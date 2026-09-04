/**
 * Walking up to somebody, and them saying something.
 *
 * The whole interaction, and it deliberately has no control attached to it: you walk close, they
 * talk. `docs/DESIGN.md` asks for a child to be playing within two seconds of opening the app, and a
 * hub whose people need a button pressed at them is a hub where most children never find out anybody
 * lives there. It is also the same discipline the doors already use (`sim/island.ts`): a PLACE rather
 * than a trigger — there is no "entered" event to miss and no "left" event to leak, so a conversation
 * cannot get stuck open behind a penguin who wandered off.
 *
 * **Stateful and world-reading, and neither is a purity violation.** `purity.test.ts` polices `sim/`
 * and this is not in it, for the reason `eis.ts` is not: who has been talked to is one child's
 * session, it differs per device, and it changes without a tick. What this file DOES keep from the
 * simulation's discipline is that it never reads a clock — time arrives as `world.tick`, so a line
 * lasts the same four seconds on a 60 Hz phone and a 120 Hz one, and a test can drive a whole
 * conversation by stepping a number. Randomness comes from a seed, so a replay of the same walk is
 * the same conversation.
 *
 * What it is NOT allowed to do, ever: repeat anything a player supplied. Every string it can produce
 * comes from `lines.ts` or `missions.ts`. See the note at the top of `lines.ts`.
 */
import type { EmoteId } from '../emote';
import { zoneUnder } from '../sim/island';
import { createRng, type Rng } from '../sim/rng';
import type { Penguin, World } from '../sim/types';
import { distanceSq } from '../sim/vec';
import { type Islander, type IslanderId, islanderAt } from './cast';
import { EMOTE_REPLIES, OWN_LINES, ZONE_LINES } from './lines';
import { type Board, type MissionSpec, missionBoard } from './missions';

/**
 * How close you have to be for somebody to talk to you, in metres.
 *
 * Under the radius of the SMALLEST zone (Der Laden, at 4 m), and that is the constraint rather than a
 * feel: a range wider than a zone means standing in the door to a minigame also means being talked at,
 * and the door sign and the speech bubble would be on screen arguing for the player's attention at the
 * exact moment they are deciding whether to play. Close enough that walking up to somebody is a thing
 * you did on purpose.
 */
export const TALK_RANGE = 3.5;

/**
 * How far the CURRENT partner has to go before the conversation actually ends, in metres.
 *
 * Wider than `TALK_RANGE` on purpose, and only for the islander already being talked to — a fresh
 * partner still has to arrive inside `TALK_RANGE` itself, so "somebody closer turns up" keeps
 * switching at once. Wanderers are the reason this exists: an islander with `bot: 'roam'` stops and
 * drifts near a landmark rather than sitting still, so a player parked at the edge of `TALK_RANGE` —
 * or an islander idling near it — crosses that one boundary back and forth for as long as they both
 * stand there. Without slack the conversation restarted from line one on every crossing (Daniel,
 * 2026-08-22: "just bip bip bip endless"), because `nearest` returned `null` for a frame and the next
 * hit reads as a brand new arrival — and `cues.ts`'s `nearestTalker` mirrors this file's rule
 * exactly, so the same flicker fired a fresh `greet` chime every time too. Ending the conversation
 * only once someone is CLEARLY gone is the same fix `hunterClose` already uses in `cues.ts` for a
 * player hovering around the chase's growl threshold.
 *
 * A partner who settles and stays somewhere in the 3.5–4.55 m band forever — rather than crossing it
 * — keeps the conversation open for as long as they do, with no separate timer cutting it short.
 * That is accepted rather than missed: a `bot: 'roam'` wanderer only ever stands at a landmark for a
 * matter of seconds before moving on (`sim/bot.ts`), which is what actually bounds it, and a player
 * choosing to stand at that exact distance on purpose is a player who gets to keep listening.
 */
export const TALK_RANGE_EXIT = TALK_RANGE * 1.3;

/**
 * The closest candidate within `range`, or — failing that — the current one if it is still within
 * `exitRange`. The one piece of logic `TALK_RANGE_EXIT`'s hysteresis actually is, factored out so
 * `cues.ts`'s `nearestTalker` and this file's own `nearest` share ONE implementation rather than two
 * copies that agree only because a comment says they must. A distance callback rather than a `Vec2`
 * field, because the two callers measure different things (an islander's own position; a penguin's).
 */
export function nearestWithSlack<T>(
	items: Iterable<T>,
	distanceSqOf: (item: T) => number,
	idOf: (item: T) => string,
	current: string | null,
	range: number,
	exitRange: number
): T | null {
	let best: T | null = null;
	let bestDistance = range * range;
	// The current partner, kept separately so they can still win by `exitRange` even on a tick where
	// nobody — themselves included — is inside the tighter `range` used above.
	let staying: T | null = null;
	const exitDistance = exitRange * exitRange;
	for (const item of items) {
		const away = distanceSqOf(item);
		if (idOf(item) === current && away < exitDistance) staying = item;
		if (away >= bestDistance) continue;
		bestDistance = away;
		best = item;
	}
	// A closer candidate — the current one or somebody new — always wins outright, which is what
	// keeps "somebody closer turns up" switching at once. Only when NOBODY is inside `range` does the
	// wider exit slack get a say, and only for whoever was already picked.
	return best ?? staying;
}

/**
 * How long one line stays up before the next, in ticks.
 *
 * Four seconds, and it is a reading speed rather than a pacing choice: the longest line in `lines.ts`
 * is about ninety characters, and a competent eight-year-old reader is at roughly one to two hundred
 * characters a minute of *comfortable* reading — three seconds to read it, one to look back at the
 * game. Every line is held to two short sentences for the same reason (`lines.ts`).
 */
export const LINE_TICKS = 240;

/** One thing being said, right now, by one penguin. */
export interface Speech {
	readonly by: IslanderId;
	/**
	 * The name over their head.
	 *
	 * The SAME string the tag carries, because a bubble attributed to somebody the child cannot find
	 * in the crowd is a bubble from nowhere — the same argument `Game.svelte`'s `nameOf` map makes
	 * about the winner of a round.
	 */
	readonly speaker: string;
	readonly text: string;
	/**
	 * The mission this line is about, or null for ordinary talk.
	 *
	 * On the speech rather than fetched again by the UI, so the bubble can show what the errand is
	 * worth beside the words that ask for it, and cannot show a different mission from the one being
	 * talked about.
	 */
	readonly mission: MissionSpec | null;
	/** The tick it started. For a fade-in, and for "is this the same line I was already showing". */
	readonly since: number;
}

export interface Conversation {
	/**
	 * Who is talking to the player right now, or null.
	 *
	 * Meant to be called from the readout poll `Game.svelte` already runs at ~10 Hz, not per frame:
	 * every decision in here is against a tick threshold or a distance, and at `WALK_SPEED` a tenth of
	 * a second is six centimetres.
	 */
	poll(world: World, meId: string): Speech | null;
	/**
	 * The player emoted. Whoever is nearby answers, in words, on the next poll.
	 *
	 * This is the entire two-way conversation this game allows and it is worth being explicit about
	 * the direction: the player chose one of six fixed symbols, and the island replies with a line we
	 * wrote. Nothing the player supplied is ever echoed, because there is nothing they can supply.
	 * An emote nobody answers is a button that makes a picture; this is what makes it a greeting.
	 */
	sawEmote(id: EmoteId): void;
}

/**
 * A conversation, seeded.
 *
 * The board is injected so a test gets a fresh one; every real caller uses the page's single
 * `missionBoard`, which outlives the `Game.svelte` remount a round costs (see `missions.ts`).
 */
export function createConversation(seed: number, board: Board = missionBoard): Conversation {
	const rng: Rng = createRng(seed);
	/** The last thing each islander said, so nobody says it twice in a row. Survives walking away. */
	const lastSaid = new Map<IslanderId, string>();

	let partner: IslanderId | null = null;
	/** Which line of THIS conversation we are on. Reset on approach — see `pick`. */
	let turn = 0;
	let speech: Speech | null = null;
	let pendingEmote: EmoteId | null = null;

	/**
	 * One line from a pool, never the one this penguin just said.
	 *
	 * The no-repeat is against what they said LAST, not against everything they have ever said: a
	 * memory of the whole conversation would walk a four-line character into silence, and hearing a
	 * joke again after two others is how a child decides it is their favourite.
	 */
	function fromPool(who: IslanderId, pool: readonly string[]): string | null {
		if (pool.length === 0) return null;
		const previous = lastSaid.get(who);
		const fresh = pool.length > 1 ? pool.filter((line) => line !== previous) : pool;
		const line = fresh[Math.floor(rng.next() * fresh.length)] ?? fresh[0];
		return line ?? null;
	}

	/**
	 * What this penguin says next.
	 *
	 * The order is the design. An emote is answered immediately, because a reply that arrives after a
	 * joke about the weather is not a reply. Then anything the mission board owes — handing one in
	 * beats being offered the next, and both beat small talk, because a child who walked back across
	 * the island with a win and got a joke has been ignored. A reminder is an OPENER only: said on
	 * arrival and never again while the player stands there, which is the difference between a penguin
	 * who is looking forward to something and a penguin who is going on about it.
	 *
	 * Then the alternation, starting with the place. That first line is what makes the island teach
	 * itself: the rules of the Royal arrive from somebody standing on the Rathausplatz, in the seconds
	 * before the child walks into it, instead of from a tutorial screen nobody reads.
	 */
	function pick(who: Islander, penguin: Penguin, tick: number): Speech {
		const emote = pendingEmote;
		pendingEmote = null;
		if (emote) {
			const reply = fromPool(who.id, EMOTE_REPLIES[emote]);
			if (reply) return say(who, reply, null, tick);
		}

		const beat = board.beat(who.id);
		if (beat && (beat.kind !== 'nag' || turn === 0)) {
			board.said(beat);
			return say(who, beat.text, beat.mission, tick);
		}

		const zone = zoneUnder(penguin);
		const here = zone ? (ZONE_LINES[zone.id] ?? []) : [];
		const own = OWN_LINES[who.id];
		// Even turns are about the place and odd ones about the penguin, and either falls back to the
		// other: a wanderer caught between two zones has nothing local to say, and a place always has.
		const wantsPlace = turn % 2 === 0;
		const line =
			(wantsPlace ? fromPool(who.id, here) : fromPool(who.id, own)) ??
			(wantsPlace ? fromPool(who.id, own) : fromPool(who.id, here));
		return say(who, line ?? '…', null, tick);
	}

	function say(who: Islander, text: string, mission: MissionSpec | null, tick: number): Speech {
		lastSaid.set(who.id, text);
		turn++;
		return { by: who.id, speaker: who.name, text, mission, since: tick };
	}

	/**
	 * The nearest islander close enough to talk, or null.
	 *
	 * Both of them have to be ON THEIR FEET, which is the same guard `zoneUnder` applies to a door and
	 * for the same reason: a line delivered mid-jump, or by somebody mid-jump, reads as the bubble
	 * belonging to whoever is behind them.
	 */
	function nearest(world: World, me: Penguin): { who: Islander; penguin: Penguin } | null {
		const candidates: { who: Islander; penguin: Penguin }[] = [];
		for (const [i, p] of world.penguins.entries()) {
			if (p.id === me.id || p.phase !== 'skating' || p.height > 0) continue;
			const who = islanderAt(i);
			if (who) candidates.push({ who, penguin: p });
		}
		return nearestWithSlack(
			candidates,
			(c) => distanceSq(c.penguin.pos, me.pos),
			(c) => c.who.id,
			partner,
			TALK_RANGE,
			TALK_RANGE_EXIT
		);
	}

	return {
		poll(world, meId) {
			const me = world.penguins.find((p) => p.id === meId);
			// An unknown id answers the same as a penguin in the water: nobody is being talked to. The
			// optional chain covers both, and `poll` is called every readout so it must never throw.
			if (me?.phase !== 'skating' || me.height > 0) {
				partner = null;
				speech = null;
				return null;
			}

			const near = nearest(world, me);
			if (!near) {
				// Walking away ends it, and clearing `partner` is what makes coming back a fresh
				// conversation rather than the middle of the old one.
				partner = null;
				speech = null;
				return null;
			}

			const arrived = near.who.id !== partner;
			if (arrived) {
				partner = near.who.id;
				turn = 0;
			}
			// A new partner, an emote to answer, or the current line has had its four seconds. The
			// emote check is before the timer so a greeting is answered at once rather than whenever
			// the line happened to run out.
			if (arrived || pendingEmote || !speech || world.tick - speech.since >= LINE_TICKS) {
				speech = pick(near.who, near.penguin, world.tick);
			}
			return speech;
		},

		sawEmote(id) {
			pendingEmote = id;
		}
	};
}
