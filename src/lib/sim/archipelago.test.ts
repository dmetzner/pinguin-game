import { describe, expect, it } from 'vitest';
import {
	floeUnder,
	gapBetween,
	JUMP_RANGE,
	layout,
	mainFloe,
	penguinsOn,
	reachableFrom,
	seaRadius,
	singleFloe,
	spawnSpots
} from './archipelago';
import {
	FLOE_RADIUS,
	JUMP_AIRTIME,
	RIM_GRACE,
	ROYAL_PLAYERS,
	ROYAL_SINK_FIRST_TICKS,
	WALK_SPEED
} from './constants';
import { sinkingRadiusAt } from './round';
import type { Penguin } from './types';
import { createWorld, spawnPenguin } from './world';

const SEEDS = Array.from({ length: 100 }, (_, i) => i * 7919 + 13);

describe('JUMP_RANGE', () => {
	it('is derived from the jump, not typed in beside it', () => {
		// Every gap in the sea is expressed against this. Typed in, it would stop being true the first
		// time anybody nudged JUMP_SPEED — and the symptom is a third of the players drowning on a
		// jump that used to work, in a mode whose entire structure is jumping between floes.
		expect(JUMP_RANGE).toBeCloseTo(WALK_SPEED * JUMP_AIRTIME, 10);
		// Sanity, in metres a person can picture: a run-up carries you a bit under three.
		expect(JUMP_RANGE).toBeGreaterThan(2);
		expect(JUMP_RANGE).toBeLessThan(4);
	});
});

describe('layout', () => {
	it('never strands a floe, and always inward', () => {
		// The one property the mode cannot survive losing. Every floe outside the middle SINKS, so a
		// floe you cannot leave in time is a death sentence handed out by the map rather than by
		// another player — and on a two-ring sea "leave" means a chain of jumps, not one hop to the
		// middle. What has to be true of every doomed floe: something within one jump of it outlives
		// it. Checked on a hundred seeds, because the gaps carry seeded jitter.
		for (const seed of SEEDS) {
			const floes = layout(ROYAL_PLAYERS, seed);
			for (const floe of floes) {
				if (floe.sinkAtTick === Infinity) continue;
				const escapes = reachableFrom(floes, floe).filter((to) => to.sinkAtTick > floe.sinkAtTick);
				expect(escapes.length).toBeGreaterThan(0);
				expect(gapBetween(floe, escapes[0] as (typeof escapes)[number])).toBeLessThanOrEqual(
					JUMP_RANGE
				);
			}
		}
	});

	it('lets every floe reach the middle by a chain of jumps', () => {
		// Reachability, not adjacency: an outer floe hangs off an inner one and the middle is two
		// jumps away. A sea with an island nobody can walk home from would only show up as players
		// mysteriously drowning at one particular sink time.
		for (const seed of SEEDS.slice(0, 25)) {
			const floes = layout(ROYAL_PLAYERS, seed);
			const reached = new Set([0]);
			for (let pass = 0; pass < floes.length; pass++) {
				for (const floe of floes) {
					if (reached.has(floe.id)) continue;
					if (reachableFrom(floes, floe).some((to) => reached.has(to.id))) reached.add(floe.id);
				}
			}
			expect(reached.size).toBe(floes.length);
		}
	});

	it('never overlaps two floes', () => {
		// Overlapping floes would give a penguin two surfaces at once, and `floeUnder` would have to
		// pick — which is a coin toss over which gradient it feels.
		for (const seed of SEEDS) {
			const floes = layout(ROYAL_PLAYERS, seed);
			for (const a of floes) {
				for (const b of floes) {
					if (a.id >= b.id) continue;
					expect(gapBetween(a, b)).toBeGreaterThan(0);
				}
			}
		}
	});

	it('keeps the middle full size and never sinks it', () => {
		// A Royal whose last ice went under would drown everybody and call it a draw. The middle is
		// also where the final few end up, so it is the arena every other number was tuned against.
		const floes = layout(ROYAL_PLAYERS, 1);
		expect(mainFloe({ floes } as never).radius).toBe(FLOE_RADIUS);
		expect(floes[0]?.sinkAtTick).toBe(Infinity);
		for (const floe of floes.slice(1)) expect(floe.sinkAtTick).toBeLessThan(Infinity);
	});

	it('takes the ring one floe at a time rather than all at once', () => {
		// The staggering is the whole clock: a sea that went under together would be one stampede,
		// and the migration is supposed to happen several times in a round.
		const sinks = layout(ROYAL_PLAYERS, 5)
			.slice(1)
			.map((f) => f.sinkAtTick);
		expect(new Set(sinks).size).toBe(sinks.length);
		expect(Math.min(...sinks)).toBe(ROYAL_SINK_FIRST_TICKS);
	});

	it('deals more floes to more players, and always at least two', () => {
		expect(layout(30, 1).length).toBeGreaterThan(layout(10, 1).length);
		// Even a tiny Royal is an archipelago: with one floe it would be the classic round wearing a
		// different name, and `isRoyal` (which asks the sea, not a flag) would answer false.
		expect(layout(2, 1).length).toBeGreaterThanOrEqual(3);
	});

	it('is the same sea for the same seed and a different one otherwise', () => {
		// Phase 3 sends a room a seed, never a map.
		expect(layout(ROYAL_PLAYERS, 42)).toEqual(layout(ROYAL_PLAYERS, 42));
		expect(layout(ROYAL_PLAYERS, 42)).not.toEqual(layout(ROYAL_PLAYERS, 43));
	});
});

describe('floeUnder', () => {
	it('finds the ice a penguin is standing on, and nothing over open water', () => {
		const floes = layout(ROYAL_PLAYERS, 3);
		const outer = floes[1];
		expect(outer).toBeDefined();
		if (!outer) return;

		expect(floeUnder(floes, outer.center)?.id).toBe(outer.id);
		// Half way across the open water between the middle's rim and this floe's: on nothing. Taken
		// from the two radii rather than from a fraction of the distance, which stopped being the gap
		// the moment the sea grew a second ring.
		const away = Math.hypot(outer.center.x, outer.center.z);
		const middleRim = FLOE_RADIUS;
		const midGap = (middleRim + (away - outer.radius)) / 2;
		const between = {
			x: (outer.center.x / away) * midGap,
			z: (outer.center.z / away) * midGap
		};
		expect(floeUnder(floes, between)).toBeNull();
	});

	it('agrees with the rim grace the step uses', () => {
		// `step.ts` drowns a penguin when this returns null, so the two have to draw the rim in the
		// same place. A penguin a centimetre inside the grace band is still standing.
		const floes = singleFloe();
		const edge = { x: FLOE_RADIUS + RIM_GRACE - 0.01, z: 0 };
		const past = { x: FLOE_RADIUS + RIM_GRACE + 0.01, z: 0 };
		expect(floeUnder(floes, edge)).not.toBeNull();
		expect(floeUnder(floes, past)).toBeNull();
	});

	it('does not claim anybody once it has sunk', () => {
		const floes = layout(ROYAL_PLAYERS, 9);
		const doomed = floes[1];
		expect(doomed).toBeDefined();
		if (!doomed) return;
		const standing = { ...doomed.center };
		doomed.radius = sinkingRadiusAt(doomed, doomed.sinkAtTick + 10_000);
		expect(doomed.radius).toBe(0);
		expect(floeUnder(floes, standing)).toBeNull();
	});
});

describe('reachableFrom', () => {
	it('puts the longest-lived escape first', () => {
		// Ranked rather than filtered: on a two-ring sea an outer floe's only neighbour is its parent,
		// which is itself doomed, so refusing to consider sinking ice would leave a bot standing on
		// melting ice with nowhere it was willing to go. Order is the answer — take the ice that
		// outlives everything else you can reach.
		const floes = layout(ROYAL_PLAYERS, 11);
		for (const floe of floes) {
			const options = reachableFrom(floes, floe);
			if (options.length === 0) continue;
			const lives = options.map((f) => f.sinkAtTick);
			expect(lives[0]).toBe(Math.max(...lives));
		}
	});

	it('offers the middle to the inner ring', () => {
		// The inner ring is laid out around the middle at one jump, so the safest ice in the sea is
		// always one hop away from it.
		const floes = layout(ROYAL_PLAYERS, 11);
		const inner = floes.filter((f) => Math.hypot(f.center.x, f.center.z) < FLOE_RADIUS * 3);
		for (const floe of inner.slice(1)) {
			expect(reachableFrom(floes, floe)[0]?.id).toBe(0);
		}
	});
});

describe('spawnSpots', () => {
	it('gives everybody a spot, on ice', () => {
		for (const seed of [1, 2, 3, 99]) {
			const floes = layout(ROYAL_PLAYERS, seed);
			const spots = spawnSpots(floes, ROYAL_PLAYERS, seed);
			expect(spots).toHaveLength(ROYAL_PLAYERS);
			for (const spot of spots) expect(floeUnder(floes, spot)).not.toBeNull();
		}
	});

	it('fills the outer ring before the middle', () => {
		// The middle is where a Royal ENDS. Starting it crowded there skips the migration the whole
		// mode is about.
		const floes = layout(ROYAL_PLAYERS, 7);
		const spots = spawnSpots(floes, ROYAL_PLAYERS, 7);
		const onMiddle = spots.filter((spot) => floeUnder(floes, spot)?.id === 0).length;
		expect(onMiddle).toBeLessThan(ROYAL_PLAYERS / floes.length + 2);
	});

	it('never spawns two penguins on top of each other', () => {
		// The classic spawn's rule, per floe: a spawn inside shoving distance decides the round
		// before anybody has touched the screen.
		const floes = layout(ROYAL_PLAYERS, 21);
		const spots = spawnSpots(floes, ROYAL_PLAYERS, 21);
		for (let i = 0; i < spots.length; i++) {
			for (let j = i + 1; j < spots.length; j++) {
				const a = spots[i];
				const b = spots[j];
				if (!a || !b) continue;
				expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(1);
			}
		}
	});
});

describe('penguinsOn', () => {
	const floes = layout(ROYAL_PLAYERS, 4);

	it('counts only who is standing on THIS floe', () => {
		const outer = floes[1];
		const other = floes[2];
		expect(outer && other).toBeTruthy();
		if (!outer || !other) return;

		const here = spawnPenguin('here', outer.center);
		const there = spawnPenguin('there', other.center);
		expect(penguinsOn(outer, [here, there]).map((p) => p.id)).toEqual(['here']);
	});

	it('ignores anyone in the air or in the water', () => {
		// The same rule `weightTargetSlope` has always had: a penguin mid-jump is not pressing on
		// anything, and one halfway between two floes must not tilt either of them.
		const outer = floes[1];
		if (!outer) return;
		const jumping: Penguin = { ...spawnPenguin('jumping', outer.center), height: 0.6 };
		const gone: Penguin = { ...spawnPenguin('gone', outer.center), phase: 'out' };
		expect(penguinsOn(outer, [jumping, gone])).toEqual([]);
	});
});

describe('seaRadius', () => {
	it('reaches past the furthest rim in the sea', () => {
		const royal = createWorld(
			Array.from({ length: ROYAL_PLAYERS }, (_, i) => `p${i}`),
			5,
			'royal'
		);
		for (const floe of royal.floes) {
			expect(seaRadius(royal)).toBeGreaterThanOrEqual(
				Math.hypot(floe.center.x, floe.center.z) + floe.radius - 1e-9
			);
		}
		// The classic round is one floe at the origin, so the sea is exactly that floe.
		expect(seaRadius(createWorld(['a'], 1))).toBeCloseTo(FLOE_RADIUS);
	});
});
