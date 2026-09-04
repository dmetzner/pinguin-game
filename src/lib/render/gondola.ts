/**
 * The ride up. A car on a cable, drawn at a fraction of the way to the top.
 *
 * This is a CURTAIN, not a place. `opening: 'countdown'` already means "the world exists, the
 * controls are dead, something is about to happen", so the ride is a picture drawn over that and
 * nothing in the simulation knows it happened: no floe, no phase, no tick. The honest reason it
 * exists is a scale problem — the island's own mountain is six metres because a child has to be able
 * to walk up it, and the course descends two hundred. The station door is where those two mountains
 * meet, and the ride is what makes the join a moment instead of a teleport.
 *
 * **It must read as complete at four seconds and survive being cut short.** The hub ends it at
 * `max(loadFinished, ~4 s)`, which means the tenth ride is the short one and a child who wants
 * another race gets it. So there is no beat in here — nothing happens AT a moment. Everything is
 * monotonic in `t`: the car climbs, the pylons come at a steady rhythm, the top station has been
 * visible since the first frame and grows. Cut it anywhere and the last frame still reads as "going
 * up", which is the only thing the ride has to say. A set piece with a flourish at second seven would
 * be a flourish nobody sees nine times out of ten.
 *
 * Two draw calls: everything that does not move (cable, pylons, both stations) is one baked mesh, and
 * the car is the other. `t` is handed in — no clock in here, per invariant 3 — and the sway is a
 * function of WHERE the car is rather than of when, which is also why it is right: a real car lurches
 * as it crosses a pylon, and crossing a pylon is a position.
 */
import {
	BoxGeometry,
	CylinderGeometry,
	Group,
	MeshLambertMaterial,
	Quaternion,
	SphereGeometry,
	Vector3
} from 'three';
import { SLIDE_BANK_HEIGHT } from '../sim/constants';
import { segmentHeading } from '../sim/slide';
import type { Floe, Vec2 } from '../sim/types';
import { bake, type Piece } from './bake';

/**
 * How far out from the middle of the run the cable hangs, and how far above the rim.
 *
 * Thirteen metres out is 7.8 m outside the rim, which puts the car over the CLIFF rather than over
 * the run — `render/chute.ts` reaches 29.8 m, so there is mountain under every pylon — and five
 * metres up puts the deck below the car and slightly to one side. That is the whole reason for these
 * two numbers: from here a child looks DOWN at the course they are about to race, which is the one
 * thing the ride can teach that nothing else in the mode can. Any further out and the run is a white
 * line in the distance; any lower and the rim hides it.
 */
const CABLE_SIDE = 13;
const CABLE_LIFT = 5;

/**
 * Which side of the run the line goes up.
 *
 * The LEFT, and it has to be a constant rather than a choice: the cable is drawn once from the course
 * and the camera is placed against it, so a side that changed per seed would be a ride that is
 * sometimes behind the mountain.
 */
const CABLE_HAND = -1;

/**
 * How many segments between pylons.
 *
 * Ten, so about 70 m, which over a 420 m course is six towers. At a four-second ride that is a tower
 * every 0.7 s — the ride's own rhythm, and the same trick as the transverse banding on the run: a
 * repeating thing passing at a legible rate is what turns travel into SPEED. Fewer and the climb is
 * silent; more and it is a picket fence.
 */
const PYLON_EVERY = 10;

/**
 * How tall a tower is.
 *
 * Twenty-four metres, and it is derived rather than chosen: the cliff at 7.8 m outside the rim is
 * about 14.5 m below it (`RAILS` in `render/chute.ts`), the cable is 5 m above the rim, and the rails
 * WANDER by a couple of metres either way. 24 m leaves every base a few metres inside the ice.
 * Buried is invisible; short is a tower standing in mid-air, which is trap 11 with a 24 m prop.
 */
const PYLON_HEIGHT = 24;

/** How far a span dips in the middle, as a fraction of its length. A cable hangs; a rod does not. */
const SAG = 0.02;

/**
 * How much the ride eases into the top station.
 *
 * `1 - (1 - t)^EASE`, so the car starts at 1.6× the average speed and arrives at nothing. Two reasons,
 * and neither is polish. The climb is 206 m in about four seconds — thirty times a real gondola — and
 * flat-out for the whole ride that reads as a lift shaft rather than as a journey; front-loading it
 * makes the bottom of the mountain a montage and the top a place. And ARRIVING is the thing a ride
 * has to say last: a car that slows into its station has finished, where a car still travelling at
 * full speed when the frame cuts has been interrupted. It degrades correctly too — cut the ride short
 * and the player was simply still in the fast part.
 */
const EASE = 1.6;

/**
 * How far the car swings, in radians, and how the swing decays across a span.
 *
 * It peaks just after a tower and dies away before the next, because that is what actually happens to
 * a gondola and because it gives the ride its only life. Derived from position, not from a clock: at
 * the same point on the cable the car has always swung the same amount, so a ride cut short at three
 * seconds and one that runs eight look like the same vehicle.
 */
const SWAY = 0.085;

/**
 * The cabin, and it is the ISLAND'S cabin.
 *
 * These five values are copied by hand from `render/island.ts` — `RED`, `RED_DARK`, `CREAM` — and
 * that is a problem I cannot fix from this file and want fixed. There are two gondolas in this game:
 * the one a child looks at from the square, hanging on the island's six-metre mountain, and this one,
 * which is the same vehicle from the inside of the same promise. If the two drift apart the landmark
 * stops being a promise about the ride, which is the only job the landmark has. A copied colour is
 * exactly the drift `CLAUDE.md` records for the fog pair, so the palette wants exporting from one
 * place and both files reading it.
 *
 * The SIZE is copied for the same reason: `CABIN_SIZE = 2.1` and `CABIN_HANG = 1.2` over there,
 * because 2.1 m is bigger than a penguin and that is the scale that says "you get in".
 */
const CABIN = 0xd9483c;
const CABIN_ROOF = 0xf6ecd8;
const CABIN_WINDOW = 0x27455f;
const CABIN_BASE = 0xa8342b;
const CABIN_SIZE = 2.1;
const CABIN_HANG = 1.2;

/** Painted steel. Dark enough to read against both the ice behind it and the sky above it. */
const STEEL = 0x4a5766;
const STEEL_LIGHT = 0x66748a;

/** The stations: the same two colours as the car, because they are the same building company. */
const STATION_WALL = 0xf6ecd8;
const STATION_ROOF = 0xd9483c;
const STATION_PIER = 0x8ea7bd;

export interface Gondola {
	root: Group;
	/**
	 * Draw the ride at `t`, a fraction of the way from the bottom station to the top, and answer where
	 * the car ended up so the camera can be placed against it.
	 *
	 * A negative `t` means nobody is riding: the whole thing goes invisible, which is one verb for
	 * both jobs rather than a second one the caller has to remember (trap 8's shape — a renderer with
	 * a state the caller can forget to set).
	 *
	 * The returned heading is horizontal and unit-length, pointing the way the car is travelling.
	 */
	update(t: number): { at: Vec2; altitude: number; heading: Vec2 };
	dispose(): void;
}

/**
 * Build the line from the course the simulation is using.
 *
 * From the course rather than from the seed, for the same reason `render/chute.ts` is: the mountain a
 * child rides up has to be the mountain they then race down, and two builders reading one seed is two
 * chances to disagree about which mountain that is.
 */
export function createGondola(course: readonly Floe[]): Gondola {
	const root = new Group();
	const owned: { dispose(): void }[] = [];
	const nothing = { at: { x: 0, z: 0 }, altitude: 0, heading: { x: 0, z: -1 } };
	if (course.length < 2) return { root, update: () => nothing, dispose() {} };

	/** Where the cable is anchored above a segment: out to one side, up from the rim it would have. */
	const anchorOf = (floe: Floe): Vector3 => {
		const along = segmentHeading(floe);
		const across = { x: -along.z, z: along.x };
		return new Vector3(
			floe.center.x + across.x * CABLE_SIDE * CABLE_HAND,
			floe.altitude + SLIDE_BANK_HEIGHT + CABLE_LIFT,
			floe.center.z + across.z * CABLE_SIDE * CABLE_HAND
		);
	};

	// The towers, from the bottom of the run to the top — which is the direction the ride goes, and
	// the reverse of the direction the course is built in. Both ends are always a tower, whatever
	// `PYLON_EVERY` divides into: a cable that stopped short of its own station would be the one
	// mistake in here nobody could look past.
	const marks: Floe[] = [];
	for (let i = course.length - 1; i > 0; i -= PYLON_EVERY) {
		const floe = course[i];
		if (floe) marks.push(floe);
	}
	const top = course[0];
	if (top) marks.push(top);
	const anchors = marks.map(anchorOf);
	if (anchors.length < 2) return { root, update: () => nothing, dispose() {} };

	/** How long each span is, and how far along the whole line each one starts. */
	const spans: { from: Vector3; to: Vector3; length: number; start: number }[] = [];
	let total = 0;
	for (let i = 0; i < anchors.length - 1; i++) {
		const from = anchors[i];
		const to = anchors[i + 1];
		if (!from || !to) continue;
		const length = from.distanceTo(to);
		spans.push({ from, to, length, start: total });
		total += length;
	}
	if (spans.length === 0 || total <= 0) return { root, update: () => nothing, dispose() {} };

	/**
	 * Where the cable is, a fraction `u` along one span.
	 *
	 * The dip is a half-sine rather than a real catenary, and at 2% of the span the difference is a
	 * few centimetres on seventy metres — but the dip itself is not optional. A cable drawn as a
	 * straight rod between towers reads as scaffolding; the sag is most of what says "this is hanging".
	 */
	const alongSpan = (span: { from: Vector3; to: Vector3; length: number }, u: number): Vector3 =>
		span.from
			.clone()
			.lerp(span.to, u)
			.setY(
				span.from.y + (span.to.y - span.from.y) * u - Math.sin(Math.PI * u) * SAG * span.length
			);

	// ---- everything that does not move ----

	const still: Piece[] = [];
	const UP = new Vector3(0, 1, 0);
	const turn = new Quaternion();

	/** One length of cable, laid between two points. */
	const rope = (from: Vector3, to: Vector3) => {
		const span = to.clone().sub(from);
		const length = span.length();
		if (length < 0.01) return;
		const geometry = new CylinderGeometry(0.075, 0.075, length, 5, 1);
		geometry.applyQuaternion(turn.setFromUnitVectors(UP, span.clone().normalize()));
		const mid = from.clone().add(to).multiplyScalar(0.5);
		geometry.translate(mid.x, mid.y, mid.z);
		still.push({ geometry, colour: STEEL });
	};

	// The cable, in six pieces per span so the sag is a curve rather than a corner.
	for (const span of spans) {
		for (let s = 0; s < 6; s++) {
			rope(alongSpan(span, s / 6), alongSpan(span, (s + 1) / 6));
		}
	}

	// The towers. Not on the end anchors — those carry a station, and a station with a tower growing
	// out of its roof is two buildings in one place.
	for (let i = 1; i < anchors.length - 1; i++) {
		const at = anchors[i];
		if (!at) continue;
		// A tapered leg, wide at the bottom, and it stops FLAT: the art direction's one hard rule is
		// that nothing a child is meant to like tapers to a point.
		const leg = new CylinderGeometry(0.55, 0.95, PYLON_HEIGHT, 7, 1);
		leg.translate(at.x, at.y - PYLON_HEIGHT / 2, at.z);
		still.push({ geometry: leg, colour: STEEL });
		// The crossarm, across the cable, with a wheel on each end. A tower is only legible at speed
		// because of the arm: a bare post is a stripe.
		const arm = new BoxGeometry(3.6, 0.55, 0.55);
		arm.translate(at.x, at.y + 0.5, at.z);
		still.push({ geometry: arm, colour: STEEL_LIGHT });
		for (const side of [-1, 1]) {
			const wheel = new SphereGeometry(0.5, 8, 6);
			wheel.translate(at.x + side * 1.6, at.y + 0.2, at.z);
			still.push({ geometry: wheel, colour: STEEL_LIGHT });
		}
	}

	// The two stations. Both are drawn, and the bottom one matters more than it sounds: it is behind
	// the car from the first frame, so it is the thing that says how far you have already come.
	for (const at of [anchors[0], anchors[anchors.length - 1]]) {
		if (!at) continue;
		const floorY = at.y - 4.5;
		// A pier under it, buried in the mountainside for the same reason the towers are.
		const pier = new CylinderGeometry(3.4, 4.2, PYLON_HEIGHT, 8, 1);
		pier.translate(at.x, floorY - PYLON_HEIGHT / 2, at.z);
		still.push({ geometry: pier, colour: STATION_PIER });
		// A wide drum with a wide flat roof: round, thick, wide-based, no points anywhere.
		const hall = new CylinderGeometry(5.2, 5.8, 5, 8, 1);
		hall.translate(at.x, floorY + 2.5, at.z);
		still.push({ geometry: hall, colour: STATION_WALL });
		const roof = new CylinderGeometry(6.6, 6.6, 1.1, 8, 1);
		roof.translate(at.x, floorY + 5.5, at.z);
		still.push({ geometry: roof, colour: STATION_ROOF });
		// The wheel the cable turns on, which is what makes it a station and not a shed.
		const drum = new CylinderGeometry(1.9, 1.9, 0.7, 10, 1);
		drum.rotateX(Math.PI / 2);
		drum.translate(at.x, at.y, at.z);
		still.push({ geometry: drum, colour: STEEL_LIGHT });
	}

	// Faceted, because everything here is painted steel and cut ice rather than a character — the one
	// place `docs/ART-DIRECTION.md` says to keep flat shading.
	const stillMaterial = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
	const stillMesh = bake(still, stillMaterial);
	owned.push(stillMaterial);
	if (stillMesh) {
		root.add(stillMesh);
		owned.push(stillMesh.geometry);
	}

	// ---- the car ----

	// Built hanging from its own ORIGIN, which is the point on the cable it is attached to, so the
	// sway below is a rotation about that point rather than a rotation plus a correction. Forward is
	// +x; `update` yaws it onto the heading.
	const cabin: Piece[] = [];

	// The middle of the body, and every other piece is placed against it: the cabin's top sits exactly
	// `CABIN_HANG` under the cable and it is exactly `CABIN_SIZE` tall, both taken from the island's.
	const half = CABIN_SIZE / 2;
	const middle = -CABIN_HANG - half;

	const hanger = new BoxGeometry(0.34, CABIN_HANG, 0.34);
	hanger.translate(0, -CABIN_HANG / 2, 0);
	cabin.push({ geometry: hanger, colour: STEEL });
	const trolley = new BoxGeometry(1.5, 0.5, 0.6);
	trolley.translate(0, 0.12, 0);
	cabin.push({ geometry: trolley, colour: STEEL_LIGHT });

	// The body, and it is SMOOTH: a sphere keeps its own normals through `bake` (the merge is
	// non-indexed, so whatever normals a piece arrives with are the normals it ends up with), and the
	// art direction wants round for anything a child is meant to like. Flat shading is for the ice.
	const body = new SphereGeometry(1, 14, 10);
	body.scale(half * 1.15, half, half);
	body.translate(0, middle, 0);
	cabin.push({ geometry: body, colour: CABIN });
	// A window band all the way round, so there is something to look out of from every angle the
	// camera can be placed at — and a dark band is what makes a coloured lump read as a vehicle.
	const glass = new SphereGeometry(1, 14, 10);
	glass.scale(half * 1.18, half * 0.4, half * 1.03);
	glass.translate(0, middle + 0.1, 0);
	cabin.push({ geometry: glass, colour: CABIN_WINDOW });
	// A cream cap on top and a darker floor pan under, which between them stop the body reading as a
	// balloon. The pan is the one piece with a hard edge, because it is the one part that is a FLOOR.
	const cap = new SphereGeometry(1, 14, 8);
	cap.scale(half * 0.96, half * 0.48, half * 0.86);
	cap.translate(0, middle + half * 0.62, 0);
	cabin.push({ geometry: cap, colour: CABIN_ROOF });
	const pan = new CylinderGeometry(half * 1.02, half * 0.9, 0.34, 12, 1);
	pan.translate(0, middle - half * 0.92, 0);
	cabin.push({ geometry: pan, colour: CABIN_BASE });

	const carMaterial = new MeshLambertMaterial({ vertexColors: true });
	const car = bake(cabin, carMaterial);
	owned.push(carMaterial);
	if (car) {
		// `bake` turns `matrixAutoUpdate` off, because almost everything baked never moves. This one
		// does, every frame of the ride, so it goes back on — the alternative is a mesh that is drawn
		// at the origin for the whole ride while every number about it is right (trap 15's shape).
		car.matrixAutoUpdate = true;
		root.add(car);
		owned.push(car.geometry);
	}

	return {
		root,
		update(t) {
			if (t < 0) {
				root.visible = false;
				return nothing;
			}
			root.visible = true;

			const travelled = (1 - (1 - Math.max(0, Math.min(1, t))) ** EASE) * total;
			// Which span, and how far along it. Linear search over six spans, once a frame.
			let span = spans[spans.length - 1];
			for (const candidate of spans) {
				if (travelled <= candidate.start + candidate.length) {
					span = candidate;
					break;
				}
			}
			if (!span) return nothing;
			const u = span.length > 0 ? Math.min(1, (travelled - span.start) / span.length) : 0;
			const at = alongSpan(span, u);

			// The way the car is going, horizontal and unit-length. Taken from the SPAN rather than
			// from the course: the cable is straight between towers and the course is not, so a heading
			// borrowed from the segment underneath would point the car off its own cable on every bend.
			const dx = span.to.x - span.from.x;
			const dz = span.to.z - span.from.z;
			const flat = Math.hypot(dx, dz) || 1;
			const heading = { x: dx / flat, z: dz / flat };

			if (car) {
				car.position.copy(at);
				// Two swings across a span, dying away as the tower behind recedes. `u` is a position,
				// so the same point on the cable always looks the same however long the ride lasted.
				const sway = Math.sin(u * Math.PI * 4) * (1 - u) * SWAY;
				car.rotation.set(0, Math.atan2(-heading.z, heading.x), sway);
			}

			return { at: { x: at.x, z: at.z }, altitude: at.y, heading };
		},
		dispose() {
			for (const thing of owned) thing.dispose();
		}
	};
}
