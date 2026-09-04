import { describe, expect, it } from 'vitest';
import {
	floeUnder,
	groundHeight,
	groundSlope,
	ISLAND_VARIANTS,
	layout,
	moundsFor
} from './archipelago';
import {
	G,
	MOUND_MAX_HEIGHT,
	MOUND_MAX_SLOPE,
	MOUND_MIN_HEIGHT,
	MOVE_GRIP,
	ROYAL_PLAYERS
} from './constants';
import { step } from './step';
import type { InputFrame, World } from './types';
import { NO_INPUT } from './types';
import { createWorld } from './world';

/** A Royal in play, and the first floe that actually has a hill on it. */
function withAHill(): { world: World; hill: ReturnType<typeof hillOf> } {
	const world = createWorld(
		Array.from({ length: ROYAL_PLAYERS }, (_, i) => `p${i}`),
		17,
		'royal'
	);
	world.round.phase = 'playing';
	const hill = hillOf(world);
	// Everybody else taken out of the round, except one so it does not end. These tests are about
	// GROUND: twenty-nine penguins shoving each other across the subject is a different experiment,
	// and parking them all on one spot was worse than leaving them alone — they exploded apart and
	// took the penguin being measured with them.
	for (const p of world.penguins.slice(2)) p.phase = 'out';
	const spare = world.penguins[1];
	if (spare) spare.pos = { x: 0, z: 0 };
	return { world, hill };
}

function hillOf(world: World) {
	// Never the middle floe: the spare penguin is parked at the origin and the tests need it nowhere
	// near the hill being measured.
	const floe = world.floes.find((f) => f.mounds.length > 0 && f.id !== 0);
	if (!floe) throw new Error('a sea with no hills at all');
	const mound = floe.mounds[0];
	if (!mound) throw new Error('no mound');
	return {
		floe,
		mound,
		/** The middle of the hill, in world coordinates. */
		top: {
			x: floe.center.x + mound.at.x * floe.radius,
			z: floe.center.z + mound.at.z * floe.radius
		}
	};
}

describe('hills on the ice', () => {
	it('gives some islands hills and leaves others flat', () => {
		// A sea where every island has a hill is as samey as one where none do, and the flat ones are
		// where a straight fight happens.
		const withHills = Array.from({ length: ISLAND_VARIANTS }, (_, i) => moundsFor(i)).filter(
			(mounds) => mounds.length > 0
		);
		expect(withHills.length).toBeGreaterThan(0);
		expect(withHills.length).toBeLessThan(ISLAND_VARIANTS);
	});

	it('is the same hill every time it is asked', () => {
		// The renderer builds its meshes from this and the simulation builds its ground from it. Two
		// answers would be an iceberg you can see and cannot climb, or climb and cannot see.
		expect(moundsFor(1)).toEqual(moundsFor(1));
		expect(moundsFor(1)).not.toEqual(moundsFor(2));
	});

	it('rises to its full height in the middle and to nothing at its edge', () => {
		const { hill } = withAHill();
		expect(groundHeight(hill.floe, hill.top)).toBeCloseTo(hill.mound.height, 6);
		expect(hill.mound.height).toBeGreaterThanOrEqual(MOUND_MIN_HEIGHT * 0.7);
		expect(hill.mound.height).toBeLessThanOrEqual(MOUND_MAX_HEIGHT);

		const reach = hill.mound.radius * hill.floe.radius;
		const edge = { x: hill.top.x + reach + 0.01, z: hill.top.z };
		expect(groundHeight(hill.floe, edge)).toBe(0);
	});

	it('is flat where there is no hill at all', () => {
		const flat = layout(ROYAL_PLAYERS, 5).find((f) => f.mounds.length === 0);
		expect(flat).toBeDefined();
		if (flat) expect(groundHeight(flat, flat.center)).toBe(0);
	});

	it('is a ramp rather than a wall', () => {
		// The number that decides this is `MOUND_MAX_SLOPE`, and the reason is arithmetic: gravity
		// down a slope is `G · gradient` and a penguin pushes with at most `MOVE_GRIP`. The first
		// draft chose heights and left the widths alone, which produced 0.97 gradients — 9.5 m/s² of
		// gravity against 9.5 m/s² of grip, a hill that could not be climbed at any speed.
		expect(G * MOUND_MAX_SLOPE).toBeLessThan(MOVE_GRIP * 0.7);

		const { hill } = withAHill();
		const reach = hill.mound.radius * hill.floe.radius;
		let steepest = 0;
		for (let d = 0; d < reach; d += reach / 60) {
			const at = { x: hill.top.x + d, z: hill.top.z };
			const slope = groundSlope(hill.floe, at);
			steepest = Math.max(steepest, Math.hypot(slope.x, slope.z));
		}
		expect(steepest).toBeLessThanOrEqual(MOUND_MAX_SLOPE + 1e-6);
	});

	it('slopes away from the top, so standing up there is something you have to hold', () => {
		// High ground you can merely occupy is a camping spot. High ground that wants you off it is a
		// decision, which is the whole reason a hill is worth having in a game about balance.
		//
		// A slope POINTS UPHILL here — `step.ts` accelerates along `-slope` — so east of the peak it
		// points back west, toward the top. Getting this backwards turned hills into magnets.
		const { hill } = withAHill();
		const reach = hill.mound.radius * hill.floe.radius;
		const east = { x: hill.top.x + reach * 0.5, z: hill.top.z };
		const west = { x: hill.top.x - reach * 0.5, z: hill.top.z };
		expect(groundSlope(hill.floe, east).x).toBeLessThan(0);
		expect(groundSlope(hill.floe, west).x).toBeGreaterThan(0);
		// And nothing at all at the very top, which is why it is a place you can stand.
		const peak = groundSlope(hill.floe, hill.top);
		expect(Math.hypot(peak.x, peak.z)).toBeLessThan(0.01);
	});

	it('carries a penguin up when it walks onto one', () => {
		// `height` is measured from the ground under the penguin, so walking uphill keeps it at zero
		// and the RENDERER adds the hill. What this asserts is that the penguin is genuinely on top of
		// something: the ground under it has risen.
		const { world, hill } = withAHill();
		const walker = world.penguins[0];
		if (!walker) throw new Error('no penguin');
		const reach = hill.mound.radius * hill.floe.radius;
		walker.pos = { x: hill.top.x + reach * 0.9, z: hill.top.z };
		walker.vel = { x: 0, z: 0 };

		expect(groundHeight(hill.floe, walker.pos)).toBeLessThan(0.15);

		// Pushing uphill, hard, for two seconds.
		const uphill: InputFrame = { ...NO_INPUT, move: { x: -1, z: 0 } };
		for (let i = 0; i < 120; i++) step(world, new Map([[walker.id, uphill]]));

		const floe = floeUnder(world.floes, walker.pos);
		expect(floe?.id).toBe(hill.floe.id);
		if (floe) expect(groundHeight(floe, walker.pos)).toBeGreaterThan(0.3);
		// On the surface rather than hovering above it or buried in it. Within a centimetre rather
		// than exactly zero, because cresting a bump at speed genuinely does launch a penguin a
		// millimetre or two — the ground fell away faster than it did, which is the same rule that
		// makes running down a hill put air under the feet.
		expect(walker.height).toBeLessThan(0.01);
	});

	it('lets go of a penguin that stops pushing', () => {
		// Gravity down a hill uses the same term as the floe's own tilt, so a penguin that stops
		// climbing slides back — which is what makes the top of one worth reaching.
		const { world, hill } = withAHill();
		const walker = world.penguins[0];
		if (!walker) throw new Error('no penguin');
		const reach = hill.mound.radius * hill.floe.radius;
		walker.pos = { x: hill.top.x + reach * 0.45, z: hill.top.z };
		walker.vel = { x: 0, z: 0 };
		const startedAt = groundHeight(hill.floe, walker.pos);

		for (let i = 0; i < 60; i++) step(world, new Map());

		const floe = floeUnder(world.floes, walker.pos);
		if (!floe) throw new Error('slid off the floe entirely');
		expect(groundHeight(floe, walker.pos)).toBeLessThan(startedAt);
	});

	it('turns running down a hill into air under the feet', () => {
		// The other half of ground with a height: leaving it means being in the air, briefly, every
		// time you outrun the slope. Nothing in `step.ts` knows about hills to make this happen —
		// `height` is measured from the ground, and the ground dropped away faster than the penguin
		// did.
		//
		// Measured from the SIDE rather than from the peak: a cosine bump is flat on top, so stepping
		// off the very middle drops a penguin by nothing at all. It is the steep part that launches.
		const { world, hill } = withAHill();
		const runner = world.penguins[0];
		if (!runner) throw new Error('no penguin');
		const reach = hill.mound.radius * hill.floe.radius;
		runner.pos = { x: hill.top.x + reach * 0.4, z: hill.top.z };
		runner.vel = { x: 7, z: 0 };

		let airborne = false;
		for (let i = 0; i < 12 && !airborne; i++) {
			step(world, new Map());
			airborne = runner.height > 0;
		}
		expect(airborne).toBe(true);
	});
});
