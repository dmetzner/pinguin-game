/**
 * Die Flucht: a sea lion is coming, and the ice runs out behind you.
 *
 * The three modes that existed before this one are all about STAYING somewhere — on the floe, on the
 * last floe, on the course. This one is about leaving, and it is the only one with something in it
 * that is actively after the player. That is a different feeling for an eight-year-old, and it is
 * the one that makes the jump matter: in the classic round jumping sheds a bad tilt, in a Royal it
 * crosses a gap once a minute, and here it is the verb.
 *
 * Almost none of the machinery is new, which is the invariants paying off again:
 *
 *  * A course is an archipelago in a LINE. `floeUnder` already answers "am I standing on anything",
 *    and a penguin over open water already falls in, so the gaps need no rule of their own.
 *  * Every gap is derived from `JUMP_RANGE`, exactly as in `archipelago.layout` — a course whose
 *    holes were chosen by eye becomes uncrossable the first time somebody tunes the jump.
 *  * Snowballs and shoves work normally. Knocking a rival into the water while something is eating
 *    its way up the line is the meanest thing in this game and it should absolutely stay.
 *
 * What IS new is the hunter, and the shape of it is the whole design: it is a PLACE, not a pursuit.
 * The sea lion advances along the course at a speed that ramps, it never out-runs a penguin who
 * keeps moving, and anything behind it is eaten. That is Mario's rising lava rather than a chasing
 * AI, and it is readable at a glance, deterministic, and impossible to cheese by circling.
 *
 * Seeded and pure like everything else here.
 */
import { JUMP_RANGE } from './archipelago';
import {
	CHASE_BEND_MAX,
	CHASE_BEND_MIN,
	CHASE_BEND_RATE,
	CHASE_BLOCK_EVERY,
	CHASE_BLOCK_HEIGHT,
	CHASE_BLOCK_RADIUS,
	CHASE_HUNTER_LEASH,
	CHASE_HUNTER_RAMP_TICKS,
	CHASE_HUNTER_START,
	CHASE_HUNTER_TOP,
	CHASE_MAX_DROP,
	CHASE_MAX_HEIGHT,
	CHASE_MAX_RADIUS,
	CHASE_MAX_RISE,
	CHASE_MIN_RADIUS,
	CHASE_PLATFORMS,
	CHASE_SHORE_RADIUS,
	CHASE_START_RADIUS,
	CHASE_STRAIGHT_MAX,
	CHASE_STRAIGHT_MIN,
	ROYAL_SINK_TICKS
} from './constants';
import { createRng, range } from './rng';
import type { Floe, Penguin, Vec2, World } from './types';
import { distance, fromHeading, length, scale, sub, ZERO } from './vec';

/**
 * Build the course: platforms in a line, with holes in it.
 *
 * The line runs along −z and never turns. That is a decision about the CAMERA rather than about the
 * course: the slide had to grow a rotating rig and a rotated stick before it could bend
 * (`render/scene.ts`), and a chase does not need bends to be frightening. Straight, the existing
 * camera works unchanged and "away from the sea lion" is always the same direction on screen —
 * which is the one thing a panicking eight-year-old must never have to think about.
 */
export function chaseCourse(seed: number): Floe[] {
	const rng = createRng(seed ^ 0xf1ee);
	const floes: Floe[] = [];

	// The route BENDS now, and that is the whole of what makes it a course rather than a corridor.
	// It was straight for one reason — the camera did not rotate, so "away from the sea lion" had to
	// stay the same direction on screen — and the slide has since grown a rig that turns with the
	// run (`render/scene.ts`) and a stick that turns with the rig. The chase borrows both.
	let heading = Math.PI;
	let at: Vec2 = ZERO;
	let height = 0;
	let along = 0;

	// Straights and bends, like the mountain: somewhere to build speed, then a corner arriving.
	let bending = 0;
	let sectionLeft = Math.round(range(rng, CHASE_STRAIGHT_MIN, CHASE_STRAIGHT_MAX));

	for (let i = 0; i < CHASE_PLATFORMS; i++) {
		const last = i === CHASE_PLATFORMS - 1;
		const radius = last
			? // The shore: wide, so arriving is not itself a jump you can miss. A race decided by the
				// last landing is a race decided by a coin.
				CHASE_SHORE_RADIUS
			: i === 0
				? // And the start line, which has to hold the whole field without anybody standing on
					// anybody. See `CHASE_START_RADIUS`.
					CHASE_START_RADIUS
				: range(rng, CHASE_MIN_RADIUS, CHASE_MAX_RADIUS);

		if (i > 0) {
			const previous = floes[i - 1];
			if (!previous) break;

			if (sectionLeft === 0) {
				if (bending === 0) {
					bending = rng.next() < 0.5 ? -1 : 1;
					sectionLeft = Math.round(range(rng, CHASE_BEND_MIN, CHASE_BEND_MAX));
				} else {
					bending = 0;
					sectionLeft = Math.round(range(rng, CHASE_STRAIGHT_MIN, CHASE_STRAIGHT_MAX));
				}
			}
			// The last stretch runs straight, so the shore arrives head-on rather than round a corner
			// nobody can see past.
			if (i > CHASE_PLATFORMS - 4) bending = 0;
			heading += bending * CHASE_BEND_RATE;
			sectionLeft--;

			// The gap is a distance between RIMS, spent along the line between the two centres.
			const gap = range(rng, 0.35, 0.72) * JUMP_RANGE;
			const apart = previous.radius + gap + radius;
			const forward = fromHeading(heading);
			at = { x: at.x + forward.x * apart, z: at.z + forward.z * apart };
			along += apart;

			// UP AND DOWN. A route that is flat for two hundred metres is a route with one idea in
			// it. The rise is bounded well under `JUMP_APEX` — a step you cannot get onto is a wall,
			// and a wall in the middle of a chase is the end of the round — while a DROP can be
			// bigger, because falling is free and landing lower is the reward for taking it.
			// Bounded ABOVE THE WATER, not just per step. The sea is a fixed plane at y ≈ 0 and a
			// platform is a slab whose top sits on it, so a route that wandered downwards would put
			// its ice under the surface — penguins standing in the sea, which is the one thing the
			// sea is for. It climbs from the start line and comes back down to it at the shore.
			// A random step PLUS a pull toward the middle of the range. Without the pull the walk is
			// biased by the shape of its own step — drops are allowed to be twice a rise, so it spends
			// the whole course pinned to the water and the route is flat, which is what it did.
			const drift = (CHASE_MAX_HEIGHT / 2 - height) * 0.3;
			height = last
				? 0
				: Math.max(
						0,
						Math.min(CHASE_MAX_HEIGHT, height + range(rng, -CHASE_MAX_DROP, CHASE_MAX_RISE) + drift)
					);
		}

		// A HINDERNIS: a block of ice across part of the platform, steep enough that it cannot be
		// walked up and low enough that it can be jumped.
		//
		// It is a `Mound`, which means the simulation already knows what to do with it — `groundHeight`
		// and `groundSlope` read a floe's own mounds, and `step.ts` turns rising ground into a force
		// without being told what a block is. What it is NOT is the hills a Royal floe carries: those
		// come from `moundsFor(variant)`, are derived from their height against `MOUND_MAX_SLOPE`, and
		// are therefore ramps by construction. This one picks its radius directly, which is what makes
		// it a wall rather than a slope.
		const blocked = !last && i > 2 && i % CHASE_BLOCK_EVERY === 0;
		const mounds = blocked
			? [
					{
						at: { x: range(rng, -0.35, 0.35), z: range(rng, -0.3, 0.3) },
						radius: CHASE_BLOCK_RADIUS / radius,
						height: CHASE_BLOCK_HEIGHT
					}
				]
			: [];

		floes.push({
			id: i,
			center: at,
			radius,
			fullRadius: radius,
			slope: ZERO,
			weightSlope: ZERO,
			tilt: ZERO,
			// Nothing sinks here. The clock in this mode is the thing behind you, and ice that also
			// went away underneath would be two timers running at once — the player could not tell
			// which of them killed them, which `docs/DESIGN.md` rule 2 forbids.
			sinkAtTick: Infinity,
			piece: false,
			sinkTicks: ROYAL_SINK_TICKS,
			breakAngle: 0,
			drift: ZERO,
			mounds,
			shape: i,
			openSide: 0,
			altitude: height,
			along,
			anchored: false
		});
	}

	return floes;
}

/**
 * Which way the course runs at this platform, as a unit vector.
 *
 * Taken from the NEXT platform rather than stored, because it is not a fact about a floe — it is a
 * fact about the pair. The last one keeps the heading of the pair before it, so arriving at the
 * shore does not swing the camera round.
 */
export function courseHeading(floes: readonly Floe[], index: number): Vec2 {
	const here = floes[index];
	// The pair AHEAD normally; at the shore, the pair behind, so arriving does not swing the camera.
	const next = floes[index + 1];
	const previous = floes[index - 1];
	const step = next
		? here && sub(next.center, here.center)
		: here && previous && sub(here.center, previous.center);
	const size = step ? length(step) : 0;
	// The course runs down −z at the start, which is where a world with no course at all points too.
	return step && size > 1e-6 ? scale(step, 1 / size) : { x: 0, z: -1 };
}

/**
 * The point this far along the route, and which way the route runs there.
 *
 * The inverse of `alongCourse`, and the sea lion's whole position: it lives as a DISTANCE down the
 * polyline (`World.hunterAt`), so something has to turn that back into a place. Here rather than in
 * the renderer because it is arithmetic about the course, it is testable, and the renderer already
 * has one job.
 */
export function pointAlong(floes: readonly Floe[], distance: number): { at: Vec2; heading: Vec2 } {
	let index = 0;
	for (const [i, floe] of floes.entries()) if (floe.along <= distance) index = i;
	const from = floes[index];
	const heading = courseHeading(floes, index);
	if (!from) return { at: ZERO, heading };
	const rest = distance - from.along;
	return {
		at: { x: from.center.x + heading.x * rest, z: from.center.z + heading.z * rest },
		heading
	};
}

/** The platform nearest this point, as an index. −1 only for a world with no floes in it. */
export function platformUnder(floes: readonly Floe[], pos: Vec2): number {
	let best = -1;
	let nearest = Infinity;
	for (const [i, floe] of floes.entries()) {
		const d = distance(floe.center, pos);
		if (d < nearest) {
			nearest = d;
			best = i;
		}
	}
	return best;
}

/**
 * How far along the course a point is, in metres from the start line.
 *
 * Measured along the ROUTE, not down an axis. It used to be `-pos.z`, which was exact while the
 * course ran in a straight line and became a lie the moment it bent: two racers equally far along a
 * corner have quite different z, and a hunter comparing itself to that axis would eat the one on the
 * outside of the bend for no reason they could see.
 *
 * The nearest platform's own distance plus however far past it you are, along the direction the
 * course runs there.
 */
export function alongCourse(floes: readonly Floe[], pos: Vec2): number {
	const index = platformUnder(floes, pos);
	const floe = floes[index];
	if (!floe) return 0;
	const heading = courseHeading(floes, index);
	return floe.along + (pos.x - floe.center.x) * heading.x + (pos.z - floe.center.z) * heading.z;
}

/** The shore. Reaching it is the whole point. */
export function shoreOf(world: World): Floe | undefined {
	return world.floes[world.floes.length - 1];
}

/**
 * Has this penguin got away?
 *
 * Being ON the shore is enough — no line to cross, no tape to break. The same reasoning as the
 * slide's `hasFinished`: a child must never lose because an arrival landed on the wrong tick.
 */
export function hasEscaped(world: World, p: Penguin): boolean {
	const shore = shoreOf(world);
	if (!shore || p.phase !== 'skating') return false;
	return alongCourse(world.floes, p.pos) >= shore.along;
}

/**
 * How fast the sea lion is going this tick, in metres a second.
 *
 * It ramps, and the top of the ramp is deliberately BELOW `WALK_SPEED`. A hunter that can outrun a
 * penguin who is running is a hunter that eventually eats everybody regardless of how well they
 * played, and the round becomes a countdown rather than a game. What it eats is hesitation: a player
 * who stops to aim a snowball, misjudges a gap, or waits for a rival to move first.
 */
export function hunterSpeed(ticks: number): number {
	const t = Math.min(1, ticks / CHASE_HUNTER_RAMP_TICKS);
	return CHASE_HUNTER_START + (CHASE_HUNTER_TOP - CHASE_HUNTER_START) * t;
}

/**
 * Where the sea lion is after this tick.
 *
 * Two terms, and the second one is what stops the mode falling apart at both ends.
 *
 *  * It always advances at `hunterSpeed`.
 *  * And it is never further behind the LAST surviving penguin than `CHASE_HUNTER_LEASH`. Without
 *    the leash a strong field simply outruns it, everybody spends the last thirty seconds jogging,
 *    and the thing the mode is about is somewhere off the bottom of the screen. The leash only ever
 *    pulls it FORWARD — a hunter that slowed down to stay close would be a hunter nobody has to run
 *    from.
 *
 * @param at where it is now, in metres along the course
 * @param hindmost how far along the last surviving penguin is
 */
export function advanceHunter(at: number, hindmost: number, ticks: number, dt: number): number {
	const moved = at + hunterSpeed(ticks) * dt;
	return Math.max(moved, hindmost - CHASE_HUNTER_LEASH);
}

/** Has this penguin been caught? Anything behind the sea lion is behind the sea lion. */
export function isCaught(world: World, p: Penguin): boolean {
	if (p.phase !== 'skating') return false;
	return alongCourse(world.floes, p.pos) <= world.hunterAt;
}

/**
 * Everyone still running, in the order they are winning: furthest along first.
 *
 * Ties broken by roster order, which is arbitrary and stable — the alternative is a standings list
 * that reshuffles itself every tick.
 */
export function fleeing(world: World): Penguin[] {
	return world.penguins
		.filter((p) => p.phase === 'skating')
		.sort((a, b) => alongCourse(world.floes, b.pos) - alongCourse(world.floes, a.pos));
}
