import { describe, expect, it } from 'vitest';
import {
	BEAK_COLOURS,
	BODY_COLOURS,
	coerceLook,
	DEFAULT_LOOK,
	HAT_COLOURS,
	HATS,
	LOOK_COMBINATIONS,
	lookFromSeed,
	resolveLook
} from './look';
import { MAX_NAME_LENGTH, NAME_COMBINATIONS, nameFromSeed, namesFromSeed } from './names';

/** Relative luminance, the WCAG definition. Used to keep the body colours apart by lightness. */
function luminance(hex: number): number {
	const channel = (c: number) => {
		const s = c / 255;
		return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
	};
	const r = channel((hex >> 16) & 0xff);
	const g = channel((hex >> 8) & 0xff);
	const b = channel(hex & 0xff);
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

describe('the body palette', () => {
	it('offers enough looks to be worth calling customisation', () => {
		expect(LOOK_COMBINATIONS).toBeGreaterThan(500);
	});

	it('separates every pair by lightness, not only by hue', () => {
		// The rule that makes the set work for the common colour-vision deficiencies, and the reason
		// the palette is not a ring of saturated colours at one brightness. Two penguins a player
		// cannot tell apart is a death they cannot explain — which is rule 2 of `docs/DESIGN.md`.
		const lums = BODY_COLOURS.map(luminance).sort((a, b) => a - b);
		for (let i = 1; i < lums.length; i++) {
			const a = lums[i - 1];
			const b = lums[i];
			if (a === undefined || b === undefined) throw new Error('gap in palette');
			expect(b - a, `two body colours sit at the same lightness`).toBeGreaterThan(0.012);
		}
	});

	it('resolves every index to an actual colour', () => {
		for (let body = 0; body < BODY_COLOURS.length; body++) {
			for (let beak = 0; beak < BEAK_COLOURS.length; beak++) {
				const resolved = resolveLook({ body, beak, hat: 'crown', hatColour: 0 });
				expect(Number.isInteger(resolved.body)).toBe(true);
				expect(Number.isInteger(resolved.beak)).toBe(true);
			}
		}
	});
});

describe('coercing a stored look', () => {
	it('accepts one it wrote itself', () => {
		const look = { body: 3, beak: 2, hat: 'cap' as const, hatColour: 4 };
		expect(coerceLook(look)).toEqual(look);
	});

	it('clamps rather than throwing on anything unexpected', () => {
		// A look stored by an older build, or edited by hand, has to degrade to something wearable.
		// A game that refuses to start because a colour index moved is worse than a wrong hat.
		expect(coerceLook(null)).toEqual(DEFAULT_LOOK);
		expect(coerceLook('nonsense')).toEqual(DEFAULT_LOOK);
		expect(coerceLook({ body: 999, beak: -1, hat: 'sombrero', hatColour: 1.5 })).toEqual({
			body: 0,
			beak: 0,
			hat: DEFAULT_LOOK.hat,
			hatColour: 0
		});
	});

	it('never produces an index the palettes cannot resolve', () => {
		const wild = [null, {}, { body: 1e9 }, { hatColour: Number.NaN }, { hat: 42 }];
		for (const value of wild) {
			const look = coerceLook(value);
			expect(look.body).toBeLessThan(BODY_COLOURS.length);
			expect(look.beak).toBeLessThan(BEAK_COLOURS.length);
			expect(look.hatColour).toBeLessThan(HAT_COLOURS.length);
			expect(HATS).toContain(look.hat);
		}
	});
});

describe('looks from a seed', () => {
	it('is deterministic', () => {
		expect(lookFromSeed(77)).toEqual(lookFromSeed(77));
	});

	it('varies across seeds', () => {
		const seen = new Set(
			Array.from({ length: 40 }, (_, i) => JSON.stringify(lookFromSeed(i * 131)))
		);
		expect(seen.size).toBeGreaterThan(20);
	});
});

describe('the name generator', () => {
	it('offers over a thousand names', () => {
		// `docs/DECISIONS/0004` promises "thousands of combinations" as the thing that makes a
		// generator acceptable in place of a text field. That promise is checkable.
		expect(NAME_COMBINATIONS).toBeGreaterThan(1000);
	});

	it('keeps every possible name short enough for the tag over the head', () => {
		// Held over EVERY combination rather than a sample, so a long word added to either list is
		// caught by the list that pairs worst with it rather than by a player noticing a wide label.
		const seen = new Set<string>();
		for (let seed = 0; seed < 40000; seed++) seen.add(nameFromSeed(seed));
		expect(seen.size).toBeGreaterThan(NAME_COMBINATIONS * 0.9);
		for (const name of seen) {
			expect(name.length, `"${name}" is too long for the name tag`).toBeLessThanOrEqual(
				MAX_NAME_LENGTH
			);
		}
	});

	it('is deterministic', () => {
		expect(nameFromSeed(1234)).toBe(nameFromSeed(1234));
	});

	it('fills a round without repeating a name', () => {
		// Two identical tags in one round is the one collision a player actually notices.
		for (let seed = 0; seed < 200; seed++) {
			const names = namesFromSeed(seed, 6);
			expect(names).toHaveLength(6);
			expect(new Set(names).size).toBe(6);
		}
	});

	it('contains no free text anywhere in its output', () => {
		// The invariant the whole module exists for: every name is two words from two fixed lists.
		for (let seed = 0; seed < 500; seed++) {
			expect(nameFromSeed(seed)).toMatch(/^[\p{L}’]+ [\p{L}’]+$/u);
		}
	});
});
