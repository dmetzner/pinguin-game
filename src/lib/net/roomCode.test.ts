import { describe, expect, it } from 'vitest';
import {
	normaliseRoomCode,
	ROOM_CODE_LENGTH,
	ROOM_CODES,
	roomCodeFromSeed,
	seedFromCode
} from './roomCode';

/** Every code the generator can produce, once each. */
function allCodes(): string[] {
	return Array.from({ length: ROOM_CODES }, (_, i) => roomCodeFromSeed(i));
}

describe('a code a child can read out', () => {
	it('offers far more rooms than will ever be open at once', () => {
		// 17 consonants × 3 vowels, twice over, less the handful that spell something.
		expect(ROOM_CODES).toBeGreaterThan(2000);
	});

	it('is always pronounceable', () => {
		// Consonant–vowel–consonant–vowel, so every code is a nonsense WORD rather than four letters
		// to be spelled out one at a time. A code you can say is a code you can shout across a table.
		for (const code of allCodes()) {
			expect(code, `${code} is not sayable`).toMatch(
				/^[BDFGHJKLMNPRSTWXZ][AEU][BDFGHJKLMNPRSTWXZ][AEU]$/
			);
			expect(code).toHaveLength(ROOM_CODE_LENGTH);
		}
	});

	it('never uses a letter that looks or sounds like another one', () => {
		// I against l and 1, O against 0, C against K, V against F. On a phone screen at arm's length
		// those are the same glyph, and a code that cannot be copied is not a code.
		for (const code of allCodes()) {
			expect(code, `${code} contains a lookalike`).not.toMatch(/[IOQYCV]/);
		}
	});

	it('never spells one of the words it could accidentally spell', () => {
		// Checked over EVERY code rather than a sample. The pattern can only make four-letter nonsense,
		// so the accidents are few and knowable — which is exactly why the whole set is walked.
		const codes = allCodes();
		for (const code of codes) expect(['FUDE', 'HURE', 'KAKA', 'PUPU']).not.toContain(code);
	});

	it('gives every seed its own room', () => {
		// One seed to exactly one code. The first version generated arithmetically and stepped PAST a
		// blocked code, which silently sent two different seeds to the same room.
		expect(new Set(allCodes()).size).toBe(ROOM_CODES);
	});

	it('gives the same code for the same seed', () => {
		expect(roomCodeFromSeed(12345)).toBe(roomCodeFromSeed(12345));
		expect(roomCodeFromSeed(-1)).toBe(roomCodeFromSeed(ROOM_CODES - 1));
	});
});

describe('reading a code back in', () => {
	it('accepts a code exactly as it was shown', () => {
		for (const code of allCodes().slice(0, 200)) expect(normaliseRoomCode(code)).toBe(code);
	});

	it('forgives everything a child actually types', () => {
		// Lower case and a stray space, first — the ordinary ones.
		expect(normaliseRoomCode('duke')).toBe('DUKE');
		expect(normaliseRoomCode(' Du ke ')).toBe('DUKE');

		// Then the misreadings, which only make sense where a CONSONANT belongs: a displayed D reads
		// as an O or a zero, a displayed L as an I or a one. In a vowel position the same character
		// means nothing, because no code ever shows a consonant there.
		expect(normaliseRoomCode('0UKE')).toBe('DUKE');
		expect(normaliseRoomCode('OUKE')).toBe('DUKE');
		expect(normaliseRoomCode('BA1A')).toBe('BALA');
		expect(normaliseRoomCode('BAIA')).toBe('BALA');
		expect(normaliseRoomCode('5UKE')).toBe('SUKE');

		// C and V never appear in a code, so somebody who typed them heard K and F.
		expect(normaliseRoomCode('CUKA')).toBe('KUKA');
		expect(normaliseRoomCode('VUKA')).toBe('FUKA');
	});

	it('rejects what is not a code at all rather than guessing', () => {
		expect(normaliseRoomCode('')).toBeNull();
		expect(normaliseRoomCode('BOL')).toBeNull();
		expect(normaliseRoomCode('BOLAX')).toBeNull();
		// Right length, wrong shape: a vowel where a consonant belongs.
		expect(normaliseRoomCode('ABLA')).toBeNull();
		expect(normaliseRoomCode('1234')).toBeNull();
		// A consonant misreading in a vowel slot is not a code, and guessing one would be worse than
		// saying so: it would drop a child into somebody else's room.
		expect(normaliseRoomCode('B0LA')).toBeNull();
		// And a code the generator refuses to hand out cannot be joined either.
		expect(normaliseRoomCode('kaka')).toBeNull();
	});
});

describe('the seed behind the code', () => {
	it('lets every peer agree on the round without sending anything', () => {
		expect(seedFromCode('BDLA')).toBe(seedFromCode('BDLA'));
	});

	it('does not put neighbouring codes on neighbouring seeds', () => {
		// Two codes one letter apart producing two seeds one apart would give visibly similar
		// starting rings, and a rematch in the next room along would feel like the same round.
		const a = seedFromCode(roomCodeFromSeed(100));
		const b = seedFromCode(roomCodeFromSeed(101));
		expect(Math.abs(a - b)).toBeGreaterThan(1000);
	});

	it('spreads across the whole range rather than clustering', () => {
		const seeds = allCodes().map(seedFromCode);
		expect(new Set(seeds).size).toBeGreaterThan(ROOM_CODES * 0.99);
	});
});
