import { describe, expect, it } from 'vitest';
import { EMOTES } from '../emote';
import { ISLAND_ZONES } from '../sim/island';
import { ISLANDERS } from './cast';
import { EMOTE_REPLIES, OWN_LINES, ZONE_LINES } from './lines';

/** Every line the island can say, from all three pools. */
const everything = [
	...Object.values(ZONE_LINES).flat(),
	...Object.values(OWN_LINES).flat(),
	...Object.values(EMOTE_REPLIES).flat()
];

/**
 * The copy, held to the two rules it can actually be held to.
 *
 * A test cannot judge whether a joke is funny, and this one does not try. What it CAN check is
 * coverage — that no place and no emote can be reached with nothing to say, which shows up on screen
 * as a penguin saying "…" — and length, which is the one property that decides whether a child reads
 * the bubble or walks away from it.
 */
describe('what the island can say', () => {
	it('has something to say about every place on it', () => {
		// A zone with no pool is a penguin standing at a door explaining nothing, which is where the
		// rules of every minigame come from. Four is the floor because `talk.ts` alternates place and
		// character, so a four-line pool is eight lines of standing still before anything repeats.
		for (const zone of ISLAND_ZONES) {
			expect(ZONE_LINES[zone.id]?.length ?? 0).toBeGreaterThanOrEqual(4);
		}
	});

	it('has no lines about a place that does not exist', () => {
		// The other direction, and it is the one that rots silently: a zone renamed in `sim/island.ts`
		// leaves its pool here, unreachable, looking exactly like working content.
		const zones = ISLAND_ZONES.map((zone) => zone.id);
		for (const id of Object.keys(ZONE_LINES)) expect(zones).toContain(id);
	});

	it('gives every character something of their own', () => {
		for (const one of ISLANDERS) {
			expect(OWN_LINES[one.id].length).toBeGreaterThanOrEqual(4);
		}
	});

	it('answers every emote there is', () => {
		// An emote nobody answers is a button that makes a picture. This is the pool that makes it a
		// greeting, so a seventh emote added without a reply pool must fail here rather than on screen.
		for (const emote of EMOTES) {
			expect(EMOTE_REPLIES[emote.id].length).toBeGreaterThanOrEqual(2);
		}
	});

	it('keeps every line short enough to read while playing', () => {
		// The bubble sits over a running game and a child who has to stop and read has stopped playing.
		// 110 characters is about two short sentences in German, which is the house rule in `lines.ts`,
		// and it is what `LINE_TICKS` was chosen against — a longer line is one the next line
		// interrupts.
		for (const line of everything) {
			expect(line.length).toBeGreaterThan(0);
			expect(line.length, line).toBeLessThanOrEqual(110);
		}
	});

	it('never repeats a line between pools', () => {
		// A duplicate defeats the no-immediate-repeat rule in `talk.ts`, which compares strings: two
		// copies of one line in a pool is a penguin allowed to repeat itself after all.
		expect(new Set(everything).size).toBe(everything.length);
	});

	it('never spells out a character name', () => {
		// The names are DRAWN from the generator (`cast.ts`) and re-roll if a word list grows. A line
		// that spelled one out would be both the first hand-typed name in the game and a line that goes
		// wrong the day somebody adds a word to `names.ts`.
		for (const one of ISLANDERS) {
			for (const line of everything) expect(line).not.toContain(one.name);
		}
	});
});
