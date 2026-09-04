/**
 * A penguin, built from primitives in code, and the object that keeps one on screen.
 *
 * No modelled asset, no texture, no download — see `docs/DECISIONS/0003-procedural-penguins.md`.
 * The budget is zero, so a bought or licensed model was never available; what makes that a good
 * outcome rather than a constraint is that customisation falls out for free. Every colour below is
 * a parameter and every hat is four primitives, so a whole look is a few numbers in local storage
 * rather than a variant mesh per combination. `src/lib/look.ts` is the data; this is the shape.
 *
 * Low-poly on purpose: it reads at a distance on a small screen, it costs almost nothing on a
 * five-year-old Android, and it is a style rather than an approximation of one. The BIRDS are
 * smooth-shaded and lightly glossy as of 2026-08-16 — see `geo` and `createActor` — while the ice
 * around them keeps its facets, which is the split that makes both look deliberate.
 *
 * **The 2026-08-21 pass: cute, as a specification.** The art direction is Animal Crossing and Mario
 * ("from the style — all should look cute", `backlog/stories/12-ice-and-igloos.md`), and on a real
 * phone screenshot this penguin was a small dark lump: a tall tapering egg with a head too small to
 * read as a head, two dots for eyes, and nothing moving on it but the gait. Four things changed and
 * three of them are animation rather than shape, because that is where "cute" actually lives:
 *
 *  * the PROPORTIONS are a pear now — a wide base that never tapers, a head 0.64 m across against
 *    the 0.50 it was, sitting low enough that it is over half the character's height;
 *  * it SQUASHES on landing and stretches in the air, which is most of what "Mario feel" is;
 *  * it is never perfectly still: it breathes, it blinks, it rolls into its turns, and its hat
 *    follows through a couple of frames behind its head;
 *  * a landing throws up dust (`puff.ts`).
 *
 * The total drawn HEIGHT is unchanged at 1.15 local metres, and that is deliberate rather than
 * incidental: `PENGUIN_HEIGHT` feeds the camera fit in `scene.ts`, so a taller penguin is answered
 * by a camera that stands further back and the character ends up the same number of pixels tall. The
 * silhouette got 20% WIDER instead, which the fit does not pay for — the frame is sized by the floe.
 */

import {
	type BufferGeometry,
	CircleGeometry,
	ConeGeometry,
	CylinderGeometry,
	Group,
	IcosahedronGeometry,
	Mesh,
	MeshBasicMaterial,
	MeshLambertMaterial,
	MeshPhongMaterial,
	type Object3D,
	RingGeometry,
	SphereGeometry
} from 'three';
import { type EmoteBurst, type EmoteMove, emoteById, emoteProgress } from '../emote';
import type { HatId, ResolvedLook } from '../look';
import { JUMP_SPEED, TICK_RATE, WALK_SPEED } from '../sim/constants';
import type { Vec2 } from '../sim/types';
import { bake, type Piece } from './bake';
import { type Bubble, createBubble } from './bubble';
import type { Interpolated } from './loop';
import { createNameTag, type NameTag } from './nameTag';
import { createPuff } from './puff';

/**
 * How much bigger than life the penguin is drawn.
 *
 * The primitives below are modelled at a realistic 1.15 m and then scaled. A chunky cartoon
 * proportion is what reads on a phone, and scaling at the end keeps the modelling numbers honest
 * about what they are — changing this one number is how the whole character resizes.
 *
 * It is still 1.48 after the cute pass, and that was a decision rather than an oversight: the camera
 * fit and the "Mein Pinguin" turntable are both tuned against it, and a bird that is 5% taller in a
 * frame the camera then pulls 2% further back from is a rebuild that buys nothing. If the character
 * still reads small on a phone this is the one number to move, and it moves everything with it.
 */
export const PENGUIN_SCALE = 1.48;

/**
 * The head, declared up here because two exported things are derived from it.
 *
 * A cute head is not a small head on a big body; at 0.64 across against a 0.79 hip it is nearly as
 * wide as the bird, and it sits at 0.83 so that head and hat are the top half of the silhouette.
 * Every hat below is placed against this centre and this radius, and moving either means moving all
 * five of them.
 */
const HEAD_Y = 0.83;
const HEAD_R = 0.32;
/**
 * Where the head turns about: inside the shoulders, not at its own centre.
 *
 * A head that rotates about its middle swivels like a turret; one that rotates about a point down in
 * the chest swings, which is what a neck does. 0.62 is just inside the top of the shoulder sphere.
 */
const HEAD_PIVOT_Y = 0.62;
/** The top of a bare head, in local metres. What the camera fit and the "you" arrow both measure. */
const HEAD_TOP = HEAD_Y + HEAD_R;

/**
 * Drawn height in metres — the top of the bare head. Used by the camera fit.
 *
 * DERIVED rather than the 1.15 it used to be: `scene.ts` pulls the camera back to fit this number, so
 * a head moved by a centimetre in a cute pass and a camera still framing the old one is exactly the
 * drift this repo asserts against elsewhere. The value is unchanged, which is the point.
 */
export const PENGUIN_HEIGHT = HEAD_TOP * PENGUIN_SCALE;

/**
 * Presentation tuning, in the penguin's own local space (so: before PENGUIN_SCALE).
 *
 * These live here rather than at the call site because they are expressed in a coordinate system
 * that is this file's private business — `NAME_TAG_HEIGHT` of 1.5 is 2.2 m in the world only
 * because the penguin is scaled by 1.48. They were inline in the page to begin with, which meant
 * the page was writing numbers in a space it did not own.
 */
/**
 * Leaning, and it is now TWO terms rather than one.
 *
 * The old single term was velocity × 0.055, which on ice is right — a penguin being carried sideways
 * by ice it is fighting has to look like it — and on a hub is a bird walking into a headwind: at
 * `WALK_SPEED` it pitched a constant 11° forward for as long as a child held the stick, which is
 * minutes at a time on the island.
 *
 * What a walker actually leans into is a CHANGE of momentum: you tip forward to start, you tip back
 * to stop, and in between you stand up. So the velocity term is cut to a modest permanent
 * inclination and the interesting one is `LEAN_PER_PUSH`, applied to how much the velocity has moved
 * recently — the difference between the velocity and a lagged copy of it, which is a high-pass filter
 * with no derivative in it and therefore no spikes when the simulation only updates on a tick.
 *
 * That is anticipation and settle, which the art direction lists as the two cheapest things that make
 * motion look intentional, and it costs one lagged vector.
 *
 * `LEAN_SETTLE_RATE` is how fast the lagged copy catches up, i.e. how long a lean lasts: 4 per second
 * is a quarter-second tip that eases out, which is a step's worth.
 */
const LEAN_PER_SPEED = 0.03;
const LEAN_PER_PUSH = 0.1;
const LEAN_SETTLE_RATE = 4;
const WADDLE_HEIGHT = 0.055;
/**
 * The speed at which the waddle reaches its full amplitude, and it is now the sim's own walk.
 *
 * It was 6 m/s against a `WALK_SPEED` of 3.6, which means the gait was capped at 0.6 of its
 * amplitude for the whole of every round: a penguin walking flat out was drawn as one strolling. The
 * only things that ever reached the full swing were a dash and being shoved, and both are over in
 * under a second. Imported rather than copied, because the number this scales against is a decision
 * `sim/constants.ts` owns.
 */
const WADDLE_FULL_SPEED = WALK_SPEED;

/**
 * The body, as a pear.
 *
 * Two spheres rather than one: a single ellipsoid is either wide at the shoulders (a barrel) or
 * narrow at the hips (a cone), and "nothing tapers to a point" is the first line of the cute spec.
 * Wide at the bottom, narrower at the top, no neck. They are both in the baked hull, so the second
 * sphere costs triangles and not a draw call — which is the whole reason this shape is affordable.
 *
 * The head that goes on top of it is declared at the top of the file, next to the two exported
 * numbers derived from it.
 */
/**
 * What the head PRIMITIVE is modelled at, so the scale below can be derived from `HEAD_R` instead of
 * stated a second time. A radius written in two places is a radius the hats will eventually disagree
 * with, and there are five of them.
 */
const HEAD_GEO_R = 0.25;
/**
 * The eyes, and the one thing that makes them alive rather than punched in.
 *
 * Big, low on the face and flattened against it — the ellipsoid's z is 0.62 so the eye is a dark
 * oval ON the cream, not a ball bolted to it. The GLEAM is a 2 cm white sphere sitting just proud of
 * each eye's upper outer edge: it is the entire difference between two dark dots and two eyes, it is
 * in the baked hull so it is free, and it is white rather than a specular highlight because a
 * highlight moves with the camera and a child reads a gleam that stays put as "looking at me".
 */
const EYE_X = 0.115;
const EYE_Y = 0.85;
const EYE_Z = 0.325;

/**
 * The gait, and why it is driven by DISTANCE rather than by the clock.
 *
 * The waddle used to be `sin(seconds * 9)`: a bob at a fixed nine hertz whose only tie to the
 * penguin was an amplitude that faded in with speed. Nothing else on the character moved at all, so
 * a penguin crossing the floe translated with its feet planted and its flippers welded to its
 * sides — "not this fake slide", which is exactly what it looked like (Daniel, 2026-08-16).
 *
 * A step happens every so many metres TRAVELLED, so the legs turn over at the speed the penguin is
 * really moving and stop dead when it stops. On ice that is worth more than it sounds: this game is
 * built on the gap between pushing and moving, and a distance-driven gait shows it — let go and the
 * feet wind down while the penguin keeps sliding, which is the difference between skating and being
 * dragged. That part was right and has not changed.
 *
 * **The stride LENGTH was wrong by a factor of four, and nothing could see it until today.** The
 * number was 2.4 strides per metre under a comment claiming "a short, quick step", and the arithmetic
 * was never done on it: one cycle per 0.42 m is a footfall every 0.21 m, which at `WALK_SPEED` is
 * SEVENTEEN footfalls a second. On tilting ice at Royal's distance, with feet swinging 13 cm, that is
 * an invisible blur. On a hub, at a walk, close to the camera and from behind, it is a bird
 * vibrating — and "the penguin movement does not look good yet" (Daniel, 2026-08-21) is that.
 *
 * So the stride is stated as a LENGTH now, because a length is the thing a person can judge: 1.8 m
 * per cycle is a footfall every 0.9 m, four a second at a full walk — a big bird moving with intent.
 * The swings that go with it are three times what they were, because a 13 cm foot movement under a
 * 0.9 m step is a bird being slid along by its middle.
 */
const STRIDE_METRES = 1.4;
const STRIDE_PER_METRE = 1 / STRIDE_METRES;
/**
 * What fraction of its cycle a foot spends ON THE GROUND.
 *
 * Above a half, so both feet are down together for a moment either side of a step — which is what
 * separates a walk from a run and is the only reason a waddle can look heavy.
 */
const STANCE = 0.62;
/**
 * How far a foot swings fore and aft, in local metres — DERIVED, and this is the one number in the
 * gait that must not be chosen by eye.
 *
 * A planted foot has to travel backwards through the penguin's own space at exactly the speed the
 * penguin travels forwards, or it slides along the ice while bearing weight. Foot slip is the single
 * most visible thing that can be wrong with a walk cycle, and it is invisible in a still frame, which
 * is how it survives. So: the stance covers `STANCE × STRIDE_METRES` of ground, the foot crosses
 * twice that swing in doing it, and everything is divided by `PENGUIN_SCALE` because these are
 * modelling metres and the ground is world metres.
 *
 * It comes out at 0.29, against the 0.09 it was — and 0.09 under a step that was itself four times
 * too short is how a penguin ends up looking slid along by its middle.
 */
const FOOT_SWING = (STANCE * STRIDE_METRES) / (2 * PENGUIN_SCALE);
/**
 * The speed at which the feet reach their full excursion — well below a walk, unlike the waddle's
 * own amplitude.
 *
 * The excursion is what makes a foot not slip, so it has to be at FULL size for any speed a child
 * spends time at; fading it in with the gait would mean a planted foot sliding half a step at half
 * pace. It fades at all only so that a penguin standing still has its feet together instead of frozen
 * mid-stride.
 */
const FOOT_FULL_SPEED = WALK_SPEED * 0.35;
/** How far it lifts off the ice on the way through. */
const FOOT_LIFT = 0.1;
/** Flipper swing, radians, counter-phase to the foot on the same side. */
const FLIPPER_SWING = 0.4;
/**
 * Side-to-side roll at full pace, radians. A waddle is mostly this, and it was mostly BACKWARDS.
 *
 * The roll was added toward the foot in the AIR rather than the one on the ground — see the use
 * site — so the body rose away from every step it took instead of settling onto it. That is a large
 * part of why walking read as floating: a walk is legible because weight goes somewhere.
 */
const WADDLE_ROLL = 0.13;
/**
 * How much the body compresses as its weight arrives on a foot.
 *
 * The dip in height says the body fell; this says it landed on something. It is the same squash the
 * jump uses, at a sixth of the amplitude and twice per stride, and it is the difference between feet
 * that move under a body and feet that carry it.
 */
const FOOTFALL_SQUASH = 0.035;

/**
 * The toboggan: how a penguin travels on a mountain.
 *
 * `TOBOGGAN_SPEED` is just above a walk, so the bird stands on the start line and drops onto its
 * belly the moment the run takes hold. The pitch is a right angle less a little — flat along the
 * ice with the head up enough to see where it is going — and the drop and shift move the body
 * forward from the feet, because rotating a standing penguin about its toes leaves it doing a
 * handstand rather than lying down.
 */
const TOBOGGAN_SPEED = 4.5;
const TOBOGGAN_PITCH = Math.PI / 2 - 0.22;
const TOBOGGAN_DROP = -0.06;
const TOBOGGAN_SHIFT = 0.34;
/** Flippers swept back along the body, the way anything moving fast holds its arms. */
const TOBOGGAN_FLIPPERS = -1.15;
/**
 * And splayed OUT while they are swept back.
 *
 * A tobogganing penguin is seen from directly behind for the whole of a slide, and swept-back
 * flippers pinned to a round body leave a smooth oval with nothing to break its outline. At 0.62 the
 * tips clear the hips on both sides, which is what says "this is an animal lying down" rather than
 * "this is a disc". Restored to `FLIPPER_REST` the moment it stands up again — the resting roll used
 * to be set once at build time and never touched, so anything that changed it had to put it back.
 */
const TOBOGGAN_SPLAY = 0.62;
/**
 * And the head comes UP, which is the thing a separate head makes possible on a mountain.
 *
 * `TOBOGGAN_PITCH` is a right angle less a little, and the "less a little" was doing two jobs: laying
 * the body along the ice AND keeping the head high enough to look where it is going. One angle cannot
 * do both — a body flat enough to read as sliding puts the face in the snow. Now the body lies flatter
 * than the head does, which is also the shape that breaks the smooth oval a tobogganing penguin
 * presents to a camera directly behind it.
 */
const TOBOGGAN_HEAD_UP = 0.55;
/** The resting outward tilt of a flipper, radians. One definition, two readers. */
const FLIPPER_REST = 0.2;

/**
 * Squash and stretch, which is most of what the reference games feel like.
 *
 * The jump is the verb in two of the four modes and the body was rigid through all of it: it went up
 * as one solid object and came down as one, so a landing was a number reaching zero. Three moments,
 * two constants:
 *
 *  * IN THE AIR it stretches, scaled by how fast it is actually moving vertically — so the stretch
 *    is at its most at take-off and at the moment of impact, and eases to nothing at the apex. That
 *    is free anticipation: the pose changes before the height does anything interesting.
 *  * ON LANDING it squashes and springs back. `SQUASH_SECONDS` is a fifth of a second because the
 *    thing it must not do is still be recovering when the player jumps again — the jump's whole
 *    airtime is 0.75 s.
 *  * ANTICIPATION BEFORE the jump is missing and cannot be added here: the renderer learns about a
 *    jump on the tick it happens, and a pre-squash would mean predicting an input. It is the one
 *    item on the Mario list that would need something in `sim/`.
 *
 * Volume is held roughly constant — x and z go as `1/√y` — because a body that only gets shorter
 * reads as a bug and a body that only gets taller reads as a stretch of the whole character.
 * `JUMP_SPEED` is imported rather than copied so the stretch cannot drift away from the jump it
 * measures.
 */
const STRETCH_MAX = 0.15;
const SQUASH_LANDING = 0.22;
const SQUASH_SECONDS = 0.2;
/** Under which impact speed a landing is not one: stepping off a bump must not squash the bird. */
const PUFF_MIN_SPEED = 1.2;
/** A take-off throws less snow than an arrival. Same mesh, weaker puff. */
const TAKEOFF_PUFF = 0.45;
/** Where the dust sits, above the ice and under the feet. Matches the blob shadow's 0.02. */
const PUFF_GROUND = 0.03;

/**
 * Idle life.
 *
 * Standing still meant PERFECTLY still: four penguins waiting out a countdown looked like four
 * models on a plinth, which is the single cheapest thing a cute character cannot afford. Breathing
 * is a 1.6% swell at 0.4 Hz, fading out as the gait fades in — a walking penguin is already moving
 * and a second rhythm on top of it just reads as noise.
 *
 * The BLINK needs its own mesh (see `lids`) and is worth it: an eye that never closes is the thing
 * that makes an otherwise good face look taxidermied. Roughly every three seconds, jittered so that
 * a floe of penguins does not blink in unison — the jitter walks by the golden ratio rather than
 * using a random number, because two devices watching the same round should draw the same frame and
 * `Math.random()` here would be the one thing in the renderer that broke that.
 */
const BREATH_HZ = 0.4;
const BREATH_DEPTH = 0.016;
/**
 * A weight shift, for a penguin that is doing nothing at all.
 *
 * Breathing is a scale and reads front-on; from BEHIND — which is where the hub's follow camera lives
 * — a body that only swells is a body that is not moving. A slow roll is the same idea on the axis
 * that view can see, and 1.3° is chosen to be at the edge of noticeable: a child waiting at a sign
 * should feel that the penguin is alive without ever being able to say why.
 */
const IDLE_SWAY = 0.022;
const IDLE_SWAY_HZ = 0.23;
const BLINK_EVERY = 2.6;
const BLINK_JITTER = 2.4;
/** How long a blink takes, closed and open again. Faster than this and it is a flicker. */
const BLINK_SECONDS = 0.14;
/** How far the lid drops from over the eye, in local metres. The eye is 0.13 tall. */
const LID_DROP = 0.07;
/**
 * Where the lids sit when open, in the NECK's space — and this constant exists because its absence
 * grew the player's penguin a pair of horns.
 *
 * The lids were placed neck-relative at construction and then repositioned in ABSOLUTE local metres
 * on every blink, because the head moved onto its own pivot after the blink was written and only one
 * of the two sites was updated. So for the 0.14 s of every blink, two body-coloured lens shapes
 * appeared 0.62 m higher than the eyes — which is 2.28 m in the world, above the crown, right beside
 * the gold arrow. Photographed in portrait on the island and reported as "two little horns", which is
 * exactly what it is (2026-08-22).
 *
 * One constant, two readers, and they can no longer drift. Trap 15's family: a coordinate space that
 * changed in one place and not the other, where both places still compile and only one is right.
 */
const LID_REST_Y = EYE_Y - HEAD_PIVOT_Y;

/**
 * How fast the DRAWN body may turn, radians per second.
 *
 * The simulation's `facing` snaps to wherever the stick points, which is right for the simulation —
 * a throw goes where you asked, on the tick you asked — and wrong on screen, where an instant 180°
 * was the other half of what read as sliding.
 *
 * So the renderer keeps its own angle and chases the real one, and it must stay that way round:
 * smoothing the value itself would mean the penguin threw at where it used to be pointing. Reading
 * the world and drawing something slightly different is invariant 2 working as intended.
 *
 * 10 rad/s turns a penguin around in a third of a second. It was 14, chosen on a floe where a turn
 * is a CORRECTION of a few degrees — which completes inside one frame at either rate, so the number
 * was never really tested by the thing it was chosen for. On a hub a turn is a DECISION: a child
 * walks somewhere else, and the whole body swinging round is the most visible thing the character
 * does. Presentation either way — the simulation's `facing` still snaps, so a throw still goes where
 * it was asked.
 */
const TURN_RATE = 10;
/**
 * What a turn LOOKS like, from the same number.
 *
 * The drawn heading already lags the real one; the rate at which it is catching up is a free signal
 * and it is what a lean is made of. Two uses, both clamped, because at the full 14 rad/s an
 * unclamped roll would put the penguin on its side:
 *
 *  * ROLL into the turn, like anything with momentum;
 *  * a few degrees of extra YAW, ahead of where the body has got to. The head cannot turn on its own
 *    — it is baked into the hull, and giving it a neck would be a second mesh on every penguin in a
 *    Royal — so the whole body over-rotates slightly instead. At this size that reads as looking
 *    where you are going, which is what it is for.
 */
/**
 * What the HEAD does, now that it is its own mesh.
 *
 * This is the one draw call the night's work spends, and it buys the three things that stop a walking
 * character reading as a puppet — all of which are impossible while the head is baked into the body:
 *
 *  * it LEADS a turn. Overlapping action: the head goes first, the body follows a few frames later,
 *    the hat later still. That ordering is most of what animators mean by "natural".
 *  * it STABILISES. A real animal's head stays roughly level while its body waddles under it, so a
 *    fraction of the body's lean and roll is subtracted here. This is also what fixes the last of the
 *    headwind look: the body may pitch forward, the head still looks where it is going.
 *  * it NODS as weight lands, in phase with the footfall squash.
 *
 * `HEAD_STABILISE` is deliberately well under 1 — a head that cancelled the body entirely would be
 * bolted to the horizon, which reads as a bug rather than as poise.
 */
const HEAD_LEAD = 0.03;
const HEAD_LEAD_MAX = 0.28;
const HEAD_STABILISE = 0.45;
const HEAD_NOD = 0.05;

const TURN_ROLL = 0.026;
const TURN_ROLL_MAX = 0.22;
const TURN_LEAD = 0.014;
const TURN_LEAD_MAX = 0.13;
/** How fast the turn signal itself settles, per second. Raw frame-to-frame rate is too jumpy to use. */
const TURN_SMOOTH = 9;

/**
 * The hat, two frames behind the head.
 *
 * The most Animal Crossing detail available for the fewest lines, and it is one exponential chase:
 * the hat keeps its own yaw, which follows the body's at HAT_LAG_RATE, and what gets drawn is the
 * DIFFERENCE. The clamp matters more than the rate — a hat that can lag by half a turn is a hat
 * that has come off.
 *
 * The bobble goes further, because it is on a string as far as the eye is concerned: it trails the
 * head's vertical movement (so it hangs behind on the way up and overshoots on landing) and swings
 * sideways out of the turn. It is already its own mesh, so this costs nothing new.
 */
const HAT_LAG_RATE = 11;
const HAT_TWIST_MAX = 0.3;
const BOBBLE_LAG_RATE = 8;
const BOBBLE_LAG_MAX = 0.1;
/** Metres of sideways swing per radian of hat twist. */
const BOBBLE_SWING = 0.22;

/**
 * How high the name floats, in local metres before PENGUIN_SCALE — and it came DOWN on 2026-08-21.
 *
 * 1.5 put the pill's middle 2.22 m up, and the Royal screenshot showed exactly what trap 9 says it
 * would: the near pink penguin's tag landed on the pale blue penguin standing three metres behind
 * it, and read as that one's name. The camera looks down at 27°, so a metre of height lifts a thing
 * 0.89 m up the screen while a metre of DEPTH lifts it only 0.45 — which means any label more than
 * about half a metre above a head is level with the head of whoever is standing behind, at every
 * distance. There is no height at which a floating label is safe; there is only "close enough to its
 * own head that the eye cannot attach it to anything else".
 *
 * So 1.38 — 2.04 m, which puts the bottom of a two-line pill just into the top of its owner's head.
 * It costs the top of a tall hat while the tag is shown, and it buys the label belonging to the right
 * bird.
 *
 * Nothing here constrains the arrow any more, because the penguin with the arrow is the one penguin
 * with no tag under it — which is what let the arrow come down onto the hat it belongs to. See
 * `MARKER_CLEARANCE`.
 */
const NAME_TAG_HEIGHT = 1.38;
const SHADOW_OPACITY = 0.3;
const SHADOW_FADE_PER_METRE = 0.14;
const SHADOW_MIN_OPACITY = 0.08;
const SHADOW_GROWTH_PER_METRE = 0.16;

/**
 * How a stunned penguin reads.
 *
 * `docs/DESIGN.md` §5 makes this a requirement rather than polish: a player being carried toward
 * the rim with no controls has to understand WHY they cannot steer, or rule 2 of the design — every
 * death is explainable in the second after it happens — fails at exactly the moment it matters most.
 *
 * Three cues at once, because one is never enough on a small bright screen in motion: the penguin
 * spins, it tips over drunkenly, and three stars orbit its head. The stars are the unambiguous one —
 * nothing else in the game orbits anything — and they are shapes rather than a colour, so they
 * survive the no-information-by-colour-alone rule.
 */
const STUN_SPIN_HZ = 2.4;
const STUN_LEAN = 0.28;
const STAR_COUNT = 3;
const STAR_ORBIT_RADIUS = 0.42;
const STAR_HEIGHT = 1.32;
const STAR_SIZE = 0.11;

/**
 * "That one is you."
 *
 * The hardest second of this game is the first one: four penguins land on the ice, three of them are
 * strangers, and until the player knows which bird answers the stick they are steering a guess. The
 * name over the head was supposed to answer it and does not — a child reads a tag AFTER they know
 * which one to read, and at the start of a round all four tags look like four names.
 *
 * So the local penguin gets two markers, and two rather than one for the same reason the stun has
 * three: a scrum hides either of them on its own. The ARROW is above the tag, which is where the eye
 * goes when penguins are apart, and the RING is on the ice, which is what survives a pile-up where
 * everything above the shoulders overlaps. Both are shapes — nothing else in the game is a floating
 * arrow or a ring on the floor — so neither depends on being able to tell yellow from white.
 *
 * They stay up for the whole round rather than only through the countdown. A marker that expires is
 * a marker that is gone by the time a knocked-about player has lost track of themselves, which is
 * the moment it exists for.
 *
 * They also matter MORE than they used to: the name tag was made small and quiet on 2026-08-21
 * because it was shouting over the characters (`nameTag.ts`), and these two are what carries
 * "which one am I" now.
 */
const MARKER_COLOUR = 0xffd21e;
/**
 * How high the arrow floats — and it is no longer a HEIGHT, it is a CLEARANCE above whatever this
 * penguin has on its head.
 *
 * The history is trap 9's whole point. It began at 2.06 local (3.1 m), where the camera's 27° of
 * downward pitch put it on top of the penguins standing BEHIND its owner. It was then measured
 * against the screen and set to 1.85, which was right while a 0.62 m name tag hung underneath it: the
 * arrow sat just above a big label and the pair read as one thing belonging to one bird.
 *
 * Then the label got small, and then the local penguin stopped having one at all — so the arrow was
 * left floating in 0.57 m of empty air, which is a third of a penguin's on-screen height above its
 * head (measured off the classic shot: 1.70 m of penguin is 90 device pixels, the gap was 30). It
 * read as a detached object hanging in the sky rather than as a label. A number that was measured
 * correctly against one frame stopped being right when the thing it was measured against was deleted.
 *
 * So it is now derived per penguin: the top of the head, or the top of the HAT if that is higher,
 * plus a clearance. Nothing to keep in step — a hat piece that moves takes the arrow with it, because
 * the top comes from the built hat's own bounding box rather than from a number copied out of it.
 *
 * **On whether one number can serve both framings** — the hub's close follow camera and an arena's
 * fit: yes, and it does not need per-mode data. The gap and the penguin are both vertical extents in
 * world metres projected by the same camera, so their RATIO on screen is the same wherever the camera
 * stands; a fixed pixel gap is the thing that would have varied. What was wrong was the size of the
 * gap, in every framing equally — the hub only made it more obvious, because there the penguin is
 * large and so is the emptiness above it.
 *
 * 0.07 local is 0.10 m in the world at the arrow's lowest, 0.17 m at mid-bob. It was 0.12 with a 0.07
 * bob, which put the average gap at 0.28 m — and on a hub, where the camera is close and there is no
 * longer a name tag under the arrow to fill the space, 0.28 m of nothing still read as a detached
 * object. The bob came down with it: a marker that swings 0.10 m needs 0.10 m of room to swing in.
 *
 * Note this is the clearance at the BOTTOM of the bob, not the average, which is why the bob is added
 * into the base below rather than being allowed to eat the gap.
 */
const MARKER_CLEARANCE = 0.07;
/**
 * The arrow's own size. Named because half the length is the offset from its middle to its point.
 *
 * Smaller than it was — 0.28 by 0.17 against 0.36 by 0.22 — because the height was only half of why
 * it read as a detached object. The other half was mass: at the old size the arrow was a third of a
 * penguin tall and nearly half as wide, which is a monument rather than a label. A marker should be
 * the smallest thing that cannot be missed.
 */
const MARKER_CONE_HEIGHT = 0.28;
const MARKER_CONE_RADIUS = 0.17;
const MARKER_BOB = 0.045;
const MARKER_BOB_HZ = 0.9;
/** A slow turn, so the arrow reads as an interface element rather than as something in the world. */
const MARKER_SPIN_HZ = 0.22;
/**
 * Emotes, which are the only thing one child can say to another in this game (`docs/DECISIONS/0004`).
 *
 * `lib/emote.ts` owns the list, the durations and the five shared MOVES; this owns what a move looks
 * like. The hard requirement is not prettiness, it is that each one is unmistakable — for the six
 * emotes against each other, and against the STUN, which is the one other thing that happens to a
 * penguin's whole body. So the stun keeps its vocabulary exclusively: nothing below spins about the
 * vertical axis and nothing orbits the head.
 *
 * That is also why `dance` — whose move `emote.ts` calls `spin` — is a rhythmic TWIST rather than a
 * pirouette. A penguin turning on the spot is a stunned penguin; a penguin twisting left-right on the
 * beat with its flippers up is dancing, and at Royal's distance the difference is obvious in a way
 * that "spins faster" would not be.
 *
 * Amplitudes are large on purpose. An emote is a deliberate performance a child pressed a button for
 * and waited half a second of enforced quiet to send (`EMOTE_GAP_TICKS`); a subtle one is a bug
 * report.
 */
const EMOTE_HOP = 0.18;
const EMOTE_HOP_STRETCH = 0.1;
const EMOTE_HOP_SQUASH = 0.08;
/** Beats in a bounce and in a dance. Two hops read as deliberate; three is a seizure. */
const EMOTE_BOUNCES = 2;
const EMOTE_DANCE_BEATS = 3;
const EMOTE_TWIST = 0.6;
/** How much of the twist the head takes OUT, so a dancing penguin still looks where it is going. */
const EMOTE_HEAD_HOLD = 0.5;
const EMOTE_WAVE_RAISE = 1.5;
const EMOTE_WAVE_SWINGS = 3;
const EMOTE_WAVE_SWING = 0.5;
const EMOTE_HUNCH = 0.28;
const EMOTE_STOMPS = 2;
const EMOTE_STOMP_LIFT = 0.22;
const EMOTE_SHRINK = 0.25;
/** How far the head sinks into the shoulders on an "uups". The whole joke is in this one number. */
const EMOTE_DUCK = 0.13;
/** Where the bubble floats: clear of the tallest thing already over this head, in WORLD metres. */
const EMOTE_BUBBLE_GAP = 0.12;
const EMOTE_BUBBLE_HALF = 0.31;

const RING_INNER = 0.5;
const RING_OUTER = 0.64;
const RING_OPACITY = 0.75;

/**
 * Shared across every penguin: geometry is identical, only the materials differ.
 *
 * The segment counts went up on 2026-08-16 ("can we enhance the style? make it more realistic")
 * together with the switch to smooth shading below, and again on 2026-08-21 for the cute pass. Ten
 * segments and flat shading gave a faceted silhouette that read as a low-poly ASSET; the same
 * primitives at 22×16, shaded smoothly, read as a rounded bird — and it is still spheres, still
 * generated in code, still nothing downloaded. The cost is a few hundred triangles per penguin
 * against a scene whose ocean alone is 51,200, i.e. nothing. Vertices are the one axis of this
 * renderer with room in it; object count is the one with none.
 *
 * The ICE keeps its facets on purpose (`scene.ts`): faceted ice reads as ice, faceted animals read
 * as a budget.
 *
 * The BEAK is a squashed sphere as of the cute pass. It was a four-sided cone, and a point is the
 * least cute shape there is — every reference the direction names has a blunt rounded nose.
 */
const geo = {
	body: new SphereGeometry(0.34, 22, 16),
	belly: new SphereGeometry(0.27, 22, 16),
	head: new SphereGeometry(HEAD_GEO_R, 22, 16),
	face: new SphereGeometry(0.19, 20, 14),
	eye: new SphereGeometry(0.062, 14, 10),
	gleam: new SphereGeometry(0.019, 8, 6),
	lid: new SphereGeometry(0.07, 14, 10),
	beak: new SphereGeometry(0.085, 16, 12),
	flipper: new SphereGeometry(0.16, 14, 11),
	foot: new SphereGeometry(0.11, 14, 11),
	shadow: new CircleGeometry(0.42, 20),
	star: new IcosahedronGeometry(STAR_SIZE, 0),
	// Four sides, not twelve: a pyramid points more clearly than a cone does, and at this size the
	// silhouette is the whole message. Left alone by the roundness pass on purpose — this is an
	// interface element drawn with an unlit material, not an animal.
	marker: new ConeGeometry(MARKER_CONE_RADIUS, MARKER_CONE_HEIGHT, 4),
	ring: new RingGeometry(RING_INNER, RING_OUTER, 32),
	// Hats. Cylinders and cones, because that is what a hat is once you stop drawing the wool.
	hatBrim: new CylinderGeometry(0.3, 0.3, 0.05, 16),
	hatCrown: new CylinderGeometry(0.24, 0.26, 0.26, 16),
	bobble: new SphereGeometry(0.09, 12, 9),
	cone: new ConeGeometry(0.22, 0.42, 16),
	spike: new ConeGeometry(0.05, 0.14, 6),
	band: new CylinderGeometry(0.27, 0.27, 0.09, 16),
	peak: new CylinderGeometry(0.3, 0.3, 0.04, 16, 1, false, -0.7, 1.4)
};

const EYE_COLOUR = 0x14161c;
const GLEAM_COLOUR = 0xffffff;

/**
 * One penguin on screen, and everything needed to keep it there or take it away.
 *
 * An object rather than a bag of meshes the caller drives, because the caller is about to become a
 * loop: phase 1 has six of these plus bots, and eliminated players get a second update path. It
 * also makes disposal impossible to forget — the previous shape exported a `disposePenguin` that
 * nothing ever called, and leaked five materials per penguin per round.
 */
export interface Actor {
	/** Lives in WORLD space. The ice it is standing on arrives through `setSurface`. */
	readonly root: Group;
	/**
	 * The ice under this penguin: where its middle is and which way it tilts.
	 *
	 * An actor used to be parented into the one tilting group, which gave it the floe's tilt for
	 * free. With several floes in the sea (`render/floeField.ts`) that would mean re-parenting a
	 * penguin mid-jump, so the tilt is handed over instead — and a penguin over open water simply
	 * keeps the last one, which is what a jumper looks like anyway.
	 */
	setSurface(center: Vec2, slope: Vec2, lift?: number): void;
	/**
	 * Draw this penguin where it is.
	 *
	 * `detailed` false is the FAR path: position, height and heading only. A Royal has thirty of
	 * these and all but a handful are on other floes, a few pixels across, where the gait, the lean,
	 * the waddle roll, the flipper counter-swing, the squash, the blink and the name tag are work
	 * nobody can see. It is the single biggest per-frame saving in the renderer, and it is invisible
	 * by construction — the threshold is a distance at which those details are smaller than a pixel.
	 */
	update(at: Interpolated, seconds: number, detailed?: boolean): void;
	/**
	 * Say something. Null clears it.
	 *
	 * A whole `EmoteBurst` rather than an id, because the burst carries the SPAN — `from` and `until`
	 * in ticks — and that is what lets the body, the bubble and the picker's cooldown all read one
	 * number instead of three counters that drift apart (`lib/emote.ts` argues this at length). The
	 * renderer works out the phase itself with `emoteProgress`; the caller just hands over whatever
	 * `startEmote` returned and forgets about it.
	 *
	 * The hub's button owns the press; this owns the performance.
	 */
	setEmote(burst: EmoteBurst | null): void;
	dispose(): void;
}

/** asin only accepts [-1, 1]; a gradient is capped far below that, but not by this file. */
function clampUnit(value: number): number {
	return Math.max(-1, Math.min(1, value));
}

function clamp(value: number, limit: number): number {
	return Math.max(-limit, Math.min(limit, value));
}

/**
 * The short way round.
 *
 * Any angle chased toward another has to go through this, or a turn across ±π sends the drawn thing
 * the long way and the penguin — or its hat — pirouettes for a step nobody asked for.
 */
function wrapAngle(delta: number): number {
	return Math.atan2(Math.sin(delta), Math.cos(delta));
}

/**
 * A phase in 0..1 from a name, so that two penguins standing together do not breathe and blink in
 * lockstep. A hash rather than a random number for the reason `puff.ts` gives: nothing in the
 * renderer may make two devices draw the same round differently.
 */
function phaseFromName(name: string): number {
	let hash = 7;
	for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) % 9973;
	return hash / 9973;
}

/**
 * A hat colour that has to read as a MATERIAL, including at the black end of the palette.
 *
 * `look.ts` offers 0x1b1f2a as a hat colour and a child can pick it in "Mein Pinguin" — I checked
 * rather than assumed — so it has to work, and at wool's shininess of 6 it did not: near-black with
 * no specular term returns almost nothing anywhere on its surface, so the hat came out as a flat
 * black mass on top of a bright round character. On the pink penguin in the Royal shot it read as a
 * hole cut in the head (art direction, 2026-08-21).
 *
 * Two answers at once, because either alone leaves it flat: the colour is LIFTED toward a neutral
 * charcoal, and the highlight is raised so light rolls across it. The lift is measured off the
 * palette rather than picked — 0x1b1f2a sits at 0.12 perceived lightness and the next darkest hat,
 * the deep indigo 0x2b3f7a, at 0.25, so a threshold of 0.22 over a span of 0.14 catches the black
 * one at 0.71 of the way and leaves every other chip untouched. The target is NEUTRAL on purpose: a
 * blue-grey would have walked the black chip toward the indigo chip and made two of the six the
 * same hat.
 *
 * Lightness and the mixing are both done on the sRGB BYTES rather than through `three.Color`, whose
 * channels are linear once colour management is on — a threshold picked by eye against a hex code is
 * a threshold about sRGB, and 0x1b1f2a is 0.12 there and 0.01 linear.
 */
const HAT_DARK_BELOW = 0.22;
const HAT_DARK_SPAN = 0.14;
const HAT_DARK_TOWARD = 0x555a63;
const HAT_WOOL_SHINE = 6;
const HAT_DARK_SHINE = 44;
const HAT_WOOL_SPECULAR = 0x1a1a1a;
const HAT_DARK_SPECULAR = 0x6a7488;
/** How much lighter the pom is than the hat under it. Two touching shapes in one colour are one shape. */
const BOBBLE_LIGHTEN = 0.16;

/** Channel-wise mix of two sRGB hexes. See `hatSurface` for why this is not `Color.lerp`. */
function mix(a: number, b: number, t: number): number {
	const channel = (shift: number) =>
		Math.round(((a >> shift) & 255) * (1 - t) + ((b >> shift) & 255) * t);
	return (channel(16) << 16) | (channel(8) << 8) | channel(0);
}

function hatSurface(colour: number): { color: number; shininess: number; specular: number } {
	const light =
		(0.2126 * ((colour >> 16) & 255) + 0.7152 * ((colour >> 8) & 255) + 0.0722 * (colour & 255)) /
		255;
	const lift = Math.max(0, Math.min(1, (HAT_DARK_BELOW - light) / HAT_DARK_SPAN));
	return {
		color: mix(colour, HAT_DARK_TOWARD, lift),
		shininess: HAT_WOOL_SHINE + lift * (HAT_DARK_SHINE - HAT_WOOL_SHINE),
		specular: mix(HAT_WOOL_SPECULAR, HAT_DARK_SPECULAR, lift)
	};
}

/**
 * Build the hat, if there is one.
 *
 * Five shapes from four primitives, which is the whole reason `docs/DECISIONS/0003` was worth
 * taking: a hat is a few centimetres of cylinder rather than a modelled asset, a texture and a
 * loader. The head sits at `HEAD_Y` with a radius of `HEAD_R`, so everything here is placed against
 * that pair and rides along when the head does.
 *
 * BAKED, as of the cute pass, and it paid for the two meshes this file gained: a crown was five
 * separate meshes and is now one, so a crowned penguin costs four draw calls less than it did. The
 * bobble is the one part kept out of the bake, because it is the part that has to move on its own.
 */
function createHat(
	hat: HatId,
	material: MeshPhongMaterial,
	bobbleMaterial: MeshPhongMaterial
): { group: Group; bobble: Mesh | null; geometry: BufferGeometry | null; top: number } | null {
	if (hat === 'none') return null;
	const group = new Group();
	const pieces: Piece[] = [];
	const piece = (source: BufferGeometry, at: [number, number, number], scaleY = 1) => {
		const geometry = source.clone();
		if (scaleY !== 1) geometry.scale(1, scaleY, 1);
		geometry.translate(...at);
		pieces.push({ geometry, colour: material.color.getHex() });
	};

	let bobble: Mesh | null = null;

	if (hat === 'bobble') {
		// 1.045 rather than 1.0, and it is not a nudge: the band's radius is 0.27 and the head's own
		// half-width at y = 1.0 is 0.271, so the two surfaces were coincident and the seam came out as
		// a jagged tear round the hat — clearly visible on the pink penguin in the Royal shot. At 1.045
		// the head is 0.241 wide there and the band encircles it with three centimetres to spare.
		piece(geo.band, [0, 1.045, 0]);
		piece(geo.hatCrown, [0, 1.14, 0]);
		bobble = new Mesh(geo.bobble, bobbleMaterial);
		bobble.position.y = 1.32;
		group.add(bobble);
	} else if (hat === 'crown') {
		piece(geo.band, [0, 1.05, 0]);
		// Four points rather than a modelled rim: at this size the silhouette is all that reads.
		for (let i = 0; i < 4; i++) {
			const angle = (i / 4) * Math.PI * 2;
			piece(geo.spike, [Math.sin(angle) * 0.2, 1.17, Math.cos(angle) * 0.2]);
		}
	} else if (hat === 'cap') {
		piece(geo.hatCrown, [0, 1.07, 0], 0.75);
		piece(geo.peak, [0, 0.98, 0.16]);
	} else {
		// party
		piece(geo.hatBrim, [0, 1.0, 0]);
		piece(geo.cone, [0, 1.24, 0]);
	}

	// One colour, painted per vertex, because that is what `bake` deals in. A hat is not the place
	// the vertex-colour machinery earns its keep — the draw-call saving is.
	const merged = bake(pieces, material);
	if (merged) group.add(merged);
	// How tall the thing came out, measured off the geometry rather than stated: the "you" arrow is
	// placed above it (`MARKER_CLEARANCE`), and a hat piece nudged up or down has to take the arrow
	// with it or the pair drifts apart exactly the way the arrow's own history did.
	let top = merged ? topOf(merged.geometry) : 0;
	if (bobble) top = Math.max(top, bobble.position.y + topOf(geo.bobble));
	return { group, bobble, geometry: merged?.geometry ?? null, top };
}

/** The highest point of a geometry, in its own space. Computed once; three caches the box. */
function topOf(geometry: BufferGeometry): number {
	if (!geometry.boundingBox) geometry.computeBoundingBox();
	return geometry.boundingBox?.max.y ?? 0;
}

/**
 * @param mine Whether this is the penguin the player is steering. See `MARKER_COLOUR` above for
 *   what it buys and why the answer is two markers rather than one. Defaults to false, so a
 *   forgotten argument produces an unmarked penguin rather than a floe of four arrows.
 */
export function createActor(
	look: ResolvedLook,
	name: string,
	mine = false,
	toboggan = false
): Actor {
	// Phong rather than Lambert, and smooth rather than flat-shaded. A penguin is a wet animal and
	// Lambert cannot be wet: it has no specular term at all, so every bird was a matte silhouette in
	// its own colour. One highlight rolling across the back as it turns is most of what "better
	// graphics" meant here, and it costs one extra term per fragment on a handful of objects.
	//
	// Deliberately NOT MeshStandardMaterial: a PBR surface without an environment map to reflect is
	// a duller Phong at several times the shader cost, and shipping an HDR to reflect is exactly the
	// asset `docs/DECISIONS/0003` exists to avoid.
	const body = new Group();
	/** Every geometry this actor OWNS — the merged ones. `geo` is shared and must outlive it. */
	const owned: BufferGeometry[] = [];

	/**
	 * The parts that never move relative to each other, baked into ONE mesh with vertex colours.
	 *
	 * Hips, shoulders, belly, head, face, beak, eyes and gleams: eleven shapes that only ever move as
	 * a unit, because the waddle, the lean and the squash are applied to the GROUP. Merged, a penguin
	 * costs seven draw calls instead of nineteen, and a Royal has thirty of them — measured at 295
	 * draw calls a frame before the limbs and the ice were counted separately.
	 *
	 * The one thing it costs: these parts used to carry three materials with different specular
	 * highlights — feathers at 26, keratin at 48, eyes at 90 — and a merged mesh has one. Feathers
	 * win, because they are almost all of the surface, and the beak and eyes keep their colour.
	 *
	 * +Z is forward, matching `heading()` in the simulation, so the renderer assigns `facing` to
	 * `rotation.y` with no conversion. A conversion that exists in one place is one someone forgets
	 * in the second place.
	 */
	const rigid: Piece[] = [];
	/**
	 * The head's own pieces, in the same modelling space as everything else and then shifted DOWN by
	 * the pivot on the way in — so the numbers below stay absolute and readable while the mesh that
	 * carries them rotates about a neck. See `HEAD_PIVOT_Y`.
	 */
	const skull: Piece[] = [];
	const shape = (
		source: BufferGeometry,
		colour: number,
		place: { at: [number, number, number]; scale?: [number, number, number]; head?: boolean }
	) => {
		const geometry = source.clone();
		if (place.scale) geometry.scale(...place.scale);
		const [x, y, z] = place.at;
		geometry.translate(x, place.head ? y - HEAD_PIVOT_Y : y, z);
		(place.head ? skull : rigid).push({ geometry, colour });
	};

	// The hips: the widest part of the bird, and the part sitting on the ice. Its bottom is at y = 0.
	shape(geo.body, look.body, { at: [0, 0.34, 0], scale: [1.16, 1, 1.06] });
	// The shoulders, and their numbers are a MEASUREMENT off a screenshot rather than a taste.
	//
	// The first pass put them at 0.60 with a half-width of 0.313, which is 0.06 WIDER than the hips
	// are at that height — so the union of the two spheres had a bulge with a concave crease under it,
	// and smooth shading turns a concave crease into a dark band. From behind, where the cream front
	// and the face are both hidden, a penguin was three same-coloured balls in a column with two
	// grooves between them: "a green ring rather than a body" (art direction, 2026-08-21), and the
	// near pink penguin in the Royal shot read as a stack of tyres.
	//
	// The rule that fixes it: the upper sphere's silhouette must stay INSIDE the hips' everywhere the
	// hips are still wide, and take over only where the hips have already narrowed. At 0.299 wide and
	// centred at 0.58 the two outlines cross at y ≈ 0.56, where both are 0.30, so the profile falls
	// monotonically — 0.348 at 0.50, 0.30 at 0.56, 0.296 at 0.62 — and there is no crease left to
	// shade. One groove survives, under the head, and that one is a NECK and is supposed to be there.
	shape(geo.body, look.body, { at: [0, 0.58, -0.015], scale: [0.88, 0.88, 0.9] });
	// The cream front, up the whole body. It has to protrude past both spheres at every height it
	// covers or it is trap 11 again — a shape that renders perfectly, costs its triangles and is
	// buried inside the thing in front of it.
	shape(geo.belly, look.belly, { at: [0, 0.4, 0.14], scale: [1.06, 1.3, 0.82] });
	const headScale = HEAD_R / HEAD_GEO_R;
	shape(geo.head, look.body, {
		at: [0, HEAD_Y, 0.01],
		scale: [headScale, headScale, headScale],
		head: true
	});
	// The face, as a plate on the front of the head rather than a spot on it: r 0.29 pushed 0.145
	// forward and flattened to hug, which shows cream across the whole front and leaves the top and
	// back in the body colour, like a hood.
	shape(geo.face, look.belly, { at: [0, 0.8, 0.155], scale: [1.53, 1.53, 1.15], head: true });
	shape(geo.beak, look.beak, { at: [0, 0.755, 0.3], scale: [1.05, 0.72, 1.45], head: true });
	for (const side of [-1, 1]) {
		shape(geo.eye, EYE_COLOUR, {
			at: [side * EYE_X, EYE_Y, EYE_Z],
			scale: [1, 1.06, 0.62],
			head: true
		});
		shape(geo.gleam, GLEAM_COLOUR, {
			at: [side * (EYE_X + 0.018), EYE_Y + 0.028, EYE_Z + 0.03],
			head: true
		});
	}

	const feathers = new MeshPhongMaterial({
		vertexColors: true,
		shininess: 26,
		specular: 0x223344
	});
	const hull = bake(rigid, feathers);
	if (hull) {
		body.add(hull);
		owned.push(hull.geometry);
	}

	/**
	 * The head, on a neck.
	 *
	 * Its own mesh and therefore its own draw call — the only one added tonight, and the reason is
	 * that a head which cannot move is the difference between a creature and a puppet, in the one view
	 * the hub's follow camera is about to use for minutes at a time. The baked HATS paid for it
	 * (a crown went from five meshes to one), so a hatted penguin is still cheaper than it was
	 * yesterday.
	 *
	 * The group is the neck; the mesh inside it is already shifted, so the group's own rotation is a
	 * neck rotation and nothing else has to know.
	 */
	const neck = new Group();
	neck.position.y = HEAD_PIVOT_Y;
	body.add(neck);
	const skullMesh = bake(skull, feathers);
	if (skullMesh) {
		neck.add(skullMesh);
		owned.push(skullMesh.geometry);
	}

	// The keratin materials the limbs keep: harder, glossier, a tighter highlight than feathers.
	const bodyMat = new MeshPhongMaterial({ color: look.body, shininess: 26, specular: 0x223344 });
	const beakMat = new MeshPhongMaterial({ color: look.beak, shininess: 48, specular: 0x554433 });

	/**
	 * The eyelids: both of them, in one mesh, and the only thing on this penguin that exists purely
	 * to be hidden.
	 *
	 * They cannot be part of the hull — a merged mesh cannot move a part of itself — so this is the
	 * one extra draw call the cute pass costs, and it is a draw call that only happens during a blink
	 * (about 4% of the time) on a penguin close enough to be drawn in detail. The baked hats pay for
	 * it several times over.
	 *
	 * `matrixAutoUpdate` has to go back ON: `bake` turns it off, correctly, for a mesh that never
	 * moves relative to its parent — and this one is scaled and dropped every frame it is visible.
	 */
	const lidPieces: Piece[] = [];
	for (const side of [-1, 1]) {
		const geometry = geo.lid.clone();
		// 0.72 rather than the eye's own 0.62: the lid has to close over the GLEAM too, and the gleam
		// stands a centimetre proud of the eye it sits on.
		geometry.scale(1, 1, 0.72);
		geometry.translate(side * EYE_X, 0, EYE_Z);
		lidPieces.push({ geometry, colour: look.body });
	}
	const lids = bake(lidPieces, new MeshPhongMaterial({ vertexColors: true, shininess: 26 }));
	if (lids) {
		lids.matrixAutoUpdate = true;
		// On the NECK, not the body: eyelids that stayed behind while the head turned would be two
		// discs hanging in the air where the face used to be.
		lids.position.y = LID_REST_Y;
		lids.visible = false;
		neck.add(lids);
		owned.push(lids.geometry);
	}

	// Kept as their own meshes, because the gait moves them every frame. The rest of the character is
	// placed once and never touched again; these four are the only animated parts, and holding them
	// by name is what keeps `update` from traversing the group looking for limbs.
	const legs: { mesh: Mesh; side: number; baseY: number; baseZ: number }[] = [];
	const flippers: { mesh: Mesh; side: number }[] = [];

	for (const side of [-1, 1]) {
		const flipper = new Mesh(geo.flipper, bodyMat);
		// Short and stubby, half buried in a body that is wider than it was: a long thin flipper is
		// the same taper the torso just lost.
		// 0.335 rather than 0.355: at the wider setting the inner edge sat almost exactly on the body's
		// surface and the flipper read as a separate oval stuck to the side.
		flipper.position.set(side * 0.335, 0.52, 0);
		flipper.scale.set(0.4, 1.12, 0.82);
		flipper.rotation.z = side * FLIPPER_REST;
		body.add(flipper);
		// The resting outward tilt is `rotation.z` and stays where it was set; the gait drives
		// `rotation.x` alone, so there is no base value to remember.
		flippers.push({ mesh: flipper, side });

		// Further apart and further forward than they were, because they now have to poke out from
		// under a body whose widest point is at the bottom.
		const foot = new Mesh(geo.foot, beakMat);
		foot.position.set(side * 0.155, 0.045, 0.16);
		foot.scale.set(1, 0.4, 1.45);
		body.add(foot);
		legs.push({ mesh: foot, side, baseY: 0.045, baseZ: 0.16 });
	}

	// The hat gets its own material so a red hat on a red penguin still reads as a hat.
	// Wool and felt, so barely any highlight at all — a hat that shone like the bird under it would
	// read as plastic, and the point of the hat is that it is a different material.
	// NOT `vertexColors`, although the hat goes through `bake`: a hat is one colour, so the per-vertex
	// colours the bake paints are simply unread, and the same material has to serve the BOBBLE — whose
	// geometry is a plain shared sphere with no colour attribute on it at all. A `vertexColors`
	// material over a geometry that has none reads the missing attribute as zero and draws the bobble
	// black.
	//
	// The colour is LIFTED and the highlight is raised for the dark end of the palette — see
	// `hatSurface`. `look.hatColour`'s last entry is 0x1b1f2a and a child can pick it in "Mein
	// Pinguin", so it has to work rather than be avoided.
	const hatFinish = hatSurface(look.hatColour);
	const hatMat = new MeshPhongMaterial(hatFinish);
	// The bobble gets its own material, a step lighter than the hat it hangs off. Same reason the ice
	// is faintly blue rather than white (trap 11): two touching shapes in exactly one colour are one
	// shape, and the pom is the part of a bobble hat that makes it a bobble hat.
	const bobbleMat = new MeshPhongMaterial({
		...hatFinish,
		color: mix(hatFinish.color, 0xffffff, BOBBLE_LIGHTEN)
	});
	const built = createHat(look.hat, hatMat, bobbleMat);
	const hat = built?.group ?? null;
	const bobble = built?.bobble ?? null;
	if (hat) {
		// Parented to the NECK and pushed back down by the pivot, so its pieces still land at the
		// absolute heights they were modelled at while turning with the head that wears it. A hat left
		// on the body would slide off the side of the skull on every glance.
		hat.position.y = -HEAD_PIVOT_Y;
		neck.add(hat);
	} else {
		hatMat.dispose();
		bobbleMat.dispose();
	}
	if (built?.geometry) owned.push(built.geometry);
	/** Where the bobble hangs when nothing is moving. Read back rather than re-stated. */
	const bobbleY = bobble?.position.y ?? 0;

	// On the ROOT rather than on the body, and that is the one line that stopped the tag being twice
	// the size it should be: the body is scaled by PENGUIN_SCALE, so a 0.42 m sprite inside it was
	// 0.62 m over the penguin's head. It also stops the label swinging with the lean, rolling with
	// the waddle and squashing with the landing, none of which a label should do.
	// The local player gets NO name tag, and that is the decision that made the other tags legible.
	//
	// It reads backwards — the penguin the child has to find is the one with no label — and it is the
	// right way round: this bird already carries an arrow over its head and a ring on the ice, two
	// SHAPES, which is a stronger cue than a word and the only one that survives a scrum. Meanwhile it
	// is always the penguin nearest the camera, so its tag was permanently occupying one of the three
	// slots `nameTag.ts` now hands out, and it was the biggest pill in the middle of the frame.
	// A penguin with no name gets no tag either, and that is not just tidiness: `preview.ts` builds an
	// actor with an empty name for the turntable, and an empty tag still MEASURES itself and would sit
	// a metre from the preview camera holding one of the three budget slots against the round going on
	// behind the sheet.
	const tag: NameTag | null = mine || name === '' ? null : createNameTag(name, look.body);
	if (tag) tag.sprite.position.y = NAME_TAG_HEIGHT * PENGUIN_SCALE;

	// Dizzy stars, parented to the ROOT rather than to the body: the body spins while stunned, and
	// stars welded to a spinning body just spin with it and read as part of the costume. Orbiting
	// independently is what makes them say "this penguin is not in control".
	// The one thing left deliberately flat-shaded: the stars are a SYMBOL, not an object in the
	// world, and faceted gold is how they say so.
	const starMat = new MeshLambertMaterial({ color: 0xffe14d, flatShading: true });
	const stars = new Group();
	stars.visible = false;
	for (let i = 0; i < STAR_COUNT; i++) {
		const star = new Mesh(geo.star, starMat);
		const angle = (i / STAR_COUNT) * Math.PI * 2;
		star.position.set(Math.sin(angle) * STAR_ORBIT_RADIUS, 0, Math.cos(angle) * STAR_ORBIT_RADIUS);
		stars.add(star);
	}
	stars.position.y = STAR_HEIGHT * PENGUIN_SCALE;

	// No shadow map anywhere in this game: a directional light's shadow camera is the single most
	// expensive thing that could be switched on here, and on a moving, tilting surface it buys
	// almost nothing. A blob is what actually communicates the one thing a player must read — how
	// high off the ice a jumping penguin is — and it costs one transparent circle.
	//
	// Typed concretely rather than as a bare `Mesh`, whose `material` is `Material | Material[]`.
	// That union forced the caller into an `Array.isArray` plus an `'opacity' in` narrowing, every
	// frame, for a material this function constructs three lines below.
	const shadowMat = new MeshLambertMaterial({
		color: 0x1b3a5c,
		transparent: true,
		opacity: SHADOW_OPACITY,
		depthWrite: false
	});
	const shadow = new Mesh<CircleGeometry, MeshLambertMaterial>(geo.shadow, shadowMat);
	shadow.rotation.x = -Math.PI / 2;
	shadow.position.y = 0.02;
	shadow.scale.setScalar(PENGUIN_SCALE);

	// The dust. On the root and in world metres, because it has to stay on the ice at the spot where
	// the landing happened while the penguin slides on — see `update`.
	const puff = createPuff();

	// Applied to the body group rather than baked into every primitive above, so the modelling
	// numbers stay readable as real-world proportions and one constant resizes the character.
	body.scale.setScalar(PENGUIN_SCALE);

	// The two "this one is you" markers, on the ROOT rather than on the body: the body spins while
	// stunned, leans into a slide and rolls with the waddle, and a marker that does all three is a
	// marker that stops being a marker at exactly the moment the player has lost track of themselves.
	//
	// The arrow is `depthTest: false` — a marker hidden behind somebody's hat has failed at its one
	// job — while the ring is not: it lies on the ice, and one that shone through the floe would read
	// as being under the ice rather than on it. The name tag used to be in the first group and is not
	// any more (`nameTag.ts`); the arrow is now the only thing on a penguin that always wins.
	// BASIC rather than Lambert: this is a symbol, not an object in the world, and the sun is behind
	// the camera's shoulder — a lit arrow presents its shaded underside to the player and goes brown
	// against bright ice, which is the one thing it cannot afford to do. Measured on screen.
	/** The tallest thing this penguin is wearing, in local metres: its head, or its hat. */
	const wearing = Math.max(HEAD_TOP, built?.top ?? 0);
	/**
	 * Everything between that and the arrow's MIDDLE: the clearance, the bob's full swing so the
	 * clearance is what you get at the closest approach rather than on average, and half the arrow
	 * because a cone is positioned by its centre.
	 */
	const markerLift = MARKER_CLEARANCE + MARKER_BOB + MARKER_CONE_HEIGHT / 2;

	const marker = mine
		? new Mesh(geo.marker, new MeshBasicMaterial({ color: MARKER_COLOUR, depthTest: false }))
		: null;
	if (marker) {
		// Point DOWN, at the penguin it belongs to.
		marker.rotation.x = Math.PI;
		marker.renderOrder = 11;
		// Scaled like the bird it belongs to, so one constant still resizes the whole character.
		marker.scale.setScalar(PENGUIN_SCALE);
	}

	const ring = mine
		? new Mesh(
				geo.ring,
				new MeshLambertMaterial({
					color: MARKER_COLOUR,
					transparent: true,
					opacity: RING_OPACITY,
					depthWrite: false
				})
			)
		: null;
	if (ring) {
		ring.rotation.x = -Math.PI / 2;
		// Just above the blob shadow, which sits at 0.02: the two overlap, and z-fighting between them
		// flickers at exactly the distance the ring is meant to be read from.
		ring.position.y = 0.04;
		ring.scale.setScalar(PENGUIN_SCALE);
	}

	const root = new Group();
	root.add(shadow, body, stars, puff.mesh);
	if (tag) root.add(tag.sprite);
	if (ring) root.add(ring);
	if (marker) root.add(marker);

	/** The floe under this penguin: its centre, and the gradient at it. See `setSurface`. */
	const surface = { center: { x: 0, z: 0 }, slope: { x: 0, z: 0 }, lift: 0 };

	/** Metres walked, which is what the gait is a function of. Wraps at 2π/STRIDE to stay small. */
	let stride = 0;
	/** The drawn heading, chasing `at.facing` at TURN_RATE. Display only — never written back. */
	let shownFacing: number | null = null;
	/** Wall-clock reading of the previous frame, so the gait can advance by distance per frame. */
	let lastSeconds: number | null = null;
	/** How fast the drawn heading is catching up, smoothed. The lean and the yaw lead are made of it. */
	let turning = 0;
	/**
	 * A lagged copy of the velocity in the penguin's own frame. The DIFFERENCE from the live one is
	 * how much it has changed recently, which is what a body leans into — see `LEAN_PER_PUSH`.
	 */
	let lagForward = 0;
	let lagSideways = 0;
	/** The hat's own yaw, chasing the body's. What gets drawn is the difference. */
	let hatFacing: number | null = null;
	/** A lagged copy of the head's height, in local metres, so the bobble can trail it. */
	let bobbleLift: number | null = null;
	/** Whether the feet were off the ice last frame — the whole landing state machine. */
	let wasAirborne: boolean | null = null;
	/** How fast it was coming down on the last airborne frame; a landing reads it after the fact. */
	let impact = 0;
	/** When the last landing was, so the squash can spring back from it. Negative is "not landing". */
	let landedAt = -1;
	/**
	 * Where this penguin is in its own two rhythms, spread across the floe by name. See BREATH_HZ for
	 * why it is a hash and not a random number.
	 *
	 * Two values rather than one: the blink's walks forward at every blink, and a breath sharing that
	 * variable would jump by a third of a cycle every time the bird blinked — a visible pop in the
	 * body's scale, from a line about eyelids.
	 */
	const breathPhase = phaseFromName(name);
	let blinkPhase = breathPhase;
	let blinkAt = 1.5 + blinkPhase * BLINK_EVERY;
	let blinkStart = -1;
	/** Where the current puff was thrown, in world XZ. The penguin slides on; the dust does not. */
	const puffAt = { x: 0, z: 0 };
	/** What this penguin is saying, and how it is saying it. See `setEmote`. */
	let saying: EmoteBurst | null = null;
	let move: EmoteMove | null = null;
	/**
	 * Built on the first emote this penguin ever sends, and never for one that does not.
	 *
	 * A Royal has thirty penguins and exactly one of them can press the button, so a bubble per actor
	 * at construction would be twenty-nine sprites and twenty-nine materials waiting for nothing. The
	 * TEXTURES are shared and module-owned (`bubble.ts`), so the one-off cost here is a sprite, and it
	 * lands on a button press rather than inside a frame.
	 */
	let bubble: Bubble | null = null;
	/** Stomps already thrown dust, so each beat of a `grumpy` kicks up exactly one puff. */
	let stomped = 0;

	return {
		root,

		setEmote(burst) {
			saying = burst;
			move = burst ? (emoteById(burst.id)?.move ?? null) : null;
			stomped = 0;
			if (burst) {
				if (!bubble) {
					bubble = createBubble();
					root.add(bubble.sprite);
				}
				bubble.show(burst.id);
			}
		},

		setSurface(center, slope, lift = 0) {
			surface.center = center;
			surface.slope = slope;
			// How high the ice itself is sitting: the swell's bob, and how far a broken piece has gone
			// under. Without it a penguin on a sinking fragment hangs in the air while its ice leaves.
			surface.lift = lift;
		},

		update(at, seconds, detailed = true) {
			// The ice's own height at this spot: `types.ts` defines the surface as
			// -(slope·local), so a penguin on the low side of a tilting floe stands lower than one on
			// the high side — which is the whole of what the tilt looks like from outside.
			const localX = at.x - surface.center.x;
			const localZ = at.z - surface.center.z;
			const ice = surface.lift - (surface.slope.x * localX + surface.slope.z * localZ);
			root.position.set(at.x, ice + at.height, at.z);
			// Standing perpendicular to the ice rather than to the world. The same two rotations the
			// floe's own group applies, so a penguin and the slab under it agree exactly.
			root.rotation.z = -Math.asin(clampUnit(surface.slope.x));
			root.rotation.x = Math.asin(clampUnit(surface.slope.z));

			// Frame delta, clamped. A backgrounded tab resumes with a delta of many seconds, and an
			// unclamped one would spin the legs through dozens of strides in a frame; a phone that
			// dropped one frame should look like a phone that dropped one frame.
			const dt = lastSeconds === null ? 0 : Math.min(Math.max(seconds - lastSeconds, 0), 0.1);
			lastSeconds = seconds;

			// Feet-on-ice, from the RAW tick rather than the interpolated height: "did that land" is a
			// yes/no fact about the simulation, and a smoothed height crosses zero a frame late and
			// then wobbles back over it. Kept outside the detail test below so that a penguin which
			// lands while it is far away does not throw up its dust when it comes near.
			const airborne = at.penguin.height > 0;
			const tookOff = wasAirborne === false && airborne;
			const landed = wasAirborne === true && !airborne;
			if (airborne) impact = Math.max(impact, -at.penguin.heightVel);
			if (landed) landedAt = seconds;

			if (!detailed) {
				// The far path. Facing is kept because a penguin's direction is legible at any size —
				// it is the difference between a dot and a dot that is going somewhere — and the tag
				// goes because a name a few pixels tall is a smear that costs a draw call.
				body.rotation.set(0, at.facing, 0);
				body.position.y = 0;
				body.scale.setScalar(PENGUIN_SCALE);
				if (lids) lids.visible = false;
				if (hat) hat.rotation.y = 0;
				stars.visible = false;
				if (tag) tag.sprite.visible = false;
				puff.mesh.visible = false;
				// Nothing a penguin says is legible at this range, and an emote is the one thing on a
				// character that must never be half-readable — see `bubble.ts`.
				bubble?.update(null);
				shadow.position.y = -at.height + 0.02;
				shadow.material.opacity = SHADOW_OPACITY;
				shadow.scale.setScalar(PENGUIN_SCALE);
				if (marker) marker.visible = false;
				if (ring) ring.visible = false;
				wasAirborne = airborne;
				if (!airborne) impact = 0;
				return;
			}

			// A penguin that has been knocked out is watching from a chunk of ice, and the stun it was
			// carrying when it went in is over as far as the screen is concerned: leaving the stars
			// spinning over a spectator makes elimination look like a state it might recover from.
			const watching = at.penguin.phase === 'out';
			// Stunned overrides the ordinary facing entirely — a penguin that has lost its controls
			// should not look like it is steering.
			const stunned = !watching && at.penguin.stunTicks > 0;
			stars.visible = stunned;
			if (stunned) {
				body.rotation.y = seconds * STUN_SPIN_HZ * Math.PI * 2;
				stars.rotation.y = -seconds * STUN_SPIN_HZ * Math.PI * 2 * 0.7;
				stars.position.y = (STAR_HEIGHT + Math.sin(seconds * 6) * 0.04) * PENGUIN_SCALE;
				// The spin left the drawn heading somewhere arbitrary, so it is re-acquired rather
				// than chased when the penguin comes round: a slow sweep back from wherever the spin
				// stopped would read as a second, drunker stun.
				shownFacing = null;
				turning = 0;
			} else {
				// Chase the simulation's heading instead of snapping to it, by the SHORT way round.
				if (shownFacing === null) shownFacing = at.facing;
				else {
					const delta = wrapAngle(at.facing - shownFacing);
					const step = TURN_RATE * dt;
					const applied = Math.abs(delta) <= step ? delta : Math.sign(delta) * step;
					shownFacing += applied;
					// How fast it is actually catching up, in rad/s, smoothed: the raw per-frame rate
					// jumps between zero and the full TURN_RATE and a lean made of it would flicker.
					const rate = dt > 0 ? applied / dt : 0;
					turning += (rate - turning) * Math.min(1, TURN_SMOOTH * dt);
				}
				// A few degrees ahead of the body, so it reads as looking where it is going.
				body.rotation.y = shownFacing + clamp(turning * TURN_LEAD, TURN_LEAD_MAX);
			}

			// Lean into the slide. Cosmetic, but it is what makes momentum visible: a penguin being
			// carried sideways by ice it is fighting looks like one, rather than like a model
			// sliding on a plane. The velocity is rotated into the penguin's own frame so the lean
			// is forward/backward and side-to-side rather than along the world axes.
			const { vel, height, phase } = at.penguin;
			// Velocity in the penguin's own frame, and a lagged copy of it. Computed before the branches
			// so the lag keeps tracking through a stun and a spectator's drift: a lag that stopped
			// updating would hand back a two-second-old velocity as "recent change" the moment the
			// penguin came round, and throw it into a lunge it never made.
			const forward = Math.cos(at.facing) * vel.z + Math.sin(at.facing) * vel.x;
			const sideways = Math.cos(at.facing) * vel.x - Math.sin(at.facing) * vel.z;
			const settle = Math.min(1, LEAN_SETTLE_RATE * dt);
			lagForward += (forward - lagForward) * settle;
			lagSideways += (sideways - lagSideways) * settle;

			if (stunned) {
				// A fixed drunken tilt rather than a velocity-derived one: the point is that the
				// penguin is not reacting to anything any more.
				body.rotation.x = STUN_LEAN;
				body.rotation.z = 0;
			} else if (watching) {
				// Upright. The velocity a spectator still carries is the one that threw it off the edge,
				// and leaning into it would leave the penguin permanently falling over on dry ice.
				body.rotation.x = 0;
				body.rotation.z = 0;
			} else {
				// A modest permanent inclination, plus the interesting half: a tip INTO whatever the
				// velocity has just done. Starting to walk pitches the body forward and it eases upright
				// as the lag catches up; stopping tips it back and it settles. That is anticipation and
				// follow-through, out of one subtraction.
				body.rotation.x = forward * LEAN_PER_SPEED + (forward - lagForward) * LEAN_PER_PUSH;
				// Three things on one axis: which way it is being carried, which way it has just
				// started or stopped being carried, and which way it is turning. A negative roll tips
				// the top toward the penguin's own +X, which is the side a positive turn rate is
				// heading for — so the sign is what makes it lean INTO the turn.
				body.rotation.z =
					-sideways * LEAN_PER_SPEED -
					(sideways - lagSideways) * LEAN_PER_PUSH -
					clamp(turning * TURN_ROLL, TURN_ROLL_MAX);
			}

			// The gait. Walking only: frozen mid-air and while falling, because feet that keep
			// stepping through a jump belong to a cartoon this game is not.
			const pace = Math.hypot(vel.x, vel.z);
			const walking = !stunned && !watching && height <= 0 && phase === 'skating';

			// TOBOGGANING, which is what a penguin does on a mountain and the reason the slide did not
			// feel like one. Everything below this line is a WALK — a stride advanced by distance, a
			// waddle roll, a dip per foot — and at eleven metres a second that is a bird sprinting
			// down an ice chute on its feet. It reads exactly as it is: not sliding.
			//
			// Above a walking pace the penguin goes onto its belly, and the pose does the rest: the
			// gait is switched off, the flippers sweep back, and the body lies along the ice. Below
			// it — at the start line, or picking itself up after a fall — it stands, so the change
			// happens the moment the run takes hold rather than being a mode the player is put into.
			const sledding = toboggan && walking && pace > TOBOGGAN_SPEED;
			if (sledding) {
				// Lying along the run rather than pivoting at the feet: the body is rotated flat and
				// then pushed forward and down so the belly, not the toes, is the part on the ice.
				body.rotation.x = TOBOGGAN_PITCH;
				body.position.y = TOBOGGAN_DROP;
				body.position.z = TOBOGGAN_SHIFT;
				// The lean survives, sideways only. Carving is the one thing the player is doing and
				// the only thing on screen that shows it.
				const carve = Math.cos(at.facing) * vel.x - Math.sin(at.facing) * vel.z;
				body.rotation.z = -carve * LEAN_PER_SPEED;
				for (const leg of legs) {
					leg.mesh.position.z = leg.baseZ - FOOT_SWING;
					leg.mesh.position.y = leg.baseY;
				}
				// Swept back along the body, the way anything moving fast holds its arms, and splayed
				// out so the silhouette from behind is not a smooth oval.
				for (const flipper of flippers) {
					flipper.mesh.rotation.x = TOBOGGAN_FLIPPERS;
					flipper.mesh.rotation.z = flipper.side * TOBOGGAN_SPLAY;
				}
			} else {
				body.position.z = 0;
			}
			// How much of the full waddle this speed earns. Everything below scales by it, so a
			// standing penguin is still and a sprinting one is at full swing, with no step in between.
			const gait = walking && !sledding ? Math.min(pace / WADDLE_FULL_SPEED, 1) : 0;

			// Advanced by DISTANCE, so the legs turn over with the ground rather than with the clock.
			// Wrapped at a whole number of strides so a long round cannot drift into float noise.
			if (walking) stride = (stride + pace * dt) % (1000 / STRIDE_PER_METRE);
			/** Where the whole body is in its stride, 0..1. Everything below is a function of it. */
			const cycle = (stride * STRIDE_PER_METRE) % 1;
			const step = cycle * Math.PI * 2;
			/** Full-size feet from well below a walking pace. See FOOT_FULL_SPEED. */
			const plant = walking && !sledding ? Math.min(pace / FOOT_FULL_SPEED, 1) : 0;

			// GUARDED, and this guard is a bug fix rather than a tidy-up. Everything the toboggan branch
			// above does to the limbs — feet tucked back, flippers swept and splayed — was being
			// overwritten by this loop a few lines later, every frame, because `gait` is zero while
			// sledding and the loop multiplied by it: `rotation.x = -sin(…) * SWING * 0` is not "leave
			// it alone", it is "set it to zero". So `TOBOGGAN_FLIPPERS` has never once been on screen,
			// and neither have the tucked feet: a tobogganing penguin has been a limbless lump for as
			// long as the slide has existed, which is very likely the "green ring rather than a body"
			// the art direction has been reporting. Trap 15's shape exactly — a value assigned,
			// documented, and then quietly clobbered downstream.
			if (!sledding) {
				for (const leg of legs) {
					// The two legs are half a stride apart — that is what makes it a walk rather than a
					// hop. Phase zero is the moment this foot lands, at its forward extreme.
					const u = (cycle + (leg.side < 0 ? 0 : 0.5)) % 1;
					if (u < STANCE) {
						// PLANTED, and travelling backwards LINEARLY — not on a sine. This is the whole
						// difference between a foot that carries a penguin and one that skates under it:
						// the body advances at a constant speed, so a foot in contact with the ground has
						// to come back at a constant speed too. A sine spends the middle of its stance
						// moving faster than the ground and both ends moving slower.
						const through = u / STANCE;
						leg.mesh.position.z = leg.baseZ + (0.5 - through) * 2 * FOOT_SWING * plant;
						leg.mesh.position.y = leg.baseY;
					} else {
						// SWINGING: back to the front in the remaining third of the cycle, lifting in an
						// arch on the way. Nothing is carrying weight, so the timing here is free.
						const through = (u - STANCE) / (1 - STANCE);
						leg.mesh.position.z = leg.baseZ + (through - 0.5) * 2 * FOOT_SWING * plant;
						// Scaled by `plant` rather than `gait`, like the excursion it belongs to: a foot
						// crossing its full swing without lifting is a foot being dragged forward.
						leg.mesh.position.y = leg.baseY + Math.sin(Math.PI * through) * FOOT_LIFT * plant;
					}

					// The flipper on the same side, counter-phase to its foot, like every walking animal.
					const flipper = flippers[leg.side < 0 ? 0 : 1];
					if (flipper) {
						flipper.mesh.rotation.x = -Math.sin(u * Math.PI * 2) * FLIPPER_SWING * gait;
						// The resting roll, put back after a toboggan run borrowed it.
						flipper.mesh.rotation.z = flipper.side * FLIPPER_REST;
					}
				}
			}

			// The roll is most of what a waddle IS, and it rides on top of the velocity lean rather
			// than replacing it: the lean says which way the penguin is being carried, the roll says
			// it is walking. Touching `rotation.z` here is safe because every branch above assigns it.
			//
			// The SIGN is the whole point, and the old one was backwards: the roll was added toward
			// the foot in the air, so the body rose away from every step instead of settling onto it.
			//
			// It is derived from the same phase the feet are, rather than from a second sine that has
			// to be kept in step with them — the lesson trap 7 paid for. `carrying` is −1 when the left
			// foot is at mid-stance (`cycle` 0.31, half of STANCE) and +1 when the right one is, half a
			// cycle later; a NEGATIVE `rotation.z` tips the body toward its own +X, which is the right
			// side. So the body leans onto whichever foot is holding it up.
			const carrying = -Math.cos((cycle - STANCE / 2) * Math.PI * 2);
			if (!sledding) body.rotation.z -= carrying * WADDLE_ROLL * gait;
			// And the opposite case: standing still is not standing rigid. Fades out as the walk fades
			// in, on the same per-penguin phase as the breath, so a crowd is not one metronome.
			if (!sledding && !stunned) {
				body.rotation.z +=
					Math.sin((seconds * IDLE_SWAY_HZ + breathPhase) * Math.PI * 2) * IDLE_SWAY * (1 - gait);
			}
			// One dip per FOOT, i.e. twice per stride — a body that rose and fell once per stride
			// limps. Phase-shifted so the low point is the moment a foot lands.
			if (!sledding) body.position.y = ((1 - Math.cos(step * 2)) / 2) * gait * WADDLE_HEIGHT;

			/**
			 * The emote, which rides ON TOP of whatever the body was already doing.
			 *
			 * Additive rather than a mode, deliberately: nothing in `sim/` knows an emote is happening,
			 * so a child can walk, jump and be shoved in the middle of a dance, and a pose that replaced
			 * the gait would freeze a penguin that the simulation is still moving. What the limbs do is
			 * an override, because a flipper cannot both wave and swing.
			 */
			const said = emoteProgress(saying, seconds * TICK_RATE);
			let emoteSquash = 0;
			let emoteLift = 0;
			/** How far a dance has twisted the body, kept so the head can take it back out. */
			let emoteTwist = 0;
			// Reset first, so nothing an emote moved is left where it was when the emote ends. The gait
			// rewrites the limbs every frame; the neck's own position is the one thing that does not.
			neck.position.y = HEAD_PIVOT_Y;
			if (said !== null && !stunned) {
				if (move === 'bounce') {
					// Two hops, stretched at the top and squashed at the bottom. `heart` and `laugh` share
					// this — `emote.ts` says so — and the BUBBLE is what tells them apart, which is why it
					// is a silhouette rather than a colour.
					const hop = Math.abs(Math.sin(said * Math.PI * EMOTE_BOUNCES));
					emoteLift = hop * EMOTE_HOP;
					emoteSquash = hop * EMOTE_HOP_STRETCH - (1 - hop) * EMOTE_HOP_SQUASH;
					for (const flipper of flippers) flipper.mesh.rotation.z = flipper.side * 0.7;
				} else if (move === 'wave') {
					// ONE flipper, held out and swung. Two would be a semaphore; one is a greeting, and it
					// reads from behind — which is the view the hub's camera spends its life in.
					const swing = Math.sin(said * Math.PI * 2 * EMOTE_WAVE_SWINGS) * EMOTE_WAVE_SWING;
					const arm = flippers[1];
					if (arm) {
						arm.mesh.rotation.z = arm.side * EMOTE_WAVE_RAISE + swing;
						arm.mesh.rotation.x = 0;
					}
				} else if (move === 'spin') {
					// The dance. A TWIST on the beat, not a rotation — see the constants above for why
					// that distinction is a requirement and not a preference. The head holds its line
					// while the body works, which is what makes it read as dancing rather than as being
					// shaken.
					const beat = said * Math.PI * 2 * EMOTE_DANCE_BEATS;
					emoteTwist = Math.sin(beat) * EMOTE_TWIST;
					body.rotation.y += emoteTwist;
					const hop = Math.abs(Math.sin(beat));
					emoteLift = hop * EMOTE_HOP * 0.7;
					emoteSquash = hop * EMOTE_HOP_STRETCH * 0.6;
					for (const flipper of flippers) {
						flipper.mesh.rotation.z = flipper.side * 1.1;
						flipper.mesh.rotation.x = Math.sin(beat + (flipper.side < 0 ? 0 : Math.PI)) * 0.6;
					}
				} else if (move === 'stomp') {
					// Grr. Hunched forward over two hard stomps, each one throwing dust — the same pool a
					// landing uses, because a stomp IS a landing as far as the ice is concerned.
					body.rotation.x += EMOTE_HUNCH;
					const beat = said * EMOTE_STOMPS;
					const foot = legs[Math.floor(beat) % 2];
					const through = beat % 1;
					if (foot)
						foot.mesh.position.y = foot.baseY + Math.sin(through * Math.PI) * EMOTE_STOMP_LIFT;
					emoteSquash = -Math.max(0, Math.cos(through * Math.PI * 2)) * EMOTE_HOP_SQUASH;
					if (Math.floor(beat) + 1 > stomped) {
						stomped = Math.floor(beat) + 1;
						puff.play(seconds, 0.45);
						puffAt.x = at.x;
						puffAt.z = at.z;
					}
				} else if (move === 'shrink') {
					// Uups. Compresses and pulls its head into its shoulders, which is the one thing a
					// separate head bought that is pure comedy rather than pure craft.
					const deep = Math.sin(said * Math.PI);
					emoteSquash = -deep * EMOTE_SHRINK;
					neck.position.y = HEAD_PIVOT_Y - deep * EMOTE_DUCK;
					for (const flipper of flippers) flipper.mesh.rotation.z = flipper.side * 0.05;
				}
			}

			// The head, and everything it does is RELATIVE to the body — which is why it can be said in
			// four lines and why it has to come after the body's own rotation is final.
			if (stunned) {
				// A stun is a whole-body event; a head doing something clever through it reads as a
				// glitch rather than as poise.
				neck.rotation.set(0, 0, 0);
			} else if (sledding) {
				// Body flat, head up. See TOBOGGAN_HEAD_UP.
				neck.rotation.set(-TOBOGGAN_HEAD_UP, 0, 0);
			} else {
				// Leads the turn, on top of the body's own lead: head first, body after, hat last. A
				// dance's twist is taken back OUT here, so the head holds its line while the body works.
				neck.rotation.y = clamp(turning * HEAD_LEAD, HEAD_LEAD_MAX) - emoteTwist * EMOTE_HEAD_HOLD;
				// Stays roughly level while the body waddles under it, and nods as the weight arrives —
				// same phase as the footfall squash, because it is the same event.
				const nod = ((1 + Math.cos(step * 2)) / 2) * HEAD_NOD * gait;
				neck.rotation.x = -body.rotation.x * HEAD_STABILISE + nod;
				neck.rotation.z = -body.rotation.z * HEAD_STABILISE;
			}

			// Squash and stretch, and the breath under it. Applied to the group's SCALE, which is
			// pivoted at the feet — the one place a squash may be pivoted, or the bird sinks into the
			// ice as it compresses. Never while sledding: y is along the run there, so a squash would
			// shorten the penguin's length rather than its height.
			let stretch = 0;
			if (!sledding) {
				if (airborne) {
					stretch = STRETCH_MAX * Math.min(Math.abs(at.penguin.heightVel) / JUMP_SPEED, 1);
				} else if (landedAt >= 0) {
					const e = (seconds - landedAt) / SQUASH_SECONDS;
					// One cosine, decaying: full squash at the impact, through neutral at a third, a
					// small overshoot into stretch, then settled. A spring, without a spring.
					if (e >= 0 && e < 1) stretch = -SQUASH_LANDING * Math.cos(e * Math.PI * 1.5) * (1 - e);
					else landedAt = -1;
				}
				// Breathing, fading out as the gait comes in, offset per penguin so a floe of them is
				// not one animal. Not while stunned: a spinning bird has enough going on.
				if (!stunned) {
					stretch +=
						Math.sin((seconds * BREATH_HZ + breathPhase) * Math.PI * 2) * BREATH_DEPTH * (1 - gait);
				}
				// And the weight arriving on a foot, in phase with the dip in `body.position.y` — which
				// is lowest at contact, twice per stride, once per foot.
				stretch -= FOOTFALL_SQUASH * ((1 + Math.cos(step * 2)) / 2) * gait;
			}
			stretch += emoteSquash;
			body.position.y += emoteLift;
			const scaleY = PENGUIN_SCALE * (1 + stretch);
			const scaleXZ = PENGUIN_SCALE / Math.sqrt(1 + stretch);
			body.scale.set(scaleXZ, scaleY, scaleXZ);

			// The blink. One mesh, hidden between blinks, dropping from above the eye rather than
			// growing out of its middle: an eyelid has a top edge and closes downward.
			if (lids) {
				if (seconds >= blinkAt) {
					blinkStart = seconds;
					// Walked by the golden ratio, which spreads a sequence over 0..1 without repeating
					// and without a random number. See BREATH_HZ.
					blinkPhase = (blinkPhase + 0.618_033_988_7) % 1;
					blinkAt = seconds + BLINK_EVERY + blinkPhase * BLINK_JITTER;
				}
				// Bounded on BOTH sides, and the upper bound is the one that matters: a half-sine of
				// the raw elapsed time comes back round to 1 every other blink-length forever, so a
				// penguin two seconds past its last blink was closing its eyes again.
				const since =
					blinkStart < 0 ? Number.POSITIVE_INFINITY : (seconds - blinkStart) / BLINK_SECONDS;
				const shut = since >= 0 && since < 1 ? Math.sin(Math.PI * since) : 0;
				lids.visible = shut > 0.02;
				if (lids.visible) {
					lids.scale.y = shut;
					lids.position.y = LID_REST_Y + LID_DROP * (1 - shut);
				}
			}

			// The hat, a couple of frames behind the head, and the bobble further behind that. Both
			// are differences rather than positions: what is drawn is how far the hat has NOT caught
			// up, which is why letting go of the stick makes it swing.
			if (hat) {
				const worn = body.rotation.y;
				if (hatFacing === null || stunned) hatFacing = worn;
				else hatFacing += wrapAngle(worn - hatFacing) * Math.min(1, HAT_LAG_RATE * dt);
				const twist = clamp(wrapAngle(hatFacing - worn), HAT_TWIST_MAX);
				hat.rotation.y = twist;
				if (bobble) {
					// The head's height in LOCAL metres, so it is comparable with the bobble's own
					// position: the jump arrives in world metres and the body is scaled.
					const lift = body.position.y + at.height / PENGUIN_SCALE;
					if (bobbleLift === null) bobbleLift = lift;
					else bobbleLift += (lift - bobbleLift) * Math.min(1, BOBBLE_LAG_RATE * dt);
					bobble.position.y = bobbleY + clamp(bobbleLift - lift, BOBBLE_LAG_MAX);
					bobble.position.x = twist * BOBBLE_SWING;
				}
			}

			// The dust. Triggered on a take-off and on a landing, and NOT while going under: a penguin
			// dropping into the sea has no ice to kick up, and the splash is the floe field's job.
			if ((landed || tookOff) && phase === 'skating') {
				const speed = landed ? impact : Math.abs(at.penguin.heightVel);
				if (speed > PUFF_MIN_SPEED) {
					const force = Math.min(speed / JUMP_SPEED, 1) * (landed ? 1 : TAKEOFF_PUFF);
					puff.play(seconds, force);
					// Where the penguin is at the moment it hits, in the root's own space: the dust has
					// to stay there while the bird slides on, and on ice it slides metres.
					puffAt.x = at.x;
					puffAt.z = at.z;
				}
			}
			const rise = puff.update(seconds);
			// The root has moved on; the offset is what keeps the cloud where the landing was. The
			// floe's tilt is ignored in the offset — a couple of centimetres over a third of a second.
			puff.mesh.position.set(puffAt.x - at.x, -at.height + PUFF_GROUND + rise, puffAt.z - at.z);

			wasAirborne = airborne;
			if (!airborne) impact = 0;

			// The name tag is the one thing that has to be hidden explicitly while a penguin is going
			// down. The BODY needs nothing — it sinks below opaque ice and the depth buffer occludes
			// it — but an earlier version of the tag was drawn with `depthTest: false` so it always
			// won, which is exactly what left a name floating over the floe after its owner had gone.
			// It is depth-tested now (`nameTag.ts`) and this line is kept anyway: a tag two metres up
			// is still above the ice for most of the sink.
			//
			// It comes BACK for a spectator, and that is the point of the chunk: a child who has been
			// knocked out can still find themselves on the screen.
			if (tag) tag.sprite.visible = phase !== 'falling';

			// The markers follow the tag exactly: gone while the penguin is going under, back when it
			// surfaces on its chunk — a child who has just been knocked out has to be able to find
			// themselves on the screen, and that is the moment "which one am I" is hardest.
			if (marker) {
				marker.visible = phase !== 'falling';
				// The anchor rides the SQUASH, which is not decoration: the body group is scaled about the
				// feet, so a penguin stretched by 15% in mid-air lifts its hat by nearly 0.2 local metres
				// — more than the whole clearance — and an arrow at a fixed height would have a party hat
				// growing up through it at the top of every jump. Multiplying the anchor keeps the gap
				// the same all the way through the bounce, and the arrow bobbing with the bird is the
				// nicer read anyway.
				marker.position.y =
					(wearing * (1 + stretch) +
						markerLift +
						Math.sin(seconds * MARKER_BOB_HZ * Math.PI * 2) * MARKER_BOB) *
					PENGUIN_SCALE;
				marker.rotation.y = seconds * MARKER_SPIN_HZ * Math.PI * 2;
			}
			// The bubble goes above whatever is already over this head — the hat, or the "you" arrow if
			// there is one. Stacked rather than swapped: the arrow is how a child knows which penguin is
			// theirs, and taking it away at the moment they press a button is taking it away at the
			// moment they are looking.
			if (bubble) {
				bubble.update(said);
				if (said !== null) {
					const above = marker
						? marker.position.y + (MARKER_CONE_HEIGHT / 2) * PENGUIN_SCALE
						: wearing * (1 + stretch) * PENGUIN_SCALE;
					bubble.sprite.position.y = above + EMOTE_BUBBLE_GAP + EMOTE_BUBBLE_HALF;
				}
			}

			if (ring) {
				ring.visible = phase !== 'falling';
				// Stays on the ice while the penguin jumps off it, exactly like the shadow. A ring that
				// rode up with the feet would be a halo, and a halo says nothing about where you are.
				ring.position.y = -at.height + 0.04;
			}

			// The shadow stays on the ice while the penguin rises, and fades and spreads with height.
			// From a fixed camera it is the only cue for how high a jump is.
			shadow.position.y = -at.height + 0.02;
			shadow.material.opacity = Math.max(
				SHADOW_MIN_OPACITY,
				SHADOW_OPACITY - at.height * SHADOW_FADE_PER_METRE
			);
			shadow.scale.setScalar(PENGUIN_SCALE * (1 + at.height * SHADOW_GROWTH_PER_METRE));
		},

		dispose() {
			tag?.dispose();
			puff.dispose();
			bubble?.dispose();
			// Materials, and the geometries this actor MERGED for itself. The primitives in `geo` are
			// shared between every penguin and owned by this module for the life of the page, which is
			// why this cannot be a blanket `geometry.dispose()` on everything it finds — and why the
			// merged hull, lids and hat have to be listed as they are made. The puff's material is
			// skipped because the puff disposes it above; its geometry is shared like `geo`.
			root.traverse((o: Object3D) => {
				if (o instanceof Mesh && o !== puff.mesh) {
					const m = o.material;
					if (Array.isArray(m)) for (const one of m) one.dispose();
					else m.dispose();
				}
			});
			for (const geometry of owned) geometry.dispose();
		}
	};
}
