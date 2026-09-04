import { describe, expect, it } from 'vitest';
import { EIS_FOR_FINISHING, EIS_FOR_WINNING } from '../eis';
import { ALL_MODES } from '../sim/modes/registry';
import { ISLANDERS, islanderById } from './cast';
import { type Board, createBoard, MISSIONS, type MissionSpec } from './missions';

/** The mission the tests below drive, and the islander who owns it. */
function firstMission(): MissionSpec {
	const mission = MISSIONS[0];
	if (!mission) throw new Error('the board was written with no missions on it');
	return mission;
}
const errand = firstMission();

/** Walk it to a given state, the way a player would: meet, hear, play, come back. */
function meet(board: Board) {
	const beat = board.beat(errand.by);
	if (beat) board.said(beat);
	return beat;
}

describe('what a mission is made of', () => {
	it('asks for something a finished round already reports', () => {
		// The constraint that shapes the whole feature. `eis.Outcome` is "it ended, and who won", and a
		// goal needing anything more would mean either a new field on a `Result` — economy arithmetic
		// inside the pure module — or a number guessed out here. A mission a child cannot verify from
		// the result screen is a mission they will believe is broken.
		for (const mission of MISSIONS) expect(['finish', 'win']).toContain(mission.goal);
	});

	it('points every mission at a game that exists and a penguin who lives here', () => {
		// A mission naming a retired mode is an errand nothing can ever complete; one naming a
		// character who is not in the cast is an errand nobody can hand in. Both read as "the mission
		// system is broken" and neither would throw.
		const modes = ALL_MODES.map((mode) => mode.id);
		for (const mission of MISSIONS) {
			expect(modes).toContain(mission.mode);
			expect(islanderById(mission.by)).not.toBeNull();
		}
	});

	it('gives every mission a distinct id', () => {
		// The id is the key `snapshot`/`restore` writes. A duplicate is two missions sharing one state.
		expect(new Set(MISSIONS.map((m) => m.id)).size).toBe(MISSIONS.length);
	});

	it('is worth one to two rounds, and never less than playing without one', () => {
		// The ratio is the decision. Below a won round's payout, a mission is a worse use of the same
		// minigame; far above it, ignoring the island's people becomes the wrong way to play.
		const round = EIS_FOR_FINISHING + EIS_FOR_WINNING;
		for (const mission of MISSIONS) {
			expect(mission.reward).toBeGreaterThanOrEqual(round);
			expect(mission.reward).toBeLessThanOrEqual(round * 2);
			// An eight-year-old adds these up in their head.
			expect(mission.reward % 5).toBe(0);
		}
	});

	it('gives every mission all three of its lines', () => {
		for (const mission of MISSIONS) {
			for (const line of [mission.ask, mission.nag, mission.done]) {
				expect(line.length).toBeGreaterThan(0);
				expect(line.length, line).toBeLessThanOrEqual(110);
			}
		}
	});

	it('spreads the missions over the island rather than over one penguin', () => {
		// Four errands from one character is a hub with one interesting penguin in it.
		expect(new Set(MISSIONS.map((m) => m.by)).size).toBeGreaterThanOrEqual(3);
		expect(MISSIONS.length).toBeLessThanOrEqual(ISLANDERS.length);
	});
});

describe('the lifecycle', () => {
	it('offers, then reminds, then thanks — in that order and once each', () => {
		const board = createBoard();
		expect(board.stateOf(errand.id)).toBe('unheard');

		// Meeting them offers it.
		expect(meet(board)?.kind).toBe('ask');
		expect(board.stateOf(errand.id)).toBe('open');

		// Meeting them again reminds, and a reminder is NOT a state change: a mission that expired
		// because it was mentioned twice is a mission a child loses by talking to somebody.
		expect(meet(board)?.kind).toBe('nag');
		expect(board.stateOf(errand.id)).toBe('open');

		// Doing it.
		expect(board.report({ mode: errand.mode, finished: true, won: true })).toEqual([errand]);
		expect(board.stateOf(errand.id)).toBe('achieved');

		// Handing it in, once.
		expect(meet(board)?.kind).toBe('done');
		expect(board.stateOf(errand.id)).toBe('thanked');
		expect(board.beat(errand.by)).toBeNull();
	});

	it('reads the same answer twice without advancing anything', () => {
		// `beat` is a READ and `said` is the write, and they are split because `talk.ts` polls at ten
		// hertz while it decides between a mission, an emote reply and a joke. If asking advanced the
		// mission, a child standing still would watch it complete itself.
		const board = createBoard();
		expect(board.beat(errand.by)?.kind).toBe('ask');
		expect(board.beat(errand.by)?.kind).toBe('ask');
		expect(board.stateOf(errand.id)).toBe('unheard');
	});

	it('completes nothing that was never asked for', () => {
		// Otherwise a child who played every game before meeting anybody would come back to four
		// penguins thanking them for errands they never heard of.
		const board = createBoard();
		expect(board.report({ mode: errand.mode, finished: true, won: true })).toEqual([]);
		expect(board.stateOf(errand.id)).toBe('unheard');
	});

	it('completes nothing from a round nobody finished', () => {
		// The same rule the wallet uses: a host who walked out, or a phone put down mid-Royal.
		const board = createBoard();
		meet(board);
		expect(board.report({ mode: errand.mode, finished: false, won: true })).toEqual([]);
		expect(board.stateOf(errand.id)).toBe('open');
	});

	it('completes nothing from the wrong game', () => {
		const board = createBoard();
		meet(board);
		const elsewhere = ALL_MODES.map((m) => m.id).find((id) => id !== errand.mode);
		if (!elsewhere) throw new Error('there is only one mode');
		expect(board.report({ mode: elsewhere, finished: true, won: true })).toEqual([]);
		expect(board.stateOf(errand.id)).toBe('open');
	});

	it('holds a win mission to a win and lets a finish mission through either way', () => {
		const win = MISSIONS.find((m) => m.goal === 'win');
		const finish = MISSIONS.find((m) => m.goal === 'finish');
		if (!win || !finish) throw new Error('the board needs one of each goal to check this');

		const board = createBoard();
		const offer = (by: typeof win.by) => {
			const beat = board.beat(by);
			if (beat) board.said(beat);
		};
		offer(win.by);
		offer(finish.by);

		expect(board.report({ mode: win.mode, finished: true, won: false })).toEqual([]);
		expect(board.report({ mode: finish.mode, finished: true, won: false })).toEqual([finish]);
		expect(board.report({ mode: win.mode, finished: true, won: true })).toEqual([win]);
	});
});

describe('paying for one', () => {
	it('pays on the hand-in, not on the result screen', () => {
		// The walk back IS the mission. A child paid at the result screen has finished at the result
		// screen, and the penguin who asked never gets their moment.
		const board = createBoard();
		meet(board);
		board.report({ mode: errand.mode, finished: true, won: true });
		expect(board.collect()).toBe(0);
		meet(board);
		expect(board.collect()).toBe(errand.reward);
	});

	it('pays exactly once however often it is asked', () => {
		// `collect` is a drain rather than a total, because the caller polls it at ten hertz beside the
		// rest of the readout. A "here is a number, please credit it" interface pays twice, and an
		// eight-year-old finds that within a minute and never reports it.
		const board = createBoard();
		meet(board);
		board.report({ mode: errand.mode, finished: true, won: true });
		meet(board);
		expect(board.collect()).toBe(errand.reward);
		expect(board.collect()).toBe(0);
		expect(board.collect()).toBe(0);
	});

	it('pays nothing for a reminder', () => {
		const board = createBoard();
		meet(board);
		meet(board);
		expect(board.collect()).toBe(0);
	});
});

describe('the seam a save file will use', () => {
	it('round-trips the whole board', () => {
		// Nothing persists this yet, deliberately (`storageKeys.island` is one blob with one writer).
		// The seam is tested now so that adding a field to `IslandSave` later is a field and not a
		// design.
		const board = createBoard();
		meet(board);
		board.report({ mode: errand.mode, finished: true, won: true });

		const fresh = createBoard();
		fresh.restore(board.snapshot());
		expect(fresh.stateOf(errand.id)).toBe('achieved');
		expect(fresh.beat(errand.by)?.kind).toBe('done');
	});

	it('treats anything it cannot read as a fresh start for that mission', () => {
		// The same discipline as `look.coerceLook` and `eis.readSave`: a blob from an older build or a
		// hand in the console costs the player one repeated errand, never the island.
		const board = createBoard();
		board.restore({ [errand.id]: 'ausgeliehen' as never, 'no-such-mission': 'open' as never });
		expect(board.stateOf(errand.id)).toBe('unheard');
		expect(board.stateOf('no-such-mission')).toBe('unheard');
	});
});
