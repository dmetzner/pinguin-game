import { describe, expect, it } from 'vitest';
import { DT, FLOE_RADIUS, MAX_SLOPE, SWELL_AMPLITUDE, WEIGHT_TILT } from './constants';
import { stepFloe, swellAt, weightTargetSlope } from './floe';
import type { Floe, Penguin } from './types';
import { length, sub } from './vec';

function penguin(x: number, z: number, over: Partial<Penguin> = {}): Penguin {
	return {
		id: `p${x}_${z}`,
		pos: { x, z },
		vel: { x: 0, z: 0 },
		height: 0,
		heightVel: 0,
		facing: 0,
		phase: 'skating',
		fallTicks: 0,
		stunTicks: 0,
		dashCooldown: 0,
		throwCooldown: 0,
		airJumps: 1,
		...over
	};
}

function floe(): Floe {
	return {
		id: 0,
		center: { x: 0, z: 0 },
		radius: FLOE_RADIUS,
		fullRadius: FLOE_RADIUS,
		slope: { x: 0, z: 0 },
		weightSlope: { x: 0, z: 0 },
		sinkAtTick: Infinity,
		piece: false,
		sinkTicks: 0,
		breakAngle: 0,
		drift: { x: 0, z: 0 },
		mounds: [],
		shape: 0,
		altitude: 0,
		along: 0,
		anchored: false,
		openSide: 0,
		tilt: { x: 0, z: 0 }
	};
}

describe('swell', () => {
	it('never exceeds its own amplitude on either axis', () => {
		for (let t = 0; t < 300; t += 0.05) {
			const s = swellAt(t);
			expect(Math.abs(s.x)).toBeLessThanOrEqual(SWELL_AMPLITUDE + 1e-9);
			expect(Math.abs(s.z)).toBeLessThanOrEqual(SWELL_AMPLITUDE + 1e-9);
		}
	});

	it('does not repeat inside a round', () => {
		// A rhythm the player memorises is a floe that has stopped being a threat. The first
		// version of this test asserted the two axes never peak TOGETHER, which is not a property
		// two incommensurable sines have — they come arbitrarily close eventually, and it fired 85
		// times in three minutes. What is actually wanted is the weaker, true statement: no short
		// period reproduces the pattern.
		for (let period = 1; period <= 60; period += 0.5) {
			let maxDeviation = 0;
			for (let t = 0; t < 90; t += 0.25) {
				const a = swellAt(t);
				const b = swellAt(t + period);
				maxDeviation = Math.max(maxDeviation, length(sub(a, b)));
			}
			// The chosen pair's worst near-repeat measures 0.74 × amplitude; the threshold sits at
			// 0.5 so an ordinary re-tune has room, and anything that drops to the 0.38 × of the
			// original hand-picked frequencies goes red with the offending period named.
			expect(maxDeviation, `swell repeats with a period of ${period}s`).toBeGreaterThan(
				SWELL_AMPLITUDE * 0.5
			);
		}
	});

	it('tips the floe in every direction rather than along one line', () => {
		// Two sines sharing a frequency would confine the gradient to a fixed diagonal, so the floe
		// would only ever tilt one way and the safe spot would be the same every round. Checking
		// that all four quadrants get used is the cheap way to catch that.
		const quadrants = new Set<number>();
		for (let t = 0; t < 120; t += 0.1) {
			const s = swellAt(t);
			if (length(s) < SWELL_AMPLITUDE * 0.5) continue;
			quadrants.add((s.x > 0 ? 1 : 0) + (s.z > 0 ? 2 : 0));
		}
		expect(quadrants.size).toBe(4);
	});

	it('reads a clock nowhere — the same second always gives the same tilt', () => {
		expect(swellAt(42.5)).toEqual(swellAt(42.5));
	});
});

describe('weight', () => {
	it('tips toward where the crowd is standing', () => {
		const target = weightTargetSlope([penguin(FLOE_RADIUS * 0.8, 0)], FLOE_RADIUS);
		// The gradient points UPHILL, so a crowd at +x makes a +x gradient, and downhill (-gradient)
		// runs toward them. That sign is the mechanic; flipping it makes the floe repel people.
		expect(target.x).toBeGreaterThan(0);
		expect(target.z).toBeCloseTo(0);
	});

	it('is flat when the crowd is balanced', () => {
		const target = weightTargetSlope([penguin(4, 0), penguin(-4, 0)], FLOE_RADIUS);
		expect(target.x).toBeCloseTo(0);
		expect(target.z).toBeCloseTo(0);
	});

	it('reaches WEIGHT_TILT only with everyone at the very rim', () => {
		const atRim = weightTargetSlope([penguin(FLOE_RADIUS, 0)], FLOE_RADIUS);
		expect(atRim.x).toBeCloseTo(WEIGHT_TILT);
	});

	it('ignores penguins that are in the air', () => {
		// A penguin mid-jump is not pressing on anything. Without this the floe answers a hop, which
		// both looks wrong and hands every player a free tilt button.
		const target = weightTargetSlope([penguin(FLOE_RADIUS * 0.8, 0, { height: 1.1 })], FLOE_RADIUS);
		expect(target.x).toBe(0);
		expect(target.z).toBe(0);
	});

	it('ignores penguins that have already fallen off', () => {
		// This one was a real bug before it was a rule: eliminated penguins keep a position, so the
		// last player standing was being tipped by the accumulated ghosts of everyone they had beaten.
		const ghosts = [
			penguin(FLOE_RADIUS, 0, { phase: 'out' }),
			penguin(FLOE_RADIUS, 1, { phase: 'falling' })
		];
		const target = weightTargetSlope([...ghosts, penguin(0, 0)], FLOE_RADIUS);
		expect(target.x).toBeCloseTo(0);
		expect(target.z).toBeCloseTo(0);
	});

	it('lags behind the crowd rather than answering instantly', () => {
		// The lag is the read: the tilt has to arrive a moment AFTER the crowd commits, so a player
		// who saw it coming can already be moving.
		const f = floe();
		const crowd = [penguin(FLOE_RADIUS * 0.9, 0)];
		const target = weightTargetSlope(crowd, FLOE_RADIUS);

		stepFloe(f, crowd, 0, DT);
		expect(f.weightSlope.x).toBeGreaterThan(0);
		expect(f.weightSlope.x).toBeLessThan(target.x * 0.2);

		for (let i = 0; i < 300; i++) stepFloe(f, crowd, i / 60, DT);
		expect(f.weightSlope.x).toBeCloseTo(target.x, 2);
	});
});

describe('the combined gradient', () => {
	it('never exceeds MAX_SLOPE even when swell and weight peak together', () => {
		// Capping the two parts separately would let them stack past the cap at exactly the moment
		// the cap exists for. Drive the worst case: everyone jammed against one rim, for minutes,
		// so every swell phase gets tried against a fully committed weight tilt.
		const f = floe();
		const crowd = [penguin(FLOE_RADIUS, 0), penguin(FLOE_RADIUS - 0.2, 0.3)];
		for (let i = 0; i < 60 * 200; i++) {
			stepFloe(f, crowd, i / 60, DT);
			expect(length(f.slope)).toBeLessThanOrEqual(MAX_SLOPE + 1e-9);
		}
	});

	it('is flat at rest with nobody on the ice', () => {
		const f = floe();
		stepFloe(f, [], 0, DT);
		// Swell at t=0 is not zero on the z axis (it carries a phase offset), so the assertion is
		// about the weight component only.
		expect(f.weightSlope.x).toBe(0);
		expect(f.weightSlope.z).toBe(0);
	});

	it('smooths identically regardless of the timestep it is given', () => {
		// `1 - exp(-rate·dt)` rather than `rate·dt`, so a dropped frame cannot change the physics.
		const crowd = [penguin(FLOE_RADIUS * 0.8, 0)];
		const fine = floe();
		for (let i = 0; i < 120; i++) stepFloe(fine, crowd, i / 120, 1 / 120);
		const coarse = floe();
		for (let i = 0; i < 60; i++) stepFloe(coarse, crowd, i / 60, DT);
		expect(fine.weightSlope.x).toBeCloseTo(coarse.weightSlope.x, 3);
	});
});
