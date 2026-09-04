/**
 * A sea with more than one floe in it, and the question "what am I standing on".
 *
 * Pingu Royal is thirty penguins, and thirty on one disc does not work — not for performance
 * reasons but for two design ones. The floe tilts from where the weight is standing, and one
 * penguin's share of that is 1/N: at four your position moves the ice, at thirty the weight term
 * averages to nothing and the see-saw the whole game rests on stops existing. And the camera frames
 * the whole arena, so an arena wide enough for thirty draws a penguin at 2% of the screen against
 * today's 13%.
 *
 * So the sea holds SEVERAL small floes instead of one big one. Every floe carries five or six
 * penguins — the number the see-saw works at — and the camera frames the one you are standing on
 * rather than the whole map. Nobody has to see all thirty at once; they have to see the six who can
 * reach them.
 *
 * Then the floes SINK, one after another, and that is the clock: the ice under you is on a timer, so
 * a Royal is a slow forced migration that ends with everyone left on the last floe. Which is the
 * six-penguin round this game already is.
 *
 * Everything here is pure and seeded. `layout()` from the same seed is the same sea on every device,
 * which is what lets phase 3 send a room a seed rather than a map.
 */
import {
	FLOE_RADIUS,
	JUMP_AIRTIME,
	MOUND_MAX_HEIGHT,
	MOUND_MAX_SLOPE,
	MOUND_MIN_HEIGHT,
	RIM_GRACE,
	ROYAL_FLOE_MAX_RADIUS,
	ROYAL_FLOE_MIN_RADIUS,
	ROYAL_GAP,
	ROYAL_GAP_JITTER,
	ROYAL_PER_FLOE,
	ROYAL_PIECE_DRIFT,
	ROYAL_PIECE_FRACTION,
	ROYAL_PIECE_SINK_TICKS,
	ROYAL_SINK_FIRST_TICKS,
	ROYAL_SINK_INTERVAL_TICKS,
	ROYAL_SINK_TICKS,
	ROYAL_WARN_TICKS,
	SLIDE_GRADE,
	WALK_SPEED
} from './constants';
import { createRng, type Rng, range } from './rng';
import { bankAt, isChute, segmentHeading } from './slide';
import type { Floe, Mound, Penguin, Vec2, World } from './types';
import { add, distance, fromHeading, length, scale, sub, ZERO } from './vec';

/**
 * How far a running penguin covers in one jump, in metres.
 *
 * DERIVED, never typed in: the airtime comes from the jump constants and the distance from the walk
 * speed, so tuning the jump moves every gap in the sea with it. This is the number every gap in
 * `layout()` is expressed against — a sea whose gaps were chosen by eye would become uncrossable the
 * first time somebody nudged `JUMP_SPEED`, and the symptom is a game where a third of the players
 * drown on a jump that used to work.
 */
export const JUMP_RANGE = WALK_SPEED * JUMP_AIRTIME;

/** A penguin's position relative to a floe's centre. Floe-local is what the tilt maths wants. */
export function localTo(floe: Floe, pos: Vec2): Vec2 {
	return sub(pos, floe.center);
}

/**
 * The floe this position is over, or null for open water.
 *
 * `RIM_GRACE` is included for the same reason `step.ts` includes it in the rim test: the two have to
 * agree exactly, or a penguin lands on ice the support test can see and the rim test cannot.
 *
 * Floes never overlap (`layout` enforces a gap), so the first match is the only match — but the
 * nearest is taken anyway, because a sinking floe passing through zero radius must not be able to
 * claim a penguin standing on its neighbour.
 */
export function floeUnder(floes: readonly Floe[], pos: Vec2): Floe | null {
	let best: Floe | null = null;
	let bestDistance = Infinity;
	for (const floe of floes) {
		if (floe.radius <= 0) continue;
		const d = distance(floe.center, pos);
		if (d <= floe.radius + RIM_GRACE && d < bestDistance) {
			best = floe;
			bestDistance = d;
		}
	}
	return best;
}

/**
 * The floes a penguin could reach from here in one jump, the safest first.
 *
 * Safest means "lasts longest": the middle never sinks, an inner floe outlives the outer one hanging
 * off it, and a floe that has already started going is the last resort. Ranked rather than filtered
 * — on a two-ring map an outer floe's only neighbour is its parent, which is itself doomed, so a
 * filter for permanence would leave a bot standing on melting ice with nowhere it was willing to go.
 */
export function reachableFrom(floes: readonly Floe[], from: Floe, range = JUMP_RANGE): Floe[] {
	return floes
		.filter((floe) => floe.id !== from.id && floe.radius > 0 && gapBetween(from, floe) <= range)
		.sort((a, b) => b.sinkAtTick - a.sinkAtTick);
}

/** The open water between two floes' rims, in metres. Negative would mean they overlap. */
export function gapBetween(a: Floe, b: Floe): number {
	return distance(a.center, b.center) - a.radius - b.radius;
}

/**
 * How many different islands there are, and therefore how many sets of hills.
 *
 * The renderer builds one mesh per variant and clones it (`render/floeField.ts`), so the hills a
 * floe carries have to depend on nothing but which variant it is — otherwise the iceberg drawn on
 * the ice and the one the simulation lets you climb are two different hills.
 */
export const ISLAND_VARIANTS = 6;

/**
 * The hills on island `variant`, in normalised floe coordinates.
 *
 * ONE definition, two readers: this file gives them to the simulation and `render/floeField.ts`
 * builds the meshes from the same call. A floe is otherwise a flat disc with a gradient, and these
 * are the only thing on it with a height — you can walk up one, stand on top, jump off it further
 * than you could from the ice, and be shoved off it.
 *
 * Two variants get nothing at all. A sea where every island has a hill is as samey as a sea where
 * none of them do, and the flat ones are where a straight fight happens.
 */
export function moundsFor(variant: number): Mound[] {
	const rng = variantRng(variant);
	const rand = () => rng.next();
	if (variant % 3 === 0) return [];

	const mounds: Mound[] = [];
	// One big one, or two smaller. Never more: a floe covered in hills has no flat ice left to fight
	// on, and the fight is still the game.
	const hills = variant % 2 === 0 ? 1 : 2;
	for (let i = 0; i < hills; i++) {
		const angle = rand() * Math.PI * 2 + i * Math.PI;
		// Never in the middle — that is where the fight is, and a hill there would turn every round on
		// the same piece of ground — and never at the rim, because a hill you can be pushed off INTO
		// THE SEA is a death nobody can read.
		const away = 0.3 + rand() * 0.16;
		const height =
			(MOUND_MIN_HEIGHT + rand() * (MOUND_MAX_HEIGHT - MOUND_MIN_HEIGHT)) / (hills === 2 ? 1.3 : 1);
		// The footprint comes FROM the height: a cosine bump is steepest half way up at `h·π / 2r`, so
		// this is the narrowest a hill of this height may be and still be a ramp rather than a wall.
		// Chosen the other way round, the first draft produced 0.97 gradients — grip exactly cancelled
		// by gravity, and a "hill" nobody could walk up.
		const needed = (height * Math.PI) / (2 * MOUND_MAX_SLOPE);
		mounds.push({
			at: { x: Math.sin(angle) * away, z: Math.cos(angle) * away },
			radius: (needed * (1 + rand() * 0.25)) / FLOE_RADIUS,
			height
		});
	}
	return mounds;
}

/** The generator behind one island, so its hills and its mesh agree without sharing anything. */
function variantRng(variant: number): Rng {
	return createRng(0x1ce + variant * 7919);
}

function makeFloe(
	id: number,
	center: Vec2,
	radius: number,
	sinkAtTick: number,
	shape = 0,
	breakAngle = 0
): Floe {
	return {
		id,
		center,
		radius,
		fullRadius: radius,
		slope: ZERO,
		weightSlope: ZERO,
		sinkAtTick,
		piece: false,
		sinkTicks: ROYAL_SINK_TICKS,
		breakAngle,
		drift: ZERO,
		mounds: moundsFor(Math.abs(shape) % ISLAND_VARIANTS),
		shape,
		openSide: 0,
		// Sea level, floating, and flat until the swell says otherwise. The slide is the only thing
		// in this game that is anchored to anything (`sim/slide.ts`).
		altitude: 0,
		along: 0,
		anchored: false,
		tilt: ZERO
	};
}

/**
 * The ground a chute reports, blended with its immediate neighbours rather than answered by one
 * segment alone.
 *
 * **What this fixes, measured rather than assumed.** `bankAt` measures its cross-section against
 * ITS OWN centre and ITS OWN heading — fine on the centreline, where `groundHeight`'s own comment
 * already proves two segments agree. OFF the centreline, on a bend, they do not: two adjacent
 * segments' centres are the same 7 m apart whether the query point is dead centre or out near the
 * bank, but the bank's cross-section is measured from each segment's own rotated frame, and a point
 * 4.5 m off centre projects onto those two frames differently by an amount that does NOT shrink as
 * the point approaches the shared boundary. Measured at seed 20260821: up to 1.8 m of disagreement
 * between what segment i and segment i+1 say the ground height is, at the SAME point, on nearly
 * every bend the course has. A racer who is not dead centre — which is most of a bend, since the
 * bank is what puts you there — crosses one of these every third of a second at speed. That is
 * "es ruckelt runter, wird man teleportiert" (Daniel, 2026-08-22): not the fall line, the ground
 * itself disagreeing with what it was a moment ago.
 *
 * A first attempt tried to fix the FRAME — blend the heading `bankAt` measures against toward the
 * neighbour's, smoothly, so the two segments would agree on which way "across" points at the
 * boundary. It made the two headings agree and the disagreement barely moved, because the heading
 * was never the whole story: `offset` is `(pos − floe.center) · across`, and floe.center ITSELF
 * differs by the full 7 m between segments. Even with an identical heading, two different origins
 * 7 m apart produce different offsets for the same point whenever the line between them is not
 * exactly perpendicular to that heading — which on a bend it never quite is.
 *
 * So this blends the ANSWER instead of the frame. Every neighbour close enough to matter — this
 * segment, and whichever of the previous or next one exists — answers independently, in its own
 * unchanged frame, and the three answers are combined by inverse-square distance to each
 * candidate's own centre. That is continuous everywhere by construction (a sum of continuous
 * weights times continuous functions is continuous), symmetric by construction (it is a function of
 * plain Euclidean distance, not of which floe happened to be asking), and it costs nothing on a
 * straight run, where the neighbours' answers already agree with this segment's own and the blend
 * changes nothing.
 */
function blendedChuteGround(
	course: readonly Floe[],
	floe: Floe,
	pos: Vec2
): { height: number; slope: Vec2 } {
	let weightSum = 0;
	let worldHeightSum = 0;
	let slopeXSum = 0;
	let slopeZSum = 0;
	for (const candidate of [floe, course[floe.id - 1], course[floe.id + 1]]) {
		if (!candidate || !isChute(candidate)) continue;
		// Inverse-square distance to THIS candidate's own centre. The +0.01 (10 cm²) is only there
		// so standing exactly on a centre never divides by zero; at any distance that matters for
		// riding the bank it is far too small to change which candidate dominates.
		const dx = pos.x - candidate.center.x;
		const dz = pos.z - candidate.center.z;
		const weight = 1 / (dx * dx + dz * dz + 0.01);
		const along = segmentHeading(candidate);
		const downhill =
			(pos.x - candidate.center.x) * along.x + (pos.z - candidate.center.z) * along.z;
		const bank = bankAt(candidate, pos);
		// `candidate.altitude` is NOT optional here, and its absence was the bug the first version
		// of this function shipped with: `bank.height - SLIDE_GRADE * downhill` is a height relative
		// to CANDIDATE's own base, and averaging that directly across neighbours mixes numbers from
		// different vertical origins — for two segments `SLIDE_DROP_PER_SEGMENT` (about 3.5 m) apart,
		// which is a bigger error than the one this function exists to fix. Blending has to happen
		// in WORLD height, which is why every candidate adds its own altitude before the weights are
		// applied, and `floe.altitude` is subtracted back out at the end so this still returns a
		// value relative to the floe the caller actually passed in, matching `groundHeight`'s
		// existing contract.
		const worldHeight = candidate.altitude + bank.height - SLIDE_GRADE * downhill;
		weightSum += weight;
		worldHeightSum += weight * worldHeight;
		slopeXSum += weight * bank.slope.x;
		slopeZSum += weight * bank.slope.z;
	}
	// `floe` itself is always a chute and always a candidate, so `weightSum` can never be zero.
	return {
		height: worldHeightSum / weightSum - floe.altitude,
		slope: { x: slopeXSum / weightSum, z: slopeZSum / weightSum }
	};
}

/**
 * How high the ice is under this point, in metres above the floe's own plane.
 *
 * Zero on flat ice, rising smoothly to a hill's full height at its middle. Smooth on purpose: a
 * cosine rather than a cone, so there is no edge anywhere for a penguin to catch on and no
 * discontinuity for the gradient below to blow up at.
 */
export function groundHeight(floe: Floe, pos: Vec2, course?: readonly Floe[]): number {
	// A chute's ground is two things at once, and for a while it was only one of them.
	//
	//  * ACROSS the run, the banked cross-section: flat down the middle, rising to a wall at the rim.
	//  * ALONG it, the fall — because a mountain descends, and this is the function that says where
	//    the ice IS.
	//
	// The second was missing. The descent lived in `Floe.altitude`, a per-segment step that only the
	// renderer read, so the simulation stood every penguin on a flat disc while the drawn ribbon
	// sloped away underneath them: they floated above the ice and dropped a storey each time
	// `floeUnder` picked the next disc. Measured from the segment's own centre and at exactly
	// `SLIDE_GRADE`, so segment i's answer and segment i+1's agree everywhere the two discs overlap
	// (`SLIDE_DROP_PER_SEGMENT` is derived from the same number for precisely that reason) — ON
	// THE CENTRELINE. See `blendedChuteGround` for the sequel: OFF it, on a bend, they do not.
	if (isChute(floe)) {
		if (course) return blendedChuteGround(course, floe, pos).height;
		const along = segmentHeading(floe);
		const downhill = (pos.x - floe.center.x) * along.x + (pos.z - floe.center.z) * along.z;
		return bankAt(floe, pos).height - SLIDE_GRADE * downhill;
	}
	if (floe.mounds.length === 0) return 0;
	let height = 0;
	for (const mound of floe.mounds) {
		const reach = mound.radius * floe.radius;
		if (reach <= 0) continue;
		const d = distance(pos, {
			x: floe.center.x + mound.at.x * floe.radius,
			z: floe.center.z + mound.at.z * floe.radius
		});
		if (d >= reach) continue;
		height += mound.height * 0.5 * (1 + Math.cos((Math.PI * d) / reach));
	}
	return height;
}

/**
 * The slope a hill adds, in the same encoding the floe's own gradient uses.
 *
 * **A slope in this game points UPHILL**: `types.ts` defines the surface as `-(slope · local)` and
 * `step.ts` accelerates along `-slope`, so a penguin on a +z gradient slides toward −z. Getting that
 * backwards here made hills into magnets — gravity pulled penguins up onto the peak and held them
 * there, which the terrain tests caught as "a penguin that stopped pushing climbed".
 *
 * With the sign right, adding this to the floe's own tilt is all it takes for an iceberg to shed
 * whoever is standing on it, through the same line of `step.ts` that already handles a tilting floe.
 */
export function groundSlope(floe: Floe, pos: Vec2, course?: readonly Floe[]): Vec2 {
	// The BANK only, deliberately, where `groundHeight` above answers with the bank AND the fall.
	// `groundGradient` below is the one that describes the whole surface.
	// The asymmetry is not an oversight: the fall along the run is already carried by the floe's own
	// `slope` — an anchored floe keeps the tilt it was built with (`floe.stepFloe`) and `step.ts`
	// applies `G · (floe.slope + groundSlope)`. Returning the fall here as well would apply the
	// mountain's gravity twice. The total is what has to be right, and the total is `tilt + bank`.
	if (isChute(floe))
		return course ? blendedChuteGround(course, floe, pos).slope : bankAt(floe, pos).slope;
	if (floe.mounds.length === 0) return ZERO;
	let x = 0;
	let z = 0;
	for (const mound of floe.mounds) {
		const reach = mound.radius * floe.radius;
		if (reach <= 0) continue;
		const middle = {
			x: floe.center.x + mound.at.x * floe.radius,
			z: floe.center.z + mound.at.z * floe.radius
		};
		const d = distance(pos, middle);
		if (d >= reach || d < 1e-6) continue;
		// |d(height)/d(d)| for the cosine bump above, pointing INWARD — toward the peak, which is
		// uphill, which is what a slope is here.
		const rise = ((mound.height * 0.5 * Math.PI) / reach) * Math.sin((Math.PI * d) / reach);
		x += ((middle.x - pos.x) / d) * rise;
		z += ((middle.z - pos.z) / d) * rise;
	}
	return { x, z };
}

/**
 * How the surface `groundHeight` describes is tilted here — its gradient, uphill, like every slope.
 *
 * Not the same question as `groundSlope`, which answers "what does the ground add to gravity" and
 * deliberately leaves the mountain's own fall to the floe's `slope`. This one answers "which way is
 * the ice leaning", and the mountain's fall is very much part of that.
 *
 * `step.ts` needs it to tell a slope from a CREST. A penguin sliding down a constant grade is not
 * falling — its velocity runs along the surface — so the ground dropping away underneath it is not
 * air. A penguin running off the top of an iceberg is falling, because the ground dropped away
 * faster than the ice it was standing on was pointing. The difference between those two is exactly
 * "did the surface fall more than its own gradient predicted", and this is the predictor.
 */
export function groundGradient(floe: Floe, pos: Vec2, course?: readonly Floe[]): Vec2 {
	const ground = groundSlope(floe, pos, course);
	return isChute(floe) ? add(ground, floe.slope) : ground;
}

/**
 * The two halves a floe leaves behind.
 *
 * Pure, and a function of the floe alone, so the sea after a break is still decided by the seed the
 * round started with. They are pushed apart along the crack's NORMAL — the crack runs one way, the
 * halves separate across it — and each keeps a shape seed derived from its parent's, so a fragment
 * still looks like the island it came off.
 */
export function breakInTwo(floe: Floe, atTick: number, nextId: number): [Floe, Floe] {
	const radius = floe.radius * ROYAL_PIECE_FRACTION;
	// Across the crack, not along it — and offset by exactly their own radius, so the two halves
	// start out touching at the point the parent's middle used to be and open from there.
	const apart = fromHeading(floe.breakAngle + Math.PI / 2);
	const offset = radius;

	return [0, 1].map((side) => {
		const sign = side === 0 ? 1 : -1;
		const piece = makeFloe(
			nextId + side,
			add(floe.center, scale(apart, sign * offset)),
			radius,
			atTick,
			floe.shape + 17 * (side + 1),
			floe.breakAngle
		);
		piece.piece = true;
		piece.sinkTicks = ROYAL_PIECE_SINK_TICKS;
		piece.drift = scale(apart, sign * ROYAL_PIECE_DRIFT);
		return piece;
	}) as [Floe, Floe];
}

/**
 * The floe everything falls back to: the classic round's only one, and a Royal's middle.
 *
 * Never undefined — a world always has ice, `layout()` and `singleFloe()` both put the main floe at
 * index 0 — and it throws rather than returning null so a caller cannot quietly draw an empty sea.
 */
export function mainFloe(world: World): Floe {
	const first = world.floes[0];
	if (!first) throw new Error('a world was built with no ice in it');
	return first;
}

/** The classic round: one floe, at the origin, that never sinks. It only shrinks. */
export function singleFloe(): Floe[] {
	return [makeFloe(0, ZERO, FLOE_RADIUS, Infinity)];
}

/**
 * Is this floe about to break, and how far through the warning is it?
 *
 * 0 while nothing is wrong, rising to 1 at the moment the crack opens. One definition, three
 * readers: the HUD's countdown, the renderer's crack and shudder, and the sound.
 */
export function breakWarning(floe: Floe, playingTicks: number): number {
	if (floe.piece || floe.sinkAtTick === Infinity) return 0;
	const since = playingTicks - (floe.sinkAtTick - ROYAL_WARN_TICKS);
	return Math.max(0, Math.min(1, since / ROYAL_WARN_TICKS));
}

/**
 * A sea for `players` penguins: one floe in the middle and a ring of others around it.
 *
 * A ring rather than a scatter, and the reason is the migration: every outer floe touches the middle
 * one, so a penguin whose ice is sinking always has somewhere to go without crossing the whole map,
 * and the last floe standing is the one in the middle — which is where the final six end up, on the
 * biggest disc, framed exactly like the classic round.
 *
 * The gaps are jumpable BY CONSTRUCTION (see `JUMP_RANGE`) with a little seeded jitter, so a sea
 * varies between rounds without ever producing a floe nobody can leave. `layout.test.ts` asserts
 * that on a hundred seeds rather than trusting this paragraph.
 */
export function layout(players: number, seed: number): Floe[] {
	const rng = createRng(seed ^ 0x5eed);
	// How many floes this many penguins need, at the density the see-saw works at. Measured, not
	// guessed: five to a floe is a thirty-second fight (the classic round with five players is
	// exactly that), and thirty penguins on seven floes therefore burned the whole field before the
	// first floe had even started to sink. Three to a floe is a fight that lasts long enough for the
	// sinking to matter, which is the only reason the mode exists.
	const wanted = Math.max(3, Math.ceil(players / ROYAL_PER_FLOE));

	// The middle is a full-size classic floe: it is where the last survivors end up, and the finale
	// should be played in the arena every number in this game was tuned against.
	const middle = makeFloe(0, ZERO, FLOE_RADIUS, Infinity, Math.floor(range(rng, 0, 1024)));
	const floes = [middle];

	// A ring holds six floes and no more — the gap to the middle is fixed by how far a penguin can
	// jump, so the ring's circumference is fixed too, and a seventh would have to be squeezed into a
	// space narrower than a floe. More than seven floes therefore means a SECOND ring, hanging off
	// the first: an outer floe is reachable from its parent and from nowhere else, which is what
	// makes the map something to learn rather than a wheel.
	const inner = Math.min(6, wanted - 1);
	const spin = range(rng, 0, Math.PI * 2);
	const innerFloes: Floe[] = [];

	for (let i = 0; i < inner; i++) {
		const radius = radiusFor(rng);
		const angle = spin + (i / inner) * Math.PI * 2;
		const from = middle.radius + ROYAL_GAP + range(rng, 0, ROYAL_GAP_JITTER) + radius;
		const floe = makeFloe(
			floes.length,
			{ x: Math.sin(angle) * from, z: Math.cos(angle) * from },
			radius,
			0,
			Math.floor(range(rng, 0, 1024)),
			range(rng, 0, Math.PI)
		);
		floes.push(floe);
		innerFloes.push(floe);
	}

	// Whatever is left hangs off the inner ring, straight outward from its parent.
	const outerCount = Math.max(0, wanted - 1 - inner);
	for (let i = 0; i < outerCount; i++) {
		const parent = innerFloes[i % Math.max(1, innerFloes.length)];
		if (!parent) break;
		const radius = radiusFor(rng);
		const away = length(parent.center) || 1;
		const step = (parent.radius + ROYAL_GAP + range(rng, 0, ROYAL_GAP_JITTER) + radius) / away;
		floes.push(
			makeFloe(
				floes.length,
				{
					x: parent.center.x * (1 + step),
					z: parent.center.z * (1 + step)
				},
				radius,
				0,
				Math.floor(range(rng, 0, 1024)),
				range(rng, 0, Math.PI)
			)
		);
	}

	// The sea takes the OUTSIDE first and works inward, which is the only order that reads as the
	// water closing in — and the only one that never asks a penguin to jump outward to survive. The
	// middle is left alone: a Royal whose last ice disappeared would drown everybody and call it a
	// draw.
	const doomed = floes.slice(1).sort((a, b) => length(b.center) - length(a.center));
	for (const [i, floe] of doomed.entries()) {
		floe.sinkAtTick = ROYAL_SINK_FIRST_TICKS + i * ROYAL_SINK_INTERVAL_TICKS;
	}

	return floes;
}

function radiusFor(rng: Rng): number {
	return range(rng, ROYAL_FLOE_MIN_RADIUS, ROYAL_FLOE_MAX_RADIUS);
}

/**
 * Spread `ids` across the sea, a few to a floe, on a ring inside each.
 *
 * Same rule as the classic spawn — nobody starts within shoving distance of anybody — applied per
 * floe, and deliberately filling the OUTER floes first so the middle is not crowded on the tick the
 * round starts. The middle is where everybody ends up; arriving there early should be a choice.
 */
export function spawnSpots(floes: readonly Floe[], count: number, seed: number): Vec2[] {
	const rng = createRng(seed ^ 0xf10e);
	const spots: Vec2[] = [];
	// Outer floes first, middle last: `layout` puts the middle at index 0.
	const order = [...floes.slice(1), ...floes.slice(0, 1)];
	const perFloe = Math.ceil(count / order.length);

	for (const floe of order) {
		const here = Math.min(perFloe, count - spots.length);
		if (here <= 0) break;
		const spin = range(rng, 0, Math.PI * 2);
		for (let i = 0; i < here; i++) {
			const angle = spin + (i / here) * Math.PI * 2;
			// Half way out, the classic spawn's proportion. Further out is a penguin that starts the
			// round already sliding toward a rim on a floe that is already tilting.
			const r = floe.radius * 0.5 + range(rng, -0.25, 0.25);
			spots.push({
				x: floe.center.x + Math.sin(angle) * r,
				z: floe.center.z + Math.cos(angle) * r
			});
		}
	}
	return spots;
}

/**
 * Everyone standing on this floe right now.
 *
 * Airborne penguins are excluded, exactly as `weightTargetSlope` excludes them: a penguin mid-jump
 * is not pressing on anything, and one halfway between two floes must not tilt either.
 */
export function penguinsOn(floe: Floe, penguins: readonly Penguin[]): Penguin[] {
	return penguins.filter(
		(p) =>
			p.phase === 'skating' &&
			p.height <= 0 &&
			distance(floe.center, p.pos) <= floe.radius + RIM_GRACE
	);
}

/**
 * How far out the sea reaches, for anything that has to frame or fill it.
 *
 * The renderer's horizon and the spectator ring both need it, and both used to read `FLOE_RADIUS`
 * directly — which is right for exactly one of the two games this now has.
 *
 * `full` measures against each floe's ORIGINAL radius instead of what is left of it, which is what
 * the watching ring wants: a ring that crept inward as the ice shrank would read as the sea moving,
 * and it is the one thing on screen that should be still.
 */
export function seaRadius(world: World, full = false): number {
	let furthest = 0;
	for (const floe of world.floes) {
		furthest = Math.max(furthest, length(floe.center) + (full ? floe.fullRadius : floe.radius));
	}
	return furthest;
}
