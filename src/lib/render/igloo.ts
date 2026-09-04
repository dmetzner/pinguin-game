/**
 * Mein Iglu, drawn — the one building on this island that belongs to the player.
 *
 * **An igloo is domes stuck together**, which story 12 calls the luckiest fact about this whole
 * feature and it is: a dome is a `SphereGeometry`, so "bigger" is one number and "another room" is
 * one more sphere. Nothing here is new art, and that is why the ladder in `lib/igloo.ts` can be four
 * rungs long without four models.
 *
 * **The simulation is the authority and nothing here is a second copy of it.** Two facts are read
 * rather than re-typed, both of them versions of trap 8 — a thing the player can bump into that the
 * renderer keeps its own opinion about:
 *
 *  * The PLOT is `sim/island.ISLAND_OBSTACLES`, by id. Its middle and its radius are the circle
 *    `holdOffObstacles` stops a penguin at, so the wall a child walks into is the wall they can see.
 *    `lib/igloo.iglooDomes` places every dome as a fraction of that radius and `iglooFits` is the test
 *    that says none of them reaches past it.
 *  * The GROUND is `archipelago.groundHeight(floe, …)`, the same function the island's mesh is a plot
 *    of and the penguins stand on. Not "flat, because the plot is on flat ground" — that is true today
 *    and is somebody else's decision to change.
 *
 * **The face is not decoration, it is the specification.** `docs/ART-DIRECTION.md` asks for two round
 * eyes with a highlight in each and no sharp points on anything a child is meant to like, and story 12
 * says in as many words that an igloo with a round doorway and two small windows reads as a FACE and
 * that this is not an accident in either reference game. So the doorway is round, the windows are
 * round, both carry a chunky rim, and the whole arrangement sits on the +z side of the big dome.
 *
 * **+z is where the camera is, and that is the whole of why any of this is visible.** The rig stands
 * on the +z side and looks back along −z (`render/camera.ts`), and the island's plot is placed NORTH
 * of its doorstep (`bearing: Math.PI`), so the face looks at both the camera and the child walking up
 * to it. Trap 17 is the sea lion's face: modelled twice, never once on screen, because the mode's own
 * geometry pointed it away from the camera by construction. The cost of getting that wrong is the
 * entire visible surface of this feature.
 *
 * **No holes are cut in any shell, deliberately.** The obvious way to make a doorway is a `phiStart` /
 * `thetaLength` window in the sphere, and it produces a tapered slot whose top edge is a line of
 * constant colatitude — which does not meet a round frame anywhere except at one point, leaving two
 * slivers of interior showing at the corners. A dark UNLIT disc laid on the surface with a rim round
 * it is a round hole from every angle the camera can reach, and it cannot be wound the wrong way
 * (trap 14) because it is not a hand-built surface. The cave already established the principle: a lit
 * hole is a grey circle, so the hole has to be unlit.
 *
 * **Four draw calls outside and two inside** (measured, `render/igloo.test.ts`), against the 209 a
 * Royal spends: everything smooth is one merged mesh, everything faceted is another, the window panes
 * are the one shiny surface and the doorway is the one unlit one. The interior needs neither the
 * faceted mesh nor the panes, because the yard is outdoors and a window seen from inside is a hole.
 * Sixteen thousand vertices at the top of the ladder, which is nothing: segment counts are nearly
 * free in this renderer and object counts are not. Rebuilt only when the plan changes — `iglooKey` is
 * what lets `SceneHandles.setIgloo` be called from a draw loop without rebuilding a house sixty times
 * a second.
 */
import {
	BoxGeometry,
	type BufferGeometry,
	CircleGeometry,
	CylinderGeometry,
	DoubleSide,
	FrontSide,
	Group,
	type Mesh,
	MeshBasicMaterial,
	MeshLambertMaterial,
	MeshPhongMaterial,
	Quaternion,
	SphereGeometry,
	TorusGeometry,
	Vector3
} from 'three';
import { type Dome, type IglooPlan, type IglooPlot, iglooDomes, myIgloo } from '../igloo';
import { groundHeight } from '../sim/archipelago';
import { ISLAND_OBSTACLES, theSquare } from '../sim/island';
import type { Floe, Vec2 } from '../sim/types';
import { alongStops, bake, type Contact, type Piece } from './bake';

/**
 * Which obstacle on the island is the player's plot.
 *
 * A wire value, as `sim/island.ts` says of every obstacle id: the renderer picks a model by it. An
 * island with no such plot draws no igloo and does not throw — `iglooSpec` returns null — which is the
 * right failure for a renderer and is also what makes this file safe to land before the row that
 * creates the plot does.
 */
const PLOT_ID = 'iglu';

/**
 * How far back the camera stands when the player is looking inside, in metres.
 *
 * Against the 14 m the island is walked at. A fixed DISTANCE rather than a fit, for exactly the reason
 * `SceneHandles.setFollow` exists: a fit of something this small solves to a camera inside the wall,
 * and a fit at all changes with the aspect ratio, which is what put a penguin at 2% of a portrait
 * frame.
 *
 * **Six metres FROM THE PLOT, which is not the same thing as six metres from the player, and the
 * difference is the whole interior view.** See `iglooView`.
 */
export const IGLOO_VIEW = 6;

/**
 * How wide the interior is opened up, in degrees of the dome swept away from the camera's side.
 *
 * The interior is a FRAMING and not a second world (story 12): the same follow camera, closer, with
 * the shells on the camera's side left out. 150° is what it takes for the floor to be visible rather
 * than glimpsed — at 90° the near wall still crosses the bottom third of the frame, which is the part
 * a penguin standing in the middle of the room occupies.
 *
 * It is a FIXED direction and that is only safe because this camera never turns. `setFollow` takes no
 * bearing on purpose (a hub camera that rotated with the player would re-map the stick continuously,
 * which is trap 7 as a permanent condition), so the side to leave out is decided once, here, and
 * cannot come unstuck.
 */
const CUTAWAY = (150 * Math.PI) / 180;

/**
 * Where the CAMERA is, in a `SphereGeometry`'s own angle. +z, and a quarter turn from its first vertex.
 *
 * **FIXED, and not to be confused with which way the face looks** — those were one constant until the
 * face learned to turn, and they are two different facts about this building. `setFollow` takes no
 * bearing on purpose (a hub camera that rotated with the player would re-map the stick continuously,
 * which is trap 7 as a permanent condition), so the camera is always on +z. The CUTAWAY and the
 * daylight coming through the far wall are measured from here, because both are about what the lens
 * can see. The doorway and the windows are measured from `faceBearing`, because they are about what a
 * child walks up to.
 */
const CAMERA_SIDE = Math.PI / 2;

/**
 * How far the face may turn away from the camera, in radians.
 *
 * Thirty degrees, and it is a limit rather than a target: past it the doorway starts to foreshorten
 * into the wall and the two windows stop being a pair. It is what stops `faceBearing` following a plot
 * round to the back of the island and modelling a face nothing can see, which is trap 17 with the
 * arithmetic doing it instead of a person.
 */
const FACE_SWING = (30 * Math.PI) / 180;

/** How round each dome is. Cheap — segment counts are nearly free and object counts are not. */
const DOME_SEGMENTS = 32;
const DOME_RINGS = 14;

/**
 * The door, in metres, and ABSOLUTE rather than a fraction of the dome.
 *
 * A door is sized to the thing that walks through it. A penguin is about a metre tall, so the opening
 * is 1.04 m across with its middle 62 cm up — and it stays that on the small igloo, where it is
 * therefore proportionally bigger. That is the right way round for this audience: a cartoon house has
 * a door too big for it, and a door that shrank with the building would be a letterbox on the one
 * igloo every child owns on their first afternoon.
 */
const DOOR_RADIUS = 0.52;
const DOOR_UP = 0.62;

/**
 * The windows, as fractions of their own dome — 62% of its height up, a third of its radius aside.
 *
 * The opposite decision from the door, and for the opposite reason: the door is a hole a body goes
 * through and the windows are a FACE. A face is a proportion, so the eyes move with the head. Held
 * absolute, they would sit almost on the crown of a small dome and read as a thing squinting upward.
 */
const WINDOW_UP = 0.62;
const WINDOW_ASIDE = 0.33;
const WINDOW_RADIUS = 0.105;

/** The apron of packed snow round each dome's foot: how far out it flares, and how tall it is. */
const APRON_OUT = 1.08;
const APRON_FLARE = 1.14;
const APRON_HIGH = 0.3;

/** The tunnel between two domes. Wide enough to be a passage, short enough to be a detail. */
const TUNNEL_RADIUS = 0.78;

/**
 * The ice, from the shadowed foot of a dome to its crown.
 *
 * **Faintly blue at the bottom, and that is trap 11's other half.** Pure white snow drifts on pure
 * white ice were invisible on the floes — they rendered, cost their triangles and could not be seen —
 * so the ice in this game is faintly blue in order that things on it have a shape. An all-white dome
 * against an all-white apron against white blocks in the yard is the same picture with three subjects
 * in it.
 */
const ICE_STOPS: [number, number][] = [
	[0, 0xb9d4ea],
	[0.35, 0xdcecf8],
	[1, 0xfdffff]
];

/**
 * The same ice from the inside, which is a different colour and not a darker one.
 *
 * Light inside an igloo has come through a metre of it, so the interior is warm where the outside is
 * cold — that is the one thing that makes a cutaway read as INSIDE rather than as an igloo with a
 * piece missing. It is also the only warm surface this building has, and `docs/ART-DIRECTION.md` §1
 * puts colour variety at the top of the list of what actually makes those games look like those games.
 */
const INSIDE_STOPS: [number, number][] = [
	[0, 0x9fb0c4],
	[0.3, 0xe4dcc8],
	[1, 0xfff6e2]
];

/**
 * How far apart the courses of ice blocks are, in metres, and how much darker a joint is.
 *
 * Colour rather than geometry, which is the cheap half of `render/island.ts`'s contract with itself:
 * the surface is one smooth shell and all of the variety is vertex colour. Real blocks would be
 * eighty primitives and a seam at every one of them; a darker line every 42 cm reads as courses from
 * the three metres away this building is ever seen from, and costs nothing at all.
 */
const COURSE = 0.42;
const JOINT = 0.1;

/** The painted rim round the door, and the one saturated thing on the building. */
const DOOR_TRIM = 0xd9483c;
/** The rim round a window, and the pane behind it. Snow, and ice with the sky in it. */
const WINDOW_TRIM = 0xf6ecd8;
const PANE = 0x7fbdd8;
/** The highlight in each eye. `docs/ART-DIRECTION.md`: two round eyes and a highlight in each. */
const GLINT = 0xffffff;
/** The dark inside a doorway. Not black: a hole in snow is blue-grey, and black reads as a cut-out. */
const DOORWAY = 0x1d2a38;
/** Daylight, seen from indoors through a window that is a hole in a wall from this side. */
const DAYLIGHT = 0xe8f6ff;
/** The lantern beside the door, and the knob on top of the tower. Unlit, so they read as lit. */
const LAMP = 0xffd85e;
const LAMP_POST = 0x7d5230;
/** The floor indoors: packed snow, walked on. */
const FLOOR = 0xcdd8e2;
/** The bedding, and the one saturated colour in the room. See `sleepingPlatform`. */
const BEDDING = 0x2fa8a2;
const PILLOW = 0xf6ecd8;

/**
 * The seam where the igloo meets the ground it stands on.
 *
 * The island's own numbers, deliberately: this building stands on that grass, and a seam of a
 * different depth or a different warmth would be the one prop on the island that does not sit on it.
 * `render/island.ts` argues the whole case — there is no shadow map, so a dark band baked once is the
 * entire grounding, and without it the igloo is a decal on a green plane.
 */
const CONTACT: Contact = { reach: 0.22, colour: 0x554a3c, strength: 0.72 };

// ---------------------------------------------------------------------------

/** Everything needed to draw one igloo: the ground, the plot, the plan, and which side of it we are on. */
export interface IglooSpec {
	/** The island as the simulation has it. Read for its ground, never for a second copy of it. */
	readonly floe: Floe;
	readonly plot: IglooPlot;
	readonly plan: IglooPlan;
	/** Looking in, rather than at it. The camera-side shells are left out and a floor is laid. */
	readonly inside: boolean;
}

export interface Igloo {
	root: Group;
	dispose(): void;
}

/**
 * What this igloo IS, as a short string.
 *
 * `SceneHandles.setIgloo` compares it and rebuilds nothing when it has not changed, which is what
 * makes the verb safe to call once a frame — the alternative is a house rebuilt sixty times a second,
 * a mistake that reads as "the hub is slow" rather than as a wrong call. It is a key rather than a
 * deep compare because the only thing that can change it is a purchase, and a purchase changes a
 * number.
 */
export function iglooKey(spec: IglooSpec): string {
	const { plan, plot } = spec;
	return [
		spec.floe.id,
		plot.at.x,
		plot.at.z,
		plot.radius,
		plan.main,
		plan.rooms,
		plan.tower ? 't' : '-',
		spec.inside ? 'in' : 'out'
	].join(':');
}

/**
 * The igloo the player owns, on the island they are standing on, or null.
 *
 * The one place the save, the layout and the ground meet, so a caller needs one line and cannot get
 * the order wrong. Null for every mode that is not the hub, and null on a hub whose simulation has no
 * plot on it — which is the honest answer while `sim/island.ts` has no `iglu` obstacle in it, and is
 * why this file can land before that row does. **Trap 15 is a parameter accepted and dropped; the
 * shape that avoids it is one call that either returns a whole thing or nothing.**
 */
export function iglooSpec(floe: Floe | null, inside: boolean): IglooSpec | null {
	if (!floe) return null;
	const plot = ISLAND_OBSTACLES.find((one) => one.id === PLOT_ID);
	if (!plot) return null;
	return { floe, plot: { at: plot.at, radius: plot.radius }, plan: myIgloo(), inside };
}

/** Where the player's plot is, for the caller that has to know whether they have walked away from it. */
export function iglooPlot(): IglooPlot | null {
	const plot = ISLAND_OBSTACLES.find((one) => one.id === PLOT_ID);
	return plot ? { at: plot.at, radius: plot.radius } : null;
}

/**
 * Where the camera should stand to look inside, as the two things `SceneHandles.setFollow` wants.
 *
 * **It aims at the PLOT and not at the player, and that is a correction to what I first specified.**
 * The numbers, measured against `camera.ts`'s 27° pitch and `scene.ts`'s 58° field of view on a
 * 568×320 phone:
 *
 *  * The plot is solid ground, so a player can never stand closer to the igloo than the doorstep, which
 *    is 6.5 m from its face and 11 m from its middle.
 *  * This rig's up-ray is `fov/2 − pitch` = **2° above level**. It barely looks up at all. So the only
 *    way to see the top of a 3.37 m igloo is to stand far enough back that the CAMERA is nearly that
 *    high, and `0.454·d` reaches 3.37 m at d ≈ 6.5.
 *  * Which means aimed at the player, the closest distance that does not decapitate the tower puts the
 *    room at **18.5% of the frame** — against 16.5% from the doorstep outside. Pressing "Reingehen"
 *    would move the camera five metres and change nothing. That is trap 15's family: the parameter is
 *    honoured, the arithmetic is right, and the feature does not happen.
 *
 * Aimed at the plot at six metres, the room is **38% of the frame height and 47% of its width** and the
 * bed is 51 px wide on that phone. That is a room.
 *
 * **The consequence, stated because it is a real cost and not an oversight:** the player's own penguin
 * is behind the camera and off screen while they are inside. The doorstep is eleven metres back and the
 * plot cannot be walked onto, so there is no camera that holds both the room and the bird — I measured
 * for one. The way out is the button, or walking off the mat (`hasLeftTheIgloo`). It is also the framing
 * story 12d wants: placing deko on a grid is a view of a room, not a view of a penguin.
 *
 * Null off the island or before the plot exists, so one call either answers or does not.
 */
export function iglooView(): { at: Vec2; distance: number } | null {
	const plot = iglooPlot();
	return plot ? { at: plot.at, distance: IGLOO_VIEW } : null;
}

/**
 * Which way the face looks: back down its own approach, clamped to stay in front of the camera.
 *
 * **Derived, because a typed angle would be correct today and wrong the moment the plot moves.** The
 * rule is the one `render/island.ts` already follows for the cave's mouth and the shop's counter —
 * look back toward the square — so the island gains a grammar rather than one building with a special
 * case.
 *
 * It exists because a fixed-bearing camera makes "walking to it" and "looking at it" two different
 * actions, and nothing in the game asks a child to do the second. Measured on the plot as laid out at
 * (36, −29): the walk from the square arrives 51° off +z, so a face on the camera's axis is seen
 * three-quarters-on at best and the dome slides off the edge of the frame as you approach. Clamped at
 * thirty degrees the face ends up 30° off the camera and 21° off the approach — presented to the lens
 * either way, and side-on to neither.
 *
 * And it survives the rotating camera landing, which is what makes it the right fix rather than a
 * workaround: **a face that looks back down its own approach is correct whether or not the rig turns.**
 */
export function faceBearing(plot: IglooPlot): number {
	const square = theSquare().at;
	// Sphere phi runs `x = −cos φ`, `z = sin φ` (see `onDome`), so a direction becomes an angle this way
	// round rather than the usual one. Getting this backwards points the door at the sea.
	const want = Math.atan2(square.z - plot.at.z, plot.at.x - square.x);
	// Wrapped before it is clamped: a raw subtraction of two angles can be a turn the long way round,
	// and clamping that gives a face pointing at nothing in particular.
	const off = Math.atan2(Math.sin(want - CAMERA_SIDE), Math.cos(want - CAMERA_SIDE));
	return CAMERA_SIDE + Math.max(-FACE_SWING, Math.min(FACE_SWING, off));
}

/**
 * Build it, once.
 *
 * Nothing here moves, so all of it is baked and none of it gets an `update`. The gondola is the only
 * thing on this island allowed to animate (`render/island.ts`), and a house that breathed would be
 * the second clock in a renderer that is meant to have one (invariant 3).
 */
export function createIgloo(spec: IglooSpec): Igloo {
	const root = new Group();
	const { floe, plot, plan, inside } = spec;

	const soft: Piece[] = [];
	const crags: Piece[] = [];
	const sheen: Piece[] = [];
	const voids: Piece[] = [];

	const domes = iglooDomes(plot, plan);
	const stops = inside ? INSIDE_STOPS : ICE_STOPS;
	const front = faceBearing(plot);

	for (const dome of domes) {
		const base = standOn(floe, dome.at, dome.radius) + dome.lift;
		soft.push({
			geometry: shell(dome, base, inside),
			// Up its own height rather than up from the sea, so a dome on a slope and a tower two metres
			// in the air are shaded from their own feet. Plus the courses, which are the whole of what
			// says "blocks of ice" on a surface that is one smooth shell.
			colour: (_x, y) => {
				const up = (y - base) / Math.max(0.001, dome.height);
				const ice = alongStops(stops, up);
				const into = ((y - base) % COURSE) / COURSE;
				return into < 0.14 ? shade(ice, JOINT) : ice;
			},
			groundY: base
		});

		if (!inside) {
			// The apron: a flared foot of packed snow. "Wide base, nothing tapering to a point" is the
			// first hard rule in the art direction, and a hemisphere on grass has no base at all — it
			// meets the ground at a tangent, which is the one contact a baked seam cannot describe.
			soft.push({
				geometry: apron(dome, base),
				colour: (_x, y) => alongStops(stops, (y - base) / Math.max(0.001, dome.height)),
				groundY: base
			});
		}

		// The face, or the daylight coming through it. Both are the same three placements: a round
		// doorway low and central, two round windows above and either side of it.
		if (dome.kind === 'tower' && !inside) {
			// A rounded knob to cap the turret. `docs/ART-DIRECTION.md`: no sharp points on anything a
			// child is meant to like, and a dome with nothing on top of it ends in a highlight that reads
			// as a pinch at this camera angle. Unlit, so it reads as a little light rather than a bead.
			const knob = new SphereGeometry(dome.radius * 0.16, 10, 8);
			knob.translate(dome.at.x, base + dome.height * 0.98, dome.at.z);
			voids.push({ geometry: knob, colour: LAMP });
		}

		if (dome.kind === 'main' && !inside) face(dome, base, front, soft, sheen, voids);
		else if (dome.kind === 'main') daylight(dome, base, voids);
		else if (!inside) porthole(dome, base, front, soft, sheen, voids);
		else daylight(dome, base, voids);
	}

	if (!inside) {
		for (const dome of domes) {
			if (dome.kind !== 'room') continue;
			// The passage. The domes already overlap by fifteen centimetres, so this is not what holds
			// them together — it is what stops the crease between two spheres meeting at an angle
			// reading as a pinch rather than as a way through.
			const front = domes[0];
			if (front) soft.push(tunnel(front, dome, standOn(floe, dome.at, dome.radius)));
		}

		yard(plan, domes, floe, crags);
		if (domes[0])
			lantern(domes[0], standOn(floe, domes[0].at, domes[0].radius), front, crags, voids);
	} else {
		for (const dome of domes) {
			if (dome.kind === 'tower') continue;
			// The floor, one disc per room, a centimetre proud of the ground. Under two centimetres
			// because a penguin carries its blob shadow at exactly that and its "that one is you" ring at
			// four (`render/penguin.ts`) — a floor drawn over the player's own markers is a worse
			// artefact than a floor that is missing.
			const disc = new CircleGeometry(dome.radius * 0.98, DOME_SEGMENTS);
			disc.rotateX(-Math.PI / 2);
			disc.translate(dome.at.x, standOn(floe, dome.at, dome.radius) + 0.012, dome.at.z);
			soft.push({ geometry: disc, colour: FLOOR });
		}
		const front = domes[0];
		if (front) sleepingPlatform(front, standOn(floe, front.at, front.radius), soft);
	}

	// Smooth, faceted, shiny and unlit — the same four families `render/island.ts` sorts its island
	// into, so the igloo is lit by the same rules as the ground it stands on.
	//
	// The shells are DOUBLE-sided indoors and only indoors. A sphere's faces point outward, so from
	// inside one every triangle is a back face and a single-sided material culls the lot: the interior
	// would be an empty floor under an open sky, with nothing in the console. That is trap 14's exact
	// symptom (a surface both invisible and unlit) arrived at from the other direction, and three
	// flips the normal for a back-facing fragment itself, so the far wall is lit correctly.
	const softMaterial = new MeshLambertMaterial({
		vertexColors: true,
		side: inside ? DoubleSide : FrontSide
	});
	const cragMaterial = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
	// The panes. Phong for the same reason the rink is: ice with the sky in it needs a specular, and a
	// Lambert window is a flat pale dot that reads as a sticker.
	const sheenMaterial = new MeshPhongMaterial({
		vertexColors: true,
		shininess: 70,
		specular: 0x9fd6ea
	});
	const voidMaterial = new MeshBasicMaterial({ vertexColors: true });

	const softMesh = bake(soft, softMaterial, CONTACT);
	const cragMesh = bake(crags, cragMaterial, CONTACT);
	const sheenMesh = bake(sheen, sheenMaterial);
	const voidMesh = bake(voids, voidMaterial);
	const meshes: (Mesh | null)[] = [softMesh, cragMesh, sheenMesh, voidMesh];
	for (const mesh of meshes) if (mesh) root.add(mesh);

	return {
		root,
		dispose() {
			for (const mesh of meshes) mesh?.geometry.dispose();
			softMaterial.dispose();
			cragMaterial.dispose();
			sheenMaterial.dispose();
			voidMaterial.dispose();
		}
	};
}

// ---------------------------------------------------------------------------
// The domes
// ---------------------------------------------------------------------------

/**
 * The LOWEST ground under a footprint, less a little.
 *
 * The island's own `standOn` in one sentence, and here for the same reason: seated on the ground at
 * its middle, a dome on any slope at all floats on its downhill side, and a gap under a building is
 * visible from every camera angle there is. Seated on the lowest ground under it, the uphill side
 * buries instead — trap 11 with the sign flipped, which `render/island.test.ts` argues at length is
 * the better failure because a buried edge is invisible and the apron covers it anyway.
 *
 * This does NOT make the igloo good on a hillside; a plot with real fall across it wants a skirt this
 * building does not have, and `sim/island.ts` is asked to put the plot on flat ground for that reason.
 * What it buys is that a plot which drifts onto the shoulder of a knoll degrades into a house sunk
 * slightly into the hill rather than one hovering over it.
 */
function standOn(floe: Floe, at: Vec2, span: number): number {
	let low = groundHeight(floe, at);
	for (let i = 0; i < 6; i++) {
		const a = (i / 6) * Math.PI * 2;
		low = Math.min(
			low,
			groundHeight(floe, { x: at.x + Math.sin(a) * span, z: at.z + Math.cos(a) * span })
		);
	}
	// Four centimetres in, so a base is never a hairline of daylight where the ground curves away.
	return low - 0.04;
}

/**
 * One dome, squashed and put on the ground.
 *
 * Squashed with `BufferGeometry.scale`, which transforms the NORMALS by their own matrix — a
 * non-uniform scale applied to positions alone would leave every normal pointing where the sphere's
 * used to, and the light on it would be a sphere's light on an ellipsoid's shape. `mergePieces` makes
 * this non-indexed afterwards and `computeVertexNormals` on a non-indexed geometry can only produce
 * flat facets, so the normals have to be right BEFORE they get there and nothing here may recompute
 * them.
 */
function shell(dome: Dome, base: number, inside: boolean): BufferGeometry {
	const geometry = inside
		? // The camera's side left out. `FRONT` is +z, so the sweep starts half a cutaway past it and
			// goes the long way round — which takes the near wall AND the roof over it, because the gap
			// runs from the crown to the ground. That is a cutaway rather than a doorway, and it is what
			// makes an interior a framing instead of a second world.
			new SphereGeometry(
				dome.radius,
				DOME_SEGMENTS,
				DOME_RINGS,
				CAMERA_SIDE + CUTAWAY / 2,
				Math.PI * 2 - CUTAWAY,
				0,
				Math.PI / 2
			)
		: new SphereGeometry(dome.radius, DOME_SEGMENTS, DOME_RINGS, 0, Math.PI * 2, 0, Math.PI / 2);
	geometry.scale(1, dome.height / dome.radius, 1);
	geometry.translate(dome.at.x, base, dome.at.z);
	return geometry;
}

/** The flared foot of packed snow round a dome. Open-ended: it is a band, not a tub. */
function apron(dome: Dome, base: number): BufferGeometry {
	const geometry = new CylinderGeometry(
		dome.radius * APRON_OUT,
		dome.radius * APRON_FLARE,
		APRON_HIGH,
		DOME_SEGMENTS,
		1,
		true
	);
	geometry.translate(dome.at.x, base + APRON_HIGH / 2, dome.at.z);
	return geometry;
}

/**
 * The passage between two domes: a cylinder lying along the line from one middle to the other.
 *
 * The rotation is written out rather than guessed, because an axis put on the wrong plane is a tube
 * standing on its end through the roof and it looks exactly like a bug in the plan. A cylinder is
 * built along +y; `rotateZ(π/2)` sends (0, 1, 0) to (−1, 0, 0), and `rotateY(θ)` then sends that to
 * (−cos θ, 0, sin θ) — so θ = atan2(ẑ, −x̂) puts the axis on the line between the two domes. A
 * cylinder is symmetric about its own axis, so the remaining sign does not exist.
 */
function tunnel(from: Dome, to: Dome, base: number): Piece {
	const dx = to.at.x - from.at.x;
	const dz = to.at.z - from.at.z;
	const span = Math.hypot(dx, dz) || 1;
	const geometry = new CylinderGeometry(TUNNEL_RADIUS, TUNNEL_RADIUS, span, 14, 1, true);
	geometry.rotateZ(Math.PI / 2);
	geometry.rotateY(Math.atan2(dz / span, -dx / span));
	geometry.translate(
		(from.at.x + to.at.x) / 2,
		base + TUNNEL_RADIUS * 0.85,
		(from.at.z + to.at.z) / 2
	);
	return {
		geometry,
		colour: (_x, y) => alongStops(ICE_STOPS, (y - base) / (TUNNEL_RADIUS * 2)),
		groundY: base
	};
}

// ---------------------------------------------------------------------------
// The face
// ---------------------------------------------------------------------------

/**
 * A point on a dome's surface, and the way it faces.
 *
 * The normal is the ELLIPSOID's, not the sphere's: after the squash the surface is `x²/r² + y²/h² +
 * z²/r² = 1` and its gradient is `(x/r², y/h², z/r²)`. Using the sphere's normal instead tilts every
 * window a few degrees out of its own wall, which at these radii is a rim that stands proud on one
 * side and sinks on the other — invisible in a still, and exactly the kind of thing that reads as
 * "the windows look wrong" with nothing to point at.
 */
function onDome(
	dome: Dome,
	base: number,
	phi: number,
	theta: number
): { at: Vector3; out: Vector3 } {
	const s = Math.sin(theta);
	const up = dome.height * Math.cos(theta);
	const at = new Vector3(
		dome.at.x - dome.radius * Math.cos(phi) * s,
		base + up,
		dome.at.z + dome.radius * Math.sin(phi) * s
	);
	// The gradient is taken at the point in the ELLIPSOID's own frame, so the height used here is the
	// one above the dome's own base and not the one above the sea.
	const out = new Vector3(
		(at.x - dome.at.x) / (dome.radius * dome.radius),
		up / (dome.height * dome.height),
		(at.z - dome.at.z) / (dome.radius * dome.radius)
	).normalize();
	return { at, out };
}

/** Which colatitude puts a feature this many metres up this dome, clamped to the dome. */
function upTo(dome: Dome, metres: number): number {
	return Math.acos(Math.min(0.97, Math.max(0.05, metres / dome.height)));
}

/** And which sweep puts it this far to the side at that colatitude, clamped the same way. */
function asideTo(dome: Dome, theta: number, metres: number): number {
	const across = dome.radius * Math.sin(theta);
	return Math.asin(Math.min(0.9, Math.max(-0.9, metres / Math.max(0.001, across))));
}

/** Lay a flat piece on a dome, facing the way the dome faces there, a little proud of the surface. */
function against(
	geometry: BufferGeometry,
	at: Vector3,
	out: Vector3,
	proud: number
): BufferGeometry {
	geometry.applyQuaternion(new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), out));
	geometry.translate(at.x + out.x * proud, at.y + out.y * proud, at.z + out.z * proud);
	return geometry;
}

/**
 * The doorway and the two windows, on the front of the big dome.
 *
 * Placed against the +z side, which is where the camera is and where the doorstep is — see the note
 * at the top of this file. A round mouth under two round eyes with a glint in each is a face and that
 * is the specification, not a flourish.
 */
function face(
	dome: Dome,
	base: number,
	front: number,
	soft: Piece[],
	sheen: Piece[],
	voids: Piece[]
): void {
	const door = onDome(dome, base, front, upTo(dome, DOOR_UP));

	// The hole. Unlit, because a lit hole is a grey circle — the cave's lesson, and the reason this is
	// in `voids` rather than in `soft`.
	voids.push({
		geometry: against(
			new CircleGeometry(DOOR_RADIUS, 20),
			door.at,
			door.out,
			// Proud by three centimetres: a disc tangent to a curved wall touches at its middle and its
			// rim lifts off by the sagitta, so pushing it out is what keeps the whole hole in front of
			// the shell instead of half-buried in it.
			0.03
		),
		colour: DOORWAY
	});
	// And the rim, which is the only saturated thing on the building. A painted doorway is what makes
	// a snow dome read as somebody's house rather than as a snow dome.
	soft.push({
		geometry: against(new TorusGeometry(DOOR_RADIUS + 0.06, 0.12, 6, 20), door.at, door.out, 0.03),
		colour: DOOR_TRIM
	});

	const eyeTheta = upTo(dome, dome.height * WINDOW_UP);
	const aside = asideTo(dome, eyeTheta, dome.radius * WINDOW_ASIDE);
	for (const side of [-1, 1]) {
		const eye = onDome(dome, base, front + side * aside, eyeTheta);
		window(eye.at, eye.out, dome.radius * WINDOW_RADIUS, soft, sheen, voids);
	}
}

/** One window and nothing else, dead centre — what a side room and the tower get. */
function porthole(
	dome: Dome,
	base: number,
	front: number,
	soft: Piece[],
	sheen: Piece[],
	voids: Piece[]
): void {
	const eye = onDome(dome, base, front, upTo(dome, dome.height * WINDOW_UP));
	window(eye.at, eye.out, dome.radius * 0.16, soft, sheen, voids);
}

/**
 * A round window: a pane, a chunky rim, and a highlight in it.
 *
 * The highlight is not polish. `docs/ART-DIRECTION.md` lists "two round eyes with a highlight in
 * each" among the hard rules for every character in this game, and the whole point of putting a face
 * on a building is that the building is then one of them. A pane without a glint is a hole with a
 * blue disc in it.
 */
function window(
	at: Vector3,
	out: Vector3,
	radius: number,
	soft: Piece[],
	sheen: Piece[],
	voids: Piece[]
): void {
	sheen.push({ geometry: against(new CircleGeometry(radius, 16), at, out, 0.02), colour: PANE });
	soft.push({
		geometry: against(new TorusGeometry(radius + 0.05, 0.1, 6, 16), at, out, 0.02),
		colour: WINDOW_TRIM
	});
	// Up and to one side of the middle, the way a highlight sits in an eye. Both windows take it on
	// the SAME side, because two eyes with mirrored glints are two eyes looking in two directions.
	const glint = against(new CircleGeometry(radius * 0.26, 10), at, out, 0.05);
	glint.translate(-radius * 0.3, radius * 0.32, 0);
	voids.push({ geometry: glint, colour: GLINT });
}

/**
 * A window seen from indoors, which is a hole with the polar day on the other side of it.
 *
 * Unlit and nearly white: from inside, a window is not a surface catching light, it IS the light. Two
 * of them on the far wall are the only thing standing between an interior and a grey bowl — the
 * cutaway lets the sun in from the camera's side, but nothing in the frame says the wall is thin.
 */
function daylight(dome: Dome, base: number, voids: Piece[]): void {
	const theta = upTo(dome, dome.height * WINDOW_UP);
	// Behind the player, on the shell that is still drawn: the cutaway takes the front, so a hole put
	// on the front would be a hole in nothing.
	for (const side of [-1, 1]) {
		const spot = onDome(dome, base, CAMERA_SIDE + Math.PI + (side * CUTAWAY) / 5, theta);
		voids.push({
			geometry: against(
				new CircleGeometry(dome.radius * 0.13, 14),
				spot.at,
				spot.out,
				// Inward, so it sits on the face of the shell the camera can see. Everything else on this
				// building is pushed the other way.
				-0.04
			),
			colour: DAYLIGHT
		});
	}
}

/**
 * The bed, and it is CARVED rather than placed.
 *
 * Story 12d is the deko: a rug, a lamp, a fish tank, a poster, a bed, bought from a shop and placed on
 * a grid you can rotate in 90° steps. This is not one of those, and the difference is the whole point
 * of it. An interior with nothing in it is where a child bounces off "Reingehen" — but an interior with
 * one FURNITURE-shaped thing in it is worse, because the first thing they will try is to move it, and
 * they cannot until 12d ships. A thing that reads as movable and is not is a promise the build has to
 * break in the first ten seconds.
 *
 * So it is a snow sleeping platform, which is what a real igloo actually has: a ledge of the same
 * packed snow as the floor, continuous with it, no more movable than the wall. Only the pad and the
 * pillow on top are soft goods, and they are the one saturated colour indoors — `docs/ART-DIRECTION.md`
 * §1 puts colour variety at the top of the list, and a room of white snow under a warm shell has
 * nothing for the eye to hold.
 *
 * Against the BACK wall, which is the wall the cutaway leaves standing: the camera is on the +z side
 * and looks along −z, so the back of the room is the whole of what an interior shot contains. A bed
 * against a side wall would be at the edge of the frame or out of it, which is trap 17 in a room
 * instead of on an animal.
 *
 * Nothing is buried below the floor, and that is a constraint rather than a preference: the ledge is a
 * flat-bottomed box with a rounded bolster along its front top edge, because a half-sunk cylinder —
 * which is what a carved ledge really wants to be — reads to `render/igloo.test.ts` as trap 11 and it
 * is right to. The bolster's own lowest point is four centimetres above the floor.
 */
function sleepingPlatform(dome: Dome, base: number, soft: Piece[]): void {
	// Sized off the dome so a small igloo gets a small bed. A penguin is about a metre tall, so at the
	// island's plot this is 1.9 m of ledge — two penguins wide, which is what makes it read as a bed
	// rather than as a step.
	const wide = Math.min(1.9, dome.radius * 0.7);
	const deep = 0.62;
	const high = 0.34;
	const roll = 0.3;
	// Set back against the wall, measured from the dome's own radius rather than typed: the shell curves
	// in over the ledge, and a bed placed at a fixed distance would push through the wall of the small
	// igloo and stand in the middle of the room in the big one.
	const back = dome.at.z - (dome.radius - deep * 1.4);

	const ledge = new BoxGeometry(wide, high, deep);
	ledge.translate(dome.at.x, base + high / 2, back);
	soft.push({
		geometry: ledge,
		colour: (_x, y) => alongStops(INSIDE_STOPS, (y - base) / (high + roll)),
		groundY: base
	});

	// The rounded front edge. A ledge of snow with a square lip is a crate, and no sharp corners on
	// anything a child is meant to like is the first hard rule in the art direction.
	const bolster = new CylinderGeometry(roll, roll, wide, 14, 1, true);
	bolster.rotateZ(Math.PI / 2);
	bolster.translate(dome.at.x, base + high, back + deep / 2 - roll * 0.55);
	soft.push({
		geometry: bolster,
		colour: (_x, y) => alongStops(INSIDE_STOPS, (y - base) / (high + roll)),
		groundY: base
	});

	// The pad and the pillow: squashed spheres, because the one thing in this room that is meant to look
	// soft is the only thing here that is not made of snow.
	const pad = new SphereGeometry(1, 18, 10);
	pad.scale(wide * 0.44, 0.1, deep * 0.42);
	pad.translate(dome.at.x, base + high + roll * 0.55, back);
	soft.push({ geometry: pad, colour: BEDDING });

	const pillow = new SphereGeometry(1, 14, 10);
	pillow.scale(wide * 0.16, 0.11, deep * 0.3);
	pillow.translate(dome.at.x - wide * 0.28, base + high + roll * 0.72, back);
	soft.push({ geometry: pillow, colour: PILLOW });
}

// ---------------------------------------------------------------------------
// The yard
// ---------------------------------------------------------------------------

/**
 * The pile of ice blocks the next room will be built out of.
 *
 * **This exists because the plot is reserved at its finished size from the first frame**, which
 * `lib/igloo.ts` explains at length: an obstacle that grew when a child bought a room would be
 * simulation state derived from a wallet. The consequence on screen is a ring of ground a penguin
 * cannot enter with nothing in it, and an invisible wall is the least forgivable thing you can put in
 * a hub for eight-year-olds. So the reserved ground holds the material, and **the pile SHRINKS as the
 * rooms go up** — three blocks on the first afternoon, none at all when the igloo is finished, so the
 * progress a child has made is legible from across the island without a number.
 *
 * **It was five blocks scattered on a golden angle across the back of the plot, and it read as
 * litter.** That was judged from a photograph rather than argued, and the photograph showed something
 * worse than clutter: the blocks were spread over eight metres, which is wider than the plot's own
 * building, so a camera could frame the RUBBISH WITH NO IGLOO IN IT — material with nothing to explain
 * it, on green grass, where pale ice is high-contrast debris rather than something belonging to the
 * white thing beside it. Three changes, all from that one picture:
 *
 *  * **One pile, not a scatter.** A stack reads as intent and a scatter reads as debris; the golden
 *    angle that keeps two spawning penguins off each other's toes is exactly the wrong tool here,
 *    because irregular spacing is what randomness looks like when the eye is hunting for a reason.
 *  * **Hard against the igloo**, so the relationship is spatial rather than something a child has to
 *    infer — and so the pile cannot be in frame without the building that explains it.
 *  * **Standing on a pad of snow** that merges into the dome's own apron. That is what stops it
 *    reading as boxes dumped on a lawn: material belonging to the building has to be standing on the
 *    building's own ground.
 */
function yard(plan: IglooPlan, domes: readonly Dome[], floe: Floe, crags: Piece[]): void {
	const main = domes[0];
	if (!main) return;
	// Three, less one for every room built and one for the tower: 3, 3, 2, 1, 0 up the ladder. The
	// finished igloo has used everything up, which is the whole point of the pile being a count.
	const left = Math.max(0, 4 - plan.rooms - (plan.tower ? 1 : 0));
	if (left === 0) return;

	// Beside the big dome on the LEFT, which is the side the lantern is not on, and far enough out that
	// the blocks clear the wall while the pad under them still runs into the apron. Derived from the
	// dome rather than typed, so it stays against the igloo when the igloo gets wider.
	const at = {
		x: main.at.x - main.radius * 1.25,
		z: main.at.z - main.radius * 0.3
	};
	const base = groundHeight(floe, at);

	// The snow the pile stands on. Wide enough to reach the apron, low enough to read as trodden ground
	// rather than as a plinth.
	//
	// It goes in the FACETED mesh with the blocks rather than in the smooth one with the shells, and not
	// because a 12 cm disc of snow shows its facets — because **the smooth mesh is the BUILDING and the
	// faceted one is the yard**, and `render/igloo.test.ts` measures the building's box to prove every
	// rung is visible. Put the pad with the shells and the last rung SHRINKS that box, because the pile
	// it belongs to has been used up by then. The test caught it; the separation is the invariant.
	const pad = new CylinderGeometry(main.radius * 0.34, main.radius * 0.4, 0.12, 18, 1);
	pad.translate(at.x, base + 0.06, at.z);
	crags.push({ geometry: pad, colour: 0xe8f2fa, groundY: base });

	// Two side by side, the third on top of them. Big — 1.05 m, a whole penguin long — because the
	// picture that condemned the scatter also showed that these are seen from much closer than the
	// igloo's face, so smallness was never the problem.
	const spots: [number, number, number][] = [
		[-0.3, 0, 0.12],
		[0.32, 0, -0.18],
		[0.02, 0.44, 0.3]
	];
	for (let i = 0; i < left; i++) {
		const spot = spots[i];
		if (!spot) continue;
		const block = new BoxGeometry(1.05, 0.44, 0.62);
		// Turned a little, and each one differently: a stack at one angle is masonry, and a stack a
		// child left there is not tidy. Small angles only — this has to read as stacked, not as fallen.
		block.rotateY(spot[2]);
		block.translate(at.x + spot[0], base + 0.12 + 0.22 + spot[1], at.z);
		crags.push({ geometry: block, colour: 0xdcecf8, groundY: base });
	}
}

/**
 * The lantern beside the door.
 *
 * One warm light in a frame made of snow, ice and grass — `docs/ART-DIRECTION.md` §1 again — and the
 * one thing on this building that says somebody is home. Unlit geometry, which is what makes it read
 * as the source of light rather than as a yellow ball: a Lambert sphere at this size is a mid-tone
 * dot, and the whole trick the cave mouth uses in reverse.
 */
function lantern(dome: Dome, base: number, front: number, crags: Piece[], voids: Piece[]): void {
	// Beside the door, which means it has to turn with the door. Written as "out along the face, then to
	// its right" rather than as an x/z offset, because an offset is only beside the door while the door
	// happens to be on +z — and it stopped being there the moment `faceBearing` was derived.
	const out = { x: -Math.cos(front), z: Math.sin(front) };
	const right = { x: out.z, z: -out.x };
	const at = {
		x: dome.at.x + out.x * dome.radius * 0.78 + right.x * dome.radius * 0.42,
		z: dome.at.z + out.z * dome.radius * 0.78 + right.z * dome.radius * 0.42
	};
	const post = new CylinderGeometry(0.06, 0.09, 0.95, 8);
	post.translate(at.x, base + 0.475, at.z);
	crags.push({ geometry: post, colour: LAMP_POST, groundY: base });

	const glow = new SphereGeometry(0.18, 12, 8);
	glow.translate(at.x, base + 1.05, at.z);
	voids.push({ geometry: glow, colour: LAMP });
}

/** A colour taken toward black by `by`, for a joint between two courses of ice. */
function shade(colour: number, by: number): number {
	const r = Math.round(((colour >> 16) & 0xff) * (1 - by));
	const g = Math.round(((colour >> 8) & 0xff) * (1 - by));
	const b = Math.round((colour & 0xff) * (1 - by));
	return (r << 16) | (g << 8) | b;
}
