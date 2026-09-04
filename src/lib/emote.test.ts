import { describe, expect, it } from 'vitest';
import {
	EMOTE_GAP_TICKS,
	EMOTES,
	type EmoteBurst,
	emoteById,
	emoteProgress,
	emoteReady,
	startEmote
} from './emote';

/**
 * The emote set, which is the only thing a player is allowed to say.
 *
 * The integrity checks below are not tidiness. This list is consumed by three people — the animator,
 * the picker and the bubble — and the whole reason it is one list is that a second one would disagree
 * with it. So what is asserted is the properties each of those three relies on: ids are unique and
 * stable, every emote has something to draw at every size, and the duration the animation reads is
 * the duration the cooldown enforces.
 */
describe('the emote set', () => {
	it('is small enough to be a fixed set rather than a keyboard', () => {
		// `docs/DECISIONS/0004` allows "a fixed set of emotes" and the whole safety argument is that the
		// channel has no capacity. A picker that grew to thirty would still be "fixed" and would no
		// longer be that. Six chips is also what fits one row of thumb-sized buttons.
		expect(EMOTES.length).toBeGreaterThanOrEqual(3);
		expect(EMOTES.length).toBeLessThanOrEqual(8);
	});

	it('has the three the owner asked for', () => {
		// Hearts, angry, dance (2026-08-21). Named explicitly so a future trim cannot quietly drop one.
		expect(emoteById('heart')).not.toBeNull();
		expect(emoteById('grumpy')).not.toBeNull();
		expect(emoteById('dance')).not.toBeNull();
	});

	it('gives every id exactly one emote', () => {
		// A duplicate id is a `find` that silently returns the first one, and an animation that plays
		// the wrong length for the emote the picker thinks it drew.
		const ids = EMOTES.map((emote) => emote.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it('gives every emote something for a reader, a glance and a screen reader', () => {
		for (const emote of EMOTES) {
			// The glyph is what a child who cannot yet read the label sees, and the aria line is the
			// only thing a screen reader gets — "Grr!" on its own says nothing.
			expect(emote.glyph.length).toBeGreaterThan(0);
			expect(emote.label.length).toBeGreaterThan(0);
			expect(emote.label.length).toBeLessThanOrEqual(8);
			expect(emote.aria.length).toBeGreaterThan(emote.label.length);
		}
	});

	it('lasts long enough to be seen and not long enough to be a nuisance', () => {
		for (const emote of EMOTES) {
			// Under a second is a frame of animation nobody across the square notices; over five is a
			// penguin stuck in a pose while its player is trying to walk away from it.
			expect(emote.ticks).toBeGreaterThanOrEqual(60);
			expect(emote.ticks).toBeLessThanOrEqual(300);
		}
	});

	it('decodes an unknown id instead of throwing', () => {
		// Phase 3 sends this string. A client meeting a build with a seventh emote must show nothing,
		// exactly as `resolveMode` degrades on an unknown minigame — never die at the first frame.
		expect(emoteById('breakdance')).toBeNull();
		expect(emoteById('')).toBeNull();
	});
});

describe('playing one', () => {
	const first = EMOTES[0];
	if (!first) throw new Error('the emote set is empty');

	it('runs for exactly as long as the emote says', () => {
		const burst = startEmote(first.id, 'me', 100, null);
		expect(burst?.until).toBe(100 + first.ticks);
	});

	it('reports a phase while it plays and nothing after', () => {
		const burst = startEmote(first.id, 'me', 100, null) as EmoteBurst;
		// A phase rather than a boolean, because that is what the animation needs — and the frame the
		// emote ends on has to report nothing, or the body holds its last pose for a frame.
		expect(emoteProgress(burst, 100)).toBe(0);
		expect(emoteProgress(burst, 100 + first.ticks / 2)).toBeCloseTo(0.5, 5);
		expect(emoteProgress(burst, 100 + first.ticks)).toBeNull();
		expect(emoteProgress(burst, 99)).toBeNull();
		expect(emoteProgress(null, 100)).toBeNull();
	});

	it('refuses a second one until the last has finished and the gap has passed', () => {
		// The gap is the rule that stops six symbols becoming a rhythm two children can agree on. A
		// press during it is DROPPED rather than queued: a queue is a performance the child cannot stop.
		const burst = startEmote('heart', 'me', 0, null) as EmoteBurst;
		expect(startEmote('grumpy', 'me', burst.until - 1, burst)).toBeNull();
		expect(startEmote('grumpy', 'me', burst.until + EMOTE_GAP_TICKS - 1, burst)).toBeNull();
		expect(startEmote('grumpy', 'me', burst.until + EMOTE_GAP_TICKS, burst)).not.toBeNull();
	});

	it('agrees with itself about when the picker may light up again', () => {
		// `emoteReady` is what greys the buttons out and `startEmote` is what actually refuses. Two
		// answers to one question is a button that looks pressable and does nothing — trap 4's shape.
		const burst = startEmote('dance', 'me', 0, null) as EmoteBurst;
		for (const tick of [
			0,
			30,
			burst.until,
			burst.until + EMOTE_GAP_TICKS - 1,
			burst.until + EMOTE_GAP_TICKS
		]) {
			expect(emoteReady(burst, tick)).toBe(startEmote('wave', 'me', tick, burst) !== null);
		}
		expect(emoteReady(null, 0)).toBe(true);
	});

	it('will not start an emote that does not exist', () => {
		// The picker cannot produce one, but the wire can.
		expect(startEmote('shrug' as never, 'me', 0, null)).toBeNull();
	});
});
