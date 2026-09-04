/**
 * Fins in the water.
 *
 * Pure scenery, like `bergs.ts`, and it earns its place for the same kind of reason: the sea in this
 * game is fatal and it looks like a calm blue plane. A child who falls in loses the round, and
 * nothing on screen ever said why the water was a bad place to be. A fin tracing a slow circle says
 * it at a glance, in a language an eight-year-old already speaks, and it says it BEFORE the mistake
 * rather than after.
 *
 * Nothing here is in the simulation and nothing here can touch anybody. A shark that could actually
 * eat a penguin would be a rule, and a rule belongs in `sim/` where it can be tested and replayed —
 * see `backlog/stories/08-the-chase.md`, where a hunter is exactly that and is built that way.
 *
 * Seeded from the round, so both players in a room watch the same sea.
 */
import { ConeGeometry, Group, MeshLambertMaterial, SphereGeometry } from 'three';
import { bake, type Piece } from './bake';

/** How many. Enough that one is nearly always in frame, few enough that the sea is not a shoal. */
const COUNT = 5;

/**
 * How many when the ice is a LINE, which is a different question.
 *
 * Five is right for a ring around one floe, where every fin is somewhere on the same circle the
 * camera is looking at. A chase route is 236 m long, so five of them are parked 47 m apart — one fin
 * every four seconds of running, and only sometimes beside a gap. Ten is a fin in most of the holes,
 * and ten draw calls is affordable in the one mode that has six penguins in it rather than thirty.
 */
const CORRIDOR_COUNT = 10;

/** How far outside the ice they circle, in metres. Inside the fog, outside anything reachable. */
const NEAR = 5;
const FAR = 22;

/** How fast one goes round, in radians a second. Slow: a cruising fin, not a shark attack. */
const MIN_RATE = 0.035;
const MAX_RATE = 0.075;

/**
 * The circle one keeps when the ice is a line, and the BAND beside the route it patrols.
 *
 * Small and close: the point of a fin in a chase is to be in the gap you are about to jump, which
 * means it has to be near enough to see and far enough not to look like it is on the ice. A band
 * rather than a spread, because a platform is about three metres of radius and a fin scattered
 * anywhere in ±7 m of the centre line spends part of its circle UNDERNEATH the ice the player is
 * standing on — which is both invisible and, for the two seconds it takes to come out the other
 * side, a shark apparently swimming through a floe.
 */
const CORRIDOR_CIRCLE = 3.2;
const CORRIDOR_INSIDE = 4.5;
const CORRIDOR_OUTSIDE = 9;

/**
 * A shark, in three tones, and the two that were missing are the two that made it invisible.
 *
 * The body was near-black on dark blue water, which at any distance is a wave shadow — the fins were
 * in the frame and nobody could find them. So the back is LIGHTER than it was, and the fin carries a
 * white tip and a collar of foam at the waterline. Both are the same trick as the sea lion's wake:
 * white on blue is the one contrast in this palette that survives the fog, and a fin with foam
 * around it reads as a thing MOVING THROUGH water rather than as a triangle lying on it.
 *
 * The white tip is not decoration either — it is what an oceanic whitetip actually has, and a pale
 * triangle over a dark back is a shape a child has seen in a cartoon and already knows the meaning
 * of.
 */
/**
 * The dorsal fin: how big, how raked, how flat, and how high it stands out of the water.
 *
 * All four are here rather than inline because the WHITE TIP is derived from every one of them — a
 * fin that grew and a tip that did not would be a fin with a white band across its middle.
 */
const FIN_R = 0.4;
const FIN_H = 0.92;
const FIN_RAKE = 0.22;
const FIN_FLAT = 0.42;
const FIN_LIFT = 0.38;

const BODY = 0x2f5f80;
const FIN = 0x25496a;
const TIP = 0xf3fbff;
const SPRAY = 0xdcf0fb;

export interface Sharks {
	root: Group;
	setTime(seconds: number): void;
	dispose(): void;
}

/**
 * @param seaRadius How far out the playable ice reaches. Nothing circles inside it.
 * @param seed The round's seed.
 * @param corridor How long the route is, in metres, when the ice is a LINE rather than an arena.
 *   Given, the fins patrol the water beside and between the platforms instead of ringing the whole
 *   sea — which in a chase is what was actually asked for: something in the gaps you are jumping
 *   over. A ring a hundred metres across in that mode puts every fin out of sight.
 */
export function createSharks(seaRadius: number, seed: number, corridor?: number): Sharks {
	const root = new Group();
	const owned: { dispose(): void }[] = [];
	const swimming: {
		mesh: Group;
		radius: number;
		/** Where its circle is centred, for a corridor. Undefined means the middle of an arena. */
		at?: { x: number; z: number };
		rate: number;
		phase: number;
		bob: number;
	}[] = [];

	let state = (seed * 374761393) >>> 0;
	const rand = () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};

	// ONE material for the whole shoal rather than one each: they are the same three tones, and five
	// identical materials are five programs three has to keep and five things to dispose.
	const material = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
	owned.push(material);

	const count = corridor === undefined ? COUNT : CORRIDOR_COUNT;
	for (let i = 0; i < count; i++) {
		const shark = new Group();
		const pieces: Piece[] = [];

		// A back and a fin, and that is the whole animal. What is above the waterline of a swimming
		// shark IS a fin and a sliver of back — modelling the rest would be modelling something
		// nobody can see, and it would have to be hidden by the ocean shader rather than by not
		// existing. Nose along +x, tail along −x.
		const back = new SphereGeometry(0.55, 10, 6);
		back.scale(2.1, 0.34, 0.8);
		back.translate(0, -0.06, 0);
		pieces.push({ geometry: back, colour: BODY });

		// The dorsal, raked backwards. A cone with three sides is a triangle from every angle that
		// matters, and the rake is what stops it reading as a traffic cone. Half again as tall as it
		// was: a fin is the entire silhouette of this animal, and at the distance the fog leaves one
		// visible the old 62 cm was a ripple.
		const fin = new ConeGeometry(FIN_R, FIN_H, 3);
		fin.rotateY(Math.PI / 2);
		fin.scale(1, 1, FIN_FLAT);
		fin.rotateX(FIN_RAKE);
		fin.translate(0, FIN_LIFT, 0);
		pieces.push({ geometry: fin, colour: FIN });

		// And the white tip: the same cone at 42% of the size, 6% fatter so the two surfaces cannot
		// z-fight over the same skin, lifted to share the fin's own apex and then given the same rake
		// and the same lift. Built in that order for a reason — raking it first and matching the apex
		// afterwards leaves it 6 cm forward of the point it is supposed to be the point of, which
		// pokes a white wedge out through the front edge of the fin.
		const tipH = FIN_H * 0.42 * 1.06;
		const tip = new ConeGeometry(FIN_R * 0.42, FIN_H * 0.42, 3);
		tip.rotateY(Math.PI / 2);
		tip.scale(1.06, 1.06, FIN_FLAT * 1.06);
		tip.translate(0, (FIN_H - tipH) / 2, 0);
		tip.rotateX(FIN_RAKE);
		tip.translate(0, FIN_LIFT, 0);
		pieces.push({ geometry: tip, colour: TIP });

		// The tail tip, which breaks the surface a body-length behind the fin. Two marks moving
		// together is what makes it read as one long animal rather than as a floating triangle.
		const tail = new ConeGeometry(0.2, 0.4, 3);
		tail.rotateY(Math.PI / 2);
		tail.scale(1, 1, 0.4);
		tail.rotateX(-0.5);
		tail.translate(-1.5, 0.1, 0);
		pieces.push({ geometry: tail, colour: FIN });

		// The collar of foam at the waterline, WIDER than the back it rings so the pale ring shows
		// around the dark shape from a camera looking down at it. This is the piece that does the
		// work: the fin says shark and the foam says the shark is moving.
		const collar = new SphereGeometry(1, 12, 6);
		collar.scale(1.5, 0.05, 0.62);
		collar.translate(0.1, 0.07, 0);
		pieces.push({ geometry: collar, colour: SPRAY });

		// And the V it drags. Two streaks splaying off the tail — the shape every drawing of a fin in
		// water has behind it, and the reason one is legible in a still frame at all.
		for (const side of [-1, 1]) {
			const streak = new SphereGeometry(1, 8, 4);
			streak.scale(1.25, 0.04, 0.1);
			streak.rotateY(side * 0.22);
			streak.translate(-1.5, 0.06, side * 0.42);
			pieces.push({ geometry: streak, colour: SPRAY });
		}

		const baked = bake(pieces, material);
		if (baked) shark.add(baked);
		if (baked) owned.push(baked.geometry);

		// Heading first, then the roll — three's default order applies `rotation.x` about the WORLD's
		// x axis, and a shark halfway round its own circle would roll about its beam instead of about
		// its spine, which is a fin flopping over sideways.
		shark.rotation.order = 'YXZ';
		root.add(shark);
		swimming.push({
			mesh: shark,
			// In a corridor a shark keeps a small circle of its own, parked somewhere along the route;
			// in an arena they all ring the ice at their own distance.
			radius: corridor === undefined ? seaRadius + NEAR + rand() * (FAR - NEAR) : CORRIDOR_CIRCLE,
			at:
				corridor === undefined
					? undefined
					: {
							// Beside the route, in a band and on one side or the other — never on the
							// centre line, where the ice is. See `CORRIDOR_INSIDE`.
							x:
								(rand() < 0.5 ? -1 : 1) *
								(CORRIDOR_INSIDE + rand() * (CORRIDOR_OUTSIDE - CORRIDOR_INSIDE)),
							// Spread down the route rather than scattered: five random points on a
							// two-hundred-metre line leave most of it empty about half the time.
							z: -((i + 0.5 + (rand() - 0.5) * 0.6) / count) * corridor
						},
			// Half of them the other way round, or five sharks all circling clockwise read as a
			// carousel.
			rate: (MIN_RATE + rand() * (MAX_RATE - MIN_RATE)) * (rand() < 0.5 ? -1 : 1),
			phase: rand() * Math.PI * 2,
			bob: rand() * Math.PI * 2
		});
	}

	return {
		root,
		setTime(seconds) {
			for (const shark of swimming) {
				const angle = shark.phase + seconds * shark.rate;
				const middle = shark.at;
				shark.mesh.position.set(
					(middle?.x ?? 0) + Math.sin(angle) * shark.radius,
					// Riding the swell, and dipping under now and then: a fin that never submerges is a
					// buoy. The sine is deliberately slower than the wave it is riding.
					Math.sin(seconds * 0.55 + shark.bob) * 0.1 - 0.12,
					(middle?.z ?? 0) + Math.cos(angle) * shark.radius
				);
				// Facing along the circle it is swimming, which is the tangent — and the sign follows
				// the direction, so a shark going the other way is not swimming backwards. Plus a
				// weave: a fin that holds one exact heading for a forty-second circle is a buoy on a
				// string, and the weave is a tenth of a radian, which is enough.
				shark.mesh.rotation.y =
					angle +
					(shark.rate > 0 ? Math.PI / 2 : -Math.PI / 2) +
					Math.sin(seconds * 0.9 + shark.phase) * 0.1;
				// And it rolls into the weave, which is the only thing on it that says it is a body
				// rather than a shape being dragged sideways.
				shark.mesh.rotation.x = Math.sin(seconds * 0.9 + shark.phase) * 0.06;
			}
		},
		dispose() {
			for (const thing of owned) thing.dispose();
		}
	};
}
