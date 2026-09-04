/**
 * Missions: a reason to walk into a game, and somebody waiting when you come out.
 *
 * **Not simulation state, and that is the whole shape of this file.** `lib/eis.ts` already argues it
 * for the wallet and the argument transfers exactly: a `World` is pure and replayable, the same seed
 * is the same round on every device, and that is what makes the simulation testable, the bots
 * single-code-path and phase 3's host/client agreement possible at all. "Has this child been asked to
 * win a round at the Eisarena yet" is the opposite kind of fact — it is one child's history, it
 * differs per device, and it changes without a tick. A round that could read it would stop being
 * replayable.
 *
 * So the division is the same one the wallet uses: **the ROUND reports what happened — it ended, and
 * who won — and this file decides what that meant.** Nothing in `sim/` grew a field. `RoundOutcome`
 * below is deliberately the smallest thing a round already knows, and it is nearly `eis.Outcome` with
 * the mode added; a goal that needed more than this (three wins in a row, under a minute, without
 * being hit) would need the round to REPORT more, and that is a conversation to have once rather than
 * a field to sneak onto `Result`.
 *
 * **Nothing here is persisted, deliberately, in v1.** The board lives for as long as the page does,
 * which covers the trip a mission is actually about: island → game → island, across the `Game.svelte`
 * remount that a round costs. A reload forgets. That is the honest v1 rather than the lazy one —
 * `storageKeys.island` is ONE blob holding one object (`eis.ts` and story 12), and a second writer to
 * it is exactly the half-written save that key's comment exists to prevent. Persisting missions is one
 * field on `IslandSave` on the day its owner adds it, and `snapshot`/`restore` below are the seam.
 *
 * Pure of clocks and randomness: nothing here reads a date or rolls a die, so the whole lifecycle is
 * testable by calling it in order.
 */
import type { Mode } from '../sim/types';
import type { IslanderId } from './cast';

/**
 * What a mission asks for, and it is deliberately a two-member union.
 *
 * These are the only two things a finished round already tells anybody (`eis.Outcome`), and inventing
 * a third — a time, a streak, a placing — would mean either reaching into `sim/` for a number or
 * guessing one out here. A mission a child cannot verify from the result screen is a mission they
 * will believe is broken.
 */
export type MissionGoal = 'finish' | 'win';

export interface MissionSpec {
	/** Stable, and a key: the day this is persisted, this string is in a save file. Never reword it. */
	readonly id: string;
	/** Who asks, and who you hand it back to. */
	readonly by: IslanderId;
	/**
	 * Which game to go and play.
	 *
	 * A mode id used as DATA — which door this errand points at — exactly as `sim/island.ts` uses one
	 * to say which door leads where. Nothing in this file asks *which* mode it is; `report` compares
	 * the mission's mode against the round's, and neither side is a literal.
	 */
	readonly mode: Mode;
	readonly goal: MissionGoal;
	/**
	 * Eis, paid on HAND-IN rather than at the moment the round ends.
	 *
	 * Which is a design decision and not an implementation detail: the walk back is the mission. A
	 * child who is paid on the result screen has finished at the result screen, and the penguin who
	 * asked never gets their moment. It also makes the number honest — the copy says "hier ist dein
	 * Eis" at the point the Eis actually arrives.
	 *
	 * Sized against `eis.EIS_FOR_WINNING + EIS_FOR_FINISHING` (ten for a won round): a mission is worth
	 * one to two rounds, so it is a good afternoon's detour and never the only sensible way to play.
	 * Round numbers because an eight-year-old adds them up in their head.
	 */
	readonly reward: number;
	/** The offer, said once, the first time you meet them after it becomes available. */
	readonly ask: string;
	/** What they say while it is still open. Warm, never nagging in the unkind sense. */
	readonly nag: string;
	/** The hand-in. This is the line that pays. */
	readonly done: string;
}

/**
 * Where a mission has got to.
 *
 *  * `unheard` — nobody has offered it yet.
 *  * `open` — asked for, not achieved.
 *  * `achieved` — the round did it; the player has not been back yet.
 *  * `thanked` — handed in and paid. Terminal.
 */
export type MissionState = 'unheard' | 'open' | 'achieved' | 'thanked';

/** What a round tells the board. The smallest thing `Game.svelte` already knows at the result screen. */
export interface RoundOutcome {
	readonly mode: Mode;
	/**
	 * Did the round actually END?
	 *
	 * The same question `eis.Outcome` asks and for the same reason: a host who walked out never
	 * finished, and a child who put the phone down mid-Royal has not done anything yet. A player who
	 * drowned in the first ten seconds and watched the rest from a chunk of ice HAS finished it.
	 */
	readonly finished: boolean;
	readonly won: boolean;
}

/** One thing an islander owes the player right now, and the words for it. */
export interface MissionBeat {
	readonly kind: 'ask' | 'nag' | 'done';
	readonly mission: MissionSpec;
	readonly text: string;
}

/**
 * The four, one per game, one per islander who has a reason to want it.
 *
 * Four rather than a generator, and one per mode rather than a ladder, because the first version has
 * to be checkable from what a round already reports and honest about what it is: a tour of the island
 * that ends with a child having played all four games and met four penguins. What is NOT here and is
 * the obvious next thing: a mission that can be taken twice. Every one of these is terminal, so an
 * island that has been fully explored goes quiet — which is a good problem and the wrong one to solve
 * before anybody has walked it.
 *
 * The goals are matched to the mode rather than to a difficulty curve. Winning the classic round is
 * four penguins on one shrinking floe and is a fair ask; winning a Royal is one in thirty and would
 * be a mission a child never completes, so the Royal asks only that you stay to the end. Reaching the
 * shore in a chase IS winning it (`sim/chase.ts` ends the mode when somebody arrives), so `'win'`
 * there means exactly the thing the copy says.
 */
export const MISSIONS: readonly MissionSpec[] = [
	{
		id: 'arena-win',
		by: 'racer',
		mode: 'classic',
		goal: 'win',
		reward: 20,
		ask: 'Trau dich: geh rüber in die Eisarena und gewinn eine Runde. Ich leg schon mal Eis beiseite!',
		nag: 'Und? Schon gewonnen? … Noch nicht? Dann los, ich warte hier.',
		done: 'DU HAST GEWONNEN! Ich wusste es. Hier, dein Eis.'
	},
	{
		id: 'royal-finish',
		by: 'professor',
		mode: 'royal',
		goal: 'finish',
		reward: 10,
		ask: 'Für mein Buch brauche ich Daten. Spiel einmal Royal bis zum Schluss — egal, wie es ausgeht.',
		nag: 'Mein Buch hat immer noch eine Seite. Einmal Royal, bitte, bis ganz zum Ende!',
		done: 'Danke! Seite zwei ist geschrieben. Dein Eis, ganz wie versprochen.'
	},
	{
		id: 'slide-finish',
		by: 'gondolier',
		mode: 'slide',
		goal: 'finish',
		reward: 10,
		ask: 'Fahr mit rauf und rutsch einmal ganz runter. Bis unten, nicht nur bis zur Hälfte!',
		nag: 'Der Berg steht noch da. Der wartet nicht ewig. Also doch, aber trotzdem.',
		done: 'Unten angekommen! Das schafft nicht jeder beim ersten Mal. Nimm dein Eis.'
	},
	{
		id: 'chase-shore',
		by: 'lookout',
		mode: 'chase',
		goal: 'win',
		reward: 20,
		ask: 'Ich trau mich nicht. Aber du? Lauf vor der Robbe weg, bis zum Strand. Dann erzählst du es mir.',
		nag: 'Bis zum STRAND, ja? Nicht bis zur Hälfte. Ich hab extra Eis zur Seite gelegt.',
		done: 'Bis zum Strand! Und alles noch dran! Erzähl es nochmal. Hier, dein Eis.'
	}
];

/** What a board looks like from the outside. One per page; `createBoard` for a test. */
export interface Board {
	/**
	 * What this islander owes the player, or null if they have nothing to hand over or ask for.
	 *
	 * A READ: calling it twice gives the same answer and changes nothing, so `talk.ts` may ask on
	 * every poll without the player watching a mission advance because they stood still.
	 */
	beat(by: IslanderId): MissionBeat | null;
	/**
	 * The beat was actually said out loud. THIS is what advances the mission.
	 *
	 * Split from `beat` because the two happen at different moments: the conversation decides what to
	 * say from several sources and only one of them wins, and a mission marked "asked" for a line that
	 * lost to a joke is a mission the player never heard of. A `done` beat pays here — see `collect`.
	 */
	said(beat: MissionBeat): void;
	/**
	 * A round ended. Marks anything it satisfies as achieved, and says which.
	 *
	 * The return value is for the caller's own use (a sound, a line under the result). It does NOT
	 * pay: the walk back is the mission, and `collect` is where the Eis comes out.
	 */
	report(outcome: RoundOutcome): readonly MissionSpec[];
	/**
	 * Eis handed over since the last time anybody asked, and zero thereafter.
	 *
	 * A drain rather than a total, so a caller polling at ten hertz cannot pay a reward twice — which
	 * is the failure mode of every "here is a number, please credit it" interface, and one an
	 * eight-year-old would find within a minute and never report.
	 */
	collect(): number;
	stateOf(id: string): MissionState;
	/** The whole board, for a save format that does not exist yet. See the note at the top. */
	snapshot(): Readonly<Record<string, MissionState>>;
	restore(states: Readonly<Record<string, MissionState>>): void;
}

const STATES: readonly MissionState[] = ['unheard', 'open', 'achieved', 'thanked'];

export function createBoard(): Board {
	const state = new Map<string, MissionState>(MISSIONS.map((m) => [m.id, 'unheard']));
	let owed = 0;

	const stateOf = (id: string): MissionState => state.get(id) ?? 'unheard';

	return {
		beat(by) {
			// Handing one in beats being asked for the next, which beats being reminded. A child who
			// walks back with a win and is asked for something else first has been ignored.
			const mine = MISSIONS.filter((m) => m.by === by);
			const achieved = mine.find((m) => stateOf(m.id) === 'achieved');
			if (achieved) return { kind: 'done', mission: achieved, text: achieved.done };
			const unheard = mine.find((m) => stateOf(m.id) === 'unheard');
			if (unheard) return { kind: 'ask', mission: unheard, text: unheard.ask };
			const open = mine.find((m) => stateOf(m.id) === 'open');
			return open ? { kind: 'nag', mission: open, text: open.nag } : null;
		},

		said(beat) {
			if (beat.kind === 'ask' && stateOf(beat.mission.id) === 'unheard') {
				state.set(beat.mission.id, 'open');
			} else if (beat.kind === 'done' && stateOf(beat.mission.id) === 'achieved') {
				state.set(beat.mission.id, 'thanked');
				owed += beat.mission.reward;
			}
			// A `nag` changes nothing on purpose: it is the same mission being mentioned again, and a
			// state transition here would be a mission that expires because it was talked about.
		},

		report(outcome) {
			// A round nobody finished is worth nothing, exactly as it is for the wallet.
			if (!outcome.finished) return [];
			const done = MISSIONS.filter(
				(m) =>
					stateOf(m.id) === 'open' &&
					m.mode === outcome.mode &&
					(m.goal === 'finish' || outcome.won)
			);
			for (const m of done) state.set(m.id, 'achieved');
			return done;
		},

		collect() {
			const due = owed;
			owed = 0;
			return due;
		},

		stateOf,

		snapshot() {
			return Object.fromEntries(state);
		},

		restore(states) {
			for (const mission of MISSIONS) {
				const restored = states[mission.id];
				// Coerced rather than trusted, in the same spirit as `look.coerceLook` and
				// `eis.readSave`: whatever wrote this — an older build, a hand in the console — is not a
				// reason to fail on the way to the first frame. An unrecognisable state is a fresh start
				// for that mission, which costs the player one repeated errand and never the island.
				state.set(
					mission.id,
					STATES.includes(restored as MissionState) ? (restored as MissionState) : 'unheard'
				);
			}
		}
	};
}

/**
 * The board this page is playing on.
 *
 * A module singleton, and that is what makes it survive the thing it has to survive: `Game.svelte` is
 * ONE round and is remounted from scratch for the next one (trap 6), so anything held in the component
 * is gone the moment a child walks through a door. A module lives as long as the tab.
 */
export const missionBoard: Board = createBoard();
