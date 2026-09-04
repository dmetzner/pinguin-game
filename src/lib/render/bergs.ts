/**
 * The icebergs on the horizon.
 *
 * Pure scenery, and the only thing in this game that is. Everything else on screen is the simulation
 * drawn — every floe you can stand on, every hill you can climb, every chunk somebody is watching
 * from. These are outside all of it, in open water beyond the ring of spectators, and nothing can
 * ever reach them.
 *
 * They earn their place by giving the sea a SIZE. A Royal's archipelago is thirty metres across with
 * nothing around it but a fog gradient, so the eye has no way to judge how far the next floe is or
 * how big the one it is standing on: everything reads as a diorama. A few tall bergs at a known
 * distance turn that into a horizon, and the camera panning between floes suddenly moves through
 * something rather than across a texture.
 *
 * Seeded from the round, so the same sea has the same skyline everywhere — a player saying "the one
 * near the big berg" is describing a place their friend can also see.
 *
 * **They are made of BOXES, and the reason is a screenshot.** The first two versions were stacks of
 * tapering cylinders, and both read as white conifers: two of them were the most eye-catching thing
 * in the top half of the frame and the word they said was "Christmas tree". A cone is the wrong shape
 * for ice at any scale. Ice fractures along planes, so a berg is flat faces meeting at hard angles,
 * broad on top rather than pointed, with slabs that have slid off it leaning against its side — and
 * the one place in this renderer where `flatShading` is unarguably right.
 */
import { BoxGeometry, Group, MeshLambertMaterial } from 'three';
import { alongStops, bake, type Contact, type Piece } from './bake';
import { SEA_LEVEL } from './floeField';

/**
 * How far BEYOND the outermost ice they sit, in metres.
 *
 * Measured from the edge rather than as a multiple of the sea's radius, which was the first attempt
 * and put them 50–90 m out in a Royal: past `FOG_FAR`, where the scene fades everything to sky, so
 * the horizon was three grey ghosts. The same multiple in the classic round would have parked them
 * almost against the floe. A distance from the ice is the same distance in both games.
 */
const BEYOND_NEAR = 16;
const BEYOND_FAR = 38;

/**
 * How much of a berg stands OUT of the water, in metres. Tall enough to break the horizon from a
 * camera that sits low.
 */
const MIN_HEIGHT = 3.5;
const MAX_HEIGHT = 9;

/**
 * How much ice there is below the waterline: at least this many metres, and at least this fraction of
 * what stands above it.
 *
 * The first version had 12% of the height under water and the bergs were photographed HOVERING, with
 * open sea visible under the ice and a flat bottom face on show — they read as folded paper boats.
 * The arithmetic is the whole of it: 12% of a 3.5 m berg is 42 cm, the ocean's own shader moves the
 * water ±76 cm (`scene.ts`), and the berg bobs another ±18 cm on top of that. The sea spent half its
 * time below the bottom of the ice.
 *
 * So the floor is set against what the WATER does, not against what the berg is: 1.8 m clears a
 * trough and a bob with 86 cm to spare, on the smallest berg there is. The share on top of that is
 * what makes a big berg sit deep as well as tall. Neither is anywhere near the nine-tenths physics
 * asks for, and they do not need to be — the sea is opaque, so ice below the trough is ice nobody
 * will ever see, and drawing it would be paying for triangles inside a wall.
 */
const DRAUGHT_MIN = 1.8;
const DRAUGHT_SHARE = 0.55;

/**
 * How far the keel's flat underside sits below the rest of the submerged ice, in metres.
 *
 * A box has a bottom, and a bottom that ends anywhere the eye can follow is the paper-boat read
 * again. This is only there so the one horizontal face in the whole berg is deeper than everything
 * else that could draw attention to it.
 */
const KEEL_BELOW = 0.4;

/**
 * How much of a block is buried in the one below it.
 *
 * The overlap is what makes a stack read as one thing that cracked rather than as a tower of crates
 * — and it is also why the block heights are scaled back up afterwards. Without that, the shares
 * below add up to a berg a fifth shorter than the height it was given, which quietly undoes the
 * whole reason `MIN_HEIGHT` and `MAX_HEIGHT` are what they are: a berg that does not break the
 * horizon from a camera sitting this low is a white smudge on the sea.
 */
const OVERLAP = 0.8;

/** How far they rise and fall on the swell, and how slowly. Slower than the floes: they are heavier. */
const BOB = 0.18;
const BOB_HZ = 0.06;

/**
 * The colour of the ice, as (fraction of the ABOVE-WATER height, colour) stops — so zero is the
 * waterline, one is the summit, and anything negative is under the sea.
 *
 * Paler with height and bluer low down, which is what makes a white shape against a white sky read as
 * ice rather than as a hole in the fog. The lowest stop is doing a second job as well: it is the only
 * value on screen darker than the water, and it is what stops the berg's silhouette dissolving into
 * the sea behind it.
 */
const ICE_STOPS: [number, number][] = [
	[-1, 0x47799a],
	[0, 0x7ea9c3],
	[0.35, 0xd2e8f6],
	[1, 0xf6fcff]
];

/**
 * The wet band where the sea has been washing over it.
 *
 * Deeper and stronger than a floe's contact seam, and scaled by the berg's own height, because a
 * fifteen-centimetre line on a nine-metre berg is a hairline and the same line on a three-metre one
 * is a stripe. This is the single thing that makes a berg look heavy rather than placed.
 */
function waterlineOf(height: number): Contact {
	return { reach: 0.35 + height * 0.06, colour: 0x235d80, strength: 0.9 };
}

export interface Bergs {
	root: Group;
	/** The swell. Bergs bob on their own phases, like everything else floating out there. */
	setTime(seconds: number): void;
	dispose(): void;
}

/**
 * @param seaRadius How far out the playable ice reaches. Nothing is drawn inside it.
 * @param seed The round's seed, so a sea has one skyline rather than a new one per device.
 */
export function createBergs(seaRadius: number, seed: number): Bergs {
	const root = new Group();
	const owned: { dispose(): void }[] = [];
	const drifting: { mesh: Group; phase: number; base: number }[] = [];

	let state = (seed * 2654435761) >>> 0;
	const rand = () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};

	// Seven, spread around rather than scattered at random: a ring with jitter never leaves a whole
	// quadrant of empty horizon, which is what a purely random placement does about a third of the
	// time and which reads as a bug in a game whose camera turns to face different floes.
	const count = 7;
	for (let i = 0; i < count; i++) {
		const angle = ((i + rand() * 0.6) / count) * Math.PI * 2;
		const away = seaRadius + BEYOND_NEAR + rand() * (BEYOND_FAR - BEYOND_NEAR);
		const crown = MIN_HEIGHT + rand() * (MAX_HEIGHT - MIN_HEIGHT);
		const width = crown * (0.42 + rand() * 0.4);
		// Where the sea cuts this berg, in its own space. The geometry is built up from zero and the
		// group is then dropped so that this height lands on the water.
		const draught = Math.max(DRAUGHT_MIN, crown * DRAUGHT_SHARE);

		const berg = new Group();
		const pieces: Piece[] = [];
		const shade = (_x: number, y: number) => alongStops(ICE_STOPS, (y - draught) / crown);

		// The KEEL: the widest block in the berg, most of it under water, breaking the surface as a
		// broad wet shelf with the rest of the ice standing on it. This is what stops a berg being a
		// silhouette that ends at the waterline — an iceberg is mass continuing down, and the eye reads
		// that from the base being wider than everything above it, not from being told.
		const keelTop = draught + crown * 0.18;
		const keel = new BoxGeometry(
			width * (1.25 + rand() * 0.3),
			keelTop + KEEL_BELOW,
			width * (1.1 + rand() * 0.3)
		);
		keel.rotateZ((rand() - 0.5) * 0.1);
		keel.rotateY(rand() * Math.PI);
		keel.translate(
			(rand() - 0.5) * width * 0.2,
			(keelTop - KEEL_BELOW) / 2,
			(rand() - 0.5) * width * 0.2
		);
		pieces.push({ geometry: keel, colour: shade, groundY: draught });

		// The mass: a broad block with one or two smaller ones shoved up out of it, each turned and
		// tipped a few degrees off true and each overlapping the one below by a fifth of its height, so
		// the stack reads as one thing that cracked rather than as a tower of crates. Broad on top, not
		// pointed — a tabular berg is what a shelf breaks into, and it is also the silhouette that
		// cannot be mistaken for a tree.
		const blocks = 2 + Math.floor(rand() * 2);
		const shares = Array.from({ length: blocks }, (_, b) => (b === 0 ? 0.6 : 0.4 / (blocks - 1)));
		let reach = 0;
		for (let b = 0; b < blocks; b++) {
			reach += (shares[b] ?? 0) * (b === blocks - 1 ? 1 : OVERLAP);
		}
		const lift = reach > 0 ? 1 / reach : 1;
		// From the waterline up: everything above this is the part of the berg anybody sees.
		let standing = draught;
		for (let b = 0; b < blocks; b++) {
			const tall = crown * (shares[b] ?? 0) * lift;
			const spread = 1 - b * 0.26;
			const geometry = new BoxGeometry(
				width * (1.05 + rand() * 0.5) * spread,
				tall,
				width * (0.85 + rand() * 0.5) * spread
			);
			geometry.rotateZ((rand() - 0.5) * 0.2);
			geometry.rotateX((rand() - 0.5) * 0.2);
			geometry.rotateY(rand() * Math.PI);
			geometry.translate(
				(rand() - 0.5) * width * 0.45,
				standing + tall / 2,
				(rand() - 0.5) * width * 0.45
			);
			pieces.push({ geometry, colour: shade, groundY: draught });
			standing += tall * OVERLAP;
		}

		// And the slabs that came off it: thin sheets tipped well past vertical, leaning on the mass
		// with their bottom ends in the water. One of these does more to say "ice" than the whole stack
		// above it — it is the only shape out there that could not be anything else.
		const slabs = 1 + Math.floor(rand() * 2);
		for (let s = 0; s < slabs; s++) {
			const length = crown * (0.45 + rand() * 0.4);
			const geometry = new BoxGeometry(
				width * (0.45 + rand() * 0.4),
				length,
				width * (0.12 + rand() * 0.1)
			);
			// Tipped by a quarter to a half of a right angle, then yawed: the lean ends up wherever the
			// yaw points it, which is the whole point of drawing it seeded rather than placed.
			const lean = 0.25 + rand() * 0.35;
			geometry.rotateX(lean * (Math.PI / 2));
			const yaw = rand() * Math.PI * 2;
			geometry.rotateY(yaw);
			const out = width * (0.6 + rand() * 0.45);
			geometry.translate(
				Math.sin(yaw) * out,
				draught + (length / 2) * Math.cos(lean * (Math.PI / 2)),
				Math.cos(yaw) * out
			);
			pieces.push({ geometry, colour: shade, groundY: draught });
		}

		// One mesh per berg rather than six or seven: they never move relative to each other, and seven
		// bergs of six blocks is forty-two objects for scenery nobody can reach.
		const material = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
		const baked = bake(pieces, material, waterlineOf(crown));
		if (baked) berg.add(baked);
		owned.push(material);
		if (baked) owned.push(baked.geometry);

		const base = SEA_LEVEL - draught;
		berg.position.set(Math.sin(angle) * away, base, Math.cos(angle) * away);
		berg.rotation.y = rand() * Math.PI * 2;
		root.add(berg);
		drifting.push({ mesh: berg, phase: rand() * Math.PI * 2, base });
	}

	return {
		root,
		setTime(seconds) {
			for (const berg of drifting) {
				berg.mesh.position.y =
					berg.base + Math.sin(seconds * BOB_HZ * Math.PI * 2 + berg.phase) * BOB;
			}
		},
		dispose() {
			for (const thing of owned) thing.dispose();
		}
	};
}
