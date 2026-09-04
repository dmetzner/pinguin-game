/**
 * How the ice floe tilts. Pure functions over time and the penguins standing on it.
 *
 * Two sources, summed and then capped:
 *
 *  * the **swell**, which is the ocean and owes nothing to the players — and is the SAME everywhere,
 *    because it is one sea however many floes are floating on it — and
 *  * the **weight**, which is entirely the players' fault and is the mechanic the design rests on.
 *
 * Keeping them apart matters beyond tidiness: the weight component is smoothed across ticks and the
 * swell is not, so they cannot share a code path, and the renderer wants the swell alone for the
 * horizon (the horizon is the ocean, and the ocean does not care where anyone is standing).
 */
import {
	MAX_SLOPE,
	SWELL_AMPLITUDE,
	SWELL_FREQ_X,
	SWELL_FREQ_Z,
	WEIGHT_TILT,
	WEIGHT_TILT_RATE
} from './constants';
import type { Floe, Penguin, Vec2 } from './types';
import { add, clampLength, scale, sub, ZERO } from './vec';

/**
 * The swell gradient at a given moment.
 *
 * Time comes in as seconds derived from the tick count — never from a clock. Two sines whose
 * frequencies were chosen by search rather than by ear, so the pattern does not reproduce itself
 * inside a 90-second round while staying completely predictable to a test. The reasoning and the
 * measurements are on SWELL_FREQ_X in `constants.ts`.
 */
export function swellAt(seconds: number): Vec2 {
	return {
		x: SWELL_AMPLITUDE * Math.sin(seconds * SWELL_FREQ_X),
		z: SWELL_AMPLITUDE * Math.sin(seconds * SWELL_FREQ_Z + 1.7)
	};
}

/**
 * The gradient the crowd's weight is currently asking for.
 *
 * The centre of mass is normalised by the floe radius, so the value is the fraction of the way to
 * the rim the crowd has drifted, and WEIGHT_TILT is the gradient at a hypothetical everyone-on-the-
 * very-edge. Penguins that are airborne or already in the water contribute nothing — a penguin
 * mid-jump is not pressing on anything, and one that has fallen off is not on the floe at all.
 * Both were bugs before they were rules: without the second, the last player standing kept being
 * tipped by the accumulated ghosts of everyone they had just eliminated.
 */
export function weightTargetSlope(
	penguins: readonly Penguin[],
	radius: number,
	center: Vec2 = ZERO
): Vec2 {
	let sumX = 0;
	let sumZ = 0;
	let count = 0;
	for (const p of penguins) {
		if (p.phase !== 'skating' || p.height > 0) continue;
		// Floe-LOCAL, because the centre of mass that tips a floe is measured from that floe's own
		// middle. In the classic round the centre is the origin and this is the arithmetic it always
		// was; in a Royal a penguin standing dead centre on an outer floe fifteen metres from the
		// origin must tip nothing at all.
		sumX += p.pos.x - center.x;
		sumZ += p.pos.z - center.z;
		count++;
	}
	if (count === 0) return ZERO;
	return {
		x: (sumX / count / radius) * WEIGHT_TILT,
		z: (sumZ / count / radius) * WEIGHT_TILT
	};
}

/**
 * Advance the floe one tick.
 *
 * The weight component chases its target exponentially rather than jumping to it, which is what
 * gives the ice its apparent mass and — more importantly — gives a player who reads the crowd a
 * moment to act before the tilt they can see coming actually arrives.
 *
 * The cap is applied to the SUM and not to each part. Capping them separately would let swell and
 * weight stack past MAX_SLOPE whenever both peaked at once, which is precisely the moment the cap
 * exists for.
 */
export function stepFloe(floe: Floe, penguins: readonly Penguin[], seconds: number, dt: number) {
	// A mountain does not float. Anchored ice keeps the tilt it was built with — that tilt IS the
	// slide — and neither the swell nor the weight of whoever is standing on it moves it at all.
	if (floe.anchored) {
		floe.slope = floe.tilt;
		return;
	}
	// `penguins` is whoever is standing on THIS floe — `archipelago.penguinsOn` in a Royal, everybody
	// in the classic round, where those are the same list.
	const target = weightTargetSlope(penguins, Math.max(floe.radius, 0.001), floe.center);
	// `1 - exp(-rate·dt)` rather than `rate·dt` so the smoothing is framerate-independent and cannot
	// overshoot even if a caller ever hands this a large dt.
	const k = 1 - Math.exp(-WEIGHT_TILT_RATE * dt);
	floe.weightSlope = add(floe.weightSlope, scale(sub(target, floe.weightSlope), k));

	floe.slope = clampLength(add(add(floe.tilt, swellAt(seconds)), floe.weightSlope), MAX_SLOPE);
}
