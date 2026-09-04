import { describe, expect, it } from 'vitest';
import { shortestTurn } from './loop';

/**
 * `loop.ts` needs a `requestAnimationFrame` and a canvas, so the loop itself is e2e territory.
 * `shortestTurn` is neither, and it is the piece with an actual edge case in it.
 */
describe('shortestTurn', () => {
	it('takes the short way across the ±π seam', () => {
		// The bug it exists for is very visible: a penguin skating past due south spins a full
		// pirouette back through zero because the interpolation walked the long way round.
		const nearlyPi = Math.PI - 0.1;
		const justOver = -Math.PI + 0.1;
		expect(shortestTurn(nearlyPi, justOver)).toBeCloseTo(0.2);
		expect(shortestTurn(justOver, nearlyPi)).toBeCloseTo(-0.2);
	});

	it('is a plain difference away from the seam', () => {
		expect(shortestTurn(0.2, 0.8)).toBeCloseTo(0.6);
		expect(shortestTurn(0.8, 0.2)).toBeCloseTo(-0.6);
	});

	it('never returns more than half a turn', () => {
		for (let a = -8; a < 8; a += 0.13) {
			for (let b = -8; b < 8; b += 0.17) {
				expect(Math.abs(shortestTurn(a, b))).toBeLessThanOrEqual(Math.PI + 1e-9);
			}
		}
	});

	it('lands on the target angle when applied in full', () => {
		const wrap = (x: number) => Math.atan2(Math.sin(x), Math.cos(x));
		for (let a = -3; a < 3; a += 0.29) {
			for (let b = -3; b < 3; b += 0.31) {
				expect(wrap(a + shortestTurn(a, b))).toBeCloseTo(wrap(b), 6);
			}
		}
	});
});
