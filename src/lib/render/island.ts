/**
 * Die Insel, drawn — the hub, and the one place in this game with a colour in it that is not blue.
 *
 * Everything else in `render/` draws ice on water. That is the whole palette: three pale blues and a
 * white disc, which `docs/ART-DIRECTION.md` §1 names as the single biggest reason the frame does not
 * look like the games it is being pulled toward. Both references are dense with green, warm sand,
 * painted wood and a red roof, and none of that can be added to a floe. So the island is the art fix
 * as much as it is a feature, and this file is where the colour actually goes in.
 *
 * **The simulation is the authority and nothing here is a second copy of it.** Three facts are read
 * rather than re-typed, and each of them is a version of trap 8 — a number the player can lose to
 * that the renderer keeps its own opinion about:
 *
 *  * The GROUND is `archipelago.groundHeight(floe, …)`, called per vertex. Not "the same cosine
 *    bump"; the function itself. A hill you can see is exactly the hill you can climb because there
 *    is one definition of where the ground is and the mesh is a plot of it.
 *  * The ZONES are `sim/island.ISLAND_ZONES`, by id. Their positions and radii are the simulation's,
 *    so the bunting round the Rathausplatz stands on the circle that actually opens the Royal.
 *  * The SHORE is `floe.radius - ISLAND_SHORE_MARGIN`, which is where `holdOnTheIsland` stops you.
 *    The ground is drawn flat out to exactly there and only then falls away, so the last step a
 *    child can take is onto dry sand rather than into a beach they are held above.
 *
 * **The ground is displaced by nothing else.** `floeField.ts` digs five centimetres of hollows into
 * its snow, and every prop on a floe then has to ask `snowAt` for its own height — that is trap 11
 * three times over in one file. A hub is the ground with the most hand-placed things standing on it
 * anywhere in the game, so it takes the simpler contract: the surface IS `groundHeight`, all of the
 * variety is vertex colour, and a prop's base is `groundAt(x, z)` with nothing else to remember.
 * Colour is free; a second surface function is a second thing to get wrong.
 *
 * **Five landmarks, readable by silhouette.** A child navigates a hub by looking at it, and every
 * word on a sign is a word an eight-year-old has to read first — so the square has bunting and a
 * bandstand, the arena has posts and rope, the mountain has a cable with something moving on it, the
 * cave is a black hole in a rock, and the shop has a striped awning and a hat over the door. No text
 * anywhere. Which way each of them FACES is chosen against where the camera can be when the zone is
 * approached (trap 17): the cave's mouth and the shop's counter both look back toward the square.
 *
 * **Seven draw calls for the whole island**, against the 209 a Royal spends: the terrain and its
 * skirt are one merged mesh, the foam is one, everything rounded is one, everything faceted is one,
 * the rink is one, the dark inside the cave is one, and the gondola cabin is the only object here
 * allowed to move. Built ONCE at mount — the island does not shrink, break, sink or drift, which
 * makes it cheaper than a floe rather than dearer.
 */
import {
	BoxGeometry,
	type BufferGeometry,
	CircleGeometry,
	Color,
	CylinderGeometry,
	Group,
	IcosahedronGeometry,
	Mesh,
	MeshBasicMaterial,
	MeshLambertMaterial,
	MeshPhongMaterial,
	RingGeometry,
	SphereGeometry
} from 'three';
import { groundHeight } from '../sim/archipelago';
import {
	ISLAND_OBSTACLES,
	ISLAND_SHORE_MARGIN,
	ISLAND_ZONES,
	type IslandZone,
	type Obstacle
} from '../sim/island';
import type { Floe, Vec2 } from '../sim/types';
import { alongStops, bake, type Contact, mergePieces, type Piece } from './bake';
import { SEA_LEVEL } from './floeField';

// ---------------------------------------------------------------------------
// The ground
// ---------------------------------------------------------------------------

/**
 * How many facets go round the island, and why it has to stay a multiple of four.
 *
 * The terrain is built from `RingGeometry` and the skirt under it from `CylinderGeometry`, and three
 * starts those two a quarter turn apart — a cylinder's first vertex is at `sin`, a ring's at `cos`.
 * At a multiple of four that quarter turn is a whole number of segments and the two rims land on the
 * same points; at anything else the beach ends in a ring of slivers all the way round, at the one
 * edge of the island that is always on screen. The same constraint `floeField.RIM_SEGMENTS` carries,
 * for the same pair of primitives.
 *
 * 144 rather than a floe's 44 because this disc is nine times the radius: an arc at the shoreline is
 * 2.5 m, about a penguin and a half, and the waterline is the island's whole outline.
 */
const RIM_SEGMENTS = 144;

/**
 * How the disc is cut up radially: a fan in the middle, the body, and the beach.
 *
 * Three pieces rather than one, because the resolution wanted at the shore is not the resolution
 * wanted across a 116 m island. The body samples every 1.4 m, finer than the curvature of the
 * smallest hill the simulation has; the beach samples every 20 cm, because it is 1.2 m wide and it
 * is the piece the eye is on.
 *
 * The middle is a triangle FAN, which is safe here and is not on a floe: a `CircleGeometry` has one
 * interior vertex and displacing it moves the whole surface as a cone — but nothing displaces this
 * one. The square is flat ground in the simulation and it is flat ground here.
 */
const PLUG_RADIUS = 5;
const BODY_RINGS = 34;
const BEACH_RINGS = 7;

/**
 * Where the coast stops being the simulation's circle, in metres from the middle.
 *
 * A perfect 58 m circle reads as a dinner plate, so the outline wobbles — and the wobble may push
 * the coast OUT and never in, tapered to nothing inside this radius. Both halves are load-bearing.
 * Outward only, because ground drawn inside `holdOnTheIsland`'s circle is ground a child can see and
 * cannot reach, which is trap 8 with the sign flipped. Tapered from 53 m, because the mountain's own
 * footprint reaches 52.1 m and scaling the disc by an angle-dependent factor would slide its peak
 * away from the six metres of hill the simulation put there.
 */
const WOBBLE_FROM = 53;

/** How far out the coast may bulge, in metres. Three harmonics, every one of them adding. */
const WOBBLE_MAX = 2.2;

/**
 * How far the beach falls from the last dry step to the drawn rim, in metres.
 *
 * The sea is at `SEA_LEVEL` (−0.83 m), so 1.35 puts the waterline about two thirds of the way down
 * the slope: wet sand below it, dry sand above, and the player held at the top of it. Less and the
 * whole beach stands above water and the island ends in a cliff of its own skirt; more and the sand
 * that is meant to be the warm colour in the frame is underwater.
 */
const SHORE_DROP = 1.35;

/**
 * How far the skirt under the beach reaches, in metres below the dry ground.
 *
 * Not about being seen — the ocean is opaque — but about not being seen THROUGH. The water's own
 * shader lifts and drops the surface by 76 cm (`scene.ts`), and a skirt stopping just under the mean
 * sea shows daylight beneath the island every time a trough goes past.
 */
const SKIRT_DEPTH = 3.6;

/**
 * The foam collar: metres either side of the waterline, and how far above the mean sea it rides.
 *
 * The same three decisions `floeField` reached for a floe and for the same reasons — wobbled with
 * the coast rather than drawn as a circle, lifted clear of the mean sea so the swell washes THROUGH
 * it instead of over it, and faded outward by vertex colour, which is the only fade one draw call
 * has. Its inner edge is buried in the sand, so the collar has no visible start.
 */
const FOAM_INNER = 1.1;
const FOAM_OUTER = 2.6;
const FOAM_LIFT = 0.1;

// ---------------------------------------------------------------------------
// The palette — this is the part of the file that is the point
// ---------------------------------------------------------------------------

/**
 * The grass, from a hollow to a crest.
 *
 * A wide range between two properly different greens rather than two shades of one, which is the
 * measurement `floeField.SNOW_STOPS` records: this scene is lit by a hemisphere at 1.4 and a sun at
 * 1.4 through an ACES curve at 1.25 exposure, and two near-neighbours land on the same pixel. What
 * moves between them is `mottle`, and it is the only thing standing between the middle of this
 * island and six thousand square metres of one flat colour.
 */
const GRASS_LOW = 0x3c8a3a;
const GRASS_HIGH = 0x7ec84c;

/** Where the grass gives out. Warmer and paler, so the beach arrives as a gradient, not a line. */
const GRASS_DRY = 0xb0c268;

/**
 * The beach, dry to drowned.
 *
 * WARM, and deliberately the warmest thing in the game: every other surface in every other mode is
 * on the blue side of white. One honest sand does more for a frame made of pale blues than any
 * further shade of ice can — the whole argument of `docs/ART-DIRECTION.md` §1.
 */
const SAND_DRY = 0xf2dda8;
const SAND_WET = 0xc09a68;
const SAND_DEEP = 0x7d6144;

/**
 * How far inside the shore the Eisarena's pier has to stop, in metres.
 *
 * Measured from `ISLAND_SHORE_MARGIN` rather than chosen: `holdOnTheIsland` stops a penguin at
 * `radius - ISLAND_SHORE_MARGIN`, and every plank past that is planking a child can see and never
 * stand on. The extra 40 cm is for the mooring posts, which go a little further out than the last
 * plank does and are the tallest thing on the pier.
 */
const PIER_MARGIN = 1.4;

/** How far the pier passes to one side of the boathouse, beyond the shed's own radius, in metres. */
const PIER_CLEAR = 2.6;

/** A path from the square to a place. Trodden sand, and the cheapest signposting there is. */
const PATH = 0xe3cd97;

/** The high ground. Blue at the snow line and white at the top, as everything cold in this game is. */
const SNOW_EDGE = 0xd6e8f6;
const SNOW_TOP = 0xfdffff;

/**
 * Where the snow starts and where it has taken over, in metres above the sea.
 *
 * Chosen against the three hills the simulation actually has: the mountain is 6 m and the two rises
 * are 2.2 and 2.6. So the peak wears a white cap, the rises stay green, and the island has a snow
 * LINE — which is what says "polar" while the middle of it stays a children's park. At 2 m the knolls
 * go white too and the island reads as one more ice floe.
 *
 * The GAP between the two was 2.7 m of ramp and is now 1.3, and that is the Berg's only remaining
 * lever. Nothing standing on the summit can be seen — there are two metres of screen above the peak
 * from the square and the HUD is in most of them (see `STATION_MAST`) — so the mountain has to read
 * by colour or not at all. Tightening the ramp roughly doubles the solidly-white core, from 7.4 m
 * across to 13.3, which is the difference between a green hill with a pale top and a peak.
 */
const SNOW_FROM = 2.9;
const SNOW_FULL = 4.2;

/**
 * Driftwood, from its wet underside to its bleached top.
 *
 * A solid brown cylinder on pale sand reads as a chocolate bar — which is exactly what the reviewer
 * called it, and once said it cannot be unseen. Two things were wrong and the colour was the bigger
 * one: real driftwood has spent a year in the sun and is SILVER on top, dark only where it lies
 * against the wet. One flat `WOOD_DARK` is confectionery; a ramp up the log's own height is a piece
 * of wood the sea has finished with.
 */
const DRIFTWOOD_STOPS: [number, number][] = [
	[0, 0x5f4f3c],
	[0.45, 0x9a8b74],
	[1, 0xcfc4ae]
];

/** Timber, in the three states this island uses it: warm, pale and weathered. */
const WOOD = 0xb87f4a;
const WOOD_PALE = 0xd9a870;
const WOOD_DARK = 0x7d5230;

/** The paint. Saturated with conviction — a pastel that lost its nerve is the washed-out frame. */
const RED = 0xd9483c;
const RED_DARK = 0xa8342b;
const TEAL = 0x2fa8a2;
const TEAL_DARK = 0x27827f;
const YELLOW = 0xf4c02f;
const CREAM = 0xf6ecd8;
const PINK = 0xea7fa0;

/** Stone, foot to top — and it is warm rather than grey: a cold rock is one more blue in the frame. */
const ROCK_STOPS: [number, number][] = [
	[0, 0x6f6455],
	[0.5, 0x92887a],
	[1, 0xb3a795]
];

/**
 * The paving on the Rathausplatz, from the middle outward.
 *
 * Cooler than it was. At `0xe0d3b6` the plaza was two per cent off `SAND_DRY` and one per cent off
 * the paths running into it, so the whole square photographed as a big disc of sand with bunting
 * over it — a beach in the middle of the grass rather than a town square. Stone is the one surface
 * on this island that is allowed to be grey: the colour in this frame is the bunting, the benches
 * and the roofs, and a paved floor under them is what those read AGAINST.
 */
const PAVING = 0xd9d2c4;
const PAVING_JOINT = 0xb2a897;

/**
 * Where the two painted rings on the square go, in metres of radius, and how high above the paving.
 *
 * They are GEOMETRY and not a colour function, which is the whole lesson of the starburst below: a
 * shape gets its edges from vertices, and a colour only ever says what tone the vertices already
 * there should be. The outer one lands just inside the bunting, so the circle that opens the Royal
 * is painted on the ground as well as fenced.
 *
 * The heights are the tight part. A penguin carries a blob shadow at 2 cm and its "that one is you"
 * ring at 4 cm (`render/penguin.ts`), so everything painted on the square has to stay under two
 * centimetres or it draws over the player's own markers — which on the one tile every player stands
 * on is a worse artefact than the one being fixed.
 */
const PLAZA_LIFT = 0.012;
const MARK_LIFT = 0.016;

/**
 * The plaza's floor pattern: a stone inlay in the middle and concentric courses of paving out to
 * the kerb.
 *
 * **Concentric, and that is the whole decision.** The middle of this square has now been drawn three
 * ways. An angle-coloured ring was the starburst. A twelve-spoke compass rose replaced it and read as
 * a four-blade propeller — because with twelve spokes the "cardinal" test lands on i = 0, 3, 6, 9 and
 * only the even two of those take the accent, so what actually reached the screen was two dark blades
 * facing each other. Both failures are the same failure: **a radial pattern in the middle of a disc
 * reads as a MACHINE, not as a floor.** Nothing radiates from a point in real paving either.
 *
 * Rings cannot do that. They have no spokes to become blades, their colour depends on radius alone so
 * no angle is asked for anywhere, and concentric courses of stone are what a paved circle is actually
 * made of. The contrast between the two tones is deliberately low — this is a floor a player stands
 * on, and its job is to stop the middle being blank, not to be looked at.
 */
const PLAZA_COURSES = 8;
const PLAZA_HUB = 1.7;
const PAVING_COURSE = 0xcdc5b5;

/**
 * The inlay at the very middle of the square, and it is STONE rather than a colour.
 *
 * It was a saturated teal disc, and it was reported as "a teal ellipse floating at the penguin's head
 * height, stuck to its neck". It was not floating: it lay on the ground at 1.6 cm, and the door-ring
 * guard proves every vertex of the plaza is on the terrain. **It is trap 9.** The camera looks down
 * at 27°, so anything BEHIND the player draws higher up the screen than the player's feet — and the
 * middle of the square is exactly where a child stands. The arithmetic: a disc on the ground at the
 * plaza's centre projects at the same screen height as a point 1.94 m up the body of a penguin
 * standing on the spawn ring. Above its head.
 *
 * Nothing can move it out of that overlap — it is the floor the player is on. What CAN change is
 * whether it reads as an object. A saturated teal disc behind a penguin is a thing; a stone inlay a
 * shade off the paving around it is a floor, and a floor that overlaps a penguin is just a floor.
 *
 * So the rule this leaves behind: **the plaza's floor is neutral, and the only saturated colour
 * allowed on it is the door ring, which means something.**
 */
const PAVING_INLAY = 0xc4b79f;

/** The rink: pale, wet, and the one Phong surface on the island. */
const RINK = 0xbfe4f4;
const RINK_EDGE = 0x7fbdd8;

/** A tree, foot to crown. The dark at the bottom is what stops a green blob reading as a balloon. */
const LEAF_STOPS: [number, number][] = [
	[0, 0x24663a],
	[0.55, 0x39894a],
	[1, 0x5fb45c]
];

/** The skirt under the beach, from the waterline down. Wet, then dark, then gone into the water. */
const SKIRT_STOPS: [number, number][] = [
	[SHORE_DROP, SAND_WET],
	[SHORE_DROP + 0.5, SAND_DEEP],
	[SKIRT_DEPTH, 0x4a3c2c]
];

/** The collar, as metres either side of the coast: white at the sand, the sea's own blue by the end. */
const FOAM_STOPS: [number, number][] = [
	[-FOAM_INNER, 0xffffff],
	[0.4, 0xffffff],
	[1.3, 0xd8f0fa],
	[FOAM_OUTER, 0x8ecfe6]
];

/**
 * The seam where anything on the island meets the ground it stands on.
 *
 * The whole of the grounding in this game, and the reason it is baked rather than cast: there is no
 * shadow map (`scene.ts` measures why, at length), so a prop with nothing under it sits at an
 * ambiguous depth and the island reads as decals on a green plane. A warm dark rather than either
 * surface taken down, because it has to work under grass AND under sand — a green seam beneath a
 * driftwood log on the beach is a green seam.
 *
 * Deeper than a floe's 16 cm: the contrast a seam gets for free against snow has to be bought here.
 */
const CONTACT: Contact = { reach: 0.22, colour: 0x554a3c, strength: 0.72 };

// ---------------------------------------------------------------------------
// The gondola — the one thing that moves
// ---------------------------------------------------------------------------

/**
 * How far below its cable head the cabin hangs, and how big it is.
 *
 * The cabin was 1.5 m and 30 m away, which is under two per cent of the frame — the promise of this
 * landmark is "ride it up and join the race", and a child cannot make that promise out of a dot.
 * 2.1 m is bigger than a penguin, which is the scale that says "you get in".
 */
const CABIN_HANG = 1.2;
const CABIN_SIZE = 2.1;

/**
 * The ring that lights under a penguin standing in a door, and everything about how it behaves.
 *
 * Daniel, having played it: *"being on a game start indicator should be more clear"*. Standing in a
 * zone put a card in one corner of the screen and a button in another, and a child has to ASSOCIATE
 * those two before either means anything. A ring under their own feet is one thing instead of two,
 * and it answers the only question being asked — *am I standing somewhere?* — in the place the
 * question is about.
 *
 * Three decisions, and each is the difference between a door and a decal:
 *
 *  * **It is the zone's own edge.** `zoneAt` opens a door for a penguin within `radius` of a point,
 *    so the ring is drawn at exactly that radius: the line you cross is the line you can see. Drawn
 *    a metre in or out it would be a lie about a rule, which is trap 8's whole family.
 *  * **It is fitted to the GROUND, not laid flat on it.** Every vertex is placed on `groundAt` when
 *    the door changes, so on Der Berg's slope it follows the hill instead of cutting into the uphill
 *    side and floating off the downhill one. A glow that floats reads as an interface element, and an
 *    interface element on the floor is exactly what this must not be.
 *  * **It is unlit.** A glow dimmed by a Lambert term is not a glow, it is paint.
 *
 * The green is the "Los!" button's green on purpose: same colour, same meaning, and a child who has
 * pressed it once has the association for free.
 */
const DOOR_SEGMENTS = 72;
/** The band, as fractions of the zone's radius. Inside the line, so the line itself stays true. */
const DOOR_INNER = 0.87;
/** How far above the ground, in metres. Over the plaza's paving and its kerb, under the blob shadow
 * a penguin carries at 2 cm (`render/penguin.ts`) — a door that draws over the player's own shadow
 * has stopped being under their feet. */
const DOOR_LIFT = 0.018;
/** How fast it breathes, and between which two opacities. Slow: a fast pulse reads as an alarm. */
const DOOR_PULSE_HZ = 0.55;
const DOOR_DIM = 0.5;
const DOOR_BRIGHT = 0.85;
/** Piped rather than flat — a bright core between two darker edges reads as a painted line with
 * light coming off it, where one flat value reads as a sticker. */
const DOOR_STOPS: [number, number][] = [
	[DOOR_INNER, 0x27b04c],
	[0.94, 0xe8ffe8],
	[1, 0x27b04c]
];

/**
 * How much room the scatter leaves around a declared building, beyond its own radius, in metres.
 *
 * Elbow room rather than clearance: the footprint is what a penguin is stopped at, and a fir tree
 * planted right against a wall reads as growing out of it even though nothing is overlapping.
 */
const BUILDING_ELBOW = 2.2;

// ---------------------------------------------------------------------------

export interface Island {
	root: Group;
	/**
	 * Advance the one thing on the island that moves.
	 *
	 * Seconds are handed IN rather than read: `render/loop.ts` is the only file in this app allowed
	 * to look at a clock (invariant 3). Everything else here is built at mount and never touched
	 * again, so an island that is never ticked is an island with its gondola parked at the bottom —
	 * a still frame of a correct picture rather than a broken one.
	 */
	update(seconds: number): void;
	/**
	 * Light the ground under a door, or clear it.
	 *
	 * Driven by the `doorUnder` poll the hub already runs at 10 Hz, so this is called with the same
	 * zone over and over: re-fitting the ring to the ground costs a few hundred vertices and happens
	 * only when the ANSWER changes, never per call and never per frame.
	 *
	 * @param at the middle of the zone in world metres, or null for "not standing in one".
	 * @param radius the zone's own radius — the line `zoneAt` actually opens the door inside.
	 */
	showDoor(at: Vec2 | null, radius: number): void;
	dispose(): void;
}

/**
 * Build the island, once.
 *
 * @param floe the island as the simulation has it: its centre, its radius and its hills. Everything
 *   drawn here is a plot of that floe rather than a second description of it, which is the only
 *   defence there is against the drawn ground and the walkable ground disagreeing (trap 8).
 */
export function createIsland(floe: Floe): Island {
	const root = new Group();
	const rand = shaper(0x151a4d);

	const cx = floe.center.x;
	const cz = floe.center.z;
	/** The furthest a penguin can get. `holdOnTheIsland` holds them at exactly this radius. */
	const hold = floe.radius - ISLAND_SHORE_MARGIN;

	/** How far out the coast is at this bearing. Never inside `floe.radius` — see `WOBBLE_FROM`. */
	const rimAt = (angle: number): number => {
		const swell =
			0.44 * (0.5 + 0.5 * Math.sin(angle * 3 + 0.7)) +
			0.34 * (0.5 + 0.5 * Math.sin(angle * 5 - 2.1)) +
			0.22 * (0.5 + 0.5 * Math.sin(angle * 8 + 1.4));
		return floe.radius + WOBBLE_MAX * swell;
	};

	/**
	 * Where the ground is, in world metres: the simulation's own answer, plus the beach.
	 *
	 * `groundHeight` is flat everywhere but the hills and knows nothing about a shore, so the drop is
	 * added outside `hold` — past the last place anybody can stand. Inside the walkable island this
	 * function IS `groundHeight`, exactly, and there is no second surface to keep in step with it.
	 */
	const groundAt = (x: number, z: number): number => {
		const height = groundHeight(floe, { x, z });
		const r = Math.hypot(x - cx, z - cz);
		if (r <= hold) return height;
		const rim = rimAt(Math.atan2(x - cx, z - cz));
		return height - SHORE_DROP * ramp(hold, Math.max(rim, hold + 0.01), r);
	};

	/** The lowest ground within `span` of here, less a little: what a flat-bottomed thing stands on. */
	const standOn = (x: number, z: number, span = 0.4): number => {
		let low = groundAt(x, z);
		for (let i = 0; i < 4; i++) {
			const a = (i / 4) * Math.PI * 2;
			low = Math.min(low, groundAt(x + Math.sin(a) * span, z + Math.cos(a) * span));
		}
		// Six centimetres in, so a base is never a hairline of daylight where the ground curves away.
		return low - 0.06;
	};

	/**
	 * The highest ground within `span` of here.
	 *
	 * The mirror of `standOn`, and the two answer different questions. A thing with a flat base is
	 * seated on the LOWEST ground under it, so its uphill side buries rather than its downhill side
	 * floating. A thing on LEGS has to clear the HIGHEST, or the deck it carries is underground at one
	 * corner — which on the gondola's hillside is two metres of it.
	 */
	const crownOf = (x: number, z: number, span: number): number => {
		let high = groundAt(x, z);
		for (let i = 0; i < 8; i++) {
			const a = (i / 8) * Math.PI * 2;
			high = Math.max(high, groundAt(x + Math.sin(a) * span, z + Math.cos(a) * span));
		}
		return high;
	};

	const walks = pathLines();
	const shade = (x: number, y: number, z: number): number =>
		groundColour(x, y, z, Math.hypot(x - cx, z - cz), walks);

	/** Put a flat primitive onto the ground, bulging the coast on the way. Every terrain piece. */
	const settle = (geometry: BufferGeometry): BufferGeometry => {
		const pos = geometry.attributes.position;
		if (!pos) return geometry;
		for (let i = 0; i < pos.count; i++) {
			const x0 = pos.getX(i);
			const z0 = pos.getZ(i);
			const r0 = Math.hypot(x0, z0);
			const angle = Math.atan2(x0, z0);
			// Tapered from `WOBBLE_FROM`, so inland is exactly the simulation's coordinates and only
			// the coast moves. `hold` is safe either way: the bulge only ever adds.
			const r = r0 + (rimAt(angle) - floe.radius) * ramp(WOBBLE_FROM, floe.radius, r0);
			const x = cx + Math.sin(angle) * r;
			const z = cz + Math.cos(angle) * r;
			pos.setX(i, x);
			pos.setZ(i, z);
			// Sampled at the FINAL position, so the ground drawn at a point is the simulation's ground
			// at that same point, whatever the wobble did on the way there.
			pos.setY(i, groundAt(x, z));
		}
		// While it still has an index. `mergePieces` makes it non-indexed afterwards, and
		// `computeVertexNormals` on a non-indexed geometry can only ever produce flat facets — a
		// hillside is the largest smooth thing in the game and it has to stay smooth.
		geometry.computeVertexNormals();
		return geometry;
	};

	// ---- the terrain, its skirt and its floor: one mesh ----
	const terrain: Piece[] = [];

	const plug = new CircleGeometry(PLUG_RADIUS, RIM_SEGMENTS);
	plug.rotateX(-Math.PI / 2);
	terrain.push({ geometry: settle(plug), colour: shade });

	const body = new RingGeometry(PLUG_RADIUS, WOBBLE_FROM, RIM_SEGMENTS, BODY_RINGS);
	body.rotateX(-Math.PI / 2);
	terrain.push({ geometry: settle(body), colour: shade });

	const beach = new RingGeometry(WOBBLE_FROM, floe.radius, RIM_SEGMENTS, BEACH_RINGS);
	beach.rotateX(-Math.PI / 2);
	terrain.push({ geometry: settle(beach), colour: shade });

	// The skirt. An open cylinder's side is already wound outward, which is the whole of trap 14
	// avoided by rotating a primitive instead of winding four quads by hand: a reversed wall is both
	// invisible AND unlit, and reads as a dark island rather than as a missing surface.
	const skirt = new CylinderGeometry(1, 0.94, 1, RIM_SEGMENTS, 1, true);
	const skirtPos = skirt.attributes.position;
	if (skirtPos) {
		for (let i = 0; i < skirtPos.count; i++) {
			const angle = Math.atan2(skirtPos.getX(i), skirtPos.getZ(i));
			const top = skirtPos.getY(i) > 0;
			// The top ring lands on the terrain's own rim, vertex for vertex — same 144 angles, same
			// wobble, same height. That weld is why `RIM_SEGMENTS` must be a multiple of four.
			const r = rimAt(angle) * (top ? 1 : 0.93);
			skirtPos.setX(i, cx + Math.sin(angle) * r);
			skirtPos.setZ(i, cz + Math.cos(angle) * r);
			skirtPos.setY(i, top ? -SHORE_DROP : -SKIRT_DEPTH);
		}
		skirt.computeVertexNormals();
	}
	terrain.push({ geometry: skirt, colour: (_x, y) => alongStops(SKIRT_STOPS, -y) });

	// And a floor, so the solid closes. A circle faces +Z, so a quarter turn the OTHER way from the
	// terrain's puts its front face down — the same line `floeField` uses under a floe.
	const floor = new CircleGeometry(1, RIM_SEGMENTS);
	floor.rotateX(Math.PI / 2);
	const floorPos = floor.attributes.position;
	if (floorPos) {
		for (let i = 0; i < floorPos.count; i++) {
			const angle = Math.atan2(floorPos.getX(i), floorPos.getZ(i));
			const r = rimAt(angle) * 0.93;
			floorPos.setX(i, cx + Math.sin(angle) * r);
			floorPos.setZ(i, cz + Math.cos(angle) * r);
			floorPos.setY(i, -SKIRT_DEPTH);
		}
	}
	terrain.push({ geometry: floor, colour: SAND_DEEP });

	const groundMaterial = new MeshLambertMaterial({ vertexColors: true });
	const ground = bake(terrain, groundMaterial);
	if (ground) root.add(ground);

	// ---- the foam collar ----
	// Built at radius 1–2 and remapped onto the coast, so both its edges follow the wobble rather
	// than crossing it: a circular collar round a wobbled island is a pale flange in the bays and
	// nothing at all on the headlands, which is exactly the seam a floe's foam used to show.
	const foamGeometry = new RingGeometry(1, 2, RIM_SEGMENTS, 3);
	foamGeometry.rotateX(-Math.PI / 2);
	const foamPos = foamGeometry.attributes.position;
	if (foamPos) {
		for (let i = 0; i < foamPos.count; i++) {
			const angle = Math.atan2(foamPos.getX(i), foamPos.getZ(i));
			const across = Math.hypot(foamPos.getX(i), foamPos.getZ(i)) - 1;
			const r = rimAt(angle) - FOAM_INNER + across * (FOAM_INNER + FOAM_OUTER);
			foamPos.setX(i, cx + Math.sin(angle) * r);
			foamPos.setZ(i, cz + Math.cos(angle) * r);
			foamPos.setY(i, 0);
		}
	}
	// Basic rather than Lambert, exactly as a floe's collar is: foam is brightness, not a surface
	// catching light, and a lit white ring at a 27° camera goes grey and reads as a shadow.
	const foamMaterial = new MeshBasicMaterial({
		color: 0xffffff,
		vertexColors: true,
		transparent: true,
		opacity: 0.7,
		depthWrite: false
	});
	const foam = bake(
		[
			{
				geometry: foamGeometry,
				colour: (x, _y, z) =>
					alongStops(FOAM_STOPS, Math.hypot(x - cx, z - cz) - rimAt(Math.atan2(x - cx, z - cz)))
			}
		],
		foamMaterial
	);
	if (foam) {
		foam.position.y = SEA_LEVEL + FOAM_LIFT;
		foam.updateMatrix();
		root.add(foam);
	}

	// ---- everything standing on it ----
	const kit: Kit = {
		soft: [],
		crags: [],
		sheen: [],
		voids: [],
		groundAt,
		standOn,
		crownOf,
		rand
	};

	for (const zone of ISLAND_ZONES) {
		const dress = FURNITURE[zone.id];
		// An unknown id draws nothing. A new zone added to the simulation gets a bare place rather
		// than a crash, which is the right failure for a renderer: the door still works.
		if (dress) dress(kit, zone, floe);
	}
	// **Every building is drawn from the simulation's own list, by id.** Not beside it, not from a
	// hand-typed copy of where it ought to be: `ISLAND_OBSTACLES` says where the solid things are and
	// how big they are, and this loop is the only thing on the island allowed to put walls up.
	//
	// It is written as a loop rather than as five calls because of what it costs to get wrong. A
	// building drawn a metre off its footprint is an invisible wall beside a solid-looking building —
	// worse than no collision at all, because the player learns to trust what they can see. Before
	// the list existed these five were hand-placed, and when it arrived every one of them was in the
	// wrong place: the Rathaus and the boathouse were not drawn AT ALL, so the square and the pier
	// each had a hole in the air nobody could walk through.
	for (const building of ISLAND_OBSTACLES) {
		const raise = BUILDINGS[building.id];
		// `iglu` is deliberately absent: `render/igloo.ts` draws the player's own home from the same
		// list, by the same id, because it changes as the igloo is upgraded and this file does not.
		if (raise) raise(kit, building, floe);
	}
	dressTheIsland(kit, floe, hold, walks);

	const softMaterial = new MeshLambertMaterial({ vertexColors: true });
	const cragMaterial = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
	// The one wet surface. Phong because the rink is meant to look like water that froze this
	// morning, and a Lambert one is a flat pale disc — the specular IS the ice.
	const sheenMaterial = new MeshPhongMaterial({
		vertexColors: true,
		shininess: 70,
		specular: 0x9fd6ea
	});
	// And the one place light does not reach. A Lambert cave mouth is lifted to a mid grey by an
	// ambient and a hemisphere and reads as a painted circle; a hole has to be unlit to be a hole.
	const voidMaterial = new MeshBasicMaterial({ vertexColors: true });

	const soft = bake(kit.soft, softMaterial, CONTACT);
	const crags = bake(kit.crags, cragMaterial, CONTACT);
	const sheen = bake(kit.sheen, sheenMaterial);
	const voids = bake(kit.voids, voidMaterial);
	for (const mesh of [soft, crags, sheen, voids]) if (mesh) root.add(mesh);

	const cabin = buildCabin();
	root.add(cabin.mesh);
	// Where the cabin hangs. Derived from the same footprint the station is drawn on, so the two
	// cannot drift apart — and null if the simulation has no gondola, in which case there is no cabin
	// to see rather than one hanging over the sea.
	const gondel = ISLAND_OBSTACLES.find((building) => building.id === 'gondel');
	const dock = gondel ? cabinDock(kit, gondel) : null;
	if (dock) cabin.mesh.position.set(dock.x, dock.y - CABIN_HANG, dock.z);
	else cabin.mesh.visible = false;
	cabin.mesh.updateMatrix();

	// The door ring. Built once at unit radius and re-fitted to the ground whenever the door changes,
	// so one geometry serves all five zones however big each of them is.
	const doorGeometry = new RingGeometry(DOOR_INNER, 1, DOOR_SEGMENTS, 2);
	doorGeometry.rotateX(-Math.PI / 2);
	const doorBaked = mergePieces([
		{
			geometry: doorGeometry,
			colour: (px, _py, pz) => alongStops(DOOR_STOPS, Math.hypot(px, pz))
		}
	]);
	// The unit circle it was built on, kept — because re-fitting overwrites the vertices and after the
	// first door the geometry no longer knows what shape it started as.
	//
	// Read AFTER the merge, and that is not a detail: `mergePieces` calls `toNonIndexed`, which turns
	// 219 shared vertices into 864 unshared ones in a different order. Cached before it, the table was
	// a quarter the length the ring now had and every vertex past the end fell back to the zone's own
	// centre — a spray of the ring collapsed onto the point in the middle, which is the same shape as
	// the starburst and would have drawn as one.
	const doorUnit: number[] = [];
	const doorSource = doorBaked?.attributes.position;
	if (doorSource) {
		for (let i = 0; i < doorSource.count; i++)
			doorUnit.push(doorSource.getX(i), doorSource.getZ(i));
	}
	// Basic, transparent and depth-blind: a glow that the sun can shade is paint, and a ring that
	// writes depth fights every decal a penguin carries.
	const doorMaterial = new MeshBasicMaterial({
		color: 0xffffff,
		vertexColors: true,
		transparent: true,
		opacity: DOOR_BRIGHT,
		depthWrite: false
	});
	const door = doorBaked ? new Mesh(doorBaked, doorMaterial) : null;
	if (door) {
		door.matrixAutoUpdate = false;
		door.visible = false;
		root.add(door);
	}
	/** Which door is drawn, so the poll can ask ten times a second and pay once. */
	let shown: { x: number; z: number; radius: number } | null = null;

	return {
		root,
		update(seconds) {
			// The cabin sways at its station rather than riding a cable, because there is no cable —
			// see `buildGondolaStation` for why, and it is a decision rather than an omission. A hanging
			// thing that is never quite still is the cheapest idle life there is and it costs one sine
			// on one object; follow-through is most of what "cute" is made of
			// (`docs/ART-DIRECTION.md` §4).
			if (dock) {
				cabin.mesh.rotation.z = Math.sin(seconds * 0.62) * 0.055;
				cabin.mesh.position.y = dock.y - CABIN_HANG + Math.sin(seconds * 0.44) * 0.05;
				cabin.mesh.updateMatrix();
			}

			// And the door breathes, if one is lit. Brightness only — the ring's vertices are fitted to
			// the ground, so scaling it would peel it off the hill it was measured against.
			if (door?.visible) {
				const beat = 0.5 + 0.5 * Math.sin(seconds * DOOR_PULSE_HZ * Math.PI * 2);
				doorMaterial.opacity = DOOR_DIM + (DOOR_BRIGHT - DOOR_DIM) * beat;
			}
		},
		showDoor(at, radius) {
			if (!door || !doorBaked) return;
			if (at === null || radius <= 0) {
				door.visible = false;
				shown = null;
				return;
			}
			door.visible = true;
			if (shown && shown.x === at.x && shown.z === at.z && shown.radius === radius) return;
			shown = { x: at.x, z: at.z, radius };

			const pos = doorBaked.attributes.position;
			if (!pos) return;
			for (let i = 0; i < pos.count; i++) {
				const x = at.x + (doorUnit[i * 2] ?? 0) * radius;
				const z = at.z + (doorUnit[i * 2 + 1] ?? 0) * radius;
				// Every vertex on the ground it is over, rather than the ring on the ground under its
				// middle. Der Berg's door is on a hillside, and a flat disc there is buried at one edge
				// and airborne at the other — trap 11 and its mirror image, in one object.
				pos.setXYZ(i, x, groundAt(x, z) + DOOR_LIFT, z);
			}
			pos.needsUpdate = true;
		},
		dispose() {
			ground?.geometry.dispose();
			groundMaterial.dispose();
			foam?.geometry.dispose();
			foamMaterial.dispose();
			soft?.geometry.dispose();
			softMaterial.dispose();
			crags?.geometry.dispose();
			cragMaterial.dispose();
			sheen?.geometry.dispose();
			sheenMaterial.dispose();
			voids?.geometry.dispose();
			voidMaterial.dispose();
			doorBaked?.dispose();
			doorMaterial.dispose();
			cabin.dispose();
		}
	};
}

// ---------------------------------------------------------------------------
// Painting the ground
// ---------------------------------------------------------------------------

/**
 * The mottle in the grass: the only thing between the middle of this island and one flat green.
 *
 * Three unrelated swells — the trick the ocean's shader and a floe's snow relief both use — with the
 * amplitudes summing to one so the result lands in 0–1 without a clamp. The third is the one that
 * reads: its wavelength is under eight metres, about what a child sees while walking, where the
 * first two are the broad "this side of the island is darker" that only shows from the air.
 */
function mottle(x: number, z: number): number {
	const n =
		0.42 * Math.sin(x * 0.13 + 1.7) * Math.cos(z * 0.11 + 0.4) +
		0.3 * Math.sin(x * 0.31 + 3.1) * Math.cos(z * 0.27 + 2.2) +
		0.28 * Math.sin(x * 0.83 + 0.6) * Math.cos(z * 0.71 + 4.4);
	return (n + 1) / 2;
}

/** A path, as the two ends of a straight walk. Painted, never built — see `pathLines`. */
interface Walk {
	from: Vec2;
	to: Vec2;
}

/**
 * The paths, from the square to each of the four places you can walk to.
 *
 * Vertex COLOUR on the terrain rather than geometry, which makes them free: no draw call, no mesh,
 * and nothing to keep at the right height over a hill. They are also the strongest piece of
 * navigation on the island — a child standing on the Rathausplatz sees four trodden lines leaving
 * it, and following one is a decision that needs no words on any sign.
 *
 * Read out of `ISLAND_ZONES`, so a zone that moves takes its path with it.
 */
function pathLines(): Walk[] {
	const square = ISLAND_ZONES[0];
	if (!square) return [];
	return ISLAND_ZONES.slice(1).map((zone) => ({ from: square.at, to: zone.at }));
}

/**
 * How high the bunting poles stand and how far the line sags between them, in metres.
 *
 * Both were raised for the same reason the plaza's inlay was de-saturated: **screen height is not
 * world height.** At 3.3 m with 0.85 of sag the line hung at 2.45 in the middle — comfortably over a
 * 1.70 m penguin's head in the world, and straight across its chest on the screen, because the span
 * behind the player draws higher than the player does at a 27° camera. Measured: the string landed
 * at 4.8° up the frame against a chest at 3.4°.
 *
 * At 4.2 with half a metre of sag the low point is 3.7 m, which projects at 11.5° — clear of the
 * head at 6.5° with room for the pennants hanging under it. The square is where a child spends their
 * first ten seconds and a string across the one thing they are looking at reads as unfinished.
 */
const BUNTING_POLE = 4.2;
const BUNTING_SAG = 0.5;

/** How wide a path is either side of its line, in metres, and how far it takes to fade out. */
const PATH_HALF = 1.5;
const PATH_FADE = 1.1;

/**
 * How far this spot is from a line between two points, in metres.
 *
 * Written once because two unrelated things need it — how much path is painted here, and whether a
 * fir tree is growing through the gondola's cable — and the second one used to be an axis test that
 * quietly stopped working the moment the cable was given a lateral offset.
 */
function toSegment(x: number, z: number, from: Vec2, to: Vec2): number {
	const dx = to.x - from.x;
	const dz = to.z - from.z;
	const span = dx * dx + dz * dz;
	if (span <= 0) return Math.hypot(x - from.x, z - from.z);
	const t = Math.max(0, Math.min(1, ((x - from.x) * dx + (z - from.z) * dz) / span));
	return Math.hypot(x - (from.x + dx * t), z - (from.z + dz * t));
}

/** How much path is on this spot, 0–1. */
function pathAt(x: number, z: number, walks: readonly Walk[]): number {
	let most = 0;
	for (const walk of walks) {
		const away = toSegment(x, z, walk.from, walk.to);
		most = Math.max(most, 1 - ramp(PATH_HALF, PATH_HALF + PATH_FADE, away));
	}
	return most;
}

/**
 * What colour the ground is here.
 *
 * The order is the order the eye reads it in: grass, the paths worn into it, the beach as the land
 * runs out, the snow on whatever is high enough, then the water darkening whatever is under it.
 * Snow before the waterline because the two never meet — the mountain is 34 m inland — and putting
 * it last would mean a wet white summit the day one ever did.
 */
function groundColour(x: number, y: number, z: number, r: number, walks: readonly Walk[]): number {
	let colour = mix(GRASS_LOW, GRASS_HIGH, mottle(x, z));
	colour = mix(colour, PATH, pathAt(x, z, walks) * 0.85);
	colour = mix(colour, GRASS_DRY, ramp(46, 52, r));
	colour = mix(colour, SAND_DRY, ramp(51, 55.5, r));
	colour = mix(colour, SNOW_EDGE, ramp(SNOW_FROM, SNOW_FROM + 1.1, y));
	colour = mix(colour, SNOW_TOP, ramp(SNOW_FROM + 0.9, SNOW_FULL, y));
	colour = mix(colour, SAND_WET, ramp(SEA_LEVEL + 0.42, SEA_LEVEL - 0.1, y));
	colour = mix(colour, SAND_DEEP, ramp(SEA_LEVEL - 0.15, SEA_LEVEL - 1.1, y));
	return colour;
}

// ---------------------------------------------------------------------------
// The landmarks
// ---------------------------------------------------------------------------

/** Where a landmark builder puts its shapes, and what it may ask about the ground. */
interface Kit {
	/** Rounded things: trees, domes, roofs, ropes, paving. Smooth-shaded. */
	soft: Piece[];
	/** Things with corners: rock, crates, planks, posts. Faceted, and here that is the point. */
	crags: Piece[];
	/** The wet ice of the rink. Phong. */
	sheen: Piece[];
	/** Holes. Unlit, because a lit hole is a grey circle. */
	voids: Piece[];
	groundAt(x: number, z: number): number;
	standOn(x: number, z: number, span?: number): number;
	/** The HIGHEST ground within `span`. What a thing on legs has to clear. See `buildGondolaStation`. */
	crownOf(x: number, z: number, span: number): number;
	rand(): number;
}

type Landmark = (kit: Kit, zone: IslandZone, floe: Floe) => void;

/**
 * One builder per zone id.
 *
 * Keyed by the simulation's id rather than by an index, because `ISLAND_ZONES` is a list somebody
 * will one day reorder and a landmark following the order would silently swap the shop with the
 * cave. The ids are documented as wire values in `sim/island.ts`, which makes them exactly the right
 * thing to key on.
 */
const FURNITURE: Record<string, Landmark> = {
	square: dressSquare,
	arena: dressArena,
	mountain: dressMountain
};

/**
 * One builder per SOLID thing, keyed by the simulation's obstacle id.
 *
 * Keyed by id rather than by index or by zone, because `ISLAND_OBSTACLES` is derived — each building
 * sits at `zone.at + bearing × (zone.radius + its own radius + gap)`, so moving a zone moves its
 * building and nothing here has to be told. The ids are documented as wire values in `sim/island.ts`,
 * which makes them the right thing to key on and the wrong thing to guess.
 */
const BUILDINGS: Record<string, (kit: Kit, at: Obstacle, floe: Floe) => void> = {
	rathaus: buildRathaus,
	bootshaus: buildBoathouse,
	gondel: buildGondolaStation,
	hoehle: buildCaveRock,
	laden: buildShop
};

/**
 * Which way a building faces: at its own doorstep.
 *
 * Every building is placed on a bearing OUT from the zone it belongs to, so the zone is always
 * between it and the rest of the island — which makes "face the zone" and "face the way you are
 * approached" the same sentence. Trap 17 charged the sea lion two rounds of modelling for a face the
 * camera could never reach; this is that lesson as one line every building calls.
 */
function facingIts(zone: IslandZone | undefined, at: Vec2): number {
	if (!zone) return 0;
	return Math.atan2(zone.at.x - at.x, zone.at.z - at.z);
}

/** The zone a building belongs to. */
function zoneOf(building: Obstacle): IslandZone | undefined {
	return ISLAND_ZONES.find((zone) => zone.id === building.of);
}

/**
 * The Rathausplatz: paving, a ring of bunting, four benches and a bandstand off the south-west side.
 *
 * Two facts from the simulation shape all of it. `spawnOnTheIsland` stands everybody on a ring at 60%
 * of the square's radius facing the middle, so that annulus and the middle itself are kept CLEAR — a
 * bandstand at the centre is a bandstand the solo player spawns inside, and the middle is what the
 * whole field is looking at in the first frame. And the square's radius is what opens the Royal, so
 * the bunting poles stand on exactly that circle: the edge of the place is drawn where the edge of
 * the place is.
 */
function dressSquare(kit: Kit, zone: IslandZone): void {
	const { x, z } = zone.at;

	// The paving, and the shape of the bug it replaces is worth keeping written down.
	//
	// **Twenty teal spikes radiated out of the player's feet, and it was a colour function.** The
	// first version was one `RingGeometry(0.001, …)` painted by a function that asked for the ANGLE
	// — a compass star in the middle of the square. A ring built with an inner radius of a millimetre
	// has a whole ring of vertices sitting on the same point, one per segment, and every one of them
	// has a different `atan2`: the same spot on the ground was asked for seventy-three different
	// colours, and the triangles fanned each of them outward. It rendered exactly as specified and
	// looked like a broken decal.
	//
	// It is the family CLAUDE.md already records twice — an object placed against an origin that is
	// not a place — with the twist that here the origin is not a position but an ANGLE. At r = 0 the
	// angle does not name anywhere, so a colour that depends on it cannot be a colour.
	//
	// The rule that comes out of it: **geometry decides edges, colour only decides tone.** So the
	// paving is a plug and a ring, both painted by RADIUS alone, and the two markings on the square
	// are their own rings of vertices, below.
	const base = kit.groundAt(x, z) + PLAZA_LIFT;
	const tone = (px: number, _py: number, pz: number): number =>
		mix(PAVING, PAVING_JOINT, ramp(0, zone.radius, Math.hypot(px - x, pz - z)));

	// A real inner radius, so no two vertices of the ring are coincident. The plug is a fan with one
	// interior vertex and that is safe now: a radius-only colour asks it for exactly one colour.
	const plug = new CircleGeometry(1.4, 96);
	plug.rotateX(-Math.PI / 2);
	plug.translate(x, base, z);
	kit.soft.push({ geometry: plug, colour: tone });

	const paving = new RingGeometry(1.4, zone.radius + 0.25, 96, 8);
	paving.rotateX(-Math.PI / 2);
	paving.translate(x, base, z);
	kit.soft.push({ geometry: paving, colour: tone });

	// The kerb. The outer band is the thing the star was reaching for and could not be: from a camera
	// looking down at 27° a teal ring on the ground says "this circle is a place", and unlike a star
	// it is exactly the circle the simulation opens the Royal inside.
	// **No painted kerb at the zone's edge any more, and that is `setDoorGlow`'s doing.** There was a
	// teal band at 8.4–8.9 m here, and the door ring lights at 7.8–9.0 m: the same annulus. A ring
	// that is already drawn cannot light UP — the reviewer read the permanent kerb as the door and
	// could not tell when it came on, which is the whole feature failing quietly. The zone's edge
	// belongs to the door; the floor keeps the courses and the inlay.

	// **The compass rose, and it is the same picture the starburst was trying to draw.**
	//
	// The kerb, the bunting and the benches all ring the EDGE of the square, which left the middle —
	// where the player stands and where the door prompt appears — the blankest area in the frame. It
	// wants a pattern, and a pattern in the middle of a disc is exactly where the last one went
	// wrong, so this one is built the other way round: each spoke is its own SECTOR of geometry with
	// ONE flat colour. A sector has a single interior vertex and a single colour, so there is nothing
	// for an angle to vary across, and no amount of tessellation changes what it draws.
	//
	// The rule from that bug, stated as a shape rather than as a warning: if the picture has edges,
	// the edges are vertices.
	const medallion = new CircleGeometry(PLAZA_HUB, 24);
	medallion.rotateX(-Math.PI / 2);
	medallion.translate(x, kit.groundAt(x, z) + MARK_LIFT, z);
	kit.soft.push({ geometry: medallion, colour: PAVING_INLAY });

	// Courses of paving from the medallion out to the kerb, every other one a shade down. Ring
	// geometry, one flat colour each: no angle is asked for anywhere on this floor, so there is
	// nothing for either of the two previous versions of this pattern to go wrong in.
	const course = (zone.radius - 0.6 - PLAZA_HUB) / PLAZA_COURSES;
	for (let i = 0; i < PLAZA_COURSES; i++) {
		if (i % 2 === 1) continue;
		const band = new RingGeometry(PLAZA_HUB + i * course, PLAZA_HUB + (i + 1) * course, 96, 1);
		band.rotateX(-Math.PI / 2);
		band.translate(x, kit.groundAt(x, z) + MARK_LIFT, z);
		kit.soft.push({ geometry: band, colour: PAVING_COURSE });
	}

	// Bunting: eight poles on the zone's own circle, with a sagging line and pennants between each
	// neighbouring pair. The densest colour on the island, spent on the place a child arrives at.
	const poles = 8;
	const flags = [RED, YELLOW, TEAL, CREAM, PINK];
	const heads: Spot[] = [];
	for (let i = 0; i < poles; i++) {
		const angle = (i / poles) * Math.PI * 2 + 0.2;
		const px = x + Math.sin(angle) * zone.radius;
		const pz = z + Math.cos(angle) * zone.radius;
		const base = kit.standOn(px, pz, 0.2);
		// Barber-striped up its length: two colours out of one piece, which is what vertex colour on
		// a merged mesh buys that a second material cannot afford.
		post(kit.crags, px, pz, base, BUNTING_POLE, 0.11, (_px, py) =>
			Math.floor((py - base) * 3.2) % 2 === 0 ? CREAM : RED
		);
		// A ball on top, because a pole that simply stops is a spike, and nothing a child is meant to
		// like gets a point on it (`docs/ART-DIRECTION.md`).
		const knob = new SphereGeometry(0.17, 10, 8);
		knob.translate(px, base + BUNTING_POLE + 0.06, pz);
		kit.soft.push({ geometry: knob, colour: YELLOW });
		heads.push({ x: px, y: base + BUNTING_POLE - 0.1, z: pz });
	}
	for (let i = 0; i < poles; i++) {
		const a = heads[i];
		const b = heads[(i + 1) % poles];
		if (a && b) bunting(kit, a, b, flags);
	}

	// Four benches, inside the bunting and outside the spawn ring, at bearings chosen to miss all
	// four paths — a bench sitting in the middle of the walk to the shop is a bench in the way.
	for (const angle of [0.75, 2.3, 3.85, 5.9]) {
		bench(kit, x + Math.sin(angle) * 7.6, z + Math.cos(angle) * 7.6, angle + Math.PI);
	}

	// **The bandstand is gone and the Rathaus took its place.** It stood at (−9, −9) with nothing in
	// the simulation under it, so a child walked straight through the one building on the square —
	// and when `ISLAND_OBSTACLES` arrived the square's declared building turned out to be a RATHAUS,
	// at (9.9, 9.9), with nothing drawn on it at all. One hole in the air and one ghost, ten metres
	// apart, on the Rathausplatz. See `buildRathaus`: the mass moved onto the footprint, and the
	// square is called what it is called for a reason.
}

/**
 * Das Rathaus: the town hall the square is named after, and the biggest building on the island.
 *
 * New, and it exists because the simulation asked for it — `ISLAND_OBSTACLES` declares a 3.5 m solid
 * on the square and nothing was drawn on it. A hole in the air on the one place every child arrives
 * at is the worst possible instance of the invisible-wall failure, so this is the first thing built
 * from the list.
 *
 * Two storeys with the upper one stepped in, a clock over the door, and a rounded barrel roof. The
 * clock is the point: it is the one shape on this island that says *civic* rather than *cottage*,
 * and an eight-year-old reads a clock face at a distance no lettering survives.
 */
function buildRathaus(kit: Kit, at: Obstacle, floe: Floe): void {
	const zone = zoneOf(at);
	const facing = facingIts(zone, at.at);
	const ahead = { x: Math.sin(facing), z: Math.cos(facing) };
	const base = kit.standOn(at.at.x, at.at.z, at.radius * 0.8);
	// Sized FROM the footprint rather than beside it: the drawn walls fill the circle the simulation
	// stops a penguin at, so the building is exactly as big as it is solid.
	// **Sized down hard, because of where the simulation puts it.** `ISLAND_OBSTACLES` derives this
	// footprint to (9.9, 9.9), which is 12.7 m from the camera at a child's spawn — and the first
	// version stood 7.8 m to the flag over a 5.1 m frontage, so it filled the right third of the
	// opening frame and read as a wall. The footprint is not mine to move; the height is. Ridge at
	// 4.7 m and flag at 6.1, against a 1.70 m penguin: still the biggest building on the island, and
	// no longer the biggest thing on the screen.
	const wide = at.radius * 1.3;
	const deep = at.radius * 1.1;

	const ground = new BoxGeometry(wide, 2.35, deep);
	ground.rotateY(facing);
	ground.translate(at.at.x, base + 1.175, at.at.z);
	kit.crags.push({
		geometry: ground,
		colour: (px, _py, pz) => (Math.floor((px + pz) * 1.4) % 2 === 0 ? CREAM : 0xe9dfc8),
		groundY: base
	});
	// The upper storey, stepped in — which is what turns a box into a building with a shape.
	const upper = new BoxGeometry(wide * 0.78, 1.45, deep * 0.8);
	upper.rotateY(facing);
	upper.translate(at.at.x, base + 3.1, at.at.z);
	kit.crags.push({ geometry: upper, colour: 0xe9dfc8 });

	const eaves = base + 3.85;
	const roof = barrelRoof(wide * 0.92, deep * 0.52, 0.85, eaves);
	roof.rotateY(facing);
	roof.translate(at.at.x, 0, at.at.z);
	kit.soft.push({
		geometry: roof,
		colour: (_px, py) => mix(RED_DARK, RED, ramp(eaves, eaves + 0.85, py))
	});
	// A canopy over the lower storey, so the two steps read as deliberate rather than as a stack.
	const brim = new BoxGeometry(wide + 0.5, 0.16, deep + 0.5);
	brim.rotateY(facing);
	brim.translate(at.at.x, base + 2.4, at.at.z);
	kit.crags.push({ geometry: brim, colour: RED_DARK });

	const face = (out: number, up: number) => ({
		x: at.at.x + ahead.x * out,
		y: base + up,
		z: at.at.z + ahead.z * out
	});
	// The clock. A pale disc with two hands, and it is the whole reason this reads as a town hall —
	// but it was mounted at the GROUND storey's depth and at the UPPER storey's height, so it stood
	// 48 cm proud of the wall behind it and read on screen as a grey box floating beside the
	// building. Two boxes of different depths is two faces to mount things on, and the one you want
	// is the one at the same height. Both numbers come off `upper` now, so they cannot disagree.
	const dial = face(deep * 0.8 * 0.5 + 0.06, 3.05);
	const plate = new CylinderGeometry(0.62, 0.62, 0.12, 20);
	plate.rotateX(Math.PI / 2);
	plate.rotateY(facing);
	plate.translate(dial.x, dial.y, dial.z);
	kit.soft.push({ geometry: plate, colour: CREAM });
	const rim = new CylinderGeometry(0.72, 0.72, 0.08, 20);
	rim.rotateX(Math.PI / 2);
	rim.rotateY(facing);
	rim.translate(dial.x - ahead.x * 0.02, dial.y, dial.z - ahead.z * 0.02);
	kit.soft.push({ geometry: rim, colour: TEAL_DARK });
	for (const [len, turn, thick] of [
		[0.44, 0.6, 0.07],
		[0.3, 2.6, 0.09]
	] as const) {
		const hand = new BoxGeometry(thick, len, 0.06);
		hand.translate(0, len / 2, 0);
		hand.rotateZ(turn);
		hand.rotateY(facing);
		hand.translate(dial.x + ahead.x * 0.07, dial.y, dial.z + ahead.z * 0.07);
		kit.crags.push({ geometry: hand, colour: 0x2a3542 });
	}

	// The door, and two windows either side of it. Unlit, like every other opening on this island.
	const door = face(deep * 0.5 + 0.05, 1.0);
	const doorway = new BoxGeometry(1.25, 2.1, 0.1);
	doorway.rotateY(facing);
	doorway.translate(door.x, door.y, door.z);
	kit.voids.push({ geometry: doorway, colour: 0x2b2233 });
	const arch = new CylinderGeometry(0.66, 0.66, 0.1, 16, 1, false, 0, Math.PI);
	arch.rotateX(Math.PI / 2);
	arch.rotateY(facing);
	arch.translate(door.x, base + 2, door.z);
	kit.voids.push({ geometry: arch, colour: 0x2b2233 });
	for (const side of [-1.55, 1.55]) {
		const across = { x: ahead.z, z: -ahead.x };
		const glass = new BoxGeometry(0.85, 1, 0.1);
		glass.rotateY(facing);
		glass.translate(door.x + across.x * side, base + 1.5, door.z + across.z * side);
		kit.voids.push({ geometry: glass, colour: 0x22303c });
	}
	// A flag on the ridge. The tallest thing on the square, and how you find it from the far side.
	const mast = base + 4.75;
	post(kit.crags, at.at.x, at.at.z, mast, 1.35, 0.08, CREAM);
	for (let i = 0; i < 2; i++) {
		const flag = new BoxGeometry(0.9, 0.42, 0.05);
		flag.rotateY(facing + Math.PI / 2);
		flag.translate(at.at.x + 0.48, mast + 1.18 - i * 0.42, at.at.z);
		kit.crags.push({ geometry: flag, colour: i === 0 ? RED : TEAL });
	}
	// Two lamps flanking the steps, and a step to arrive on.
	const stoop = face(deep * 0.5 + 0.8, 0);
	const step = new BoxGeometry(2.4, 0.22, 1.1);
	step.rotateY(facing);
	step.translate(stoop.x, base + 0.11, stoop.z);
	kit.crags.push({ geometry: step, colour: PAVING_COURSE, groundY: base });
	void floe;
}

/**
 * Das Bootshaus: the shed beside the Eisarena, and the second building the list asked for.
 *
 * It stands where the pier used to run straight through — `ISLAND_OBSTACLES` puts a 2.2 m solid at
 * the rink's seaward side, and the boardwalk was drawn along z = 0 through the middle of it. Both
 * halves of that are fixed here and in `dressArena`: the shed is drawn, and the walk goes round.
 */
function buildBoathouse(kit: Kit, at: Obstacle, floe: Floe): void {
	const facing = facingIts(zoneOf(at), at.at);
	const base = kit.standOn(at.at.x, at.at.z, at.radius * 0.8);
	const wide = at.radius * 1.5;
	const deep = at.radius * 1.25;

	const walls = new BoxGeometry(wide, 2.3, deep);
	walls.rotateY(facing);
	walls.translate(at.at.x, base + 1.15, at.at.z);
	kit.crags.push({
		geometry: walls,
		// Planked, and in the arena's teal so the two read as one place from across the island.
		colour: (px, _py, pz) => (Math.floor((px + pz) * 2.4) % 2 === 0 ? TEAL : TEAL_DARK),
		groundY: base
	});
	const eaves = base + 2.3;
	const roof = barrelRoof(wide + 0.5, deep * 0.6, 0.85, eaves);
	roof.rotateY(facing);
	roof.translate(at.at.x, 0, at.at.z);
	kit.soft.push({
		geometry: roof,
		colour: (_px, py) => mix(RED_DARK, RED, ramp(eaves, eaves + 0.85, py))
	});
	// The big opening a boat comes out of, facing the rink.
	const ahead = { x: Math.sin(facing), z: Math.cos(facing) };
	const mouth = new BoxGeometry(wide * 0.6, 1.7, 0.1);
	mouth.rotateY(facing);
	mouth.translate(at.at.x + ahead.x * (deep * 0.5), base + 0.85, at.at.z + ahead.z * (deep * 0.5));
	kit.voids.push({ geometry: mouth, colour: 0x1d2630 });
	crate(kit, at.at.x - ahead.x * 2.1, at.at.z - ahead.z * 2.1, 0.8, 0.5);
	barrel(kit, at.at.x - ahead.x * 1.6 + ahead.z * 1.9, at.at.z - ahead.z * 1.6 - ahead.x * 1.9);
	void floe;
}

/**
 * Die Eisarena: a rink of frozen water inside a boarding of posts and rope, with a boardwalk running
 * east to the shore.
 *
 * The boardwalk is planks LYING ON the ground rather than a deck on stilts, and that is not
 * laziness. Nothing on this island is collided with — the simulation knows a floe's radius and its
 * hills and nothing else — so a raised jetty is a jetty a child walks through at knee height. Flat
 * planks with posts and rope beside them read as the same object and are honest about what they are.
 * It stops at the last dry sand for the same reason: a pier whose end nobody can reach is an
 * invisible wall with planks on it.
 */
function dressArena(kit: Kit, zone: IslandZone, floe: Floe): void {
	const { x, z } = zone.at;
	const rink = zone.radius * 0.92;

	const ice = new CircleGeometry(rink, 48);
	ice.rotateX(-Math.PI / 2);
	ice.translate(x, kit.groundAt(x, z) + 0.02, z);
	kit.sheen.push({
		geometry: ice,
		colour: (px, _py, pz) => mix(RINK, RINK_EDGE, ramp(0.55, 1, Math.hypot(px - x, pz - z) / rink))
	});

	// Posts and rope all the way round, which is the silhouette a child reads as "a place with an
	// edge to it". Sixteen: fewer and the rope sags into the rink between them.
	const posts = 16;
	const heads: Spot[] = [];
	for (let i = 0; i < posts; i++) {
		const angle = (i / posts) * Math.PI * 2;
		const px = x + Math.sin(angle) * (rink + 0.5);
		const pz = z + Math.cos(angle) * (rink + 0.5);
		const base = kit.standOn(px, pz, 0.2);
		post(kit.crags, px, pz, base, 1.05, 0.1, WOOD);
		const cap = new SphereGeometry(0.14, 8, 6);
		cap.translate(px, base + 1.06, pz);
		kit.soft.push({ geometry: cap, colour: TEAL });
		heads.push({ x: px, y: base + 0.92, z: pz });
	}
	for (let i = 0; i < posts; i++) {
		const a = heads[i];
		const b = heads[(i + 1) % posts];
		if (a && b) rope(kit.soft, a, b, 0.14, 0.045, WOOD_DARK);
	}

	// **How far east it runs is READ, not typed** — and typing it was a real bug. The count was 12 and
	// the bollards were 18.4 m out, which put the last plank's far corner at 58.1 m and both mooring
	// posts at 57.9 m on a shore that holds the player at 56.8. So the end of the pier stood past the
	// last place a child can walk, and `standOn` — which honestly reports the ground, beach drop and
	// all — took it down the sand with it. That is the pier's own stated rule broken by its own
	// arithmetic: a jetty whose end nobody can reach is an invisible wall with planks on it.
	//
	// Walked out instead, one plank at a time, while the plank's FAR CORNER is still on dry sand.
	const hold = floe.radius - ISLAND_SHORE_MARGIN;
	const reach = hold - PIER_MARGIN;
	// **And it goes ROUND the boathouse.** The walk used to run along the zone's own axis, which is
	// exactly where `ISLAND_OBSTACLES` then put a 2.2 m shed: the pier went through the middle of a
	// solid building, so a child following the planks walked into a wall standing on the planks. The
	// offset is derived from that footprint rather than chosen, so a shed that moves takes the walk
	// with it instead of eating it.
	const shed = ISLAND_OBSTACLES.find((building) => building.of === zone.id);
	const clear = shed ? shed.radius + PIER_CLEAR : 0;
	const walk = z - clear;
	const planks: number[] = [];
	for (let px = x + rink + 1.4; Math.hypot(px + 0.65, Math.abs(walk) + 1.2) < reach; px += 1.5) {
		planks.push(px);
	}

	planks.forEach((px, i) => {
		const base = kit.standOn(px, walk, 1.2);
		const plank = new BoxGeometry(1.3, 0.12, 2.4);
		plank.rotateY(0.02 * (i % 3) - 0.02);
		plank.translate(px, base + 0.09, walk);
		kit.crags.push({ geometry: plank, colour: i % 2 === 0 ? WOOD : WOOD_PALE, groundY: base });
	});
	// Two mooring posts and a rope between them at the end of it, which is what makes a line of
	// planks a jetty rather than a garden path. Just past the last plank, and still on dry sand.
	const endX = (planks[planks.length - 1] ?? x + rink) + 1.3;
	const bollards: Spot[] = [];
	for (const side of [-1.5, 1.5]) {
		const base = kit.standOn(endX, walk + side, 0.3);
		post(kit.crags, endX, walk + side, base, 1.5, 0.16, WOOD_DARK);
		const cap = new SphereGeometry(0.2, 8, 6);
		cap.translate(endX, base + 1.52, walk + side);
		kit.soft.push({ geometry: cap, colour: WOOD_PALE });
		bollards.push({ x: endX, y: base + 1.3, z: walk + side });
	}
	const [left, right] = bollards;
	if (left && right) rope(kit.soft, left, right, 0.3, 0.05, WOOD_DARK);
	crate(kit, endX - 1.4, walk - 2.2, 0.8, 0.4);

	// A mast with pennants, so the arena has something above head height. Everything else here is a
	// metre tall and the zone is 34 m from the square: without this it has no silhouette at all.
	const mx = x + 3.4;
	const mz = z + 5;
	const mast = kit.standOn(mx, mz, 0.3);
	post(kit.crags, mx, mz, mast, 5.6, 0.13, CREAM);
	for (let i = 0; i < 3; i++) {
		const flag = new BoxGeometry(1.05, 0.5, 0.06);
		flag.translate(mx + 0.55, mast + 5.3 - i * 0.55, mz);
		kit.crags.push({ geometry: flag, colour: [TEAL, CREAM, RED][i] ?? TEAL });
	}
}

/**
 * Der Berg's summit, and everything on it is small ON PURPOSE.
 *
 * The peak has no declared footprint, so anything built here is something a child walks through. The
 * station moved to the one place the simulation does declare — `buildGondolaStation`, on the
 * hillside below — and what is left at the top is a cairn, some rock and some snow: props at the
 * scale of the benches and crates everywhere else, where walking through is forgivable because
 * nothing about them says "wall".
 *
 * They are still doing a job. A six-metre mound with nothing on it is a bump; a mound with bare rock
 * breaking through its snow and a cairn on the crest is a SUMMIT, and that is most of what the Berg
 * has to say until it is allowed to be ultra-high.
 */
function dressMountain(kit: Kit, zone: IslandZone): void {
	const { x, z } = zone.at;

	// A cairn on the crest. The one built thing at the top, and it is a heap of stones — which is
	// what people actually put on summits, and which cannot be mistaken for a building.
	const stones = 5;
	for (let i = 0; i < stones; i++) {
		const up = i / stones;
		const size = 0.52 - up * 0.3;
		const angle = i * 2.1;
		const px = x + Math.sin(angle) * up * 0.28;
		const pz = z + Math.cos(angle) * up * 0.28;
		const ground = kit.standOn(x, z, 0.6);
		const stone = new IcosahedronGeometry(size, 1);
		stone.scale(1.2, 0.72, 1.1);
		stone.rotateY(angle);
		stone.translate(px, ground + 0.22 + up * 1.5, pz);
		kit.crags.push({
			geometry: stone,
			colour: (_px, py) => alongStops(ROCK_STOPS, (py - ground) / 2.2),
			groundY: i === 0 ? ground : undefined
		});
	}

	// Rock breaking through the snow on the flanks. Placed by bearing so it rings the summit rather
	// than clustering, and only where the snow line already is — below it they would be boulders in
	// a meadow.
	for (let i = 0; i < 9; i++) {
		const angle = (i / 9) * Math.PI * 2 + 0.4;
		const away = 3.2 + (i % 3) * 1.9;
		const px = x + Math.sin(angle) * away;
		const pz = z + Math.cos(angle) * away;
		const ground = kit.standOn(px, pz, 0.7);
		const size = 0.55 + (i % 4) * 0.22;
		const crag = new IcosahedronGeometry(size, 1);
		crag.scale(1.3, 0.85, 1);
		crag.rotateY(angle * 1.7);
		crag.translate(px, ground + size * 0.4, pz);
		kit.crags.push({
			geometry: crag,
			colour: (_px, py) => alongStops(ROCK_STOPS, (py - ground) / (size * 1.7)),
			groundY: ground
		});
	}

	// And drifts of snow between them, so the white on the summit has a shape rather than being the
	// terrain's own colour ramp and nothing else.
	for (let i = 0; i < 7; i++) {
		const angle = (i / 7) * Math.PI * 2 + 1.9;
		const away = 1.8 + (i % 3) * 2.2;
		const px = x + Math.sin(angle) * away;
		const pz = z + Math.cos(angle) * away;
		const ground = kit.groundAt(px, pz);
		const drift = new SphereGeometry(1.1 + (i % 3) * 0.5, 14, 9);
		drift.scale(1, 0.2, 0.75);
		drift.rotateY(angle);
		drift.translate(px, ground + 0.04, pz);
		kit.soft.push({ geometry: drift, colour: SNOW_TOP, groundY: ground });
	}
}

/**
 * Die Robbenhöhle: a rock with a hole in it, and the hole faces the island.
 *
 * NORTH, back toward the square, because the rock is declared on a bearing OUT from its own zone —
 * so the doorstep is always between it and the rest of the island, and the mouth has to look at the
 * doorstep or it is a boulder. Trap 17 on a smaller object.
 *
 * **The mass is fitted to `at.radius` rather than chosen.** It was four hand-placed lumps spanning
 * about eleven metres at (0, 36.6); the simulation declares three metres at (0, 43.5). Drawn as it
 * was, two thirds of the rock was scenery a child walks through and the solid third was somewhere
 * else entirely.
 */
function buildCaveRock(kit: Kit, at: Obstacle, floe: Floe): void {
	const facing = facingIts(zoneOf(at), at.at);
	const ahead = { x: Math.sin(facing), z: Math.cos(facing) };
	const across = { x: ahead.z, z: -ahead.x };

	// Four lumps rather than one: a single icosahedron is a die, and a cave is a heap of rock that
	// happens to have a gap in it. Every offset is a FRACTION of the declared radius, so the drawn
	// heap grows and shrinks with the thing a penguin actually bumps into.
	const lumps: [number, number, number, number][] = [
		[0, 0.1, 1, 1],
		[-0.95, -0.25, 0.68, 0.85],
		[0.98, -0.15, 0.62, 0.8],
		[0.1, 0.85, 0.55, 0.7]
	];
	for (const [side, out, scale, squash] of lumps) {
		const px = at.at.x + across.x * side * at.radius + ahead.x * out * at.radius;
		const pz = at.at.z + across.z * side * at.radius + ahead.z * out * at.radius;
		const size = at.radius * scale;
		const ground = kit.standOn(px, pz, size * 0.6);
		const lump = new IcosahedronGeometry(size, 1);
		lump.scale(1.12, squash * 1.35, 1.05);
		lump.rotateY(side + out);
		lump.translate(px, ground + size * squash * 0.95, pz);
		kit.crags.push({
			geometry: lump,
			colour: (_px, py) => alongStops(ROCK_STOPS, (py - ground) / (size * 2.2)),
			groundY: ground
		});
	}

	// The mouth: a dark tunnel driven into the face the doorstep is on, most of it inside the rock
	// and the last three quarters of a metre standing proud. A closed cylinder rather than a disc on
	// the surface, because a flat dark ellipse pasted on a faceted rock is a sticker — and because a
	// closed primitive cannot be wound the wrong way round.
	const mx = at.at.x + ahead.x * at.radius * 0.55;
	const mz = at.at.z + ahead.z * at.radius * 0.55;
	const ground = kit.standOn(mx, mz, 1.4);
	const tunnel = new CylinderGeometry(1.35, 1.35, 3.2, 18);
	tunnel.rotateX(Math.PI / 2);
	tunnel.scale(1, 1.15, 1);
	tunnel.rotateY(facing);
	tunnel.translate(mx, ground + 1.3, mz);
	kit.voids.push({
		geometry: tunnel,
		colour: (_px, py) => (py > ground + 2 ? 0x1c2130 : 0x0f1219)
	});

	// Crates outside it: this is where the Super-Robbe keeps what you are about to steal, and no word
	// on a sign says it faster. Placed on the doorstep side, where a child arriving actually looks.
	const out = (f: number, side: number) => ({
		x: at.at.x + ahead.x * at.radius * f + across.x * side,
		z: at.at.z + ahead.z * at.radius * f + across.z * side
	});
	const a = out(1.35, -1.9);
	const b = out(1.7, -1.1);
	const c = out(1.4, 2);
	crate(kit, a.x, a.z, 0.9, 0.35);
	crate(kit, b.x, b.z, 0.75, 1.1);
	crate(kit, c.x, c.z, 0.85, -0.4);
	const drum = out(1.9, 2.6);
	barrel(kit, drum.x, drum.z);

	// A lamp at the mouth: the one warm light in the darkest corner of the island.
	const lamp = out(1.25, -2.9);
	const lampBase = kit.standOn(lamp.x, lamp.z, 0.25);
	post(kit.crags, lamp.x, lamp.z, lampBase, 2.6, 0.09, WOOD_DARK);
	const bulb = new SphereGeometry(0.3, 10, 8);
	bulb.translate(lamp.x, lampBase + 2.62, lamp.z);
	kit.soft.push({ geometry: bulb, colour: YELLOW });
	void floe;
}

/**
 * Der Laden: a hut with a striped awning, a counter and a hat over the door.
 *
 * The sign carries a SHAPE and not a word — a bobble hat, which is what the shop sells. Invariant 4
 * forbids free text between players; this is the same discipline applied to the world, and it is
 * also the only version an eight-year-old reads at a glance.
 *
 * The whole building is turned to face the square, because that is where everybody comes from and
 * therefore where the camera is when the shop is approached (trap 17).
 */
function buildShop(kit: Kit, at: Obstacle, floe: Floe): void {
	const { x, z } = at.at;
	// Facing its own doorstep, which is also where the camera is when a child walks up to it — the
	// two are the same sentence because every building sits on a bearing OUT from its zone.
	const facing = facingIts(zoneOf(at), at.at);
	const ahead = { x: Math.sin(facing), z: Math.cos(facing) };
	const across = { x: ahead.z, z: -ahead.x };
	const place = (forward: number, side: number) => ({
		x: x + ahead.x * forward + across.x * side,
		z: z + ahead.z * forward + across.z * side
	});

	// **Sized against its own declared footprint**, which is the rule every building on this island
	// now follows: 2.4 m of radius, so 3.8 by 2.8 of hut fills the circle a penguin is stopped at.
	//
	// It has moved as well, and that fixed a second thing for free. It used to be drawn on its ZONE at
	// (−16, 8) — 18.8 m from the opening camera at the widest part of a 106° frame, where the reviewer
	// kept reading its red roof as a wall clipping the left edge. Its footprint is at (−23.1, 11.5),
	// five metres further out, because a building sits BEHIND the doorstep you approach it from.
	const base = kit.standOn(x, z, at.radius * 0.9);
	const hut = new BoxGeometry(3.8, 2.4, 2.8);
	hut.rotateY(facing);
	hut.translate(x, base + 1.2, z);
	kit.crags.push({
		geometry: hut,
		colour: (px, _py, pz) => (Math.floor((px + pz) * 2.2) % 2 === 0 ? TEAL : TEAL_DARK),
		groundY: base
	});

	// The hut is 2.8 m deep and 2.4 m tall, so the roof is 3.4 m across and rises 0.9. It was a 5 m
	// circle standing 2.5 m proud of a building half its height — the mushroom the bandstand already
	// taught, made twice.
	const roof = barrelRoof(4.3, 1.7, 0.9, base + 2.4);
	roof.rotateY(facing);
	roof.translate(x, 0, z);
	kit.soft.push({
		geometry: roof,
		colour: (_px, py) => mix(RED_DARK, RED, ramp(base + 2.4, base + 3.3, py))
	});

	// The counter window, dark, and the awning over it. A striped awning is the second of the four
	// things `docs/ART-DIRECTION.md` §1 asks for by name, and stripes cost nothing on a merged mesh.
	const front = place(1.42, 0);
	const glass = new BoxGeometry(2.1, 1.1, 0.08);
	glass.rotateY(facing);
	glass.translate(front.x, base + 1.4, front.z);
	kit.voids.push({ geometry: glass, colour: 0x231d2c });

	// The awning projects toward the square — which is toward the CAMERA, because the shop is turned
	// to face where players come from. Every centimetre of projection is a centimetre nearer the lens
	// at the widest part of a 106° frame, so it is the one dimension on this building that had to come
	// down further than the rest: 1.5 m deep reaching 3.1 m out, now 1.1 m reaching 2.4 m.
	const shade = place(1.85, 0);
	const awning = new BoxGeometry(2.9, 0.1, 1.1);
	awning.rotateX(-0.22);
	awning.rotateY(facing);
	awning.translate(shade.x, base + 2.2, shade.z);
	kit.soft.push({
		geometry: awning,
		colour: (px, _py, pz) =>
			Math.floor((px * across.x + pz * across.z) * 1.6) % 2 === 0 ? CREAM : RED
	});
	for (const side of [-1.25, 1.25]) {
		const leg = place(2.3, side);
		post(kit.crags, leg.x, leg.z, kit.standOn(leg.x, leg.z, 0.2), 2, 0.08, WOOD);
	}

	// The sign: a board above the roof with a hat on it, in the round rather than painted on, because
	// a flat picture on a board is invisible from every angle but one.
	const board = new BoxGeometry(2.1, 0.95, 0.14);
	board.rotateY(facing);
	board.translate(x, base + 3.85, z);
	kit.crags.push({ geometry: board, colour: WOOD_PALE });
	for (const side of [-0.75, 0.75]) {
		const leg = place(0, side);
		const strut = new BoxGeometry(0.14, 0.9, 0.14);
		strut.translate(leg.x, base + 3.1, leg.z);
		kit.crags.push({ geometry: strut, colour: WOOD_DARK });
	}
	// The hat is CREAM with a red band now, not solid red. Roof, awning and sign were three red
	// masses stacked on one building — at the edge of the frame that is not a shop, it is a red wall.
	const hat = place(0.14, 0);
	const brim = new CylinderGeometry(0.4, 0.42, 0.14, 12);
	brim.translate(hat.x, base + 3.74, hat.z);
	kit.soft.push({ geometry: brim, colour: RED });
	const crown = new SphereGeometry(0.36, 12, 9, 0, Math.PI * 2, 0, Math.PI / 2);
	crown.translate(hat.x, base + 3.79, hat.z);
	kit.soft.push({ geometry: crown, colour: CREAM });
	const bobble = new SphereGeometry(0.17, 10, 8);
	bobble.translate(hat.x, base + 4.17, hat.z);
	kit.soft.push({ geometry: bobble, colour: TEAL });

	// Stock outside, because a shop with nothing round it is a shed.
	const stack = place(1.6, 2.4);
	const spare = place(1.4, -2.5);
	crate(kit, stack.x, stack.z, 0.85, 0.3);
	crate(kit, stack.x + 0.5, stack.z + 0.9, 0.7, -0.6);
	barrel(kit, spare.x, spare.z);
	// A flower box under the window: the smallest prop on the island and the one that makes it a home.
	const trough = place(1.6, 1.45);
	const troughBase = kit.standOn(trough.x, trough.z, 0.4);
	const planter = new BoxGeometry(1.3, 0.34, 0.5);
	planter.rotateY(facing);
	planter.translate(trough.x, troughBase + 0.17, trough.z);
	kit.crags.push({ geometry: planter, colour: WOOD, groundY: troughBase });
	for (let i = 0; i < 5; i++) {
		const petal = new SphereGeometry(0.13, 8, 6);
		petal.translate(
			trough.x + across.x * (i * 0.28 - 0.56),
			troughBase + 0.42,
			trough.z + across.z * (i * 0.28 - 0.56)
		);
		kit.soft.push({ geometry: petal, colour: [PINK, YELLOW, CREAM, PINK, RED][i] ?? PINK });
	}
	void floe;
}

/**
 * Where the cabin hangs at the station.
 *
 * Derived rather than stored, so the thing that draws the mast and the thing that moves the cabin
 * cannot disagree about where the cable head is. Trap 15 is a parameter accepted and dropped; this is
 * the same defence, one function instead of two copies of an arithmetic.
 */
function cabinDock(kit: Kit, at: Obstacle): Spot {
	const ground = kit.crownOf(at.at.x, at.at.z, at.radius) + STATION_CLEAR;
	return { x: at.at.x, y: ground + STATION_DECK + STATION_MAST - 0.35, z: at.at.z };
}

/**
 * The station's deck: how thick it is, how far it clears the highest ground under it, and how tall
 * the mast over it stands. Metres. The clearance is what makes it a platform and not a slab.
 */
const STATION_DECK = 0.36;
const STATION_CLEAR = 0.55;
/**
 * And the mast is 3.6 rather than 4.6 because **the frame ran out**, which is the constraint this
 * whole landmark lives under and is worth writing down where somebody will raise it again.
 *
 * The camera pitches 27° with a 58° lens, so the TOP EDGE of the frame points only 2.0° above level
 * (`render/camera.ts`, a measured pair). From the square that is a ceiling of 6.36 + distance·tan 2°:
 * 8.50 m out here at 61 m. The station's deck sits at 4.70 on the Berg's flank, so a 4.6 m mast put
 * the cap over its head at 9.00 — half a metre off the top of the screen, and the whole gondola
 * simply vanished from the skyline. 3.4 is the tallest that fits, and it was found by the guard
 * rather than by eye: at 3.6 the yellow cap still cleared the edge by fourteen centimetres.
 *
 * The same ceiling is why there is nothing on the summit: the peak is 6.00 m and the ceiling above it
 * is 8.17, so **anything standing on the Berg has two metres of screen to live in** — and the HUD's
 * button row occupies most of it. That is not a thing art can solve; see the report.
 */
const STATION_MAST = 3.4;

/**
 * Die Gondel's station, drawn on the footprint the simulation declares, with the cabin parked in it.
 *
 * **There is deliberately no cable, and that is the honest state of this landmark.** The gondola is
 * meant to be a RIDE up an ultra-high mountain, and the mountain does not exist yet: the Berg is a
 * 6 m `Mound`, and a climbable mound cannot be ultra-high on a 58 m island — `MOUND_MAX_SLOPE` forces
 * a 40 m hill to have a 120 m footprint. Until the simulation declares a massif to hang the top
 * station on, a cable would either end in mid-air or end at a tower a child walks through, and both
 * of those are the invisible-wall failure this whole pass exists to remove.
 *
 * What IS here is complete and true: a boarding deck, a painted mast, the machine housing the cable
 * would run out of, and a cabin hanging in it swaying. A child reading that sees "this is where you
 * get on", which is exactly what the door under their feet is already telling them.
 */
function buildGondolaStation(kit: Kit, at: Obstacle, floe: Floe): void {
	const facing = facingIts(zoneOf(at), at.at);
	const ahead = { x: Math.sin(facing), z: Math.cos(facing) };
	// **On legs, because it is on a hillside.** The ground under this footprint rises two metres from
	// one edge to the other — the station sits on the Berg's own flank — and a flat deck there is
	// buried at the uphill edge or airborne at the downhill one whatever height it is seated at.
	// There is no third answer for a slab. A platform on posts has one: clear the HIGHEST ground and
	// let each leg reach down to its own. That is also what a real mountain station looks like, so
	// the constraint and the picture want the same thing.
	const ground = kit.crownOf(at.at.x, at.at.z, at.radius) + STATION_CLEAR;

	const deck = new CylinderGeometry(at.radius, at.radius + 0.12, STATION_DECK, 14);
	deck.translate(at.at.x, ground + STATION_DECK / 2, at.at.z);
	kit.crags.push({ geometry: deck, colour: WOOD });
	// A leg per sixth of the rim, each standing on the ground it is actually over.
	for (let i = 0; i < 6; i++) {
		const a = (i / 6) * Math.PI * 2 + 0.4;
		const lx = at.at.x + Math.sin(a) * (at.radius - 0.35);
		const lz = at.at.z + Math.cos(a) * (at.radius - 0.35);
		const foot = kit.groundAt(lx, lz) - 0.08;
		post(kit.crags, lx, lz, foot, ground - foot, 0.16, WOOD_DARK);
	}
	// And steps down to the doorstep, which is downhill of it — one tread at a time, each seated
	// against its own ground so the flight follows the slope instead of hanging off the deck.
	for (let i = 0; i < 3; i++) {
		const out = at.radius + 0.45 + i * 0.75;
		const sx = at.at.x + ahead.x * out;
		const sz = at.at.z + ahead.z * out;
		const tread = new BoxGeometry(1.5, 0.2, 0.8);
		tread.rotateY(facing);
		tread.translate(sx, ground - ((i + 1) / 4) * (ground - kit.groundAt(sx, sz)), sz);
		kit.crags.push({ geometry: tread, colour: WOOD_PALE });
	}

	// Banded like the bunting poles: the same paint on the same island, so the tower belongs to the
	// park rather than to a quarry. The first version was bare timber with crossed braces and
	// photographed as an oil derrick.
	post(kit.crags, at.at.x, at.at.z, ground + STATION_DECK, STATION_MAST, 0.24, (_x, py) =>
		Math.floor((py - ground) * 1.1) % 2 === 0 ? CREAM : RED
	);
	const housing = new BoxGeometry(1.2, 0.75, 0.95);
	housing.rotateY(facing);
	housing.translate(at.at.x, ground + STATION_DECK + STATION_MAST - 0.3, at.at.z);
	kit.crags.push({ geometry: housing, colour: RED_DARK });
	const lid = new SphereGeometry(0.7, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2);
	lid.scale(1, 0.42, 0.8);
	lid.translate(at.at.x, ground + STATION_DECK + STATION_MAST + 0.05, at.at.z);
	kit.soft.push({ geometry: lid, colour: YELLOW });

	// A canopy over the platform, because standing in the rain is not what a station is for.
	const eaves = ground + STATION_DECK + 2.5;
	const canopy = barrelRoof(at.radius * 2.1, at.radius * 0.85, 0.7, eaves);
	canopy.rotateY(facing + Math.PI / 2);
	canopy.translate(at.at.x, 0, at.at.z);
	kit.soft.push({
		geometry: canopy,
		colour: (_px, py) => mix(RED_DARK, RED, ramp(eaves, eaves + 0.7, py))
	});
	for (const side of [-1, 1]) {
		const across = { x: ahead.z * at.radius * 0.8, z: -ahead.x * at.radius * 0.8 };
		post(
			kit.crags,
			at.at.x + across.x * side,
			at.at.z + across.z * side,
			ground + STATION_DECK,
			2.2,
			0.1,
			WOOD_PALE
		);
	}
	crate(
		kit,
		at.at.x - ahead.x * (at.radius + 1.4),
		at.at.z - ahead.z * (at.radius + 1.4),
		0.8,
		0.4
	);
	void floe;
}

/**
 * The cabin, as its own mesh — the only object on this island with a matrix that changes.
 *
 * Everything else is merged and frozen, so this is a draw call spent entirely on motion, and it is
 * worth it: a still island reads as a diorama however dense it is, and one moving thing in the
 * distance is what tells a child the place is running.
 */
function buildCabin(): { mesh: Mesh; dispose(): void } {
	const pieces: Piece[] = [];

	const s = CABIN_SIZE;
	const shell = new BoxGeometry(s, s, s);
	shell.translate(0, -s / 2, 0);
	// Cream below, red above, with the band where the windows are. Two colours rather than one is
	// what makes a distant box read as a vehicle instead of as a crate on a wire.
	pieces.push({ geometry: shell, colour: (_x, y) => (y > -s * 0.42 ? RED : CREAM) });
	const lid = new SphereGeometry(s * 0.72, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2);
	lid.scale(1, 0.42, 1);
	pieces.push({ geometry: lid, colour: RED_DARK });
	// Windows on all four sides now, not two. The cabin swings, and a face that is only on the ends
	// is a face the camera spends half the ride behind — the lesson trap 17 charged the sea lion for.
	for (const side of [-1, 1]) {
		const long = new BoxGeometry(0.06, s * 0.42, s * 0.68);
		long.translate((side * s) / 2, -s * 0.36, 0);
		pieces.push({ geometry: long, colour: 0x21313d });
		const end = new BoxGeometry(s * 0.68, s * 0.42, 0.06);
		end.translate(0, -s * 0.36, (side * s) / 2);
		pieces.push({ geometry: end, colour: 0x21313d });
	}
	const hanger = new BoxGeometry(0.16, 0.7, 0.16);
	hanger.translate(0, 0.3, 0);
	pieces.push({ geometry: hanger, colour: YELLOW });
	const grip = new CylinderGeometry(0.2, 0.2, 0.5, 8);
	grip.rotateZ(Math.PI / 2);
	grip.translate(0, 0.62, 0);
	pieces.push({ geometry: grip, colour: WOOD_DARK });

	const material = new MeshLambertMaterial({ vertexColors: true });
	const mesh = bake(pieces, material);
	if (!mesh) throw new Error('the gondola was built with no cabin in it');
	return {
		mesh,
		dispose() {
			mesh.geometry.dispose();
			material.dispose();
		}
	};
}

// ---------------------------------------------------------------------------
// Density: the small things, which is most of what a hub is made of
// ---------------------------------------------------------------------------

/**
 * How much small stuff there is, and it is a lot on purpose.
 *
 * Both reference games are dense with props at a scale below the one the eye is looking at, and that
 * density is what separates "a place people live in" from "a terrain with five buildings on it".
 * None of it costs a draw call — every last tuft is merged into the same two meshes as the landmarks
 * — so the only budget it spends is the one this renderer has spare, which is vertices.
 */
const TUFTS = 150;
const FLOWERS = 55;
const BUSHES = 26;
const TREES = 34;
const ROCKS = 24;
const DRIFTWOOD = 12;

/**
 * Scatter the small things, keeping out of everywhere a person or a landmark already is.
 *
 * Rejection sampling against the zones and the paths, seeded so the island is the same island every
 * time a child opens the game. A hub is a place learned by heart — `sim/island.ts` makes the same
 * argument for hand-placing the hills instead of seeding them — and a fir tree that moved between
 * sessions would undo that on its own.
 */
function dressTheIsland(kit: Kit, floe: Floe, hold: number, walks: readonly Walk[]): void {
	const cx = floe.center.x;
	const cz = floe.center.z;
	// **Every declared building, and not just every zone.** The scatter used to dodge the five zones
	// and two hand-typed spots; `ISLAND_OBSTACLES` now says where the solid things are, so a fir tree
	// growing out of the Rathaus is a thing the list itself prevents. One source, and it grows when
	// the sim's does.
	const keepClear: [number, number, number][] = ISLAND_OBSTACLES.map((building) => [
		building.at.x,
		building.at.z,
		building.radius + BUILDING_ELBOW
	]);

	/** Somewhere with nothing else on it, or null if this draw landed badly. */
	const spot = (from: number, to: number, clear: number, ceiling = SNOW_FROM) => {
		const angle = kit.rand() * Math.PI * 2;
		const away = from + kit.rand() * (to - from);
		const x = cx + Math.sin(angle) * away;
		const z = cz + Math.cos(angle) * away;
		// Never in a zone: a landmark places its own props by hand, and a boulder in the middle of the
		// Rathausplatz is a boulder every player has to walk round.
		for (const zone of ISLAND_ZONES) {
			if (Math.hypot(x - zone.at.x, z - zone.at.z) < zone.radius + clear) return null;
		}
		// Nor on a path — the paths are the one part of the ground that has to stay looking walked on.
		if (pathAt(x, z, walks) > 0.05) return null;
		// Nor on the two things standing on open grass rather than inside a zone. See `BANDSTAND_AT`.
		for (const [bx, bz, room] of keepClear) {
			if (Math.hypot(x - bx, z - bz) < room + clear) return null;
		}
		// Nor above the snow line: grass on a white summit is the one place the palette contradicts
		// itself, and the ground's own colour is what decides where that line is.
		if (kit.groundAt(x, z) > ceiling) return null;
		return { x, z };
	};

	for (let i = 0; i < TUFTS; i++) {
		const at = spot(8, 52, 0.6);
		if (at) tuft(kit, at.x, at.z, 0.9 + kit.rand() * 0.6);
	}
	for (let i = 0; i < FLOWERS; i++) {
		const at = spot(10, 48, 0.8);
		if (!at) continue;
		tuft(kit, at.x, at.z, 0.7);
		const head = new SphereGeometry(0.11, 8, 6);
		head.translate(at.x, kit.groundAt(at.x, at.z) + 0.38, at.z);
		kit.soft.push({ geometry: head, colour: [PINK, YELLOW, CREAM, RED, PINK][i % 5] ?? PINK });
	}
	for (let i = 0; i < BUSHES; i++) {
		const at = spot(12, 50, 1.4);
		if (!at) continue;
		const ground = kit.standOn(at.x, at.z, 0.5);
		for (let lobe = 0; lobe < 2; lobe++) {
			const size = 0.55 + kit.rand() * 0.35;
			const bush = new SphereGeometry(size, 10, 8);
			bush.scale(1.2, 0.8, 1.1);
			bush.translate(
				at.x + (kit.rand() - 0.5) * 0.7,
				ground + size * 0.62,
				at.z + (kit.rand() - 0.5) * 0.7
			);
			kit.soft.push({
				geometry: bush,
				colour: (_px, py) => alongStops(LEAF_STOPS, (py - ground) / 1.4),
				groundY: ground
			});
		}
	}
	for (let i = 0; i < TREES; i++) {
		const at = spot(14, 50, 2.2, SNOW_FROM + 0.6);
		if (!at) continue;
		// The north half, where the mountain is. A hillside with firs on it and an open south side
		// gives the island two different places to be, which an even scatter would not.
		if (at.z > cz + 14) continue;
		tree(kit, at.x, at.z, 2.4 + kit.rand() * 1.8);
	}
	for (let i = 0; i < ROCKS; i++) {
		const at = spot(12, 53, 1.2, SNOW_FULL);
		if (!at) continue;
		const size = 0.35 + kit.rand() * 0.5;
		const ground = kit.standOn(at.x, at.z, size * 0.6);
		// One subdivision: twenty faces is a die and eighty is a stone that has been rained on. The
		// same call `floeField` makes for a pebble, for the same reason.
		const rock = new IcosahedronGeometry(size, 1);
		rock.scale(1, 0.7 + kit.rand() * 0.4, 1);
		rock.rotateY(kit.rand() * Math.PI);
		rock.translate(at.x, ground + size * 0.45, at.z);
		kit.crags.push({
			geometry: rock,
			colour: (_px, py) => alongStops(ROCK_STOPS, (py - ground) / (size * 1.6)),
			groundY: ground
		});
	}
	for (let i = 0; i < DRIFTWOOD; i++) {
		// On the sand, the one band with nothing else in it — and driftwood is what says "this beach
		// is the edge of an island" rather than "the grass stops here".
		const angle = kit.rand() * Math.PI * 2;
		const away = hold - 1.6 - kit.rand() * 3.4;
		const x = cx + Math.sin(angle) * away;
		const z = cz + Math.cos(angle) * away;
		const ground = kit.standOn(x, z, 0.8);
		const lie = kit.rand() * Math.PI;
		const thick = 0.15 + kit.rand() * 0.09;
		// Tapered harder than it was and set at a slight roll, so the silhouette is not a extruded
		// rectangle. Five sides rather than seven: driftwood is split, not turned.
		const log = new CylinderGeometry(thick * 0.55, thick * 1.35, 1.5 + kit.rand() * 1.5, 5);
		log.rotateZ(Math.PI / 2 - 0.1 - kit.rand() * 0.12);
		log.rotateY(lie);
		log.translate(x, ground + thick, z);
		kit.crags.push({
			geometry: log,
			colour: (_px, py) => alongStops(DRIFTWOOD_STOPS, (py - ground) / (thick * 2.2)),
			groundY: ground
		});
		// A stub of a branch on about half of them. One asymmetry is the whole difference between a
		// bar of something and a piece of a tree.
		if (kit.rand() > 0.45) {
			const stub = new CylinderGeometry(0.05, 0.09, 0.55 + kit.rand() * 0.4, 5);
			stub.rotateZ(0.7);
			stub.rotateY(lie + 1.1);
			stub.translate(x + Math.sin(lie) * 0.5, ground + thick * 1.4, z + Math.cos(lie) * 0.5);
			kit.crags.push({
				geometry: stub,
				colour: (_px, py) => alongStops(DRIFTWOOD_STOPS, (py - ground) / (thick * 2.6)),
				groundY: ground
			});
		}
	}
}

// ---------------------------------------------------------------------------
// The pieces everything is built out of
// ---------------------------------------------------------------------------

/** A point in the world. Enough of one for a cable, a rope and the thing hanging off either. */
interface Spot {
	x: number;
	y: number;
	z: number;
}

/** A post standing on the ground: BASE here, not centre — a cylinder's origin is its middle (trap 11). */
function post(
	into: Piece[],
	x: number,
	z: number,
	base: number,
	height: number,
	radius: number,
	colour: Piece['colour']
): void {
	const geometry = new CylinderGeometry(radius * 0.88, radius, height, 8);
	geometry.translate(x, base + height / 2, z);
	into.push({ geometry, colour, groundY: base });
}

/**
 * A barrel roof: a cylinder lying along x with its lower half inside the building.
 *
 * A closed cylinder rather than three's half-cylinder, which is open at the flat face and at both
 * ends — a roof with the sky visible through it is worse than a flat one, and it is the failure that
 * looks like a shading bug rather than like a missing surface (trap 14's family).
 *
 * @param length along the ridge, @param radius across it, @param eaves the y the walls stop at.
 */
function barrelRoof(
	length: number,
	halfWidth: number,
	rise: number,
	eaves: number
): BufferGeometry {
	const roof = new CylinderGeometry(1, 1, length, 16);
	roof.rotateZ(Math.PI / 2);
	// An ELLIPSE in cross-section, and that is the fix rather than a tweak. A cylinder stands its own
	// RADIUS above its centre, so a barrel wide enough to cover a hut is automatically as tall as it
	// is wide: the shop got a five-metre roof on a two-and-a-half-metre building and read as a wall
	// from the edge of the frame, which is the bandstand's mushroom in a second place. Squashing the
	// cross-section is what lets width and height be two decisions.
	roof.scale(1, rise, halfWidth);
	// Centred ON the eaves, so exactly `rise` stands above the walls and the rest is inside them.
	roof.translate(0, eaves, 0);
	return roof;
}

/**
 * A cylinder from one point to another — a cable, a brace, a length of rope.
 *
 * Built along +Y and turned onto the direction, because +Y is the only axis a `CylinderGeometry`
 * knows about. The two rotations are in this order on purpose: `rotateX` then `rotateY` applies
 * `Ry · Rx`, which takes +Y to (sinθ·sinφ, cosθ, sinθ·cosφ) — solve that for the direction and the
 * angles fall out. Reversed, the thing points somewhere else entirely and it looks like a bug in the
 * geometry rather than in the order.
 */
function strut(
	into: Piece[],
	from: Spot,
	to: Spot,
	radius: number,
	colour: Piece['colour'],
	groundY?: number
): void {
	const dx = to.x - from.x;
	const dy = to.y - from.y;
	const dz = to.z - from.z;
	const span = Math.hypot(dx, dy, dz);
	if (span < 1e-4) return;
	const geometry = new CylinderGeometry(radius, radius, span, 6);
	geometry.translate(0, span / 2, 0);
	geometry.rotateX(Math.acos(Math.max(-1, Math.min(1, dy / span))));
	geometry.rotateY(Math.atan2(dx, dz));
	geometry.translate(from.x, from.y, from.z);
	into.push(groundY === undefined ? { geometry, colour } : { geometry, colour, groundY });
}

/** A rope between two points, sagging. Six segments: fewer and a catenary is a bent stick. */
function rope(
	into: Piece[],
	from: Spot,
	to: Spot,
	sag: number,
	radius: number,
	colour: number
): void {
	const steps = 6;
	const at = (t: number): Spot => ({
		x: from.x + (to.x - from.x) * t,
		y: from.y + (to.y - from.y) * t - sag * 4 * t * (1 - t),
		z: from.z + (to.z - from.z) * t
	});
	for (let i = 0; i < steps; i++) strut(into, at(i / steps), at((i + 1) / steps), radius, colour);
}

/** A rope with pennants on it. The cheapest saturated colour there is, and it hangs over the square. */
function bunting(kit: Kit, from: Spot, to: Spot, flags: readonly number[]): void {
	const sag = BUNTING_SAG;
	rope(kit.soft, from, to, sag, 0.03, CREAM);
	const count = 5;
	const yaw = Math.atan2(to.x - from.x, to.z - from.z);
	for (let i = 0; i < count; i++) {
		const t = (i + 0.5) / count;
		// A rounded pennant rather than a triangle: nothing a child is meant to like gets a point on
		// it, and at this size the shape reads entirely from its colour anyway.
		const flag = new BoxGeometry(0.34, 0.42, 0.04);
		flag.rotateY(yaw);
		flag.translate(
			from.x + (to.x - from.x) * t,
			from.y + (to.y - from.y) * t - sag * 4 * t * (1 - t) - 0.24,
			from.z + (to.z - from.z) * t
		);
		kit.crags.push({ geometry: flag, colour: flags[i % flags.length] ?? CREAM });
	}
}

/** A tree: a stubby trunk and three round crowns. Rounded, wide-based, no point at the top. */
function tree(kit: Kit, x: number, z: number, height: number): void {
	const ground = kit.standOn(x, z, 0.4);
	const trunk = new CylinderGeometry(0.13, 0.2, height * 0.3, 7);
	trunk.translate(x, ground + height * 0.15, z);
	kit.crags.push({ geometry: trunk, colour: WOOD_DARK, groundY: ground });
	for (let i = 0; i < 3; i++) {
		const size = height * (0.36 - i * 0.08);
		const crown = new SphereGeometry(size, 10, 8);
		crown.scale(1, 0.82, 1);
		crown.translate(x, ground + height * (0.34 + i * 0.24) + size * 0.4, z);
		kit.soft.push({
			geometry: crown,
			colour: (_px, py) => alongStops(LEAF_STOPS, (py - ground) / height),
			groundY: ground
		});
	}
}

/** Three blades of grass. The smallest thing on the island, and there are a hundred and fifty of them. */
function tuft(kit: Kit, x: number, z: number, size: number): void {
	const ground = kit.groundAt(x, z);
	const colour = mix(GRASS_LOW, GRASS_HIGH, 0.75);
	for (let i = 0; i < 3; i++) {
		const angle = (i / 3) * Math.PI * 2 + kit.rand();
		const blade = new CylinderGeometry(0.015, 0.05, 0.3 * size, 5);
		blade.rotateZ((kit.rand() - 0.5) * 0.7);
		blade.rotateY(angle);
		blade.translate(x + Math.sin(angle) * 0.09, ground + 0.15 * size, z + Math.cos(angle) * 0.09);
		kit.soft.push({ geometry: blade, colour, groundY: ground });
	}
}

/** A bench: a seat, a back and two legs. Facing wherever it is told to. */
function bench(kit: Kit, x: number, z: number, facing: number): void {
	const ground = kit.standOn(x, z, 0.7);
	const seat = new BoxGeometry(1.6, 0.12, 0.5);
	seat.rotateY(facing);
	seat.translate(x, ground + 0.44, z);
	kit.crags.push({ geometry: seat, colour: WOOD_PALE, groundY: ground });
	const back = new BoxGeometry(1.6, 0.42, 0.1);
	back.rotateY(facing);
	back.translate(x - Math.sin(facing) * 0.22, ground + 0.7, z - Math.cos(facing) * 0.22);
	kit.crags.push({ geometry: back, colour: WOOD, groundY: ground });
	for (const side of [-0.62, 0.62]) {
		const leg = new BoxGeometry(0.12, 0.44, 0.12);
		leg.translate(x + Math.cos(facing) * side, ground + 0.22, z - Math.sin(facing) * side);
		kit.crags.push({ geometry: leg, colour: WOOD_DARK, groundY: ground });
	}
}

/** A wooden crate: a box and a lighter lid, so it reads as a container from above. */
function crate(kit: Kit, x: number, z: number, size: number, yaw: number): void {
	const ground = kit.standOn(x, z, size * 0.6);
	const body = new BoxGeometry(size, size * 0.8, size);
	body.rotateY(yaw);
	body.translate(x, ground + size * 0.4, z);
	kit.crags.push({ geometry: body, colour: WOOD, groundY: ground });
	const lid = new BoxGeometry(size * 1.08, size * 0.12, size * 1.08);
	lid.rotateY(yaw);
	lid.translate(x, ground + size * 0.82, z);
	kit.crags.push({ geometry: lid, colour: WOOD_PALE, groundY: ground });
}

/** A barrel: a cylinder with two hoops, because a plain cylinder is a bucket. */
function barrel(kit: Kit, x: number, z: number): void {
	const ground = kit.standOn(x, z, 0.4);
	const body = new CylinderGeometry(0.42, 0.38, 1, 12);
	body.translate(x, ground + 0.5, z);
	kit.crags.push({ geometry: body, colour: WOOD, groundY: ground });
	for (const up of [0.24, 0.76]) {
		const hoop = new CylinderGeometry(0.44, 0.44, 0.1, 12);
		hoop.translate(x, ground + up, z);
		kit.soft.push({ geometry: hoop, colour: WOOD_DARK, groundY: ground });
	}
}

// ---------------------------------------------------------------------------
// Arithmetic
// ---------------------------------------------------------------------------

/**
 * Two scratch colours, reused by every `mix` in this file.
 *
 * The terrain alone asks for a colour forty thousand times at mount, and a `new Color` per vertex
 * hands the collector forty thousand objects at the one moment in this app's life when a hitch is
 * most visible — the frame the game opens on. Exactly the reasoning `bake.alongStops` records for
 * its own pair.
 */
const FROM = new Color();
const TO = new Color();

/** Between two hex colours, as a hex colour. */
function mix(from: number, to: number, t: number): number {
	if (t <= 0) return from;
	if (t >= 1) return to;
	return FROM.setHex(from).lerp(TO.setHex(to), t).getHex();
}

/** A smooth 0 → 1 between two values, in either direction, with both ends flat. */
function ramp(from: number, to: number, at: number): number {
	if (from === to) return at >= to ? 1 : 0;
	const t = Math.min(1, Math.max(0, (at - from) / (to - from)));
	return t * t * (3 - 2 * t);
}

/**
 * A tiny deterministic generator.
 *
 * Seeded rather than `Math.random`, so the hundred and fifty tufts are the same hundred and fifty
 * tufts on every device and in every session. The same mulberry-shaped generator `floeField` runs on
 * a floe's `shape`, and here for the same reason: the island is a place a child learns by heart.
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
