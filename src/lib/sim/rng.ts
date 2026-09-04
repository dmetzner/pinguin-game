/**
 * A seeded pseudo-random generator, because `Math.random()` is banned inside the simulation.
 *
 * The ban is not tidiness. From phase 3 the host and every client run this same code over the same
 * inputs and must reach the same world; a single unseeded call anywhere in `sim/` makes that
 * impossible and — worse — makes it impossible *intermittently*, which is the hardest class of
 * networking bug there is. It is also what lets a test replay a round and get the same answer.
 *
 * mulberry32: 32-bit state, one multiply-shift round, uniform enough for spawn jitter and wave
 * phases and small enough to hold in the head. Nothing here is cryptographic and nothing should be.
 */
export interface Rng {
	/** Advance and return a float in [0, 1). */
	next(): number;
}

export function createRng(seed: number): Rng {
	// `>>> 0` pins the state to an unsigned 32-bit integer up front, so a caller passing a negative
	// or fractional seed gets a valid generator rather than NaN forever after.
	let s = seed >>> 0;
	return {
		next() {
			s = (s + 0x6d2b79f5) >>> 0;
			let t = s;
			t = Math.imul(t ^ (t >>> 15), t | 1);
			t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
			return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
		}
	};
}

/** A float in [min, max). */
export function range(rng: Rng, min: number, max: number): number {
	return min + rng.next() * (max - min);
}
