/**
 * The mountain, drawn as one ribbon of ice cut into one cliff.
 *
 * The simulation builds the slide out of overlapping discs, because a disc is what "is there ice
 * under this penguin" understands (`sim/slide.ts`). Drawing those discs is what the first version
 * did, and it looked exactly like what it was: forty pancakes hanging in the air at slightly
 * different heights, with foam rings and snow drifts on them.
 *
 * So the discs are the physics and this is the picture: one merged strip sampled from `groundHeight`,
 * which is the function `step.ts` asks where the ice is. The same function, not one like it — so the
 * wall you can see and the wall that holds you in are the same wall by construction rather than by
 * two expressions agreeing. That is trap 8 read forwards: if the simulation has a shape you can lose
 * to, draw THAT shape.
 *
 * What it cannot do is make the shape READABLE, and that is the other half of trap 8. Two people have
 * now called this mode broken while every test passed, and from a camera on the deck the frame is only
 * ever three surfaces: deck, bank and sky. The rim is a convex silhouette, so the cliff, the crags,
 * the sea and two hundred metres of mountain are all behind it and none of them can help. Everything
 * a racer needs to judge — where the ice stops, where the middle is, how far up the bank they are,
 * how fast they are going — has to be drawn on those three surfaces or it is not on the screen. Hence
 * the kerb, the centre line, the four-step bank, and `STEPS`.
 *
 * What is OUTSIDE the run is a CLIFF, and that is a rule before it is a look. `floeUnder` has never
 * heard of the mountainside: a racer who goes over the lip is in the water a second later, however
 * much ice was drawn beside them. The old version put a sixteen-metre shoulder out there falling
 * away at the grade of the run — ground, to look at, that a penguin drops straight through, which is
 * rule 2 of `docs/DESIGN.md` failing the way trap 8 failed it. A cliff is the only shape that tells
 * the truth about that, and it is also the shape that makes the thing read as a mountain: six facets
 * at six unequal angles, wandering, take the one polar sun six different ways, where a plateau and a
 * run tilted the same way are two patches of the same white.
 *
 * How far out it may reach is a MEASUREMENT, not a taste. The course bends at `SLIDE_BEND_RATE` in
 * steps of `SLIDE_SEGMENT_STEP` — a radius of curvature of about forty-four metres — so it can come
 * back near itself, and mountainside that reached that far would be drawn ice standing over the run
 * below it, which is the grey slab nobody could name. Across six hundred seeds the closest a probe
 * 30 m from a segment's centre ever comes to another segment's rim is 14.6 m — the course returns
 * ALONG itself and never beside itself, so a sideways reach is cheap — and the drawn mountain reaches
 * 29.8 m. Nothing has to be clamped. Past about 44 m that stops being true, and the margin is what
 * pays for the depth: spend it going down rather than going out.
 */
import { BufferGeometry, Float32BufferAttribute, Group, Mesh, MeshLambertMaterial } from 'three';
import { groundHeight } from '../sim/archipelago';
import { SLIDE_BANK_HEIGHT } from '../sim/constants';
import { bankAt, segmentHeading } from '../sim/slide';
import type { Floe } from '../sim/types';

/** A corner of the mountain. */
type Point = readonly [number, number, number];

/**
 * How many points across the run.
 *
 * A MULTIPLE OF TEN, or the picture stops agreeing with the physics. `bankAt` stops rising at 80% of
 * the half-width and is a flat SHELF from there to the rim — the shelf being the whole reason a racer
 * thrown up the bank lands on top of it instead of going over — so 0.8 has to land exactly on a
 * sample. One off it and the drawn wall climbs all the way to the edge: the ledge that saves the
 * racer is drawn as a slope they should be sliding back down.
 *
 * Twenty rather than ten because of what the player can actually SEE. From a camera on the deck the
 * rim is a convex silhouette: the cliff, the crags, the sea and two hundred metres of mountain are
 * all BEHIND it, and the entire frame is deck, bank and sky. So every readable thing in this mode has
 * to be drawn on those three surfaces, and at ten samples the bank was two facets — it went from flat
 * to full height in one step and did not read as rising at all. Twenty gives it four, which is a
 * curve. Forty triangles a segment against one merged mesh; the budget here is draw calls, and this
 * is not one.
 */
const SAMPLES = 20;

/**
 * The floor of the run.
 *
 * Not the brightest thing here — the crest of a bank is. A trough sees less sky than the walls around
 * it, and that difference IS the cross-section: one value across deck and wall and the chute is a
 * white cut-out of a chute.
 */
const DECK = 0xd2e9fb;

/**
 * How many slices of drawn ice per segment of simulated ice.
 *
 * THREE, and this is the number that decides whether the mode feels fast. A segment is 7 m and a
 * chute settles at 12.3 m/s, so banding locked to the segment flickers at 1.7 Hz — below the rate at
 * which the eye reads a moving pattern as SPEED at all. It reads as large panels changing slowly,
 * which is precisely "a flat pale value like a concrete road with nothing to judge speed against".
 * Sliced in three the band is 2.33 m and the rhythm is 5.1 Hz, which is about where road markings sit
 * at motorway speed.
 *
 * It is also the only way the run gets a rhythm at all: everything else about the surface — the kerb,
 * the centre line, the bank — is a shape, and a shape does not move relative to the player. Only the
 * transverse rhythm does.
 *
 * It has to be ODD. The band alternates on `id * STEPS + s`, so an even count makes every segment
 * start on the same parity and the rhythm stalls for two slices at every segment boundary — a limp in
 * the one pattern whose whole job is to be even. Odd, the alternation runs straight through.
 */
const STEPS = 3;

/**
 * How much darker every other segment is.
 *
 * A speedometer, and the reason the run needs one is arithmetic rather than taste: a chute settles at
 * twelve metres a second and nothing in the middle of the frame changes unless something in the
 * middle of the frame is marked. Seven metres of banding flowing under a racer is the same device as
 * the dashes on a road, and it is here for the same reason.
 *
 * It runs ACROSS the run and it is the only thing in this file that does. The previous version put a
 * few percent of per-facet wobble on every deck strip as well, which was a mistake worth writing
 * down: the wobble was the same size as the banding and keyed on the strip as well as the segment, so
 * the transverse rhythm became a checkerboard and the one speed cue in the mode was cancelled by the
 * code meant to stop the ice looking flat. The MOUNTAIN gets the variety. The run gets the rhythm.
 */
const BAND_DEPTH = 0.93;

/** The crest of a bump, which is the one part of the deck that stands INTO the light. */
const DECK_BUMP = 0xeafaff;

/**
 * The kerb: the outermost twentieth of the run on each side, which is the top of the shelf.
 *
 * The single most important value in this file, because it answers the one question a child is
 * actually asking at twelve metres a second — WHERE DOES THE ICE STOP. Everything out there used to
 * be a shade of white against a shade of white, and a rim you cannot see is trap 8's family: losing
 * to something that was never on the screen. It is dark, it is continuous, and it is the one thing
 * here the transverse banding does not touch, because a dashed edge is not an edge.
 */
const KERB = 0x7ba3c6;

/**
 * The line down the middle, dashed on alternate segments.
 *
 * The other half of the reference frame. The kerb says where the ice stops and this says where the
 * middle is, which between them are the only two facts a racer on a banked surface needs and neither
 * of which the run had. Dashed rather than solid because a dash moving under you is a speed cue and a
 * solid line is a stripe: the same reason roads dash theirs.
 */
const CENTRE_LINE = 0xa6cbe8;

/**
 * The bank, from the foot of the wall to its crest, mixed by how high the ice actually is.
 *
 * Not two values on a threshold: `mix`ed continuously by the strip's own height as a fraction of
 * `SLIDE_BANK_HEIGHT`, so the wall gets brighter the further up it goes and the cross-section reads as
 * a curve rather than as a step. That is the answer to "the banks do not announce themselves" — a
 * banked wall that is one value is a floor with a different outline, and a player who cannot see the
 * bank rising has no way to know they are being thrown until they are over the rim.
 *
 * The foot is DEEPER than the deck and the crest is brighter than anything else on the mountain. The
 * crest is not 0xffffff, and that is a paid-for lesson rather than a preference: pure white has no
 * channel left to vary, so every wobble can only take it DOWN, and a value taken down from pure white
 * is a neutral GREY. Seven hundred vertices of #ffffff plus a spread of #f9f9f9 to #fdfdfd was the
 * "grey-white paper" the art director kept naming — the ice had been desaturated to paper by the code
 * meant to give it variety. A near-white with blue in it goes to paler and deeper BLUE, like ice.
 */
const WALL_FOOT = 0xc6dff4;
const WALL_CREST = 0xf4fcff;

/**
 * The shelf on a side the course has left OPEN.
 *
 * The open side has a wall a third of the usual height (`SLIDE_OPEN_WALL`) and it is the one place on
 * the mountain that will not hold a racer in. The missing wall is the honest cue and this is the
 * redundant one, in the sense `CLAUDE.md` asks for: shape first, colour as well.
 *
 * It was 0x8fb6d6, which is LIGHTER than the ordinary kerb — the hazard edge was less visible than
 * the safe one, which is the cue pointing the wrong way. It is now the darkest and the only WARM
 * thing on the ice: nothing else in this mode has any red in it, so a band that does reads as a mark
 * somebody painted rather than as ice that happens to be a different blue. The art director looked at
 * an open side and read it as geometry that had failed to draw, which is the strongest evidence
 * available that the old cue said nothing at all.
 */
const EDGE_WARN = 0x8a6a63;

/**
 * How much further the rim falls away on an open side, in metres.
 *
 * Two, on top of the first rail's own 3.2 — so where every other stretch of rim carries a cornice up
 * to 1.3 m above the anchor, this one sits 5.2 m below it. That is a 6.5 m notch in the skyline at the
 * one place the ice will not hold you, and a notch in a horizon is visible from much further away than
 * a change of colour on a shelf.
 */
const OPEN_DIP = 2;

/**
 * How many segments either side of an open one carry the mark.
 *
 * Two, which is five segments of it — 35 m, or about three seconds at the speed a chute settles at.
 * Painted on the open segment alone it was 14 m of shelf, a tenth of that: a label on the hole you
 * are already falling through rather than a thing you can see coming and steer away from. The whole
 * reason the open side exists is that it is the bill for carrying too much speed into the bend before
 * it, and a bill nobody can read in time is just a random death.
 */
const WARN_SPREAD = 2;

/**
 * Under the lip.
 *
 * The darkest band on the mountainside, immediately outside the brightest line on it. That pairing
 * is the whole trick for "where does the ice stop": white crest, hard edge, dark drop. Anything
 * gentler and the rim is a shade of white against a shade of white, which is what the run had.
 */
const LIP_SHADOW = 0x5f8bb2;

/** The cliff where it goes into the sea, and the WET band right at the surface. */
const WATERLINE = 0x2a5580;
const WET = 0x1a3554;

/**
 * How tall the wet band is.
 *
 * Trap 16 in `CLAUDE.md`, applied before it is paid for a second time: an iceberg without a wet band
 * at the waterline and bulk continuing below it reads as a paper boat sitting ON the surface rather
 * than as a mass sitting IN it. A mountain two hundred metres tall is the same object with the same
 * tell. 1.6 m is about a penguin, which is the only scale reference the frame has.
 */
const WET_BAND = 1.6;

/** Rock. The only thing here that is not ice, and the only thing giving the cliff a scale. */
const ROCK = 0x55606d;

/**
 * Snow that has caught on a ledge, and old ice that has not.
 *
 * The two MARKS on the cliff, and the reason they exist is the Royal, which reads as a mass of ice
 * where this reads as folded paper. A floe there is not one white: it carries drifts, a patch of
 * meltwater, rocks. That is what the eye needs to stop seeing a plane — a value that does not belong
 * to the plane it is on. Scattered per facet, from a hash, so no two segments are marked alike.
 */
const SNOW_SHELF = 0xe8f5ff;
const BLUE_ICE = 0x2f86b8;

/**
 * The face of the mountain, as rails running down it: how far out from the rim, how far below it.
 *
 * SIX rather than four, and the gradients deliberately unequal — 2.1, 0.9, 1.7, 2.5, 1.7, 2.0. Four
 * rails at one gradient are one flat plane with three lines drawn on it, which was the origami wedge;
 * four rails at four gradients turned out to be four flat panels folded along hard creases, which is
 * the same complaint with more corners in it. What the eye reads as MASS is many small facets, so
 * this is smaller facets, unequal, and — see `railsFor` — not the same on two consecutive segments,
 * which is what stops the creases running dead straight for a hundred metres.
 *
 * Every one of them is steeper than the run itself (0.5). That is the point: a mountainside at the
 * grade of the chute reads as ground you could ride, and there is no ice out there at all.
 */
const RAILS: readonly { readonly out: number; readonly down: number; readonly colour: number }[] = [
	{ out: 0.9, down: 3.2, colour: 0x93bcd8 },
	{ out: 2.6, down: 5.0, colour: 0x7aabcd },
	{ out: 5.0, down: 8.5, colour: 0x5e93bd },
	{ out: 8.0, down: 15, colour: 0x4a7cab },
	{ out: 11.5, down: 21, colour: 0x396a99 },
	{ out: 16, down: 30, colour: 0x2f5c86 }
];

/**
 * How far the first rail can rise ABOVE the line the mountainside hangs from.
 *
 * The mountain had no mass above the run's rim anywhere on it, which made the rim the silhouette for
 * its whole length: four hundred metres of dead straight edge against the sky, and the art director
 * read it as an unfinished mesh, correctly. Real chutes have a cornice on the lee edge for the same
 * reason a real dune does — wind puts snow where the ground stops. So the first rail is allowed to
 * curl UP, on a slow wander so a cornice is a 28 m ridge rather than a per-segment spike.
 *
 * 4.5 against a base of 3.2 means the lip ranges from 3.2 m below the anchor to 1.3 m above it. The
 * ceiling is a sight line, not a taste: the crest sits 0.9 m outside the rim and at most 3.7 m over
 * the deck, and the camera looks along the run from ten metres up — so a cornice can never be the
 * thing that hides the corner ahead.
 */
const CORNICE = 4.5;

/**
 * How far a rail wanders from where the table puts it: sideways, and downwards.
 *
 * The one change in this file that turns the mountainside from panels into a mountainside. A rail at
 * its table value is a ruled line running the whole length of the run, parallel to the five other
 * ruled lines, and a surface bounded by parallel straight creases is a folded sheet whatever it is
 * coloured. Wandered, the crease is a ridge and the ground beside it is a gully.
 *
 * SIDEWAYS is the one that does the work and it gets 0.45 — ±22% of reach, taking the outermost rail
 * to 19.5 m and the flared foot to 30.7 m from a segment's centre. DOWNWARDS gets a third of that,
 * because the deepest rail is 30 m down and the same fraction there is ±6.6 m of vertical noise per
 * seven metres of run: that is not a ridge, it is a crumpled silhouette. The eye reads a wandering
 * crease as terrain and a wandering skyline as a mistake.
 */
const RAIL_WANDER = 0.45;
const DEPTH_WANDER = 0.16;

/**
 * How long a ridge is, in segments.
 *
 * Four, so about 28 m. White noise per segment is not terrain: it gives a crease that zig-zags every
 * seven metres, which reads as a bad mesh rather than as a mountainside. `wanderAt` interpolates
 * between values four segments apart with a smoothstep and adds a fine tremor on top — the coarse
 * term is the ridge and the fine one is the ice on it.
 */
const RIDGE_SPAN = 4;

/**
 * How much a facet's own value varies from its rail's.
 *
 * Ten percent, which is the smallest amount that reads at a distance and the largest that does not
 * turn an ice cliff into camouflage. Without it every facet on a rail is the same number, and a run
 * of identical values with creases between them is exactly the thing that reads as paper — the eye
 * takes a constant value as a flat sheet no matter how the geometry is folded.
 *
 * It only ever DARKENS. Centred on the rail's own value it would have to brighten too, and the
 * brightest thing here is already a near-white: brightening that clips green and blue at 255, which
 * throws away the blue the colour was chosen for and lands back on grey. Downwards, every variation
 * is more ice rather than less.
 */
const FACET_VARY = 0.1;

/**
 * How much the foot splays out where it goes under the water.
 *
 * Six, and the 22 m of total reach that makes is the number the header paragraph measures against. A
 * base that flared with its own depth — two hundred metres of it, at the top of the run — gave the
 * mountain a properly enormous massif and spent every metre of that margin doing it.
 */
const BASE_FLARE = 6;

/**
 * The summit above the start: how high over the middle of the run, how far back, and how far the
 * back of it falls away.
 *
 * Eleven metres against a run 10.4 m wide is a crest you read as a crest rather than as a kerb, and
 * nine metres back makes it a dome instead of a wall — a wall at the top of a chute is a door, and the
 * run is meant to look like it comes OVER something. The drop behind is 26 m because nothing needs to
 * be right about it except that no camera can see under it.
 */
const SUMMIT_RISE = 11;
const SUMMIT_BACK = 9;
const SUMMIT_DROP = 26;

/** The summit's own ice: the deck's white, since it is the same snow the run is cut through. */
const SUMMIT_FACE = 0xd8ecfc;

/** How far under the water the ice carries on, so the waterline is a join and not a visible seam. */
const WATER_SINK = 1.5;

/**
 * A number in [0, 1) from three integers.
 *
 * Deterministic, because everything drawn here has to be the same mountain on a host and on a client
 * — `Math.random()` in the renderer is two devices watching the same round draw different frames, and
 * `puff.ts` records the same reason for the same decision. Three integers rather than one because
 * every scatter here is keyed on a segment, a rail and a side, and one key per thing scattered means
 * the wander of a rail cannot correlate with the colour of the facet it bounds.
 */
function hash(a: number, b: number, c: number): number {
	let t = (a * 374761393 + b * 668265263 + c * 2246822519) >>> 0;
	t = Math.imul(t ^ (t >>> 13), 1274126177) >>> 0;
	return ((t ^ (t >>> 16)) >>> 0) / 4294967296;
}

/**
 * A wander in [0, 1) that changes SLOWLY down the run, with a tremor on it.
 *
 * Value noise, in one dimension, because the thing being drawn is a ridge line and a ridge is
 * correlated over tens of metres. The coarse term is interpolated between samples `RIDGE_SPAN`
 * segments apart with a smoothstep, so a crest crests instead of cornering; the fine term is a
 * seventh of the amplitude and per segment, so no two facets on one ridge are identical.
 */
function wanderAt(id: number, rail: number, key: number): number {
	const coarse = id / RIDGE_SPAN;
	const low = Math.floor(coarse);
	const t = coarse - low;
	const a = hash(low, rail, key);
	const b = hash(low + 1, rail, key);
	const eased = t * t * (3 - 2 * t);
	return (a + (b - a) * eased) * 0.72 + hash(id, rail, key + 7) * 0.28;
}

/**
 * One facet's colour: its rail's, moved by how STEEP it is and by a per-facet wobble.
 *
 * The steepness term is the honest half of "cool the shadowed side, warm the lit one" — honest
 * because it needs no second copy of where the sun is. Ice lying back toward the sky takes the warm
 * light from it; ice standing on edge takes the cold half of the hemisphere and the light bouncing
 * off the water, which is bluer and less of it. That is what `polarDayLights`' HemisphereLight
 * already does, exaggerated here so it survives the fog. The left/right asymmetry the sun gives is
 * left to the sun: the facets face sideways now, so it can find them.
 *
 * @param gradient Metres down per metre out. 0.5 is the grade of the run; 2.5 is a wall.
 */
function paint(colour: number, gradient: number, wobble: number): number {
	const lying = 1 / (1 + gradient);
	return scaled(colour, (0.9 + 0.16 * lying) * (1 - FACET_VARY + FACET_VARY * wobble), 12 * lying);
}

/** Two colours, blended per channel. `t` is clamped, because a bank can be measured slightly over. */
function mix(from: number, to: number, t: number): number {
	const at = Math.max(0, Math.min(1, t));
	const channel = (shift: number) => {
		const a = (from >> shift) & 255;
		return Math.round(a + (((to >> shift) & 255) - a) * at);
	};
	return (channel(16) << 16) | (channel(8) << 8) | channel(0);
}

/**
 * One colour, brightened or darkened, and pushed warm or cold.
 *
 * `warm` moves red up and blue down by the same amount, which is a colour temperature rather than a
 * hue: on ice it is the difference between snow in the sun and snow in the shade, and it is the one
 * axis a polar scene has to spare. The deck goes through here WITHOUT it — a trough is not an
 * outward-facing surface and the sky-exposure argument in `paint` does not describe it, and the crest
 * of a bank has to stay the brightest, coldest white in the frame or the lip stops being a line.
 */
function scaled(colour: number, value: number, warm = 0): number {
	const channel = (shift: number, add: number) =>
		Math.max(0, Math.min(255, Math.round(((colour >> shift) & 255) * value + add)));
	return (channel(16, warm) << 16) | (channel(8, 0) << 8) | channel(0, -warm);
}

export interface Chute {
	root: Group;
	dispose(): void;
}

/**
 * Build the ribbon from the course the simulation is using.
 *
 * Taken from the same floes rather than from the seed, so the drawn mountain cannot be a different
 * mountain from the one being played — the trap that had the floe drawn at full size while the
 * simulation shrank the arena underneath it (trap 8 in `CLAUDE.md`), in a new place.
 */
export function createChute(course: readonly Floe[]): Chute {
	const root = new Group();
	if (course.length < 2) return { root, dispose() {} };

	const positions: number[] = [];
	const colours: number[] = [];

	const push = (point: Point, colour: number) => {
		positions.push(point[0], point[1], point[2]);
		colours.push(((colour >> 16) & 255) / 255, ((colour >> 8) & 255) / 255, (colour & 255) / 255);
	};

	/**
	 * Three corners, wound COUNTER-CLOCKWISE as seen from the side the face is meant to be visible
	 * from. Three does not draw a back face, and `computeVertexNormals` takes its direction from the
	 * same winding — so getting this backwards is not a subtle shading difference. Every quad here
	 * was inverted once: the deck's normal pointed at the sea floor, the run was culled from above,
	 * and the screen showed the SKIRTS through the hole where the ice should have been. It read as a
	 * dark grey mountain rather than as a missing surface, which is why it survived a look. The rocks
	 * were STILL inverted after that pass, and read as exactly what trap 14 says they read as: a dark
	 * grey blob nobody could name, which is the inside of the far faces of a pyramid you are looking
	 * through the near faces of.
	 */
	const tri = (a: Point, b: Point, c: Point, ca: number, cb: number, cc: number) => {
		push(a, ca);
		push(b, cb);
		push(c, cc);
	};

	/** Four corners of a flat face, one colour, wound counter-clockwise seen from the front. */
	const quad = (a: Point, b: Point, c: Point, d: Point, colour: number) => {
		tri(a, b, c, colour, colour, colour);
		tri(a, c, d, colour, colour, colour);
	};

	/**
	 * One strip down the mountainside, with its own colour at the top edge and at the bottom.
	 *
	 * The winding FLIPS with the side, and it has to: the left face of the mountain is seen from the
	 * left and the right face from the right, so one order of the same four corners is outward on one
	 * side and inward on the other. Getting it wrong gives a flank lit from inside the mountain,
	 * which is trap 14 and is invisible rather than merely dark.
	 */
	const band = (
		side: number,
		innerA: Point,
		innerB: Point,
		outerA: Point,
		outerB: Point,
		inner: number,
		outer: number
	) => {
		if (side < 0) {
			tri(outerA, innerA, innerB, outer, inner, inner);
			tri(outerA, innerB, outerB, outer, inner, outer);
		} else {
			tri(innerA, outerA, outerB, inner, outer, outer);
			tri(innerA, outerB, innerB, inner, outer, inner);
		}
	};

	/** Across the run, to the right of the way it is going. The one place that sign is decided. */
	const acrossOf = (floe: Floe) => {
		const along = segmentHeading(floe);
		return { x: -along.z, z: along.x };
	};

	/**
	 * Across the run a fraction `u` of the way between two segments.
	 *
	 * Every point placed sideways from the run has to use THIS and not one segment's own vector, and
	 * the reason is the same bug twice. A rail extruded along the near segment's vector was two and a
	 * half metres from itself at the next segment's boundary — the sawtooth down the flank. Then the
	 * mountainside was sliced three ways along the run and the waterline's flare kept doing it, once
	 * per slice instead of once per segment: a 1.91 m crack at every boundary on a bend, three times a
	 * segment, all the way down two hundred metres of it. On screen that is a fan of thin vertical
	 * lines and a shoal of striped triangles under the flank, which is exactly what it looked like.
	 */
	const acrossAt = (here: Floe, next: Floe, u: number) => {
		const from = acrossOf(here);
		const to = acrossOf(next);
		const x = from.x + (to.x - from.x) * u;
		const z = from.z + (to.z - from.z) * u;
		const len = Math.hypot(x, z) || 1;
		return { x: x / len, z: z / len };
	};

	/**
	 * The cross-section of the run, a fraction `u` of the way from one segment to the next.
	 *
	 * The height comes from `groundHeight` — the function `step.ts` asks where the ice is. Not
	 * something like it, not `bankAt` plus this file's own idea of the fall: the same function, so the
	 * ice you can see and the ice that holds you are the same ice by construction rather than by two
	 * expressions agreeing. That closes the last approximation in here as a side effect: `bankAt`
	 * gives a bump a cosine along the run, and sampling only at segment centres drew it as a crease
	 * with straight sides, a tenth of a metre out in the middle. Sampled properly, a bump is a bump.
	 *
	 * The disc that owns an intermediate point is the nearer centre — the same bisector handoff
	 * `floeUnder` makes. Across the run the direction is interpolated rather than handed over, because
	 * a handover puts a kink in the middle of every bend.
	 *
	 * **The two answers agree ON THE CENTRELINE for the reason the line above gives, and nowhere
	 * else — this comment used to claim otherwise and was wrong.** `groundHeight` is measured from
	 * each segment's own centre, and two centres 7 m apart on a bend do not agree off the centreline
	 * even with an identical heading, because the offset itself is `(pos − centre) · across` and the
	 * centres are the thing that differs. `groundHeight`'s own `course` parameter is what actually
	 * closes this — blending this segment's answer with its neighbour's rather than handing the
	 * query to exactly one of them — and it is passed below for that reason, not for the interpolated
	 * `across` above, which only ever smoothed the drawn WIDTH and never touched the height.
	 */
	const sliceAt = (here: Floe, next: Floe, u: number): Point[] => {
		const owner = u < 0.5 ? here : next;
		const across = acrossAt(here, next, u);
		const cx = here.center.x + (next.center.x - here.center.x) * u;
		const cz = here.center.z + (next.center.z - here.center.z) * u;
		const points: Point[] = [];
		for (let i = 0; i <= SAMPLES; i++) {
			const t = ((i / SAMPLES) * 2 - 1) * owner.radius;
			const at = { x: cx + across.x * t, z: cz + across.z * t };
			points.push([at.x, owner.altitude + groundHeight(owner, at, course), at.z]);
		}
		return points;
	};

	/** How high the ice sits at a segment's own centre: zero, or the crest of a bump. */
	const bumpOf = (floe: Floe) => bankAt(floe, floe.center).height;

	/**
	 * Where the mountainside hangs from: the rim a segment WOULD have with a full wall and no bump.
	 *
	 * A straight line down the hill, and it has to be, because everything below it inherits whatever
	 * it does. Two things move a real rim and both of them stepped the whole cliff when it hung off
	 * the real one:
	 *
	 *  * a BUMP, which `bankAt` adds across the entire width of the run, rim included — half a metre
	 *    on one segment in `SLIDE_BUMP_EVERY`, six times down the run;
	 *  * an OPEN side, where the wall is `SLIDE_OPEN_WALL` of its height — 1.63 m, four to six times.
	 *
	 * Each one put a rectangular notch in the lip AND in all six creases under it, which is the
	 * staircase down the left-hand flank. The mountain does not rise because there is a bump in the
	 * chute and it does not fall away because the wall is low: the first strip absorbs the difference,
	 * and the deck's rim still carries both exactly as the simulation has them.
	 */
	const anchorY = (floe: Floe) => floe.altitude + SLIDE_BANK_HEIGHT;

	/** Which segments carry the open-side mark, on which side. Asked of the course, spread by `WARN_SPREAD`. */
	const warned = new Set<string>();
	for (const floe of course) {
		if (floe.openSide === 0) continue;
		for (let d = -WARN_SPREAD; d <= WARN_SPREAD; d++) warned.add(`${floe.id + d}:${floe.openSide}`);
	}

	/**
	 * Where this segment's rails actually go, wandered by `RAIL_WANDER`.
	 *
	 * Per floe and side, so the two iterations that share a rail put it in the same place — the old
	 * flank extruded both of its edges along the NEAR segment's across-vector, and on a bend (0.16 rad
	 * a segment, sixteen metres out) that left a rail two and a half metres from itself at every
	 * boundary. That was the sawtooth.
	 *
	 * Each rail is clamped to stay outside and below the one before it. Not politeness: a rail that
	 * wandered past its neighbour would invert the strip between them, and an inverted strip is a face
	 * wound the wrong way — invisible AND lit from inside the mountain, which is trap 14 arriving by
	 * arithmetic rather than by a typo.
	 */
	const railsFor = (floe: Floe, side: number) => {
		const rails: { out: number; down: number; colour: number }[] = [];
		let lastOut = 0;
		let lastDown = 0;
		for (const [k, rail] of RAILS.entries()) {
			const out = Math.max(
				lastOut + 0.4,
				rail.out * (1 + (wanderAt(floe.id, k, side + 2) - 0.5) * RAIL_WANDER)
			);
			const wandered = rail.down * (1 + (wanderAt(floe.id, k, side + 11) - 0.5) * DEPTH_WANDER);
			// The first rail is the only one allowed above the anchor, and it is the only one with no
			// floor under it: a cornice is a lip that curls UP, and clamping it to `lastDown + 0.6`
			// would be the clamp cancelling the feature. Everything below it still has to stay below
			// what it hangs from — a rail that overtook its neighbour would invert the strip between
			// them, and an inverted strip is a face wound the wrong way (trap 14, by arithmetic).
			// A cornice curling up over a side the course has deliberately left OPEN is a mixed
			// message — the one place the mountain will not hold a racer in should be the one place
			// the skyline dips, not a lip like every other. So the rim drops away there instead, for
			// the whole `WARN_SPREAD`, which puts a visible notch in the horizon 35 m before the hole
			// in the wall arrives. Shape first; the mark on the shelf is the redundant half.
			const open = warned.has(`${floe.id}:${side}`);
			const down =
				k === 0
					? open
						? wandered + OPEN_DIP
						: wandered - CORNICE * wanderAt(floe.id, 0, side + 77)
					: Math.max(lastDown + 0.6, wandered);
			// The mark, if this facet has one. A shelf of snow up high where snow can settle; old blue
			// ice anywhere, because that is what a cliff is made of under the white.
			const mark = hash(floe.id, k, side + 23);
			const colour =
				mark > 0.86 && k < 3 ? SNOW_SHELF : mark < 0.12 ? BLUE_ICE : (rail.colour ?? 0);
			rails.push({ out, down, colour });
			lastOut = out;
			lastDown = down;
		}
		return rails;
	};

	/**
	 * One rail, placed: out from the segment's CENTRE along its own across-vector, down from
	 * `anchorY`.
	 *
	 * From the centre and the anchor rather than from the drawn rim, because both of those are smooth
	 * functions of the segment and the rim is not. Out along the segment's OWN across-vector is the
	 * other half of that: the old flank extruded both of its edges along the near segment's vector, so
	 * on a bend (0.16 rad a segment, sixteen metres out) a rail was two and a half metres from itself
	 * at every boundary. That was the sawtooth along the bottom.
	 */
	const railPoint = (floe: Floe, side: number, out: number, down: number): Point => {
		const across = acrossOf(floe);
		const reach = (floe.radius + out) * side;
		return [
			floe.center.x + across.x * reach,
			anchorY(floe) - down,
			floe.center.z + across.z * reach
		];
	};

	/** The bottom of the mountain, which is the sea. See `setSeaLevel` in `render/scene.ts`. */
	const waterY = (course[course.length - 1]?.altitude ?? 0) - WATER_SINK;

	for (let i = 0; i < course.length - 1; i++) {
		const here = course[i];
		const next = course[i + 1];
		if (!here || !next) continue;

		// `STEPS + 1` cross-sections, so the deck is drawn in slices of 2.33 m rather than 7 m. The
		// first and last are the segments' own profiles, which is what keeps this pair welded to the
		// pairs either side of it.
		const slices: Point[][] = [];
		for (let s = 0; s <= STEPS; s++) slices.push(sliceAt(here, next, s / STEPS));

		// A GAP is a missing id, and it must be a hole in the DECK as well as in the physics — a
		// ribbon drawn straight across one would be ice you can see and fall through. The mountain
		// carries on across it: a gap is a hole in a ledge, not a canyon cut through the mountainside,
		// and drawing it as a canyon is most of why the run read as a strip of paper in mid-air.
		const solid = next.id === here.id + 1;

		// Whether this segment carries a bump, asked of the simulation rather than recomputed from the
		// id — one segment in `SLIDE_BUMP_EVERY`, and the crest is the one part of the deck that stands
		// INTO the light.
		const bump = bumpOf(here) > 0.05;

		if (solid) {
			for (let s = 0; s < STEPS; s++) {
				const near = slices[s];
				const far = slices[s + 1];
				const middle = near?.[SAMPLES / 2];
				if (!near || !far || !middle) continue;
				// The transverse rhythm counts SLICES, not segments — see `STEPS`. Alternating on the
				// segment alone was a 1.7 Hz flicker, which the eye does not read as speed.
				const dark = (here.id * STEPS + s) % 2 !== 0;
				for (let k = 0; k < SAMPLES; k++) {
					const a0 = near[k];
					const a1 = near[k + 1];
					const b0 = far[k];
					const b1 = far[k + 1];
					if (!a0 || !a1 || !b0 || !b1) continue;
					const side = k < SAMPLES / 2 ? -1 : 1;
					// How far up the bank this strip is, as a fraction of a full wall — measured against
					// this slice's OWN centre line, so the fall down the run and the lift of a bump are
					// both already subtracted and only the bank is left.
					const up = (Math.max(a0[1], a1[1]) - middle[1]) / SLIDE_BANK_HEIGHT;
					// How far in from the rim, in strips. Zero is the kerb and `SAMPLES / 2 - 1` is the
					// centre line: the two facts a racer on a banked surface needs, and the run had neither.
					const inward = Math.min(k, SAMPLES - 1 - k);
					const open = warned.has(`${here.id}:${side}`) || warned.has(`${next.id}:${side}`);
					const base =
						inward === 0
							? open
								? EDGE_WARN
								: KERB
							: up > 0.012
								? mix(WALL_FOOT, WALL_CREST, up)
								: bump
									? DECK_BUMP
									: inward === SAMPLES / 2 - 1 && !dark
										? CENTRE_LINE
										: DECK;
					// The transverse band, and NOT on the kerb: a dashed edge is not an edge.
					const colour = inward > 0 && dark ? scaled(base, BAND_DEPTH) : base;
					// Counter-clockwise seen from ABOVE, which is where the player is.
					quad(a0, a1, b1, b0, colour);
				}
			}
		}

		for (const side of [-1, 1]) {
			const rails = railsFor(here, side);
			const paired = railsFor(next, side);
			const edge = side < 0 ? 0 : SAMPLES;

			// The mountainside is sliced along the run to the same `STEPS` as the deck, and that is not
			// for the look of it: the deck's rim now has intermediate points on it, and a cliff drawn as
			// one quad per segment would meet them at T-junctions. Every rail here is a straight line
			// between the two segments' own rails, so slicing it changes no shape — it only keeps every
			// edge in this mesh shared with exactly one other, which is the property the winding check
			// depends on.
			for (let s = 0; s < STEPS; s++) {
				const nearRim = slices[s]?.[edge];
				const farRim = slices[s + 1]?.[edge];
				if (!nearRim || !farRim) continue;
				const from = s / STEPS;
				const to = (s + 1) / STEPS;
				const at = (p: Point, q: Point, u: number): Point => [
					p[0] + (q[0] - p[0]) * u,
					p[1] + (q[1] - p[1]) * u,
					p[2] + (q[2] - p[2]) * u
				];

				let innerA = nearRim;
				let innerB = farRim;
				// The rim itself is painted with the shadow under the lip rather than with the colour of
				// the ice on top of it: the break in value has to land ON the edge, which is the only line
				// in this mode a child has to be able to see coming.
				let innerColour = LIP_SHADOW;
				let outerA = nearRim;
				let outerB = farRim;
				let lastOut = 0;
				let lastDown = 0;
				for (const [k, rail] of rails.entries()) {
					const far = paired[k];
					if (!far) continue;
					const p = railPoint(here, side, rail.out, rail.down);
					const q = railPoint(next, side, far.out, far.down);
					outerA = at(p, q, from);
					outerB = at(p, q, to);
					// Painted from the facet's OWN gradient, which is why the rails are allowed to wander:
					// a wandered rail is a differently-lit facet as well as a differently-shaped one.
					const colour = paint(
						rail.colour,
						(rail.down - lastDown) / Math.max(0.2, rail.out - lastOut),
						hash(here.id, k, side + 41)
					);
					band(side, innerA, innerB, outerA, outerB, innerColour, colour);
					innerA = outerA;
					innerB = outerB;
					innerColour = colour;
					lastOut = rail.out;
					lastDown = rail.down;
				}

				// And down to the water.
				//
				// Not because anything down there is interesting, but because the eye can see UNDER a
				// thirty-metre cliff from a camera ten metres over the rim, and what it saw there was sky.
				// The run starts two hundred metres above the sea; a mountain that stops thirty metres
				// below its own ledge is the paper aeroplane floating in a pale blue void.
				// It arrives in two bands rather than one: the mass, and then the WET line where the ice
				// actually enters the water (trap 16). The wet band is vertical and does not flare — a
				// surface the sea is washing is the one part of a mountain not weathered into a slope — and
				// the join between them sits one penguin above the surface, which is the only scale
				// reference a frame of this mode has.
				const flared = (u: number, point: Point, y: number): Point => {
					const across = acrossAt(here, next, u);
					return [
						point[0] + across.x * BASE_FLARE * side,
						y,
						point[2] + across.z * BASE_FLARE * side
					];
				};
				const brinkY = (point: Point) => Math.min(waterY + WET_BAND, point[1] - WATER_SINK);
				const brinkA = flared(from, outerA, brinkY(outerA));
				const brinkB = flared(to, outerB, brinkY(outerB));
				const surf = paint(WATERLINE, 8, hash(here.id, 99, side + 41));
				band(side, innerA, innerB, brinkA, brinkB, innerColour, surf);
				band(
					side,
					brinkA,
					brinkB,
					[brinkA[0], brinkA[1] - WET_BAND, brinkA[2]],
					[brinkB[0], brinkB[1] - WET_BAND, brinkB[2]],
					surf,
					WET
				);
			}

			// Crags on the cliff, and they are SIZED against the Royal rather than against the metre.
			// At 1.4–2.4 m they rendered as two dark flecks in the whole frame — the rocks on a floe
			// read because a floe is 7 m across and the camera is on top of it, and the same rock 30 m
			// down a cliff is a speck. A crag is 2.6–4.4 m here and there are three times as many, and
			// they are still the only thing on the mountain that says how big any of it is.
			const crag = hash(here.id, 7, side + 61);
			if (crag > 0.62) {
				const size = 2.6 + 1.8 * hash(here.id, 8, side + 61);
				const on = rails[crag > 0.86 ? 1 : 3] ?? rails[1];
				// Sunk by a third of itself, because the rail it stands on is a SLOPE: a base placed
				// exactly on the surface has half of itself hanging off the low side. Trap 11 is the
				// same mistake made the other way round, and the ice there is opaque either way.
				const rail = railPoint(here, side, on?.out ?? 0, on?.down ?? 0);
				const foot: Point = [rail[0], rail[1] - size * 0.35, rail[2]];
				const tip: Point = [foot[0], foot[1] + size, foot[2]];
				const p: Point = [foot[0] - size * 0.6, foot[1], foot[2] - size * 0.5];
				const q: Point = [foot[0] + size * 0.6, foot[1], foot[2] - size * 0.5];
				const r: Point = [foot[0], foot[1], foot[2] + size * 0.7];
				// Three faces, each wound counter-clockwise seen from OUTSIDE it. The order looks
				// backwards next to the base triangle p→q→r and is not: a face's front is the side its
				// winding turns anticlockwise for, and for the outside of a pyramid that is the reverse
				// of the way round its base is described.
				tri(q, p, tip, ROCK, ROCK, ROCK);
				tri(r, q, tip, ROCK, ROCK, ROCK);
				tri(p, r, tip, ROCK, ROCK, ROCK);
			}
		}
	}

	// The SUMMIT, and it exists because the run had nothing above it.
	//
	// The top of the deck simply stopped on a hard straight edge with sky behind it, which reads as an
	// unfinished mesh — and it is the brightest edge in the frame, so it is the first thing the eye
	// lands on. Whatever the course does past the camera's reach, the drawn thing has to terminate in
	// something, and the only honest something at the top of a chute is the ground it was cut into.
	//
	// A dome rather than a wall: the crest rises `SUMMIT_RISE` over the middle of the run and tapers to
	// nothing at the rim, so it meets the cliff exactly where the cliff already starts and needs no
	// join. Then a long back face falling away behind it, which nobody on the run will ever see — but
	// the gondola arrives at a station beside this segment and looks around, and an open shell is the
	// one thing that cannot survive being looked at from the other side.
	const start = course[0];
	const second = course[1];
	if (start && second) {
		const brow = sliceAt(start, second, 0);
		const uphill = segmentHeading(start);
		const crest: Point[] = [];
		const behind: Point[] = [];
		for (const [i, point] of brow.entries()) {
			const t = Math.abs((i / SAMPLES) * 2 - 1);
			const rise = SUMMIT_RISE * (1 - t ** 1.6);
			const x = point[0] - uphill.x * SUMMIT_BACK;
			const z = point[2] - uphill.z * SUMMIT_BACK;
			crest.push([x, point[1] + rise, z]);
			behind.push([
				x - uphill.x * SUMMIT_BACK,
				point[1] + rise - SUMMIT_DROP,
				z - uphill.z * SUMMIT_BACK
			]);
		}
		for (let k = 0; k < SAMPLES; k++) {
			const c0 = crest[k];
			const c1 = crest[k + 1];
			const p0 = brow[k];
			const p1 = brow[k + 1];
			const b0 = behind[k];
			const b1 = behind[k + 1];
			if (!c0 || !c1 || !p0 || !p1 || !b0 || !b1) continue;
			// Wound like the deck — the crest is the UPHILL pair and the brow the downhill one, which is
			// the same order `quad(a0, a1, b1, b0)` takes down the whole run.
			const lit = paint(SUMMIT_FACE, 0.6, hash(k, 3, 5));
			quad(c0, c1, p1, p0, lit);
			quad(b0, b1, c1, c0, paint(SUMMIT_FACE, 1.4, hash(k, 4, 5)));
		}
	}

	const geometry = new BufferGeometry();
	geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
	geometry.setAttribute('color', new Float32BufferAttribute(colours, 3));
	geometry.computeVertexNormals();

	// Flat shading, one material, one draw call for the whole mountain — and `matrixAutoUpdate` off,
	// because a mountain does not move.
	const material = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
	const mesh = new Mesh(geometry, material);
	mesh.matrixAutoUpdate = false;
	mesh.updateMatrix();
	root.add(mesh);

	return {
		root,
		dispose() {
			geometry.dispose();
			material.dispose();
		}
	};
}
