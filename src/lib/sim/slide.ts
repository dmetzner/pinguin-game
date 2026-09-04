/**
 * The mountain: a chute of ice you slide down, racing whoever else is on it.
 *
 * The whole thing is built out of parts that already existed, and that is the reason it is small.
 * Gravity in this game comes from a floe's GRADIENT (`step.ts`), a penguin falls when there is no
 * floe under it (`archipelago.floeUnder`), and the camera frames whichever floe the local penguin is
 * standing on (`render/scene.ts`). So a slide is a chain of overlapping floes with a permanent tilt
 * down the hill: the penguins accelerate along it because the ice is tilted, they fall off the sides
 * because the ice runs out, and the camera follows them down without knowing anything about
 * mountains.
 *
 * What is genuinely new is the ending. Every other mode in this game ends when one penguin is left;
 * a race ends when somebody arrives, and everybody else's round ends with them.
 *
 * Seeded and pure like everything else here: the same seed is the same mountain, so a room can be
 * sent four letters instead of a course.
 */
import {
	SLIDE_BANK_HEIGHT,
	SLIDE_BEND_MAX,
	SLIDE_BEND_MIN,
	SLIDE_BEND_RATE,
	SLIDE_BUMP_EVERY,
	SLIDE_BUMP_HEIGHT,
	SLIDE_DROP_PER_SEGMENT,
	SLIDE_GAP_EVERY,
	SLIDE_GRADE,
	SLIDE_OPEN_EVERY,
	SLIDE_OPEN_WALL,
	SLIDE_SEGMENT_STEP,
	SLIDE_SEGMENTS,
	SLIDE_STRAIGHT_MAX,
	SLIDE_STRAIGHT_MIN,
	SLIDE_WIDTH
} from './constants';
import { createRng, range } from './rng';
import type { Floe, Penguin, Vec2, World } from './types';
import { distance, fromHeading, ZERO } from './vec';

/**
 * Build the course.
 *
 * Overlapping discs, because a disc is what `floeUnder` understands: the step that puts a penguin in
 * the water is "no floe here". They overlap along the run, so the surface is continuous — except
 * where the course deliberately leaves a GAP.
 */
export function slideCourse(seed: number): Floe[] {
	const rng = createRng(seed ^ 0x510e);
	const floes: Floe[] = [];

	// Straight away from the start. The camera turns to follow the run now (`render/scene.ts`), so
	// the course is free to go wherever it likes — the first version had to be clamped to a thirty
	// degree cone, because a fixed camera makes a course that curves round into a course you steer
	// backwards, and the result was a hallway that was always very slightly turning.
	let heading = Math.PI;
	let at: Vec2 = ZERO;

	// A course is STRAIGHTS and BENDS, not a random walk. That is most of what makes a run have
	// moments in it: somewhere to build speed, then a corner arriving.
	let inSection = 0;
	let bending = 0;
	let sectionLeft = Math.round(range(rng, SLIDE_STRAIGHT_MIN, SLIDE_STRAIGHT_MAX));

	for (let i = 0; i < SLIDE_SEGMENTS; i++) {
		if (sectionLeft === 0) {
			if (bending === 0) {
				// Into a bend, one way or the other.
				bending = rng.next() < 0.5 ? -1 : 1;
				sectionLeft = Math.round(range(rng, SLIDE_BEND_MIN, SLIDE_BEND_MAX));
			} else {
				bending = 0;
				sectionLeft = Math.round(range(rng, SLIDE_STRAIGHT_MIN, SLIDE_STRAIGHT_MAX));
			}
			inSection = 0;
		}
		heading += bending * SLIDE_BEND_RATE;
		sectionLeft--;
		inSection++;

		const forward = fromHeading(heading);
		at = { x: at.x + forward.x * SLIDE_SEGMENT_STEP, z: at.z + forward.z * SLIDE_SEGMENT_STEP };

		// The wall goes missing on the OUTSIDE of a bend, which is where the speed is already taking
		// you: the one place the mountain can throw you off is the place you are most likely to end up
		// if you carry too much into a corner. Never in the first few segments, and never at the
		// finish — a race decided before anybody has their line, or after they have won, is a cheat.
		const nearTheEnds = i < 4 || i > SLIDE_SEGMENTS - 4;
		const openSide: -1 | 0 | 1 =
			!nearTheEnds && bending !== 0 && inSection > 1 && i % SLIDE_OPEN_EVERY === 0
				? ((bending > 0 ? 1 : -1) as -1 | 1)
				: 0;

		// A gap is a missing segment — and `SLIDE_GAP_EVERY` is zero, so there are none. The guard is
		// what makes zero mean OFF rather than a division by nothing: `i % 0` is NaN, which is never
		// equal to 0, so the expression would already be false — but silently, and by accident. See the
		// constant for the three dead stops per run this cost.
		const gap = SLIDE_GAP_EVERY > 0 && !nearTheEnds && i % SLIDE_GAP_EVERY === 0;
		if (gap) continue;

		floes.push({
			id: i,
			center: at,
			radius: SLIDE_WIDTH,
			fullRadius: SLIDE_WIDTH,
			// The fall line: down the hill, along the direction of travel. `types.ts` defines a slope
			// as pointing UPHILL, so the tilt is the backward direction and gravity does the rest.
			tilt: { x: -forward.x * SLIDE_GRADE, z: -forward.z * SLIDE_GRADE },
			slope: ZERO,
			weightSlope: ZERO,
			sinkAtTick: Infinity,
			piece: false,
			sinkTicks: 0,
			breakAngle: 0,
			drift: ZERO,
			mounds: [],
			shape: i,
			openSide,
			altitude: -i * SLIDE_DROP_PER_SEGMENT,
			along: i * SLIDE_SEGMENT_STEP,
			anchored: true
		});
	}

	return floes;
}

/**
 * Is this floe a piece of the mountain?
 *
 * DERIVED rather than flagged, and the distinction it draws is the one `anchored` used to blur.
 * `anchored` means "does not float": no swell, no crowd tilt, its own constant gradient. That is
 * true of a chute segment AND of an island (`sim/island.ts`), which is land — but only one of the
 * two wants the mountain's physics, where you keep your speed, lean instead of pushing, and stand on
 * a banked cross-section instead of on the hills the ice actually carries.
 *
 * A chute is anchored ice WITH A FALL LINE, and that is exactly what this asks. A second boolean
 * would have been a field that could disagree with `tilt` about whether a slope is a slope; nothing
 * can disagree with a definition. Every chute segment is built with `|tilt| = SLIDE_GRADE`, so this
 * is true of all of them and of nothing else in the game.
 */
export function isChute(floe: Floe): boolean {
	return floe.anchored && (floe.tilt.x !== 0 || floe.tilt.z !== 0);
}

/**
 * Which way this segment runs, as a unit vector.
 *
 * Derived from the tilt, which is the fall line pointing backwards — so the course direction is
 * simply the other way. One definition: the camera turns to it, the bots aim along it, and the banks
 * are measured across it.
 */
export function segmentHeading(floe: Floe): Vec2 {
	const size = Math.hypot(floe.tilt.x, floe.tilt.z) || 1;
	return { x: -floe.tilt.x / size, z: -floe.tilt.z / size };
}

/**
 * How high the banked wall is under this point, and which way it pushes.
 *
 * The walls are GROUND. A chute's cross-section is a parabola — flat in the middle, rising to
 * `SLIDE_BANK_HEIGHT` at the rim — and `step.ts` already turns a rising surface into a force that
 * pushes a penguin back down it, because that is how the icebergs work. So a banked run needs no new
 * physics at all: it needs a height function.
 *
 * The side the course has left OPEN has no wall, and that is where a racer goes over.
 */
export function bankAt(floe: Floe, pos: Vec2): { height: number; slope: Vec2 } {
	const heading = segmentHeading(floe);
	const acrossX = -heading.z;
	const acrossZ = heading.x;
	const offset = (pos.x - floe.center.x) * acrossX + (pos.z - floe.center.z) * acrossZ;
	const side = offset >= 0 ? 1 : -1;
	// The open side keeps a LOW wall rather than none: see `SLIDE_OPEN_WALL`.
	const wall = floe.openSide === side ? SLIDE_OPEN_WALL : 1;

	// Three zones across the run, and the third one is the one that took a rewrite to learn.
	//
	//  * The middle (to 45%) is FLAT. A chute that curved all the way to its centre would be a gutter
	//    that steers itself, and the player would have nothing to do.
	//  * Then the bank RISES, parabolically, to its full height at 80%.
	//  * And from there to the rim it is a flat SHELF along the top of the wall.
	//
	// Without the shelf the wall ended exactly where the ice did, so a racer carrying enough speed to
	// climb the bank went straight over the rim from the top of it — five of six, every seed. With it,
	// being thrown up the wall puts you on top of the wall, still sliding, with a way back down. That
	// is what makes the run something you can ride badly and survive.
	// The flat middle reaches 0.5 and the wall rises over the next 0.4, full at 0.9, shelf beyond.
	// Both numbers moved with `SLIDE_BANK_HEIGHT`: what a racer feels is the GRADIENT, `2·h/(span·r)`,
	// and widening the span is the half of that fraction which costs nothing — the wall still ends up
	// the same height in the same place, it just gets there without a spring in it.
	const t = Math.min(1, Math.abs(offset) / floe.radius);
	const rising = Math.min(1, Math.max(0, (t - 0.5) / 0.4));

	// And a BUMP, on one segment in `SLIDE_BUMP_EVERY`, across the whole width of the run.
	//
	// The mode had a jump button and nothing to jump. Everything else on the mountain is a reason to
	// steer — the banks, the gaps, the open sides — so the one control a child presses for fun did
	// nothing for forty seconds at a time. A bump is the cheapest possible answer: the ice rises and
	// falls, and `step.ts` already turns a surface that falls away faster than its own gradient into
	// AIR, so a racer who hits the crest carrying speed takes off without a single new rule.
	//
	// A half-cosine along the run, and its half-width is HALF A SEGMENT rather than a radius. That is
	// forced rather than chosen: consecutive discs overlap, `floeUnder` hands a point to the nearest
	// of them, and the handoff is exactly half a step from each centre. A bump still rising at that
	// line is a bump the next segment has never heard of — a step in the ice at every boundary, which
	// is the staircase this whole surface was rewritten to remove.
	const along = (pos.x - floe.center.x) * heading.x + (pos.z - floe.center.z) * heading.z;
	const bumpy = floe.id % SLIDE_BUMP_EVERY === 0 && floe.id > 3;
	const reach = SLIDE_SEGMENT_STEP / 2;
	const u = Math.min(1, Math.abs(along) / reach);
	const bump = bumpy ? SLIDE_BUMP_HEIGHT * 0.5 * (1 + Math.cos(Math.PI * u)) : 0;
	// d(bump)/d(along), pointing UPHILL — back toward the crest, so gravity pulls a racer off it in
	// whichever direction they are already going.
	const bumpRise =
		bumpy && u > 0 && u < 1
			? ((SLIDE_BUMP_HEIGHT * 0.5 * Math.PI) / reach) *
				Math.sin(Math.PI * u) *
				(along >= 0 ? -1 : 1)
			: 0;
	const alongSlope = { x: heading.x * bumpRise, z: heading.z * bumpRise };

	// No early return for the flat middle: at `rising === 0` the two terms below are exactly zero, so
	// the general path already answers `{ bump, alongSlope }`. One expression is one thing to keep
	// right when the cross-section changes again.
	const height = SLIDE_BANK_HEIGHT * wall * rising * rising + bump;
	// d(height)/d(offset), pointing UPHILL — which on a wall is outward, so gravity sends a penguin
	// back toward the middle. Zero on the shelf, where the wall has stopped rising.
	const rise =
		rising >= 1 ? 0 : ((2 * SLIDE_BANK_HEIGHT * wall * rising) / (0.4 * floe.radius)) * side;
	return {
		height,
		slope: { x: acrossX * rise + alongSlope.x, z: acrossZ * rise + alongSlope.z }
	};
}

/** The bottom of the mountain: the last segment, and the thing a racer is racing to. */
export function finishOf(world: World): Floe | undefined {
	return world.floes[world.floes.length - 1];
}

/**
 * Has this penguin arrived?
 *
 * Being ON the last segment is enough — there is no line to cross and no tape to break, because a
 * penguin arriving at 12 m/s would cross any line in a single tick and the question "did it happen
 * this tick or last" is not one a child should ever be able to lose on.
 */
export function hasFinished(world: World, p: Penguin): boolean {
	const finish = finishOf(world);
	if (!finish || p.phase !== 'skating') return false;
	return distance(p.pos, finish.center) <= finish.radius;
}

/**
 * How far down the mountain this penguin has got, as a segment index.
 *
 * Used for the standings, and deliberately coarse: the HUD says which PLACE you are in, and a
 * position that flickered between second and third as two penguins traded centimetres would be
 * worse than no position at all.
 */
export function progressOf(world: World, p: Penguin): number {
	let best = -1;
	let bestDistance = Infinity;
	for (const [i, floe] of world.floes.entries()) {
		const d = distance(p.pos, floe.center);
		if (d < bestDistance) {
			bestDistance = d;
			best = i;
		}
	}
	return best;
}

/**
 * Everyone still racing, in the order they are winning.
 *
 * Ahead means further down the mountain. Ties are broken by roster order, which is arbitrary and
 * stable — the alternative is a standings list that reshuffles itself every tick.
 */
export function standings(world: World): Penguin[] {
	return world.penguins
		.filter((p) => p.phase === 'skating')
		.sort((a, b) => progressOf(world, b) - progressOf(world, a));
}
