/**
 * Every floe in the sea, drawn — and no two of them alike.
 *
 * One mesh in the classic round and a dozen in a Pingu Royal. The first version drew them all from
 * one shared cylinder with one hard-coded rim wobble, so an archipelago was the same island stamped
 * ten times at different sizes: you could not say "meet me at the one with the rocks", you could not
 * tell at a glance which floe you were looking at while the camera panned, and a sea of clones reads
 * as a placeholder however nice the lighting is.
 *
 * So the field builds a LIBRARY of islands up front — `TEMPLATES` of them, each with its own rim
 * harmonics, thickness, snow relief, drifts, meltwater pools, pressure ridge and rocks — and every
 * floe clones the one its `shape` seed picks. Cloning in three shares geometry and materials, so a
 * floe costs a handful of `Object3D`s and nothing on the GPU.
 *
 * That is not only tidiness. Ice BREAKS mid-round, and a fragment is a new floe: building a
 * 44-segment cylinder and eight decorations inside the frame where the ice gives way puts the hitch
 * at exactly the moment the player most needs to react. The library is built once, at mount.
 *
 * Each floe owns a GROUP, and that group is what carries the tilt. Nothing else has to know about
 * the gradient encoding: put an object in a floe's group and it rides that floe.
 *
 * The SLAB is one mesh and one material, and everything the ice looks like is vertex colours on it:
 * snow rolling over a bevelled shoulder, a blue ice wall under that, a wet dark band at the
 * waterline, and relief across the top so a seven-metre disc is not one flat value. That is not
 * thrift for its own sake — it is what lets a fragment DARKEN as a whole when it takes on water,
 * from one material colour, while still being four colours of ice.
 *
 * The three things a player has to be able to SEE, in the order they happen:
 *
 *  1. **A crack** opens along the line the ice will break on, three seconds before it does.
 *  2. **A shudder** builds under their feet through the same three seconds.
 *  3. **The break**: two halves that tip away from each other, drift apart and go under, darkening
 *     as they take on water.
 */
import {
	BoxGeometry,
	CircleGeometry,
	Color,
	CylinderGeometry,
	Group,
	IcosahedronGeometry,
	Mesh,
	MeshBasicMaterial,
	MeshLambertMaterial,
	RingGeometry,
	SphereGeometry
} from 'three';
import { breakWarning, ISLAND_VARIANTS, moundsFor } from '../sim/archipelago';
import { FLOE_RADIUS } from '../sim/constants';
import type { Floe } from '../sim/types';
import { alongStops, bake, type Contact, mergePieces, type Piece } from './bake';

/** How thick the slab is. Below this sits the ocean plane, so the floe reads as floating. */
export const FLOE_THICKNESS = 1.15;

/**
 * Where the sea's surface is, in world metres.
 *
 * `scene.ts` places the ocean plane at exactly this expression under the name `OCEAN_Y`. It is
 * written here because everything that has to meet the water — the foam collar, the waterline band
 * on a floe's wall, an iceberg's wet base — is drawn from this file and its neighbours, and the
 * three of them agreeing with each other and disagreeing with the ocean would be the worst of the
 * available outcomes.
 */
export const SEA_LEVEL = -FLOE_THICKNESS * 0.72;

/**
 * How far a floe sinks as it goes, in metres.
 *
 * A fragment loses its radius (`round.ts`) — which the player reads as the ice running out — and it
 * also drops, which is what makes it read as GOING UNDER rather than as melting. The drop is
 * presentation only: the simulation has no y for a floe, and a penguin's support is decided
 * entirely by the radius.
 */
const SINK_DEPTH = 2.1;

/** How far a fragment tips as it goes under, radians. It leans away from the ice it broke off. */
const TIP_MAX = 0.22;

/** How hard doomed ice shakes at the end of its warning, radians, and how fast. */
const SHUDDER = 0.012;
const SHUDDER_HZ = 9;

/**
 * How many facets go round a floe. The rim is the silhouette, and the silhouette is the landmark.
 *
 * It has to stay a multiple of FOUR. The slab is a cylinder and the snow on it is a ring, and three
 * builds the two from opposite conventions — a cylinder's first vertex is at `sin`, a ring's at
 * `cos`, a quarter turn apart. At a multiple of four that quarter turn is a whole number of
 * segments, so the two rims land on exactly the same points and weld; at anything else they are half
 * a segment out of phase and the join is a ring of slivers all the way round the floe, at the one
 * place on it the eye is guaranteed to be looking.
 */
const RIM_SEGMENTS = 44;

/**
 * The slab's profile, from the top of the snow down to the underside, as multiples of the floe's
 * radius — and the reason the ice finally has an EDGE.
 *
 * The first version was a plain cylinder, 1.0 down to 0.9, lit by a polar day and photographed from
 * 27° above: it read as a paper cut-out lying on the water, with no rim, no thickness and no bevel
 * anywhere. What was missing is the shoulder. The widest point is a quarter of the way down, not at
 * the top, so snow rolls OVER an edge and turns into ice below it, and the whole slab has a
 * top-lit band along its rim that a straight-sided disc cannot have.
 *
 * The widest entry is what the eye reads as the size of the floe, so it is the one pinned to the
 * simulation's radius. The rim harmonics below then move it in and out by up to a tenth either way,
 * as they always have — a landmark has to have a shape — but the shoulder is not allowed to add to
 * that on its own, because a drawn rim wider than the real one is trap 8 again: ice you can see and
 * cannot stand on.
 */
const PROFILE = [0.98, 1.005, 0.985, 0.93, 0.86];

/** How many rows the wall is cut into. One per `PROFILE` step, less the one at the top. */
const WALL_ROWS = PROFILE.length - 1;

/**
 * The colour of the slab from its top surface downward, as (depth in metres, colour) stops.
 *
 * Every one of these is doing a job the geometry cannot do on its own:
 *
 *  * The snow is faintly BLUE rather than pure white, which is what makes everything drawn on top of
 *    it visible — the first pass put white drifts on white ice and they simply were not there.
 *  * The wall is markedly bluer than the top rather than a shade off it: at this camera angle the
 *    thickness is a thin band of near-silhouette, and white-on-white made the slab read as a flat
 *    cutout with no edge at all.
 *  * The band at the waterline is DARK, and it is the single thing that separates a white floe from
 *    pale blue water. Ice is wet where the sea has been touching it, and a dark line under the ice
 *    is what every photograph of a floe has and this game did not.
 *
 * Depths rather than fractions of the thickness, because the waterline is at a fixed height and the
 * templates are not all the same thickness.
 */
const WALL_STOPS: [number, number][] = [
	[0, 0xeef6fd],
	[0.3, 0xd3e6f4],
	[0.55, 0x8fc4de],
	[-SEA_LEVEL, 0x2e6c91],
	[-SEA_LEVEL + 0.35, 0x27536f]
];

/**
 * The two ends of the snow's own colour range, from the bottom of a hollow to the top of a crest.
 *
 * These are the ONLY thing that makes the deck of a floe not one flat white value, and the range is
 * wide because the first attempt at it was not. Two facts, both measured off a phone screenshot
 * rather than reasoned about:
 *
 *  * **Relief buys no shading here.** Five centimetres over a three-metre swell is a surface gradient
 *    of about 0.03 — a degree and a half of normal tilt — and a Lambert surface facing straight up at
 *    a hemisphere light barely notices. The displacement is worth having for the things that SIT in
 *    it, and for nothing else.
 *  * **The deck is saturated.** `polarDayLights` puts a hemisphere at 1.4, an ambient at 0.25 and a
 *    sun at 1.4 on a surface pointing straight at all three. Everything above roughly 0.55 in sRGB
 *    lands in the same white after tone mapping, so a 12% range between two near-whites is a 0%
 *    range on screen. The first pass here was `0xdfecf7 → 0xffffff` and the deck photographed as one
 *    value, exactly as if nothing had been done.
 *
 * So the hollows go properly blue. It is more contrast than snow "should" have, and it is the amount
 * that survives the light this game stands in.
 */
const SNOW_STOPS: [number, number][] = [
	[0, 0xc2dbee],
	[0.55, 0xe8f4fc],
	[1, 0xfdffff]
];

/**
 * How much ice is left showing between a piece of dressing and the edge, in metres, and how finely the
 * edge is sampled to find it.
 *
 * The margin is what keeps a drift reading as snow ON the floe rather than as snow balanced on the
 * lip of it. The sample count is set against the rim's FASTEST harmonic — up to thirteen cycles round
 * the floe, so a dip is about half a radian wide — and nine samples across the arc a piece covers
 * resolves one comfortably. Four did not, and the symptom was a single drift hanging two centimetres
 * over the water on one island out of six.
 */
const RIM_MARGIN = 0.25;
const RIM_SAMPLES = 4;

/** A wind-blown heap of snow: the brightest thing on the floe, and what the hollows are measured against. */
const DRIFT = 0xfdffff;

/**
 * Meltwater, from the middle of a pool to its edge.
 *
 * Properly blue rather than the pale wash this used to be. The pools were the one feature that read
 * instantly from above and they went white-on-white the moment the snow around them was brightened —
 * a light blue at this light level is a white with a hint in it. See `SNOW_STOPS` for the measurement.
 */
const POOL_STOPS: [number, number][] = [
	[0, 0x3f86b2],
	[1, 0x79b6d5]
];

/**
 * A block of a pressure ridge, in metres above the ice at its foot.
 *
 * SATURATED blue at the foot, and that word is the whole of the second fix this needed. The ramp
 * before this one bottomed out at `0x7cafcd`, which is a blue on paper and photographed as GREY on a
 * floe — a small pale object on saturating white ice, its own faces flat-shaded and turned away from
 * the sky, mixed with a seam colour that was itself a desaturated blue-grey. Grey against white ice
 * reads as concrete or a stone marker, which is the same wrong word as the timber it replaced.
 *
 * The slab's own wall is the reference, because that one works on screen: `0x8fc4de` at mid-depth,
 * unmistakably blue at playing distance. Ice under compression is white and blue and wet, and there
 * is nothing in this game that should be a neutral grey except a rock.
 */
const RIDGE_STOPS: [number, number][] = [
	[0, 0x5c9fc9],
	[0.5, 0x95c8e1],
	[1.15, 0xe6f4fd],
	[1.75, 0xfdffff]
];

/**
 * A pebble, base to top.
 *
 * WARM and SATURATED, and the second of those is what the first attempt at this got wrong. These
 * were dark grey icosahedra and in a Royal three of them landed beside the player looking like a coal
 * delivery on an ice floe — the reference games this is being pulled toward have no black in them
 * anywhere. Rounding them fixed the silhouette and left the colour half-fixed: a warm tone this
 * desaturated, lerped toward a cool contact seam, mixes straight back to mud. A brown has to be
 * saturated enough to still be brown after the shadow lands on it. Warm and light also does the job
 * `docs/DESIGN.md` wants most from this pass: a frame made of three near-identical pale blues gets
 * more from one honest brown than from another shade of ice.
 */
const PEBBLE_STOPS: [number, number][] = [
	[0, 0xa8825f],
	[1, 0xdcc7ab]
];

/**
 * A hill, from the ice at its foot to its summit, as a fraction of its own height.
 *
 * A ramp rather than the flat value per tier this used to have. Three tiers of three near-whites is
 * three bands of the same white once the deck is this brightly lit, and a hill with no shading across
 * it is the largest flat object on the floe.
 */
const MOUND_STOPS: [number, number][] = [
	[0, 0xa4cadf],
	[0.45, 0xd8e9f7],
	[1, 0xfcfeff]
];

/**
 * How deep the hollows in the snow are, in metres.
 *
 * It goes DOWN from the plane the simulation works on, never up, and that is not a stylistic choice.
 * Two things on a penguin are drawn as decals lying on the ice — the blob shadow at 2 cm and the
 * "that one is you" ring at 4 cm (`render/penguin.ts`) — and snow that humped up five centimetres
 * would swallow both of them wherever a crest happened to land under a bird. Relief that only ever
 * digs in cannot reach them, and reads exactly the same: what the eye is picking up is the shading
 * and the crest-to-hollow colour, not which side of zero the surface is on.
 *
 * Five centimetres, and the one number that must not grow: the simulation's ground is flat, and a
 * trough deep enough to SEE a penguin standing in is a trough a child will ask about.
 */
const SNOW_RELIEF = 0.05;

/**
 * Where the relief stops, as a fraction of the top surface's radius, and how gradually.
 *
 * Pinned to zero at the very rim so the snow meets the bevelled shoulder on exactly the vertices the
 * shoulder is made of. Anything else is a hairline gap all the way round the floe, at the one place
 * on it the eye is guaranteed to be looking.
 */
const RELIEF_EDGE = 0.62;

/** What the top surface fades toward as ice takes on water. */
const DRY = new Color(0xffffff);
const AWASH = new Color(0x7fb4cf);

/**
 * How much the sea lifts a floe, in metres, and how slowly.
 *
 * Every floe bobs on its own phase, so a Royal's sea moves like water with things floating in it
 * rather than like a diorama. It is small — six centimetres — because the penguins standing on it
 * are lifted by exactly the same amount (`floeOffsetY`), and anything larger reads as the camera
 * shaking rather than as the ice rising.
 */
const BOB = 0.06;
const BOB_HZ = 0.17;

/**
 * The foam collar, as fractions of the floe's radius, and how far above the sea it rides.
 *
 * There was a foam ring here before and it was doing none of these three things. It was a perfect
 * CIRCLE at a fixed radius while the floe's own outline wobbles by up to a tenth of its radius, so
 * it vanished under the ice on the bulges and stuck out as a pale flange in the dips — a ragged
 * lily-pad rather than a waterline. It was also exactly coplanar with the ocean plane, whose vertex
 * shader then moved the water three quarters of a metre up and down through it. And it was one flat
 * value of white, so its outer edge ended in a visible rim.
 *
 * Now: wobbled with the same harmonics as the ice, lifted clear of the mean sea so the swell washes
 * THROUGH it rather than over it, and faded outward toward the sea's own colour by vertex colour,
 * which is the only fade available to one draw call.
 */
const FOAM_INNER = 0.9;
const FOAM_OUTER = 1.18;
const FOAM_LIFT = 0.26;

/** The seam where anything soft standing on a floe meets the snow. See `bake.ts`. */
const CONTACT: Contact = {
	reach: 0.16,
	// The snow's own colour taken down and toward the blue of the ice under it, which is the colour
	// the sky is not reaching. Black here reads as a hole punched in the floe.
	colour: 0x9dbbd1,
	strength: 0.8
};

/**
 * The same seam, for the faceted half of the dressing — and it is weaker and bluer on purpose.
 *
 * A drift is two metres across and its own shape carries it, so a 16 cm seam at 80% is a shadow under
 * a big soft thing. A pebble is 60 cm across and half of it lies INSIDE that reach, so the same
 * numbers do not shade it, they repaint it — which is how a saturated brown came out grey and a blue
 * ridge came out like concrete. Ten centimetres at 60% touches the bottom of a small object instead of
 * most of it. The colour is a DEEP blue rather than the pale blue-grey the soft half uses, and the
 * depth is the point as much as the hue: a warm pebble lerped toward a mid-tone lands on a mid-tone
 * with no saturation left, which the eye reads as grey MATERIAL, where the same mix against something
 * darker reads as the pebble with a shadow on it. A shadow on snow is blue, and the one rule this
 * palette has is that nothing is neutral unless it is a rock.
 */
const CRAG_CONTACT: Contact = { reach: 0.1, colour: 0x4a7fa4, strength: 0.6 };

/** The crack, once it has opened all the way: metres across, and how far it stands proud of the ice. */
const CRACK_WIDTH = 0.34;
const CRACK_LIFT = 0.02;

/**
 * How high this floe is sitting right now, in metres: the swell's lift, less however far it has gone
 * under.
 *
 * Exported because the PENGUINS have to use the same number. The floe's group carries this offset,
 * and an actor standing on the floe is in world space (`render/penguin.ts`) — so if only the ice knew
 * about it, a penguin on a sinking fragment would hang in the air above it while it went down, which
 * is the exact opposite of the thing the fragment is trying to say.
 */
export function floeOffsetY(floe: Floe, seconds: number): number {
	// A mountain neither bobs nor sinks: it is where it is, and where it is includes being lower down
	// the hill than the segment before it.
	if (floe.anchored) return floe.altitude;
	const sunk = floe.piece ? 1 - floe.radius / floe.fullRadius : 0;
	const bob = Math.sin(seconds * BOB_HZ * Math.PI * 2 + floe.shape) * BOB;
	// `altitude` is zero for every floe in a sea and is how high a chase's platforms sit, which is
	// the only reason the route has an up and a down in it. It is added rather than substituted,
	// because a platform at a height still floats — the swell does not stop at the shoreline.
	return floe.altitude + bob - sunk * SINK_DEPTH;
}

export interface FloeField {
	root: Group;
	/**
	 * Draw exactly these floes.
	 *
	 * `seconds` drives the shudder and `playingTicks` decides who is about to break — both are read
	 * only for presentation, and the geometry of the sea comes entirely from the simulation.
	 */
	update(floes: readonly Floe[], seconds: number, playingTicks: number): void;
	/** The group that carries this floe's tilt, or null if it is not drawn. */
	groupOf(id: number): Group | null;
	dispose(): void;
}

interface Entry {
	group: Group;
	ice: Mesh;
	crack: Mesh;
	skin: MeshLambertMaterial;
	dispose(): void;
}

/**
 * How many different islands the sea can be made of.
 *
 * Six, against a Royal that deals ten floes and then breaks them into fragments: enough that a sea
 * never looks stamped out, few enough that the whole library is built in one frame at mount. A floe
 * picks its template by `shape`, so the same seeded sea is the same islands everywhere.
 */
const TEMPLATES = ISLAND_VARIANTS;

export function createFloeField(): FloeField {
	const root = new Group();
	const entries = new Map<number, Entry>();
	const library = Array.from({ length: TEMPLATES }, (_, i) => buildTemplate(i));

	const ensure = (floe: Floe) => {
		const existing = entries.get(floe.id);
		if (existing) return existing;
		const template = library[Math.abs(floe.shape) % TEMPLATES];
		if (!template) throw new Error('the floe library was built empty');
		const entry = instantiate(template);
		root.add(entry.group);
		entries.set(floe.id, entry);
		return entry;
	};

	return {
		root,

		update(floes, seconds, playingTicks) {
			const seen = new Set<number>();
			for (const floe of floes) {
				// The mountain is drawn as one ribbon by `render/chute.ts`. Islands only here.
				if (floe.anchored) continue;
				seen.add(floe.id);
				const entry = ensure(floe);
				// A floe with no radius left is gone: hidden rather than drawn at zero, because a
				// zero-scaled mesh still costs a draw call and still has a rim the eye can catch.
				entry.group.visible = floe.radius > 0.05;
				if (!entry.group.visible) continue;

				// How far through going under this fragment is, from its own remaining radius — so the
				// drop and the shrink cannot disagree, and ice that is merely shrinking (the classic
				// endgame, and a Royal's middle) never dips at all.
				const sunk = floe.piece ? 1 - floe.radius / floe.fullRadius : 0;
				entry.group.position.set(floe.center.x, floeOffsetY(floe, seconds), floe.center.z);

				// The gradient, as the two rotations `types.ts` defines it to be.
				let tiltX = Math.asin(clamp(floe.slope.z));
				let tiltZ = -Math.asin(clamp(floe.slope.x));

				// A fragment leans away from the ice it broke off, which is the whole reason a break
				// reads as a break: two halves tipping apart say "this came in two" in a way that two
				// smaller circles never could. The lean is along the DRIFT, so it always tips outward.
				if (sunk > 0) {
					const lean = TIP_MAX * sunk;
					const drift = Math.hypot(floe.drift.x, floe.drift.z) || 1;
					tiltX += (floe.drift.z / drift) * lean;
					tiltZ -= (floe.drift.x / drift) * lean;
				}

				// The shudder: the last seconds before the ice gives way, felt under the feet rather
				// than announced. It builds with the warning so the first tremor is almost nothing.
				const warning = breakWarning(floe, playingTicks);
				if (warning > 0) {
					const shake = Math.sin(seconds * SHUDDER_HZ * Math.PI * 2) * SHUDDER * warning;
					tiltX += shake;
					tiltZ += shake * 0.6;
				}

				entry.group.rotation.set(tiltX, 0, tiltZ);

				// Wet ice is darker. Both a warning that is impossible to miss from above and, once it
				// is a fragment, the difference between ice you can stand on and ice you cannot.
				//
				// It is the whole slab that darkens now rather than only its top surface, and that is a
				// consequence of the slab being one vertex-coloured mesh rather than three materials:
				// the material colour multiplies every band of ice at once, so a fragment on its way
				// under goes down as one object instead of as a wet lid on dry walls.
				entry.skin.color.copy(DRY).lerp(AWASH, Math.max(warning * 0.45, sunk * 0.9));

				// Scaled rather than rebuilt — the rim wobble, the normals and the materials all
				// survive a scale, and only X and Z: the slab keeps its thickness.
				const scale = floe.radius / FLOE_RADIUS;
				entry.ice.scale.set(scale, 1, scale);

				// The crack, drawn along the line the floe will break on and opening as the moment
				// arrives. It is the same `breakAngle` the simulation splits across (`archipelago.ts`),
				// so the ice gives way exactly where the player was told it would.
				entry.crack.visible = warning > 0;
				if (warning > 0) {
					entry.crack.rotation.y = floe.breakAngle;
					entry.crack.scale.set(warning, 1, floe.radius * 2.02);
					entry.crack.position.y = CRACK_LIFT;
				}
			}
			// Anything the world stopped mentioning at all — a fragment that has gone under, or the
			// whole sea when a Royal is swapped for a classic round.
			for (const [id, entry] of entries) if (!seen.has(id)) entry.group.visible = false;
		},

		groupOf(id) {
			return entries.get(id)?.group ?? null;
		},

		dispose() {
			// The entries own only their own skin material — every geometry and every other material
			// belongs to the library, which is disposed once.
			for (const entry of entries.values()) entry.dispose();
			entries.clear();
			for (const template of library) template.dispose();
		}
	};
}

/** asin is only defined on [-1, 1], and a gradient is capped well below that — but not by this file. */
function clamp(value: number): number {
	return Math.max(-1, Math.min(1, value));
}

/** A cubic ease, 0 at 0 and 1 at 1, with both ends flat. Every taper in here wants the same one. */
function ease(t: number): number {
	const x = Math.min(1, Math.max(0, t));
	return x * x * (3 - 2 * x);
}

/**
 * A tiny deterministic generator, seeded by a floe's `shape`.
 *
 * The same floe is the same island on every device and in every replay, which matters more than it
 * sounds: the silhouette is a landmark players navigate by, and one that re-rolled itself between a
 * host and a client would be two different maps.
 */
function shaper(seed: number): () => number {
	let state = (seed * 2654435761) >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

interface Template {
	group: Group;
	/** The slab itself, inside the group, so an instance can be given its own skin. */
	ice: Mesh;
	/** The crack, hidden until the ice is about to give way. */
	crack: Mesh;
	dispose(): void;
}

/**
 * Everything about one island that is a NUMBER rather than a triangle.
 *
 * Split out from the geometry for two reasons. The renderer needs the rim wobble and the snow's
 * height in four separate places — the slab, the underside, the snow itself and the foam — and a
 * second copy of either would be a seam. And `islandDressing` below hands the same plan to the same
 * `decorate` a test can call, which is the only way trap 11 can be guarded at all: once the pieces
 * have been baked into one mesh, there is no longer any such thing as "a drift", and a drift buried
 * inside the ice is indistinguishable from one that was never there.
 */
interface IslandPlan {
	variant: number;
	/** The remaining draws, in sequence. `decorate` continues where this left off. */
	rand: () => number;
	thickness: number;
	/** The y, in the slab's own space, that the simulation's flat plane sits at. */
	surface: number;
	wobbleAt(x: number, z: number): number;
	reliefAt(x: number, z: number): number;
	snowAt(x: number, z: number): number;
	/**
	 * How far the snow reaches in the direction of `(x, z)`, in metres — the floe's actual EDGE there.
	 *
	 * Not a fraction of the radius, because the rim is not a circle: the harmonics move it in and out
	 * by up to a sixth, so "inside 0.98 R" is both too tight on a bulge and far too loose in a dip.
	 * Anything that has to stay on the ice asks here.
	 */
	brimAt(x: number, z: number): number;
}

function planIsland(variant: number): IslandPlan {
	const rand = shaper(variant + 1);

	const thickness = FLOE_THICKNESS * (0.85 + rand() * 0.4);
	// The top surface is the plane the simulation works on, and the slab is built around the origin of
	// its own cylinder — so this is the y everything ON the ice is placed at, and putting a thing at
	// 0 instead buries it half a metre inside the floe. That mistake cost a whole session of
	// decoration that rendered perfectly and was invisible (trap 11).
	const surface = thickness / 2;

	// Push the rim in and out so the outline is not a perfect circle — three harmonics with their own
	// phases, which is what makes one island recognisably not another. Deterministic from the angle
	// and the variant rather than random per vertex, because the outline is a landmark and it should
	// be the same shape every time anybody looks at it.
	//
	// Everything that has to line up with the rim asks THIS function: the slab, the snow on top of it
	// and the foam round the outside. The foam used not to, and the seam showed.
	const waves = [
		{ n: 3 + Math.floor(rand() * 3), amp: 0.03 + rand() * 0.05, phase: rand() * Math.PI * 2 },
		{ n: 5 + Math.floor(rand() * 4), amp: 0.02 + rand() * 0.03, phase: rand() * Math.PI * 2 },
		{ n: 9 + Math.floor(rand() * 5), amp: 0.008 + rand() * 0.015, phase: rand() * Math.PI * 2 }
	];
	const wobbleAt = (x: number, z: number): number => {
		const angle = Math.atan2(x, z);
		let wobble = 1;
		for (const wave of waves) wobble += wave.amp * Math.sin(angle * wave.n + wave.phase);
		return wobble;
	};

	// The snow's relief: three long, unrelated swells, which is the same trick the ocean's shader uses
	// and for the same reason — it never reads as scrolling in one direction and it costs nothing.
	//
	// The fourth one is the one that reads. The first three have wavelengths of four to sixteen metres,
	// which on a seven-metre disc is one broad gradient and no detail at all; this one is under two
	// metres, so the deck gets patches at the size a player actually looks at. The amplitudes sum to
	// exactly one on purpose — `reliefAt` maps their range onto 0–1, and a total over one would push
	// the snow above the plane the simulation works on, which is the one place it may not go.
	const swells = [
		{ amp: 0.42, fx: 0.38 + rand() * 0.16, fz: 0.29 + rand() * 0.16, phase: rand() * Math.PI * 2 },
		{ amp: 0.27, fx: 0.71 + rand() * 0.3, fz: 0.58 + rand() * 0.3, phase: rand() * Math.PI * 2 },
		{ amp: 0.16, fx: 1.27 + rand() * 0.5, fz: 1.03 + rand() * 0.5, phase: rand() * Math.PI * 2 },
		{ amp: 0.15, fx: 2.6 + rand() * 1.1, fz: 2.2 + rand() * 1.1, phase: rand() * Math.PI * 2 }
	];
	/** How high the snow stands here, 0 in the hollows and 1 on the crests. */
	const reliefAt = (x: number, z: number): number => {
		let n = 0;
		for (const swell of swells) {
			n += swell.amp * Math.sin(x * swell.fx + swell.phase) * Math.cos(z * swell.fz + swell.phase);
		}
		return (n + 1) / 2;
	};
	/**
	 * How far above the ice's own plane the snow is at this point, in metres.
	 *
	 * Divided by the wobble, which is a function of the angle alone, so the radius this compares is
	 * the one the rim would have if the rim were a circle — which makes the taper reach zero on
	 * exactly the vertices the rim is made of, wherever the harmonics happen to have put them.
	 *
	 * Everything standing on the ice reads this. A drift placed at `surface` while the snow around it
	 * has dipped five centimetres away is trap 11 again with a smaller number and the sign flipped.
	 */
	const snowAt = (x: number, z: number): number => {
		const r = Math.hypot(x, z) / (FLOE_RADIUS * wobbleAt(x, z));
		const edge = PROFILE[0] ?? 1;
		const taper = 1 - ease((r / edge - RELIEF_EDGE) / (1 - RELIEF_EDGE));
		// Never positive: the crests are AT the plane and the hollows are cut out of it. See
		// SNOW_RELIEF for the two decals that would otherwise disappear under a drift of snow.
		return (reliefAt(x, z) - 1) * SNOW_RELIEF * taper;
	};

	const brimAt = (x: number, z: number): number => FLOE_RADIUS * (PROFILE[0] ?? 1) * wobbleAt(x, z);

	return { variant, rand, thickness, surface, wobbleAt, reliefAt, snowAt, brimAt };
}

/**
 * One island's dressing, as pieces, before any of it is merged.
 *
 * Exported for the guard on trap 11 — and it is the real path, not a hook cut for a test: the
 * template below calls exactly this. A whole session's worth of drifts, pools and rocks once
 * rendered perfectly, cost their triangles, and sat half a metre inside the slab where nobody could
 * see it, and the reason it survived review is that the code placing them reads as correct. What it
 * cannot do is read as correct to a bounding box.
 */
export function islandDressing(variant: number): {
	surface: number;
	snowAt(x: number, z: number): number;
	brimAt(x: number, z: number): number;
	/** Everything the renderer chose to put there. */
	pieces: Piece[];
	/** The hills, which it did not — see `Dressing`. */
	hills: Piece[];
} {
	const plan = planIsland(variant);
	const dressing = decorate(plan);
	return {
		surface: plan.surface,
		snowAt: plan.snowAt,
		brimAt: plan.brimAt,
		pieces: [...dressing.soft, ...dressing.crags],
		hills: dressing.hills
	};
}

/** One island, built once and cloned by every floe whose seed lands on it. */
function buildTemplate(variant: number): Template {
	const plan = planIsland(variant);
	const { thickness, surface, wobbleAt, reliefAt, snowAt } = plan;
	const group = new Group();

	// The slab's WALL. `PROFILE` decides its shape; the cylinder is only a source of correctly-wound
	// triangles at the right topology, and every ring of it is moved onto the profile below.
	//
	// Open-ended, because neither of the caps three would put on it is the surface anybody sees. The
	// top is the snow below — a cap at the plane would be drawn ABOVE every hollow in it and hide the
	// relief completely — and the bottom is a disc of its own, so the solid still closes.
	const underside = FLOE_RADIUS * (PROFILE[PROFILE.length - 1] ?? 1);
	const slab = new CylinderGeometry(
		FLOE_RADIUS * (PROFILE[0] ?? 1),
		underside,
		thickness,
		RIM_SEGMENTS,
		WALL_ROWS,
		true
	);
	const slabPos = slab.attributes.position;
	if (slabPos) {
		for (let i = 0; i < slabPos.count; i++) {
			const x = slabPos.getX(i);
			const z = slabPos.getZ(i);
			const r = Math.hypot(x, z);
			// Nothing should be on the axis at all now the cylinder is open-ended, and a vertex with no
			// direction to push it in would be pushed to NaN rather than left where it was.
			if (r < 1e-4) continue;
			const down = (surface - slabPos.getY(i)) / thickness;
			const want = FLOE_RADIUS * profileAt(down) * wobbleAt(x, z);
			slabPos.setX(i, (x / r) * want);
			slabPos.setZ(i, (z / r) * want);
		}
		// While it still has an INDEX: `mergePieces` will make it non-indexed, after which
		// `computeVertexNormals` can only ever produce flat facets. The floe wants to be round.
		slab.computeVertexNormals();
	}

	// The underside, welded to the bottom row of the wall: same radius, same wobble, same 44 angles.
	// A circle faces +Z, so a quarter turn the OTHER way from the snow's puts its front face down —
	// which is the whole of trap 14 in one line, and why this is a primitive being rotated rather
	// than four vertices being wound by hand.
	const floorGeometry = new CircleGeometry(underside, RIM_SEGMENTS);
	floorGeometry.rotateX(Math.PI / 2);
	const floorPos = floorGeometry.attributes.position;
	if (floorPos) {
		for (let i = 0; i < floorPos.count; i++) {
			const wobble = wobbleAt(floorPos.getX(i), floorPos.getZ(i));
			floorPos.setX(i, floorPos.getX(i) * wobble);
			floorPos.setZ(i, floorPos.getZ(i) * wobble);
			floorPos.setY(i, -surface);
		}
		floorGeometry.computeVertexNormals();
	}

	// The snow on top, as a ring of five bands plus a plug in the middle. A ring rather than a disc
	// because a `CircleGeometry` is a triangle FAN with one interior vertex — displacing it moves the
	// whole surface as a cone and nothing else, which is the trap this relief would otherwise have
	// walked straight into. The plug is a fan, but it is a 40 cm one under the player's feet.
	//
	// Both are sampled at the same 44 angles from the same start, so their shared rim welds: same
	// radius, same wobble, same relief, vertex for vertex.
	const brim = FLOE_RADIUS * (PROFILE[0] ?? 1);
	const snowGeometry = new RingGeometry(brim * 0.06, brim, RIM_SEGMENTS, 5);
	const plugGeometry = new CircleGeometry(brim * 0.06, RIM_SEGMENTS);
	for (const flat of [snowGeometry, plugGeometry]) {
		flat.rotateX(-Math.PI / 2);
		const pos = flat.attributes.position;
		if (!pos) continue;
		for (let i = 0; i < pos.count; i++) {
			const wobble = wobbleAt(pos.getX(i), pos.getZ(i));
			const x = pos.getX(i) * wobble;
			const z = pos.getZ(i) * wobble;
			pos.setX(i, x);
			pos.setZ(i, z);
			pos.setY(i, surface + snowAt(x, z));
		}
		flat.computeVertexNormals();
	}

	const snowShade = (x: number, _y: number, z: number): number =>
		alongStops(SNOW_STOPS, reliefAt(x, z));

	const iceGeometry = mergePieces([
		{ geometry: slab, colour: (_x, y) => alongStops(WALL_STOPS, surface - y) },
		{ geometry: floorGeometry, colour: (_x, y) => alongStops(WALL_STOPS, surface - y) },
		{ geometry: snowGeometry, colour: snowShade },
		{ geometry: plugGeometry, colour: snowShade }
	]);
	if (!iceGeometry) throw new Error('an island was built with no ice in it');

	// White, so the vertex colours ARE the colours. The wetness lerp then multiplies all of them at
	// once, which is what makes a sinking fragment darken as one object.
	const iceMaterial = new MeshLambertMaterial({ color: 0xffffff, vertexColors: true });
	const ice = new Mesh(iceGeometry, iceMaterial);
	ice.name = 'ice';
	// The top surface is the plane the simulation works on, so it must sit at exactly y = 0.
	ice.position.y = -surface;
	group.add(ice);

	// Everything ON the ice — drifts of snow, meltwater, a pressure ridge, rocks, and the hills —
	// baked into TWO meshes with vertex colours, split by whether the thing wants to look faceted.
	//
	// Merged rather than parented one by one because object COUNT is what a frame costs here: three
	// updates a matrix and runs a frustum test per object per frame, and a Royal's ten floes were
	// carrying about a hundred and eighty of them between them. The simulation, by comparison, is 3%
	// of a frame with thirty penguins on it — measured — so the renderer's book-keeping is where the
	// time actually goes.
	//
	// Two rather than one is a draw call per floe, spent deliberately. A box shares its corner
	// vertices, so smooth shading averages the normals across the corner and a pressure ridge turns
	// into a pillow; a sixteen-segment sphere with facets on reads as crumpled foil rather than as a
	// heap of snow. One material cannot be both, and the whole ask here is roundness where the thing
	// is round.
	//
	// The hills are NOT decoration: `sim/archipelago.moundsFor` hands the simulation the same shapes
	// from the same variant number, so the hill drawn here is the one a penguin climbs.
	const dressing = decorate(plan);
	const softMaterial = new MeshLambertMaterial({ vertexColors: true });
	const cragMaterial = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
	const soft = bake([...dressing.soft, ...dressing.hills], softMaterial, CONTACT);
	const crags = bake(dressing.crags, cragMaterial, CRAG_CONTACT);
	if (soft) ice.add(soft);
	if (crags) ice.add(crags);

	// Foam at the waterline. A floe without it is a white shape pasted on a blue one; with it, the sea
	// is touching something. Basic rather than Lambert because foam is not a surface catching light,
	// it is brightness — and a lit white ring at this angle goes grey and reads as a shadow.
	const foamGeometry = new RingGeometry(
		FLOE_RADIUS * FOAM_INNER,
		FLOE_RADIUS * FOAM_OUTER,
		RIM_SEGMENTS,
		4
	);
	foamGeometry.rotateX(-Math.PI / 2);
	const foamPos = foamGeometry.attributes.position;
	if (foamPos) {
		for (let i = 0; i < foamPos.count; i++) {
			const wobble = wobbleAt(foamPos.getX(i), foamPos.getZ(i));
			foamPos.setX(i, foamPos.getX(i) * wobble);
			foamPos.setZ(i, foamPos.getZ(i) * wobble);
		}
	}
	// White where it meets the ice and the sea's own colour by the time it ends, so the collar has no
	// outer rim for the eye to catch. Opacity cannot vary per vertex; a colour can, and over water
	// fading toward the water is the same thing.
	const foamStops: [number, number][] = [
		[FOAM_INNER, 0xffffff],
		[0.99, 0xffffff],
		[1.06, 0xd6effa],
		[FOAM_OUTER, 0x8ecfe6]
	];
	const foamBaked = mergePieces([
		{
			geometry: foamGeometry,
			colour: (x, _y, z) => alongStops(foamStops, Math.hypot(x, z) / (FLOE_RADIUS * wobbleAt(x, z)))
		}
	]);
	const foamMaterial = new MeshBasicMaterial({
		color: 0xffffff,
		vertexColors: true,
		transparent: true,
		opacity: 0.68,
		depthWrite: false
	});
	const foam = foamBaked ? new Mesh(foamBaked, foamMaterial) : null;
	if (foam) {
		foam.matrixAutoUpdate = false;
		// Above the mean sea rather than level with it. The ocean's shader lifts the water three
		// quarters of a metre either way, so a collar AT sea level spends half its life submerged and
		// the other half a hand's breadth in the air; a collar a little above it has the swell washing
		// through, which is what foam is.
		foam.position.y = surface + SEA_LEVEL + FOAM_LIFT;
		foam.updateMatrix();
		ice.add(foam);
	}

	// A thin box rather than a texture: the crack has to be visible from a camera looking down at
	// 27°, and at that angle a flat line disappears.
	const crackGeometry = new BoxGeometry(CRACK_WIDTH, 0.16, 1);
	const crackMaterial = new MeshLambertMaterial({ color: 0x123449 });
	const crack = new Mesh(crackGeometry, crackMaterial);
	crack.name = 'crack';
	crack.visible = false;
	group.add(crack);

	return {
		group,
		ice,
		crack,
		dispose() {
			iceGeometry.dispose();
			iceMaterial.dispose();
			crackGeometry.dispose();
			crackMaterial.dispose();
			foamBaked?.dispose();
			foamMaterial.dispose();
			soft?.geometry.dispose();
			softMaterial.dispose();
			crags?.geometry.dispose();
			cragMaterial.dispose();
		}
	};
}

/** Where `PROFILE` is a fraction `down` of the way from the snow to the underside. */
function profileAt(down: number): number {
	const last = PROFILE.length - 1;
	const at = Math.min(last, Math.max(0, down * last));
	const low = Math.floor(at);
	const lower = PROFILE[low] ?? 1;
	const upper = PROFILE[Math.min(last, low + 1)] ?? lower;
	return lower + (upper - lower) * (at - low);
}

/**
 * One floe, from a template.
 *
 * `clone` shares every geometry and material with the library, which is the whole point — a fragment
 * that appears in the middle of a break costs a few objects and nothing on the GPU. The exception is
 * the SLAB's material: it is the one thing that changes per floe, because ice darkens as it takes on
 * water, and a shared one would wet the whole sea at once.
 */
function instantiate(template: Template): Entry {
	const group = template.group.clone(true);
	const ice = group.getObjectByName('ice');
	const crack = group.getObjectByName('crack');
	if (!(ice instanceof Mesh) || !(crack instanceof Mesh)) {
		throw new Error('a floe template lost its ice on the way through clone()');
	}

	const skin = new MeshLambertMaterial({ color: DRY.getHex(), vertexColors: true });
	ice.material = skin;

	return {
		group,
		ice,
		crack,
		skin,
		dispose() {
			// Only what this instance owns. Everything else belongs to the library.
			skin.dispose();
		}
	};
}

/** The three parts of an island's dressing: two split by whether they want facets, and the hills. */
interface Dressing {
	soft: Piece[];
	crags: Piece[];
	/**
	 * The hills, kept apart from everything else because they are the only dressing the renderer does
	 * not get to CHOOSE. `sim/archipelago.moundsFor` decides where they are and how wide, and the
	 * simulation reads the same call for `groundHeight` — so a hill whose footprint reaches the rim
	 * reaches the rim, and a renderer that pulled it in would be drawing a hill you can climb further
	 * than you can see. They are baked in with `soft`; only the guards need them separable.
	 */
	hills: Piece[];
}

/**
 * How far the bottom tier of a hill reaches BELOW the ice, in metres.
 *
 * More than `SNOW_RELIEF`, so a hill whose middle sits on a crest while the snow dips away around it
 * still has its skirt buried, rather than a rim of daylight running under it. Its peak is untouched: the top of a hill is the
 * ground a penguin stands on and the simulation decides where that is.
 */
const MOUND_EMBED = 0.09;

/**
 * Snow drifts, meltwater, a pressure ridge, rocks and the hills, on top of one island.
 *
 * Geometry only: every piece is baked into one of the island's two dressing meshes, so these are
 * positioned by transforming the geometry rather than the mesh. Nothing here is collided with except
 * the hills — `sim/` knows about a floe's radius and its mounds, and about nothing else on it.
 *
 * `snowAt` is why nothing here floats or sinks: the snow is not flat any more, so `surface` alone is
 * the wrong height everywhere except at the rim.
 */
function decorate(plan: IslandPlan): Dressing {
	const { rand, surface, snowAt, brimAt } = plan;
	const soft: Piece[] = [];
	const crags: Piece[] = [];

	/**
	 * How far out a thing `reach` metres across may be placed, along the direction `angle`.
	 *
	 * A drift is up to 2.8 m across and was being placed by its CENTRE at up to 0.87 R, so the far
	 * side of it hung as much as 11% past the ice — a lens of white snow in mid-air over the water,
	 * measured at 1.11 R. Trap 11's mirror image: the same failure to ask where the edges of a thing
	 * end up, pointing outward instead of downward.
	 *
	 * It asks `brimAt` rather than using a fixed fraction because the rim is not a circle. The
	 * harmonics pull it in by up to a sixth at some angles, so a margin safe on average is a margin
	 * that fails on whichever island happens to have a dip there.
	 *
	 * And it samples ACROSS the slice of rim the thing covers rather than asking once along its own
	 * bearing. Asking once left a drift 2.4 cm over the edge and the reason is the third harmonic: it
	 * runs at up to thirteen cycles round the floe, so a dip fits comfortably inside the arc a
	 * two-metre drift spans, and the brim straight ahead of such a piece says nothing about the brim
	 * beside it.
	 */
	const inside = (angle: number, wanted: number, reach: number): number => {
		const spread = Math.atan2(reach, Math.max(reach, wanted));
		let brim = Number.POSITIVE_INFINITY;
		for (let i = -RIM_SAMPLES; i <= RIM_SAMPLES; i++) {
			const at = angle + (spread * i) / RIM_SAMPLES;
			brim = Math.min(brim, brimAt(Math.sin(at), Math.cos(at)));
		}
		return Math.max(0, Math.min(wanted, brim - reach - RIM_MARGIN));
	};

	const drifts = 3 + Math.floor(rand() * 4);
	for (let i = 0; i < drifts; i++) {
		// A flattened sphere, half-buried: a wind-blown heap of snow. Pure white against the faintly
		// blue ice, or it is invisible — which is exactly what the first version was. Sixteen segments
		// round rather than nine, because vertices are the one budget with room in it and a drift is
		// the most organic shape on the floe.
		const radius = 1 + rand() * 1.8;
		const squash = 0.7 + rand() * 0.5;
		const geometry = new SphereGeometry(radius, 16, 10);
		const angle = rand() * Math.PI * 2;
		const away = inside(angle, FLOE_RADIUS * (0.42 + rand() * 0.45), radius * Math.max(1, squash));
		const x = Math.sin(angle) * away;
		const z = Math.cos(angle) * away;
		geometry.scale(1, 0.16 + rand() * 0.12, squash);
		geometry.rotateY(rand() * Math.PI);
		const ground = surface + snowAt(x, z);
		geometry.translate(x, ground + 0.03, z);
		soft.push({ geometry, colour: DRIFT, groundY: ground });
	}

	// Meltwater: flat pools lying in the ice, and the one feature that reads instantly from above —
	// which is where this camera looks from, and what stops a floe being a white disc. No `groundY`:
	// a pool is entirely AT its contact, so a seam would not shade it, it would repaint it.
	const pools = 1 + Math.floor(rand() * 3);
	for (let i = 0; i < pools; i++) {
		const span = 0.7 + rand() * 1.4;
		const squash = 0.6 + rand() * 0.6;
		const geometry = new CircleGeometry(span, 20);
		const angle = rand() * Math.PI * 2;
		const away = inside(angle, FLOE_RADIUS * (0.2 + rand() * 0.55), span * Math.max(1, squash));
		const x = Math.sin(angle) * away;
		const z = Math.cos(angle) * away;
		geometry.rotateX(-Math.PI / 2);
		geometry.scale(1, 1, squash);
		geometry.translate(x, 0, z);
		// Deeper in the middle. A pool is the one thing on the ice that is not white, so it is carrying
		// the whole of the deck's colour variety on its own — and a flat disc of one blue reads as a
		// sticker where a gradient reads as water with a bottom to it.
		// Every vertex put on the snow UNDER it rather than the disc put at the height of its middle.
		// A pool is up to four metres across and the relief moves five centimetres over that, so a
		// flat one lies half-buried at one end and floats at the other — which is trap 11 for the
		// third time, in a form where the number is small enough to argue about.
		const pos = geometry.attributes.position;
		if (pos) {
			for (let v = 0; v < pos.count; v++) {
				pos.setY(v, surface + snowAt(pos.getX(v), pos.getZ(v)) + 0.012);
			}
			geometry.computeVertexNormals();
		}
		soft.push({
			geometry,
			colour: (px, _py, pz) => alongStops(POOL_STOPS, Math.hypot(px - x, pz - z) / span)
		});
	}

	// A pressure ridge on about half of them: where two floes shoved into each other long before this
	// round started. The only feature with a silhouette above the horizon, so it is what makes one
	// island recognisable from the far side of the sea.
	//
	// BROKEN into blocks, because the first version was ONE box three to six metres long — uniform
	// width, square ends, one flat near-white value, lying level on the ice — and on a phone it read
	// as a scaffolding plank. Ice under compression does not make beams: it makes a line of slabs
	// shoved up at angles, tallest in the middle and dying out at both ends.
	//
	// And AT THE RIM, running along it, at hill height. The first broken version was 0.5–0.85 m tall
	// in the middle of the floe, which is half a penguin: it read as debris somebody had dropped, and
	// the intention above cannot be delivered at that size — a landmark you can name from across the
	// sea has to break the skyline. `MOUND_MIN/MAX_HEIGHT` is 0.9–1.5 m for real climbable ground, so
	// that is the scale a feature on a floe has to be to count as one.
	//
	// The rim placement is what makes the size affordable. This is DRESSING — `sim/` knows a floe's
	// radius and its mounds and nothing else on it — so a penguin walks straight through it, and a
	// two-metre wall through the middle of the arena would be a lie told right where the fight is.
	// Out at 0.62–0.76 R, running tangentially, it is behind the fight rather than in it, the only
	// player who meets it is one already being shoved into the sea, and it is also simply where a
	// pressure ridge forms: at the EDGE, which is the part of a floe that collides with anything.
	if (rand() > 0.4) {
		const angle = rand() * Math.PI * 2;
		const away = FLOE_RADIUS * (0.62 + rand() * 0.14);
		const midX = Math.sin(angle) * away;
		const midZ = Math.cos(angle) * away;
		// Along the rim, not across it: a quarter turn off the radius. Kept in step with the block
		// placement below, so the line of slabs and the slabs themselves point the same way.
		const bearing = angle + Math.PI / 2;
		const span = 3.4 + rand() * 2.4;
		const crest = 1.05 + rand() * 0.6;
		const blocks = 4 + Math.floor(rand() * 3);
		for (let i = 0; i < blocks; i++) {
			// −1 at one end of the line, +1 at the other. The taper off that is what gives the ridge
			// ENDS rather than a place where it stops.
			const along = blocks > 1 ? (i / (blocks - 1)) * 2 - 1 : 0;
			const tall = crest * (1 - along * along * 0.66);
			const long = (span / blocks) * (1.15 + rand() * 0.5);
			const geometry = new BoxGeometry(0.55 + rand() * 0.5, tall, long);
			// Rolled and yawed per block, so no two of them present the same face and the line of them
			// is a line of separate things rather than a segmented one.
			geometry.rotateZ((rand() - 0.5) * 0.55);
			geometry.rotateY(bearing + (rand() - 0.5) * 0.5);
			const x = midX + Math.sin(bearing) * along * span * 0.5 + (rand() - 0.5) * 0.4;
			const z = midZ + Math.cos(bearing) * along * span * 0.5 + (rand() - 0.5) * 0.4;
			const ground = surface + snowAt(x, z);
			geometry.translate(x, ground + tall * 0.42, z);
			crags.push({
				geometry,
				colour: (_px, py) => alongStops(RIDGE_STOPS, py - ground),
				groundY: ground
			});
		}
	}

	if (rand() > 0.35) {
		const pebbles = 1 + Math.floor(rand() * 3);
		for (let i = 0; i < pebbles; i++) {
			// One subdivision rather than none: twenty faces is a die and eighty is a stone that has
			// been in the sea. Still faceted — a pebble is the one thing out here that should be — but
			// round enough in silhouette to stop reading as a lump of something burnt.
			const radius = 0.3 + rand() * 0.34;
			const geometry = new IcosahedronGeometry(radius, 1);
			const angle = rand() * Math.PI * 2;
			const away = FLOE_RADIUS * (0.5 + rand() * 0.38);
			const x = Math.sin(angle) * away;
			const z = Math.cos(angle) * away;
			geometry.scale(1, 0.7 + rand() * 0.5, 1);
			geometry.rotateX(rand());
			geometry.rotateY(rand());
			const ground = surface + snowAt(x, z);
			geometry.translate(x, ground + radius * 0.5, z);
			crags.push({
				geometry,
				colour: (_px, py) => alongStops(PEBBLE_STOPS, (py - ground) / (radius * 2)),
				groundY: ground
			});
		}
	}

	return { soft, crags, hills: buildMounds(plan) };
}

/**
 * The hills on one island, drawn from the ones the simulation says are there.
 *
 * The MESH is a little wider than the hill it draws so its base disappears into the ice rather than
 * ending in a visible rim, and a little shorter than its full height so the flat top a penguin
 * actually stands on is where the peak looks like it is.
 */
function buildMounds(plan: IslandPlan): Piece[] {
	const { surface, snowAt } = plan;
	const pieces: Piece[] = [];

	for (const mound of moundsFor(plan.variant)) {
		const radius = mound.radius * FLOE_RADIUS;
		const x = mound.at.x * FLOE_RADIUS;
		const z = mound.at.z * FLOE_RADIUS;
		const ground = surface + snowAt(x, z);
		// THREE tiers rather than one cone. The physics profile is a cosine bump — wide and gentle,
		// because a hill has to be climbable (`MOUND_MAX_SLOPE`) — and a single cone over that profile
		// reads as a sand dune. Stacked tiers read as ice shoved up out of the sea, which is what a
		// hill on a floe is, and they sit inside the same silhouette. Smooth-shaded within each tier
		// and creased between them: the crease is the shape, the facets were never the point.
		const tiers = 3;
		for (let i = 0; i < tiers; i++) {
			const t = i / tiers;
			const next = (i + 1) / tiers;
			// The cosine profile, sampled at this tier's bottom and top.
			const bottom = Math.cos((Math.PI * t) / 2);
			const top = Math.cos((Math.PI * next) / 2);
			// The lowest tier reaches down under the snow; the others only overlap their neighbour.
			const embed = i === 0 ? MOUND_EMBED : 0.04;
			const geometry = new CylinderGeometry(
				radius * top * 0.98,
				radius * bottom,
				mound.height / tiers + embed,
				10 + i * 2,
				1
			);
			geometry.rotateY(i * 0.7);
			geometry.translate(x, ground + (mound.height * (t + next)) / 2 - embed / 2, z);
			pieces.push({
				geometry,
				// One ramp across all three tiers rather than a flat value each. Three near-whites are
				// one white at this light level, and the tier boundaries then read as the only shape
				// the hill has.
				colour: (_px, py) => alongStops(MOUND_STOPS, (py - ground) / mound.height),
				groundY: ground
			});
		}
	}

	return pieces;
}
