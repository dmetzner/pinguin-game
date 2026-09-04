/**
 * A penguin as it arrives, and the arrangements it can arrive in.
 *
 * Split out of `world.ts` so that a mode descriptor (`sim/modes/`) can pick its own arrangement
 * without `world.ts` and `sim/modes/` importing each other. `world.ts` still re-exports
 * `spawnPenguin`, which is where every caller has always found it.
 */
import { spawnSpots } from './archipelago';
import { AIR_JUMPS, FLOE_RADIUS } from './constants';
import { createRng, range } from './rng';
import type { Floe, Penguin, Vec2 } from './types';
import { distanceSq, heading, sub, ZERO } from './vec';

/** One arrangement: `ids` on `floes`, from `seed`. Every mode's `spawn` has this shape. */
export type Arrangement = (
	ids: readonly string[],
	floes: readonly Floe[],
	seed: number
) => Penguin[];

/**
 * A penguin as it exists the moment it arrives on the ice.
 *
 * The ONE definition of what a fresh penguin is, used both by `createWorld` and by `respawn`. It was
 * two definitions to begin with, and that is a trap rather than a duplication: `respawn` only
 * assigns fields, so adding one to `Penguin` makes `createWorld` a type error and leaves `respawn`
 * silently stale. Phase 1 adds exactly that kind of field — a stun timer — and a penguin that
 * surfaces from the water still stunned is a bug that shows up once every few rounds and reads as a
 * physics glitch.
 */
export function spawnPenguin(id: string, pos: Vec2, floeCentre: Vec2 = ZERO): Penguin {
	return {
		id,
		pos,
		vel: ZERO,
		height: 0,
		heightVel: 0,
		// Facing the middle of the ice it is standing on. Everyone starts looking at the fight, which
		// reads as intent and saves a beginner the first confusing second of "which way am I
		// pointing". In a Royal that is the middle of THIS floe, not the middle of the sea.
		facing: heading(sub(floeCentre, pos)),
		phase: 'skating',
		fallTicks: 0,
		stunTicks: 0,
		dashCooldown: 0,
		throwCooldown: 0,
		airJumps: AIR_JUMPS
	};
}

/**
 * Place one penguin per id evenly around a ring, with a little seeded jitter.
 *
 * Evenly, because a spawn that puts two players within shoving distance of each other decides the
 * round before anyone has touched the screen. At 55% of the radius: far enough apart to breathe,
 * close enough that nobody starts the round already in danger from the rim.
 *
 * The jitter is deliberately small and deliberately seeded — it exists so that a rematch does not
 * feel like a rerun, not so that anyone gets a worse position than anyone else.
 */
export const spawnOnOneFloe: Arrangement = (ids, floes, seed) => {
	const radius = floes[0]?.radius ?? FLOE_RADIUS;
	const rng = createRng(seed);
	const ringRadius = radius * 0.55;
	const offset = range(rng, 0, Math.PI * 2);

	return ids.map((id, i) => {
		const angle = offset + (i / Math.max(1, ids.length)) * Math.PI * 2;
		const r = ringRadius + range(rng, -0.35, 0.35);
		return spawnPenguin(id, { x: Math.sin(angle) * r, z: Math.cos(angle) * r });
	});
};

/**
 * A start line across the top of the chute.
 *
 * Abreast rather than in a queue, because a race that begins with somebody already in front is not
 * a race — and across the WIDTH of the first segment rather than the second, so the first thing
 * anybody does is choose a line.
 */
export const spawnOnTheStartLine: Arrangement = (ids, floes) => {
	const first = floes[0];
	const next = floes[1];
	if (!first || !next) return [];
	// Across the chute is perpendicular to the way it runs.
	const down = sub(next.center, first.center);
	const across = { x: down.z, z: -down.x };
	const span = Math.hypot(across.x, across.z) || 1;

	return ids.map((id, i) => {
		// Spread over the middle 70% of the width: nobody starts with a toe over the edge.
		const offset = ids.length === 1 ? 0 : (i / (ids.length - 1) - 0.5) * first.radius * 1.4;
		const pos = {
			x: first.center.x + (across.x / span) * offset,
			z: first.center.z + (across.z / span) * offset
		};
		return spawnPenguin(id, pos, next.center);
	});
};

/**
 * Thirty penguins, a few to each floe.
 *
 * The spots come from `archipelago.spawnSpots`, which fills the outer ring before the middle: the
 * middle floe is where a Royal ends, and starting the round already crowded there would skip the
 * migration the whole mode is about.
 */
export const spawnAcrossTheSea: Arrangement = (ids, floes, seed) => {
	const spots = spawnSpots(floes, ids.length, seed);
	return ids.map((id, i) => {
		const pos = spots[i] ?? ZERO;
		// Facing its own floe's middle, so nobody opens the round looking out to sea.
		const home = floes.reduce((best, floe) =>
			distanceSq(floe.center, pos) < distanceSq(best.center, pos) ? floe : best
		);
		return spawnPenguin(id, pos, home.center);
	});
};
