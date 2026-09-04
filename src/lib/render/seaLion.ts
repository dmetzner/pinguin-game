/**
 * The sea lion: the thing you are running from.
 *
 * It is drawn at `world.hunterAt`, which the simulation keeps as a distance along the course and
 * nothing more (`sim/chase.ts`). Nothing here decides anything — the same relationship the renderer
 * has with every other part of the world, and it matters more than usual for this one, because a
 * monster whose position came from the renderer would be a monster that arrives at a different time
 * on a slower phone.
 *
 * Built once at mount and moved every frame, like `snowball.ts`'s pool: a creature allocated the
 * first time it is needed would allocate it in the frame the player most needs the frame rate.
 *
 * It is the emotional centre of the mode and it is allowed to cost more than anything else on
 * screen: EIGHT draw calls, against two for the version before it (2026-08-21). There is exactly one
 * of it, a chase has six penguins rather than a Royal's thirty, and seven of the eight are parts
 * that MOVE independently — body, head, jaw, two fore-flippers, the rear, the wake — with the ground
 * shadow as the eighth. Anything that does not move relative to its parent is baked into the part
 * that carries it, which is what keeps a face made of thirty-odd primitives down to one call.
 *
 * ## The one thing that makes this animal hard to draw
 *
 * **It is seen from behind for the whole mode, and it faces away from the camera.** The rig sits
 * about eleven metres behind the penguin it is framing, the hunter comes up the route behind that,
 * and the model faces down the course — so the nose, the mouth, the whiskers and both eyes are all
 * on the FAR side of a two-and-a-half-metre body. The version before this one put a small head and
 * two tusks on the end that nobody can see, which is most of why it read as a brown potato: every
 * feature it had was pointing away.
 *
 * Three answers, and all three are needed:
 *
 *  1. **The head SWINGS**, half a radian either way. At the extreme, one eye, one cheek and the
 *     whiskers swing clear of the skull and are visible from directly behind — the face arrives on
 *     screen every second or so instead of never.
 *  2. **The eyes bulge past the skull's own silhouette** rather than sitting in it, so there is
 *     something to see even at the middle of the swing. Big pale eyeball, dark pupil pushed out of
 *     it, one white glint: the same trick every Animal Crossing face uses, and it survives being
 *     twenty metres away and four pixels wide because it is three tones rather than a shape.
 *  3. **The head breaks the line of the back.** A silhouette whose top edge is one smooth hump is a
 *     rock. A hump with a head on it is an animal.
 */
import {
	CircleGeometry,
	ConeGeometry,
	CylinderGeometry,
	Group,
	Mesh,
	MeshLambertMaterial,
	MeshPhongMaterial,
	SphereGeometry
} from 'three';
import type { Vec2 } from '../sim/types';
// The one place the sin/cos convention for a direction is written down, and the same function the
// penguins' `facing` comes out of. See `update` for what it cost to have it written down twice.
import { heading as angleOf } from '../sim/vec';
import { bake, type Piece } from './bake';
import { FLOE_THICKNESS } from './floeField';

/**
 * How big the animal is drawn, against the metres it is modelled in below.
 *
 * The one knob that resizes the boss, and it is held where it is on purpose: `08-the-chase.md`
 * measured the sea lion's 17 m start distance AGAINST THE CAMERA — at nine metres it was a wall
 * across the bottom third of the screen with the game behind it. This model is a longer animal than
 * the one that measurement was taken with, so it is scaled back to the same 6.6 m and the same
 * height, and the whole redesign is a change of what it looks like rather than of how much screen
 * it takes.
 */
const SIZE = 0.86;

/**
 * And how much of that length it keeps — an extra squash along the COURSE only.
 *
 * This is a framing constant, not a taste one, and it is the smaller half of a problem the camera
 * owns (see `back`). The animal is drawn BEHIND the line it is eating and the rig stands 18.1 m
 * behind the player, so every metre of body is a metre nearer the lens; at 6.6 m long its whole rear
 * half was under the camera and off the bottom of the screen, which is where all the work went.
 *
 * Squashing rather than scaling, because shortening is the one axis that costs nothing: it is a
 * five-metre animal that is still 2.2 m wide and 2.5 m tall, so it loses no bulk from any angle the
 * player sees it from — and a stubbier body with the same head on it is MORE of the shape the art
 * direction asks for, not less. Nothing tapers, nothing is long and thin, and the head is a bigger
 * fraction of the silhouette than it was.
 */
const LENGTH_SQUASH = 0.76;

/**
 * Where the water is: the same line `scene.ts` puts the ocean plane on.
 *
 * Written as the expression rather than as −0.83 because the number is a consequence of how thick a
 * floe is, and `floeField.ts` already spells the identical expression out for its foam ring. Not
 * imported from `scene.ts`, which imports THIS file — that would be a cycle.
 */
const WATER_Y = -FLOE_THICKNESS * 0.72;

/**
 * How wide the wake reaches to either side of the route, in metres.
 *
 * This is the number that makes the mode's core rule visible, and it is chosen against the ICE
 * rather than against the animal: a chase platform is about three metres of radius, so a crest
 * seven metres out either side always has both its ends hanging over open water. That is the whole
 * mechanism by which a player who cannot see the sea lion — behind a block, behind a rise, or
 * behind the camera itself, which happens whenever the leash is longer than the eleven metres the
 * rig stands back — can still see the line being eaten.
 */
const WAKE_HALF_WIDTH = 7;

/**
 * Where the animal rides, relative to whatever it is on.
 *
 * Two heights, and the difference between them is the whole character of the thing. In the water it
 * swims low — a back and a head, the rest under, which is what a sea lion at speed actually looks
 * like. Over a platform it HAULS OUT and galumphs across the ice after you. Left swimming at one
 * height it spent half the course hidden underneath the very platforms the player is running along,
 * which is the one place it must never be: this animal is the clock, and a clock you cannot see is
 * not a clock.
 *
 * `HAUL_RIDE` is measured off the model rather than chosen: the belly's lowest point is 1.14 of the
 * metres the animal is modelled in, so it is written in those and scaled, and 1.02 of them leaves ten
 * centimetres of belly in the ice — which is what weight looks like. Anything much less than that is
 * an animal standing INSIDE the platform. The version before this one rode at a flat 0.25 with two
 * thirds of a metre of itself buried, which is trap 11 with a monster in it.
 */
const SWIM_RIDE = -1.24;
const HAUL_RIDE = 1.02 * SIZE;

/** How fast it settles between those two, per frame. Chased, so coming out of the water is a lunge. */
const RIDE_CHASE = 0.08;

/**
 * The stroke, in radians a second: a swimming animal and a galumphing one are not the same tempo.
 *
 * Integrated rather than read off `seconds * rate`, because the rate CHANGES when it hauls out and
 * a sine whose frequency jumps mid-round jumps its phase with it — the body would teleport through
 * half a stroke at the waterline, which is exactly the moment the player is watching it.
 */
const SWIM_RATE = 2.4;
const GALUMPH_RATE = 5.2;

/** How far the body shoves itself forward and back inside a stroke, in metres. */
const SURGE = 0.2;

/**
 * The head swing: how far, and how fast.
 *
 * Half a radian, 29°, is what it takes for the outer eye to clear the skull and be visible from
 * DIRECTLY behind (measured off the model, not guessed) — and 0.6, or 34°, is what it takes to be
 * worth something from a rig turned off the route. The two add: with the camera 30° off the tail, the
 * far end of the swing puts the head 64° round, which is a muzzle, a mouth line, one eye and a fan of
 * whiskers in near-full profile. The swing is not decoration on this animal, it is the only mechanism
 * by which its face is ever pointed anywhere near the player.
 *
 * Slower than the stroke on purpose — a head that swept at the tempo of its own flippers read as a
 * windscreen wiper.
 */
const HEAD_SWING = 0.6;
const SWING_RATE = 2.4;

/**
 * The LUNGE, which is the one thing on this animal that says "it is hunting you".
 *
 * Surface detail cannot say that. A body that rears, throws its mouth open and drops back can, and
 * it is also the only moment the face is pointed anywhere a player might be looking: the head stops
 * swinging and locks forward down the course for the length of it, which from a rig turned off the
 * route is a three-quarter view of an open mouth.
 *
 * One value drives all of it — pitch, lift, jaw, flippers, the wake and the swing it suppresses —
 * because a lunge whose parts each had their own timer would be a body doing five unrelated things.
 * `sin` raised to a power is what turns a wave into a PULSE: the fifth power spends about a second
 * of every five doing something and the rest of the cycle at rest, where a plain sine would have the
 * animal permanently half-rearing.
 *
 * `LUNGE_LIFT` is not decoration either — it is the compensation. Rearing rotates the body about its
 * own origin, so the tail, 1.9 drawn metres behind that origin, drops `1.9 · sin(REAR)` as the nose
 * comes up. Lift it by that much and the tail stays on the ice instead of going through it.
 */
const LUNGE_RATE = 1.25;
const LUNGE_SHARPNESS = 5;
const LUNGE_REAR = 0.3;
const LUNGE_LIFT = 0.56;

/** How far the jaw drops at the peak of one. Wide: a mouth half open is a yawn. */
const JAW_OPEN = 0.72;

/** How far behind the stroke the rear end is, in radians. A tail that led its own body is a fish. */
const TAIL_LAG = 1.1;

/**
 * The hide, and the three tones that give it a top and a bottom at a glance.
 *
 * Warm amber-brown, and the CHROMA is the whole point of the third attempt at this. Brown-grey mud
 * was the biggest object on screen and the least legible one; the saturated ginger that replaced it
 * read as a traffic cone at this size, which is worse — it was also louder than the penguins, and
 * the penguins are the subject. This is the same warm hue with the saturation taken most of the way
 * out and the value dropped, which keeps both separations that matter (dark against white ice, warm
 * against blue water) and gives them back to the six primary-coloured birds it is chasing.
 */
const HIDE = 0xa06840;
const SADDLE = 0x6b4326;
const BELLY = 0xe8cba4;

/** The face. A big shiny black nose is the cheapest cute there is; the pale eye is what reads. */
const EYE_PALE = 0xfdf8ee;
const EYE_DARK = 0x18120f;
const NOSE = 0x2e1c15;
const WHISKER = 0xf4ece0;

/** Teeth and the inside of the mouth. Pink, because an open mouth has to read as OPEN. */
const TOOTH = 0xfffdf4;
const MOUTH = 0xc9505c;
const TONGUE = 0xe0757f;

/**
 * The foam it pushes.
 *
 * A touch COOLER and darker than the ice it crosses (`--ice` is 0xf4fbff), which is the opposite of
 * the first instinct: foam brighter than the floe made the brightest thing on screen a decoration,
 * and on a white platform a white line is nothing anyway — that is what `WAKE_SHADE` is for.
 */
const FOAM = 0xe4f4fd;

/**
 * The dark line right behind the crest, which is what makes the wake survive being on ICE.
 *
 * White foam on blue water is unmistakable and white foam on a white platform is nothing at all —
 * the same white-on-white that hid the floe decorations and then hid the chase's own blocks for an
 * hour. So the wake carries a tone that reads on whichever surface it is currently lying on, and
 * this is the half that does the work on the ice.
 */
const WAKE_SHADE = 0x1c5c86;

/** Where the head hangs off the body, and the pivot the whole face swings about. */
const HEAD_AT = { x: 0, y: 0.62, z: -1.95 };

/**
 * Where the muzzle sits in the head's own space.
 *
 * Named because TWO things read it: the geometry below, and the anchor that decides where the whole
 * animal stands relative to the line it is eating. The mouth is what does the eating, so the mouth
 * is what sits on the line — and a mouth drawn from one number and anchored from a copy of it is
 * trap 15 in the one place a player can lose to it.
 */
const MUZZLE_AT_Z = -1.2;

export interface SeaLion {
	root: Group;
	/**
	 * Put it where the simulation says, facing down the course.
	 *
	 * @param spot where it is, in world coordinates — the point `World.hunterAt` metres along a route
	 *   that bends, worked out by the caller from the same polyline the racers run on
	 * @param heading which way the course runs there, so the animal faces the way it is swimming
	 * @param altitude how high the ice it is climbing over sits, zero out on the water
	 * @param seconds wall-clock, for the swimming motion only
	 * @param onIce whether there is a platform where it currently is — it hauls out and galumphs
	 *   across the ice rather than swimming under it
	 */
	update(spot: Vec2, heading: Vec2, altitude: number, seconds: number, onIce: boolean): void;
	dispose(): void;
}

export function createSeaLion(): SeaLion {
	const root = new Group();
	const owned: { dispose(): void }[] = [];

	// Phong and smooth-shaded, where the ice around it keeps its facets. A sea lion is the wettest
	// thing in this game — wetter than the penguins, which went Phong for exactly this reason — and
	// Lambert has no specular term at all, so the old flat-shaded version could not be wet however it
	// was coloured. One hard highlight rolling along the back as it swings is most of what says ALIVE
	// from twenty metres.
	//
	// Deliberately NOT MeshStandardMaterial: `penguin.ts` records why, and a boss with no environment
	// map to reflect would be a duller Phong at several times the shader cost.
	const hide = new MeshPhongMaterial({ vertexColors: true, shininess: 64, specular: 0x4a5560 });
	owned.push(hide);

	/**
	 * One moving part: a group that can be animated, with everything rigid inside it baked flat.
	 *
	 * The group is what moves and the mesh is what is drawn, and both are handed back because `bake`
	 * turns `matrixAutoUpdate` off on what it returns — a baked mesh that is itself animated would
	 * silently never move again. Everything below therefore animates the GROUP.
	 */
	const part = (
		pieces: Piece[],
		at?: { x: number; y: number; z: number }
	): { group: Group; mesh: Mesh | null } => {
		const group = new Group();
		const mesh = bake(pieces, hide);
		if (mesh) {
			group.add(mesh);
			owned.push(mesh.geometry);
		}
		if (at) group.position.set(at.x, at.y, at.z);
		return { group, mesh };
	};

	// ── The body ────────────────────────────────────────────────────────────────────────────────────
	// Modelled nose-first along −z, in metres of a real animal, and scaled by SIZE at the end so
	// these numbers stay readable as proportions.
	const trunk: Piece[] = [];

	// Chesty at the front and tapering behind, which is the shape a sea lion actually is and also the
	// shape that says "this end is coming at you". Three overlapping ellipsoids rather than one, so
	// the silhouette has shoulders in it.
	const chest = new SphereGeometry(1, 18, 12);
	chest.scale(1.28, 1, 1.5);
	chest.translate(0, 0.02, -1);
	trunk.push({ geometry: chest, colour: HIDE });

	const barrel = new SphereGeometry(1, 18, 12);
	barrel.scale(1.2, 0.92, 1.95);
	barrel.translate(0, 0, 0.5);
	trunk.push({ geometry: barrel, colour: HIDE });

	const hips = new SphereGeometry(1, 14, 10);
	hips.scale(0.84, 0.62, 1.1);
	hips.translate(0, -0.16, 2.1);
	trunk.push({ geometry: hips, colour: HIDE });

	// The pale underside, WIDER than the barrel it hangs under rather than tucked inside it. The
	// camera looks down at 27°, so a belly that only faced the sea floor was a colour nobody ever
	// saw; what shows from up there is the lower flank, so that is where the cream has to reach.
	const belly = new SphereGeometry(1, 18, 10);
	belly.scale(1.26, 0.62, 1.9);
	belly.translate(0, -0.52, 0.2);
	trunk.push({ geometry: belly, colour: BELLY });

	// The dark back, and it is a HUMP rather than a stripe.
	//
	// Seen from directly behind — which is what a bend or a lunge will still give the camera — the
	// silhouette was one smooth dome, and a dome says nothing at all: no direction, no bulk, no
	// motion. A raised shoulder hump breaks that outline against the sea, and it breaks it in the
	// place that means something, because a hump at the FRONT is what a body pushing forward looks
	// like. It carries the dark tone as well, so from a camera looking down this is most of the
	// animal's colour.
	const hump = new SphereGeometry(1, 16, 12);
	hump.scale(0.74, 1.08, 1.3);
	hump.translate(0, 0.04, -0.4);
	trunk.push({ geometry: hump, colour: SADDLE });

	// And a thinner ridge carrying that line back to the tail, so the hump belongs to a spine instead
	// of being a lump somebody left on the shoulders.
	const ridge = new SphereGeometry(1, 14, 10);
	ridge.scale(0.4, 0.94, 1.6);
	ridge.translate(0, 0.04, 0.85);
	trunk.push({ geometry: ridge, colour: SADDLE });

	const swimmer = new Group();
	swimmer.add(part(trunk).group);

	// ── The head ────────────────────────────────────────────────────────────────────────────────────
	const skullPieces: Piece[] = [];

	// The neck is part of the head, so the swing does not open a gap at the shoulder. Round and
	// centred on the pivot, which is the only shape that can be rotated without showing a seam.
	const neck = new SphereGeometry(1, 12, 10);
	neck.scale(0.86, 0.8, 0.95);
	neck.translate(0, -0.1, 0.42);
	skullPieces.push({ geometry: neck, colour: HIDE });

	const skull = new SphereGeometry(1, 18, 14);
	skull.scale(0.88, 0.84, 0.9);
	skull.translate(0, 0.32, -0.45);
	skullPieces.push({ geometry: skull, colour: HIDE });

	// A brow, in the dark back tone. It is the one facial feature that is visible from DIRECTLY
	// behind and above — a dark bar across the top of the head — and a brow is the whole difference
	// between a friendly animal and one that is hunting you. Cute-menacing, not grim: it is a stripe
	// over two enormous eyes, which is a Mario boss rather than a shark.
	const brow = new SphereGeometry(1, 12, 8);
	brow.scale(0.92, 0.36, 0.5);
	brow.translate(0, 0.8, -0.84);
	skullPieces.push({ geometry: brow, colour: SADDLE });

	// A round muzzle, not a cone. Animal Crossing has no thin cones anywhere in it and neither does a
	// sea lion's face; the version before this one had a 52 cm cone for a snout, which is a beak.
	const muzzle = new SphereGeometry(1, 16, 12);
	muzzle.scale(0.62, 0.5, 0.62);
	muzzle.translate(0, 0.02, MUZZLE_AT_Z);
	skullPieces.push({ geometry: muzzle, colour: BELLY });

	const snout = new SphereGeometry(1, 12, 10);
	snout.scale(0.26, 0.2, 0.2);
	snout.translate(0, 0.18, -1.72);
	skullPieces.push({ geometry: snout, colour: NOSE });

	// The roof of the mouth, so a jaw that drops reveals a mouth rather than a hole with the sky
	// behind it.
	const palate = new SphereGeometry(1, 12, 8);
	palate.scale(0.54, 0.2, 0.6);
	palate.translate(0, -0.3, -1.2);
	skullPieces.push({ geometry: palate, colour: MOUTH });

	for (const side of [-1, 1]) {
		// The eye, and it is 60 cm across on a 90 cm skull. That is not a caricature of an animal, it
		// is the proportion the reference games use, and it is the only feature that survives the
		// distance this thing is usually seen at. Set wide enough to bulge 33 cm past the skull's own
		// outline, so there is an eye to see even when the head is pointing dead away — and set HIGH
		// on the skull rather than on the front of it, because the camera looks DOWN on this animal
		// from 9 m up and the top of the head is most of what it ever shows. Two pale beads either
		// side of a dark brow is the whole face from up there, and it is the only reading available
		// when the body is under the lens.
		const white = new SphereGeometry(0.3, 14, 12);
		white.translate(side * 0.76, 0.7, -0.9);
		skullPieces.push({ geometry: white, colour: EYE_PALE });

		// The pupil is a second ball pushed out THROUGH the first, forward and outward, rather than a
		// spot painted on it — which is what lets it read as looking down the course from behind as
		// well as from the side.
		const pupil = new SphereGeometry(0.2, 12, 10);
		pupil.translate(side * 0.82, 0.68, -1.03);
		skullPieces.push({ geometry: pupil, colour: EYE_DARK });

		// One glint, baked rather than left to the specular highlight: a highlight moves with the
		// light and can be on the far side of the head, and a black eye with no white in it is a
		// button.
		const glint = new SphereGeometry(0.075, 8, 6);
		glint.translate(side * 0.94, 0.82, -1.07);
		skullPieces.push({ geometry: glint, colour: EYE_PALE });

		// Two tusks, hanging past the lip so they are there whether the mouth is open or not. A shape
		// an eight-year-old has to interpret is a shape that arrives too late.
		const tusk = new ConeGeometry(0.12, 0.8, 8);
		tusk.rotateX(Math.PI);
		tusk.translate(side * 0.28, -0.28, -1.5);
		skullPieces.push({ geometry: tusk, colour: TOOTH });

		// Whiskers, four a side. Thin enough to be nearly free and the first thing to disappear at
		// distance, which is the right way round: they are what the face is made of when the head
		// swings past the camera, three metres away, and the swing is the only time anybody sees them.
		for (let i = 0; i < 4; i++) {
			const whisker = new CylinderGeometry(0.035, 0.018, 0.85, 4);
			whisker.translate(0, 0.425, 0);
			whisker.rotateX(-Math.PI / 2);
			whisker.rotateX(-0.1 - i * 0.12);
			whisker.rotateY(-side * (0.3 + i * 0.16));
			whisker.translate(side * 0.4, 0.02 - i * 0.04, -1.42);
			skullPieces.push({ geometry: whisker, colour: WHISKER });
		}
	}

	const { group: head } = part(skullPieces, HEAD_AT);
	// Yaw before pitch, for the same reason the body needs it: the swing is 29°, and a pitch applied
	// after it about an axis the swing has already turned is half a roll — a head that lolls.
	head.rotation.order = 'YXZ';
	swimmer.add(head);

	// ── The jaw, which opens ────────────────────────────────────────────────────────────────────────
	// Hinged under the back of the muzzle, in the HEAD's frame, so it swings with the head and drops
	// independently of it.
	const jawPieces: Piece[] = [];

	// DARK, where the muzzle above it is cream — and that boundary is the mouth line. Drawn as its
	// own dark sliver it would have to hug the muzzle's curve and would show as a bar sticking out of
	// the side of the face; made out of the jaw's own colour it follows the exact geometry for free,
	// and in three-quarter profile it is the feature that says this end bites. From the side the face
	// now reads cream muzzle, dark mouth, cream chin.
	const jawBone = new SphereGeometry(1, 14, 10);
	jawBone.scale(0.56, 0.26, 0.72);
	jawBone.translate(0, -0.02, -0.62);
	jawPieces.push({ geometry: jawBone, colour: SADDLE });

	const chin = new SphereGeometry(1, 10, 8);
	chin.scale(0.46, 0.18, 0.52);
	chin.translate(0, -0.14, -0.72);
	jawPieces.push({ geometry: chin, colour: BELLY });

	const tongue = new SphereGeometry(1, 10, 8);
	tongue.scale(0.4, 0.14, 0.5);
	tongue.translate(0, 0.1, -0.66);
	jawPieces.push({ geometry: tongue, colour: TONGUE });

	// Teeth, which live INSIDE the closed mouth and appear as it opens. That is the point of them:
	// the tusks say "this bites" all the time, and the teeth are the reward for looking at the moment
	// it roars.
	for (const side of [-1, 1]) {
		for (let i = 0; i < 3; i++) {
			const tooth = new ConeGeometry(0.055, 0.24, 6);
			tooth.translate(side * (0.14 + i * 0.12), 0.18, -1.1 + i * 0.16);
			jawPieces.push({ geometry: tooth, colour: TOOTH });
		}
	}

	const { group: jaw } = part(jawPieces, { x: 0, y: -0.46, z: -0.62 });
	head.add(jaw);

	// ── The fore-flippers, which push ───────────────────────────────────────────────────────────────
	// One group each, pivoting at the shoulder, with the paddle modelled outward along ±x from there.
	//
	// Deeper front-to-back than the first version, which was a 16 cm blade: edge-on from a rig turned
	// off the route it was a line, and the near flipper is one of the four things that has to tell the
	// story in three-quarter profile. And it carries a PALE trailing edge, which is the cheapest
	// motion cue on the animal — the heave rolls it in and out of view, so from directly behind the
	// two flippers flash light and dark on every stroke where a plain dark paddle just sat there.
	const flippers: { group: Group; side: number }[] = [];
	for (const side of [-1, 1]) {
		const blade = new SphereGeometry(1, 12, 10);
		blade.scale(1.05, 0.17, 0.54);
		blade.translate(side * 0.98, 0, 0.06);
		const edge = new SphereGeometry(1, 10, 8);
		edge.scale(0.92, 0.1, 0.2);
		edge.translate(side * 1.02, 0.02, 0.44);
		const { group } = part(
			[
				{ geometry: blade, colour: HIDE },
				{ geometry: edge, colour: BELLY }
			],
			{ x: side * 0.92, y: -0.42, z: -1.35 }
		);
		swimmer.add(group);
		flippers.push({ group, side });
	}

	// ── The rear, which follows ─────────────────────────────────────────────────────────────────────
	// Bigger and splayed wider than the first pair, and pale along the trailing edge for the same
	// reason as the fore-flippers: from directly behind, the rear end is the nearest part of the
	// animal and therefore the biggest thing on screen, and two small dark fans on a dark body were
	// the largest area doing the least work. Splayed, tipped light and swung a third of a radian,
	// they are the motion the rear view is made of.
	const rearPieces: Piece[] = [];
	for (const side of [-1, 1]) {
		const fan = new SphereGeometry(1, 12, 10);
		fan.scale(0.34, 0.15, 0.86);
		fan.rotateY(side * 0.44);
		fan.translate(side * 0.42, 0, 0.62);
		rearPieces.push({ geometry: fan, colour: HIDE });

		const tipEdge = new SphereGeometry(1, 10, 8);
		tipEdge.scale(0.28, 0.1, 0.26);
		tipEdge.rotateY(side * 0.44);
		tipEdge.translate(side * 0.58, 0.02, 1.18);
		rearPieces.push({ geometry: tipEdge, colour: BELLY });
	}
	const stub = new SphereGeometry(1, 10, 8);
	stub.scale(0.24, 0.2, 0.36);
	stub.translate(0, 0.12, 0.28);
	rearPieces.push({ geometry: stub, colour: SADDLE });

	const { group: rear } = part(rearPieces, { x: 0, y: -0.3, z: 2.55 });
	swimmer.add(rear);

	swimmer.scale.set(SIZE, SIZE, SIZE * LENGTH_SQUASH);
	// Heading FIRST, then pitch, then roll — three's default XYZ order applies the pitch outermost,
	// which means about the world's x axis rather than the animal's own. On a course running down −z
	// the two are the same thing; on a course running along x, a body that meant to heave nose-down
	// rolls onto its side instead. The route bends, so the order has to say which axis it meant.
	swimmer.rotation.order = 'YXZ';
	root.add(swimmer);

	/**
	 * How far behind the line it is eating the body's own origin sits, in drawn metres.
	 *
	 * DERIVED from where the muzzle is, so the MOUTH lands on the line and the rest of the animal
	 * trails behind it. That is both the honest reading — the thing that eats you is on the line the
	 * simulation eats you at — and, since every metre of body behind the line is a metre nearer a
	 * camera standing 18.1 m back, the anchor that puts the most animal on screen. Anchoring the NOSE
	 * instead, which is what stood here, spent a metre of that budget on the snout in front of the
	 * mouth.
	 */
	const back = -(HEAD_AT.z + MUZZLE_AT_Z) * SIZE * LENGTH_SQUASH;

	// ── The wake ────────────────────────────────────────────────────────────────────────────────────
	// The rule made visible: a LINE across the route at exactly the line being eaten. Built out of
	// scaled spheres and nothing hand-wound on purpose — trap 14 cost a whole mountain, and a
	// primitive cannot be inside out.
	//
	// A line, and the emphasis is the whole of the second attempt at this. The first drew the crest
	// and then a six-metre apron of foam trailing back under the animal, which from a camera standing
	// 9 m above the water and 18 m behind is not a trail at all: its near end is three metres from
	// the lens, so it projects across the bottom third of the screen as a pale SHEET, brighter than
	// the ice, hiding the animal it is supposed to belong to. ANYTHING laid flat on the ground near
	// this camera does that. So the wake is 14 m wide and 2 m deep and then it stops — wide is what
	// makes it visible past the ice, deep was what made it a sheet.
	//
	// ORDER MATTERS, twice over and in the same direction both times: the pieces overlap, the mesh
	// does not write depth (see the material), and a merged geometry draws its triangles in the order
	// they were merged. So the thing that must be on top goes LAST, and it is also given the higher
	// y — dark band under white crest, so it still layers correctly if anybody turns depth writing on.
	const wakePieces: Piece[] = [];

	// The dark band, immediately behind the crest, and the half of the wake that does the work on ICE.
	// White foam on a white platform is the same nothing that hid the chase's own blocks for an hour.
	const shade = new SphereGeometry(1, 16, 6);
	shade.scale(WAKE_HALF_WIDTH * 0.97, 0.1, 0.85);
	shade.translate(0, 0.02, 1.5);
	wakePieces.push({ geometry: shade, colour: WAKE_SHADE });

	// The crest itself, sitting ON the line being eaten.
	const crest = new SphereGeometry(1, 20, 8);
	crest.scale(WAKE_HALF_WIDTH, 0.3, 0.8);
	crest.translate(0, 0.06, 0.5);
	wakePieces.push({ geometry: crest, colour: FOAM });

	// Thicker at the ends, because an ellipsoid tapers to nothing there and the ends are the part
	// that hangs over the water either side of a platform — which is what the player has to read when
	// the animal itself is behind ice, or under the lens.
	for (const side of [-1, 1]) {
		const breaker = new SphereGeometry(1, 10, 8);
		breaker.scale(0.9, 0.26, 0.8);
		breaker.translate(side * WAKE_HALF_WIDTH * 0.95, 0.08, 0.5);
		wakePieces.push({ geometry: breaker, colour: FOAM });
	}

	const wakeMaterial = new MeshLambertMaterial({
		vertexColors: true,
		transparent: true,
		// Not a white-out. It is three or four metres from the lens when it matters most, and at that
		// range a near-opaque band is a bar across the game rather than water.
		opacity: 0.7,
		// Never writes depth: it lies flat on ice or water a few centimetres above the surface, and a
		// translucent decal that occludes is how you get a white rectangle over the animal behind it.
		depthWrite: false
	});
	const wake = new Group();
	const wakeMesh = bake(wakePieces, wakeMaterial);
	if (wakeMesh) {
		wake.add(wakeMesh);
		owned.push(wakeMesh.geometry);
	}
	owned.push(wakeMaterial);
	root.add(wake);

	// A blob under it, the same one every penguin has (`penguin.ts`) and for the same reason: nothing
	// in this game casts a real shadow, and without one the biggest object on screen floats. On the
	// water it doubles as the mass under the surface, which is the more frightening reading of the
	// two.
	const shadowMaterial = new MeshLambertMaterial({
		color: 0x1b3a5c,
		transparent: true,
		// Fainter than a penguin's 0.3, and it has to be: this blob is a dozen times the area of one,
		// and at 0.26 it read as a dark slab of water under the near platform rather than as a shadow.
		opacity: 0.16,
		depthWrite: false
	});
	const shadowGeometry = new CircleGeometry(1, 20);
	const shadow = new Mesh(shadowGeometry, shadowMaterial);
	shadow.rotation.x = -Math.PI / 2;
	// Hugging the body rather than ringing it — a shadow wider than the thing casting it is a stain.
	shadow.scale.set(1.15 * SIZE, 2.5 * SIZE * LENGTH_SQUASH, 1);
	root.add(shadow);
	owned.push(shadowGeometry, shadowMaterial);

	/** Where it is riding right now, chased toward the water or the ice. See `update`. */
	let ride = SWIM_RIDE;
	/** How hauled out it is, 0–1. Chased for the same reason `ride` is: the waterline is a lunge. */
	let haul = 0;
	/** The stroke, integrated. See `SWIM_RATE`. */
	let stroke = 0;
	let last = 0;

	return {
		root,
		update(spot, heading, altitude, seconds, onIce) {
			// Clamped, because the first frame of a round and the frame after the tab comes back from
			// the background are both a huge jump, and a stroke that spun through forty cycles arrives
			// at a random phase — which is a body that teleports at exactly the wrong moment.
			const dt = Math.min(Math.max(seconds - last, 0), 0.1);
			last = seconds;

			haul += ((onIce ? 1 : 0) - haul) * RIDE_CHASE;
			stroke += dt * (SWIM_RATE + (GALUMPH_RATE - SWIM_RATE) * haul);
			const beat = Math.sin(stroke);

			const want = onIce ? altitude + HAUL_RIDE : SWIM_RIDE;
			ride += (want - ride) * RIDE_CHASE;

			// The heave. In the water it is a long roll; hauled out it is a bound — the whole animal
			// throws itself up and forward and lands, which is what galumphing is and what makes a
			// sea lion on ice funny as well as frightening. `beat` cubed keeps it on the ground for
			// most of the cycle instead of hovering through it.
			const bound = Math.max(0, beat) ** 3;
			// The lunge. One value, every part of the animal. See `LUNGE_RATE`.
			const lunge = Math.max(0, Math.sin(seconds * LUNGE_RATE)) ** LUNGE_SHARPNESS;
			const lift = beat * 0.07 * (1 - haul) + bound * 0.3 * haul + lunge * LUNGE_LIFT;
			// And forward, inside the stroke. Presentation only, and small: the simulation owns where
			// the danger IS, so the drawn body may breathe around that line and must never redefine
			// it.
			const surge = beat * SURGE + lunge * 0.28;

			swimmer.position.set(
				spot.x - heading.x * (back - surge),
				ride + lift,
				spot.z - heading.z * (back - surge)
			);
			// Facing the way the course runs.
			//
			// `angleOf` is `sim/vec.ts`'s `heading`, which is the angle a penguin's `facing` is in and
			// which `penguin.ts` hands to `rotation.y` with no conversion — because a penguin is
			// modelled looking along +z. This animal is modelled nose-first along −z, so it is that
			// angle plus half a turn, and NOT `atan2(x, −z)`, which is what stood here.
			//
			// That expression is a MIRROR: it agrees on a course running dead down −z and points the
			// animal the wrong way round every bend, which is the exact failure the comment beside the
			// camera's own bearing in `Game.svelte` was written to prevent. It survived because the
			// chase ran straight when this file was written, and because a featureless brown body
			// facing backwards looks identical to one facing forwards. It does not survive a head, a
			// tail and a wake.
			swimmer.rotation.y = angleOf(heading) + Math.PI;
			// Rolling rather than bobbing: a swimming animal leans into its strokes, and a body that
			// only moved up and down reads as a float. Slower than the stroke, so the two never lock
			// into one mechanical motion.
			swimmer.rotation.z = Math.sin(stroke * 0.5) * 0.09;
			// Nose down as it lands, up as it pushes — on the ice only, because in the water the roll is
			// the motion and a pitching body just submerges its own head. And UP, hard, on a lunge:
			// this is the rear, and `lift` above is what keeps the tail out of the ice while it happens.
			swimmer.rotation.x = -beat * 0.09 * haul + lunge * LUNGE_REAR;
			swimmer.scale.set(SIZE, SIZE * (1 - beat * 0.03), SIZE * LENGTH_SQUASH * (1 + beat * 0.04));

			// The head. The swing is what puts a face on screen at all (see the header) — and it is
			// SUPPRESSED for the length of a lunge, which is the point of doing it that way round: the
			// swing is for the rest of the time, and the lunge is the second the head holds still,
			// pointed down the course at its prey, with its mouth open. A head still sweeping through
			// its own roar is a monster that is not looking at anybody.
			head.rotation.y = Math.sin(seconds * SWING_RATE) * HEAD_SWING * (1 - lunge);
			head.rotation.z = Math.sin(seconds * SWING_RATE) * 0.1 * (1 - lunge);
			// Nose clear of the water when swimming, and thrown up on top of the body's own rear.
			head.rotation.x = 0.14 * (1 - haul) + lunge * 0.24;
			jaw.rotation.x = -lunge * JAW_OPEN;

			// Flippers heave together rather than alternately: both a swimming stroke and a galumph
			// are a single push with the pair of them, and alternating read as walking.
			for (const flipper of flippers) {
				// Thrown back and down on a lunge, which is what a body hauling itself upward does with
				// them, and what makes the rear look powered rather than lifted by a wire.
				flipper.group.rotation.z = flipper.side * (0.18 + beat * 0.5 + lunge * 0.4);
				flipper.group.rotation.y = -flipper.side * (beat * 0.3 + lunge * 0.5);
			}
			// The rear follows, a fifth of a stroke behind. The lag is the whole difference between a
			// body and a puppet — and the sway is half again as wide as it was, because from directly
			// behind this is the largest thing on screen and it was the stillest.
			const wag = Math.sin(stroke - TAIL_LAG) * (1 + lunge * 0.5);
			rear.rotation.y = wag * 0.42;
			rear.rotation.x = wag * 0.16;

			// The wake sits on whatever surface the animal is on, with its crest ON the eaten line —
			// not below the ice, which is where the version before this one put it: at half a metre
			// under the platform top it was inside the slab for the whole of every haul-out, and faded
			// to 15% opacity as well, so the one cue that is supposed to always be visible was
			// invisible for most of the course.
			wake.position.set(spot.x, onIce ? altitude + 0.07 : WATER_Y + 0.1, spot.z);
			wake.rotation.y = swimmer.rotation.y;
			// Breathing, at two rates that do not divide into each other, so the line never looks like
			// a decal that somebody forgot to animate.
			// Breathing, plus a shove on every lunge — the water in front of a thing that just threw
			// itself forward is the cheapest confirmation that it did.
			wake.scale.set(
				1 + Math.sin(seconds * 2.7) * 0.02 + lunge * 0.06,
				1 + lunge * 0.3,
				1 + Math.sin(seconds * 1.9) * 0.06 + lunge * 0.18
			);

			// Under the animal's middle rather than under the crest, and just under the wake so the
			// foam is the thing on top where the two overlap.
			shadow.position.set(
				spot.x - heading.x * back,
				onIce ? altitude + 0.04 : WATER_Y + 0.05,
				spot.z - heading.z * back
			);
			// The blob is an ellipse and has to lie along the animal. Its own `rotation.x` already tips
			// it flat, so the turn is `rotation.z` — a spin in the circle's own plane, applied before
			// the tip. An ellipse is the same ellipse a half-turn round, so this is the heading angle
			// itself and the sign of it cannot be got wrong.
			shadow.rotation.z = swimmer.rotation.y;
		},
		dispose() {
			for (const thing of owned) thing.dispose();
		}
	};
}
