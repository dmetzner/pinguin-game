/**
 * Everything you can see. Reads the world; never writes to it.
 *
 * That direction is invariant 2 and it is not stylistic: the moment the renderer can nudge a
 * position, the simulation stops being the authority and phase 3's host/client agreement stops
 * being possible. Nothing in this file imports `step`.
 */
import {
	ACESFilmicToneMapping,
	AmbientLight,
	BackSide,
	type Camera,
	Color,
	DirectionalLight,
	Fog,
	HemisphereLight,
	Mesh,
	PerspectiveCamera,
	PlaneGeometry,
	Scene,
	ShaderMaterial,
	SphereGeometry,
	Vector2,
	Vector3,
	WebGLRenderer
} from 'three';
import { groundHeight } from '../sim/archipelago';
import { FLOE_RADIUS, WALK_SPEED } from '../sim/constants';
import type { Floe, Snowball, Vec2 } from '../sim/types';
import { type Bergs, createBergs } from './bergs';
import { type Blocks, createBlocks } from './blocks';
import { cameraPlacement } from './camera';
import { type Chute, createChute } from './chute';
import { createClouds } from './clouds';
import { createFloeField, FLOE_THICKNESS } from './floeField';
import { createGondola, type Gondola } from './gondola';
import { createChunkField } from './iceChunk';
import { createIgloo, type Igloo, type IglooSpec, iglooKey } from './igloo';
import { createIsland, type Island } from './island';
import { type Actor, PENGUIN_HEIGHT } from './penguin';
import { createSeaLion, type SeaLion } from './seaLion';
import { createSharks, type Sharks } from './sharks';
import { createSnowballField } from './snowball';

/** Where the water sits by default: just under the floe, so the ice reads as floating. */
const OCEAN_Y = -FLOE_THICKNESS * 0.72;

/**
 * The five swell amplitudes, in metres, as ONE list.
 *
 * They were hand-typed FOUR times — twice in the vertex shader (the height, then again in the
 * analytic derivative) and nowhere a caller could read them. That mattered the day something outside
 * the sea needed to know how high the water reaches: see SEA_SURFACE_MAX, which is a sum rather than
 * a sixth copy. Interpolated into the GLSL below, so the height and its own derivative cannot drift.
 */
const SWELL = [0.3, 0.26, 0.2, 0.085, 0.06] as const;

/**
 * The highest the sea ever gets, in world metres. **Anything walkable has to be above this.**
 *
 * Every floe clears it by half a metre without anybody thinking about it, because a floe's top is at
 * `FLOE_THICKNESS / 2` = 0.575 and the crests reach +0.077. A HUB's ground is at zero — it is a plot
 * of `groundHeight`, which knows nothing about how thick the ice under it used to be — so the swell
 * came 7.7 cm through the grass, in moving patches, whenever a crest passed. That is Daniel's "water
 * glitching through the island", and it is a geometry overlap rather than a depth-buffer fight: the
 * two surfaces genuinely cross.
 *
 * Exported so the fix can be made on the ground's side without a hand-typed number — a walkable
 * surface at `SEA_SURFACE_MAX + something` cannot be wrong. `setIsland` meanwhile drops the sea by
 * exactly the shortfall, which self-cancels the day the ground rises (see SEA_CLEARANCE).
 */
export const SEA_SURFACE_MAX = OCEAN_Y + SWELL.reduce((total, one) => total + one, 0);

/**
 * How far under a hub's ground the highest crest is held, metres.
 *
 * Not zero, and 25 cm rather than 2: the sea is a 2.5 m grid, so between two vertices the drawn
 * surface is a straight line under a curve and sits BELOW where the maths says — the error runs the
 * safe way, but the depth buffer still has to separate two surfaces a few millimetres apart over
 * fifty metres of grass, and that is what flickers. A quarter of a metre is a waterline nobody can
 * see moving on a beach and a gap no depth precision has to think about.
 */
const SEA_CLEARANCE = 0.25;

/**
 * The sky at eye level, and the colour everything distant fades into.
 *
 * Saturated a step past the #9fd8ef it was, and that is the smallest change in this file with the
 * largest reach: the palette was three near-identical pale blues (`--sky`, `--ice`, `--deep`) with a
 * white disc in the middle of them, which is a diagram's colour scheme rather than a game's. Both
 * reference games are saturated with conviction. Kept in step with `--sky` in `app.css`, because the
 * HUD sits over this and the page's own background is the horizon behind the canvas.
 */
const SKY = 0x8ed4f2;

/** Deeper blue overhead. The dome fades from this to SKY at the horizon; see `createSky`. */
const ZENITH = 0x4a97dc;

/**
 * The pale haze band that sits ON the horizon, and the reason it is a third colour.
 *
 * The sea fades to SKY and the dome started at SKY, so the two met at exactly the same value and
 * the horizon LINE vanished — which matters more here than it would in most games: the design asks
 * for a floe that visibly rocks, and a wobble needs a level line to wobble against (the whole
 * argument in `camera.ts` for the 27° pitch). Real horizons are brighter than the sky above them
 * for the same reason: that is the longest path through the haze there is.
 *
 * It is WARM now, and that is the one place warmth could be put without touching the light. The
 * whole frame was cold — three pale blues and white ice — and the note in `docs/DESIGN.md` about
 * this looking like a diagram is largely about that. The three light intensities below are measured
 * against the screen and are not free to move, so the sun's warmth goes where the sun's own haze
 * would put it: in the band on the horizon, against the cool blue above it. It stays pale rather
 * than orange, because an orange band reads as evening and this is a polar DAY.
 */
const HAZE = 0xf7ecdb;

/**
 * Where the sun is, as one triple.
 *
 * It used to be typed into `sun.position.set` alone. The ocean now needs the same direction for its
 * specular, and a sea whose glitter comes from somewhere other than the light in the sky is the
 * kind of wrong that is hard to name and impossible to unsee.
 *
 * **There is no sun DISC on the screen, and this triple is why.** Normalised it is 53° above the
 * horizon at an azimuth of 142° from where the camera looks — that is up and BEHIND the player. The
 * frame's top edge points 2° above level (`camera.ts`), so a disc drawn faithfully at this direction
 * is off the top of the screen by fifty degrees and off the side of it as well. `createSky` draws it
 * anyway, derived from this constant rather than hand-placed, so the day this triple moves the sun
 * appears where it should instead of somewhere a second number says. Putting it on screen means
 * dropping it to roughly 2° of elevation IN FRONT of the camera, which back-lights every penguin —
 * their fronts face the camera, and that is where the cuteness is. Not a change to make quietly.
 */
const SUN_POSITION: readonly [number, number, number] = [-18, 30, 14];

/** The sky the whole game is lit under, for anything that needs a background of its own. */
export const SKY_COLOUR = SKY;

/**
 * The polar day as three lights, built fresh each call.
 *
 * Exported because there is a SECOND room now — the penguin on a turntable in "Mein Pinguin"
 * (`render/preview.ts`) — and a preview lit differently from the game is a preview that lies about
 * the colour a child just picked. The three intensities are measured against the screen rather than
 * derived (see below), so a second hand-typed copy of them is a second thing to re-measure.
 *
 * A function rather than a shared array: an `Object3D` belongs to one scene at a time, so handing
 * both scenes the same `HemisphereLight` would take it out of whichever added it first.
 *
 * The three COLOURS have been warmed and the three intensities have not, which is the only edit this
 * function will take without a fresh measurement against the screen. The sun went 0xfff4e0 →
 * 0xffedc6 and the ambient 0xffffff → 0xfff1dc: about a tenth off the blue channel of each, which is
 * a warm cast on every lit surface and a barely measurable drop in luminance. Everything in the frame
 * was cold — see HAZE — and the reference games have warmth in the sunlight rather than in the
 * subject. The hemisphere pair is untouched: its two colours are the SKY above and the SEA below, and
 * warming those would be lighting the ice with a sky that is not the one over it.
 */
export function polarDayLights(): [HemisphereLight, AmbientLight, DirectionalLight] {
	const sun = new DirectionalLight(0xffedc6, 1.4);
	sun.position.set(SUN_POSITION[0], SUN_POSITION[1], SUN_POSITION[2]);
	return [new HemisphereLight(0xdff2ff, 0x4a86ad, 1.4), new AmbientLight(0xfff1dc, 0.25), sun];
}

/**
 * Where the sea starts and finishes fading into the sky.
 *
 * Shared by `scene.fog` and the ocean's own shader, which cannot inherit it — a ShaderMaterial gets
 * no fog uniforms from the scene, so it applies the same curve by hand. Two hand-typed copies of
 * these numbers meant the sea could fade on a different schedule than everything else in it, which
 * is precisely the hard line across the sky the fog exists to prevent.
 */
const FOG_NEAR = 26;
const FOG_FAR = 95;

/**
 * The same two, for the slide.
 *
 * Far enough that the whole visible run is solid and the fade begins where the mountain does — its
 * job on a chute is to hide where the geometry stops, not to describe the distance to the ice you
 * are standing on.
 *
 * 70/260 did not do that job: about 120 m of run is on screen at once, so at 70 m the ice a racer is
 * looking at was already fading and the pack 200 m ahead was 68% of the way to the horizon colour.
 * Every value the mountain has was being spent on atmosphere, which is why it read as one flat tone
 * whatever `chute.ts` painted on it. 150 keeps everything anybody is racing on at full contrast and
 * leaves the fade for the last third of the visible run, where it is describing distance rather than
 * erasing the subject.
 *
 * 380 is not a taste either: `camera.far` is 400, so a fade that finished later would be a mountain
 * CLIPPED at full strength instead of faded out, which is the hard edge this exists to prevent. If
 * the far plane ever moves, this moves with it — and it should, because the sea's own plane is 400 m
 * across and centred on the origin while a course runs up to 365 m from it, so the bottom third of
 * the mountain currently has no water under it at any fog setting.
 */
const MOUNTAIN_FOG_NEAR = 150;
const MOUNTAIN_FOG_FAR = 380;

/**
 * And the same two for the HUB, which is 116 m across.
 *
 * The sea's pair is measured against a 15 m arena, and it is total by 95 m: on an island whose far
 * shore is 72 m from a follow camera, that fades the ground a child is walking toward to nine tenths
 * of the horizon colour. Measured on screen — the grass at the back of the island came out paler than
 * the sand, which is the mountain's washed-out problem again in a mode that is supposed to be the one
 * place in this game with a colour in it.
 *
 * 60 leaves the whole walkable island at full saturation and starts the fade in open water past it;
 * 240 is short enough that the sea still finishes fading before its plane ends at 213 m, which is what
 * keeps a horizon line on the screen. Both are applied to `scene.fog` AND to the ocean's own copy, for
 * the reason `setCourse` does the same: they are one curve written twice, and the seam lands on the
 * horizon.
 */
/**
 * Where the cloud deck sits on a mountain, as a fraction of the run's own drop below its summit.
 *
 * A fraction rather than a height, because the mountain is about to get much taller and a deck at a
 * fixed altitude is wrong at every height the mountain is not. At a quarter, the first seconds of a run
 * are spent looking DOWN on the weather and the rest of it has cloud overhead — which is the whole of
 * what makes a two-hundred-metre drop feel like one, and is free, because the clouds already exist.
 */
/**
 * How far the rig swings off the axis while something is HUNTING the player, radians.
 *
 * Trap 17, and it is a framing problem with a geometric proof rather than a taste: the camera sits
 * behind the player, the hunter is behind the player — that is the entire mode — and the hunter faces
 * its prey, so its face points away from the camera BY CONSTRUCTION. Eyes, a muzzle, whiskers and a
 * mouth were modelled and could never appear. No amount of work on the animal reaches it.
 *
 * Thirty degrees buys three things at once: the face comes into three-quarter view, the gap between
 * hunter and prey stops being foreshortened and becomes a horizontal distance a child can read, and the
 * route ahead stays in shot. Past about thirty-five the run starts to leave the side of the frame on a
 * bend; under about twenty-five the animal is still mostly its own back.
 */
export const HUNTED_SIDE_BEARING = (30 * Math.PI) / 180;

const MOUNTAIN_DECK_FRACTION = 0.25;

/**
 * And how much further out the deck stands there, as a multiple.
 *
 * The ring is 135–200 m and a chute is 200 m long, so at the default the clouds are behind the racer by
 * the halfway gate. Doubled, the whole run sits inside the deck. The sprites double with it (see
 * `Clouds.setDeck`), so they are the same size on screen and only the parallax drops.
 */
const MOUNTAIN_DECK_SPREAD = 2;

const ISLAND_FOG_NEAR = 60;
const ISLAND_FOG_FAR = 240;

/**
 * And the colour the MOUNTAIN disappears into, which is a different colour from the sea's.
 *
 * The rest of the game fades into SKY, which is the sea's own horizon: the eye is looking level,
 * across water, into haze. A chute is the one place that is not true — the camera is up a mountain
 * with its lens pitched about 44° down, so every pixel of its sky is BELOW the horizon line and the
 * colour there is doing the job an alpine sky does. That sky is deeper and colder than a sea horizon,
 * and it has to be: the run is white, and a white mountain against a pale blue is a white shape with
 * no edge. This one value is used four times — the scene fog, the dome under the horizon, and both of
 * the sea's fade targets at the shoreline — because those four surfaces MEET on the mountain, and any
 * two of them disagreeing is a line drawn across the picture (see `Ocean.setFade`).
 */
const MOUNTAIN_SKY = 0x73bee8;

/**
 * And the air a long way BELOW a mountain camera, which is the only gradient that mode can show.
 *
 * A chute's frame runs from 15° to 73° under level, so every ramp in the dome that keys off the horizon
 * has finished before the top edge: the slide got one flat value from corner to corner. This is the
 * other end of a ramp that lives entirely inside the band a down-pitched camera can see.
 *
 * Deeper rather than paler, which is the opposite of a horizon and deliberate. A sea horizon is bright
 * because that is the longest path through the haze there is (see HAZE); looking DOWN from height the
 * path is short and the air is thin, so the tone goes toward the deep blue of the sky's own body. Tried
 * ZENITH here first and it is only two units away from MOUNTAIN_SKY once tone mapping has had it — an
 * invisible gradient is the same bug as no gradient.
 */
const MOUNTAIN_DEEP = 0x3f8ec4;

/**
 * The optional half of `setFollow`, as a named bag rather than four positional numbers.
 *
 * Named because of the mistake that has now been made twice in this interface: `spec.view` was 14, it
 * meant METRES to one verb and a RADIUS to the other, and the island was framed from 26.8 m instead of
 * 14 m with the penguin at 5.2% of the frame instead of 10.3%. Two numbers of the same type, different
 * units, adjacent in an argument list, is a bug waiting for its turn — `setFocus` takes a `radius` and
 * this takes a `distance`, and everything else here says what it is at the call site.
 */
export interface FollowOptions {
	/**
	 * How far the camera climbs above its usual angle, as a gradient. Zero on the flat.
	 *
	 * This is what the bearing framings need in order to stop going through `setFocus`. A chute and a
	 * chase are FOLLOW cameras with a turn and a lift: they want a fixed distance, not a fit, and until
	 * this existed the only verb that took a lift also solved its distance from a radius — which is
	 * aspect-dependent, which is why they cannot be played on a tall screen. Same number `spec.lift`
	 * already carries.
	 */
	descent?: number;
	/**
	 * Where the player is going, for a camera that turns to follow them. Omit for a fixed compass.
	 *
	 * The renderer keeps the smoothed angle rather than the caller, because it also has to be able to
	 * answer `steer` with it — see `steer` for why those two cannot be separate numbers.
	 */
	heading?: { facing: number; speed: number };
	/**
	 * A fixed swing off the direction of travel, radians. The chase wants 25–35°; nothing else wants any.
	 *
	 * This is trap 17's fix and it is the one thing on this interface that cannot be justified from
	 * inside the renderer. A chase camera sits behind the player, the hunter is behind the player — that
	 * is the entire mode — and the hunter faces its prey, so its face points AWAY from the camera by
	 * construction. Eyes, a muzzle, whiskers and a mouth have been built and never once been on screen.
	 * Swinging the rig off the axis fixes it, and buys two more things: the gap between hunter and prey
	 * becomes a readable horizontal distance instead of a foreshortened one, and the route ahead stays in
	 * shot.
	 *
	 * The ANGLE comes from the caller because it is a fact about a mode, and `modes/guard.test.ts`
	 * forbids this file from asking which mode it is. Applied only after the `steer` handshake, like
	 * every other rotation the caller did not compute.
	 */
	side?: number;
}

/**
 * The scene, as a set of things the caller may ask for — not as a bag of Three.js objects.
 *
 * Deliberately narrow. The previous shape exposed `renderer`, `scene`, `camera` and the tilting
 * `Group` raw, and the page used that access to do renderer work: convert a gradient into Euler
 * angles, narrow a material union, call `renderer.render(scene, camera)`. Nothing outside `render/`
 * should need a Three.js type, and with this interface nothing does.
 */
export interface SceneHandles {
	setSize(width: number, height: number): void;
	/**
	 * Put an actor on the floe, so it tilts with the ice rather than sliding across a level plane.
	 *
	 * Keyed, because an actor can be moved off the floe again: `setSpectators` parents an eliminated
	 * penguin onto its own chunk of ice, and it needs to find the right one.
	 */
	addActor(id: string, actor: Actor): void;
	/**
	 * Tilt the floe to a simulation gradient.
	 *
	 * The conversion lives here because it is the one place the renderer reads a simulation
	 * ENCODING rather than a value: `types.ts` defines the surface as height `-(slope.x·x +
	 * slope.z·z)`, and that is a rotation of -asin(slope.x) about Z and +asin(slope.z) about X. It
	 * was two lines in the page, which is the least testable file in the tree and the one least
	 * likely to be revisited when the floe representation changes in phase 1.
	 */
	/**
	 * Draw exactly these floes, each tilted by its own gradient.
	 *
	 * Replaced `setSlope` and `setRadius`, which between them described a world with exactly one
	 * floe in it. A Royal has several and they tilt independently — see `render/floeField.ts` — and
	 * splitting the two verbs meant every caller had to remember both: the drawn floe not following
	 * the simulation's radius was trap 8, and it was a missing call rather than a wrong number.
	 */
	setFloes(floes: readonly Floe[], seconds: number, playingTicks: number): void;
	/**
	 * Frame this floe: where the camera looks and how far back it stands.
	 *
	 * The camera does NOT follow the player — `docs/DESIGN.md` §4, and it hides the opponent about
	 * to shove them. It follows the ICE they are standing on, which changes only when somebody jumps
	 * a gap, and it fits that floe the way it has always fitted the only one there used to be.
	 */
	setFocus(center: Vec2, radius: number, altitude?: number, bearing?: number, descent?: number): void;
	/**
	 * Stand a fixed number of METRES behind this point, instead of fitting an arena around it.
	 *
	 * `framing: 'follow'` in the registry, and the hub is the first mode to ask for it. The two verbs
	 * take two different quantities and that is the whole reason this one exists: `setFocus` takes a
	 * RADIUS and solves a distance from it, and `ISLAND.view` is 14 with a comment saying "a fixed
	 * distance behind the player". Fed to the fit, 14 becomes a 26.8 m camera and a penguin 5.2% of the
	 * frame high — the satellite view in `shots/phone-landscape-island.png`. Taken as the distance it
	 * means, it is 14.0 m and 10.3%, against the 11.0% a Royal gives on a 6.6 m floe. Same number, same
	 * field, two readings, a factor of two in the picture.
	 *
	 * It is also what makes story 11 possible at all. A FIT depends on the aspect ratio, so the same
	 * island on a tall screen is framed from 67.9 m and the penguin is 2.0% of the frame — which is the
	 * whole of why `portrait` is false for every arena mode. A fixed distance does not move: 10.3% in
	 * landscape, 10.3% in portrait.
	 *
	 * **`bearing` turns the rig, and the caller has to have rotated the stick by the same number.**
	 * Daniel asked for a camera that looks where he is running, and a hub is the one place nothing is
	 * protected by a fixed compass — there is no rival about to shove you and no rim to be pushed over
	 * (`docs/DESIGN.md` §4, trap 8). But the rig turning is exactly half of the change: `Game.svelte`
	 * rotates the thumb's direction by this angle so "push up" keeps meaning "forward", and if the
	 * camera turns while the stick does not, then walking north-east re-aims the camera, which re-aims
	 * what "up" means, which re-aims the penguin. That is a feedback loop, not an offset, and it reads
	 * as the controls fighting the player.
	 *
	 * So it is a PARAMETER rather than something computed in here, and `followBearing` below is the
	 * policy the caller should compute it with — one value, assigned once, read by the rig and by the
	 * stick. The slide and the chase already work exactly this way; the island is not a second
	 * pattern. Default zero, so a caller that has not thought about it gets the fixed compass.
	 *
	 * @param altitude The ground under the player, not sea level. A hub has hills on it, and a camera
	 *   left at zero puts a climber off the top edge of the frame.
	 */
	setFollow(at: Vec2, distance: number, altitude?: number, opts?: FollowOptions): void;
	/**
	 * Draw the ride up at `t`, a fraction from the bottom station to the top, and say where the car got
	 * to. Negative hides the whole thing.
	 *
	 * Returns the car's placement rather than aiming the camera itself, which is a departure from the
	 * signature I was given and the reason is one camera authority: `Game.svelte` calls a framing verb
	 * every frame, so a verb that ALSO placed the camera would fight it and the winner would be whichever
	 * ran last. Handing the placement back keeps the caller in charge and matches what `render/gondola.ts`
	 * already answers. A caller that only wants the picture can ignore it.
	 *
	 * Null before there is a course to hang a cable on — the ride is built by `setCourse`, because the
	 * cable's anchors are the run's own segments and there is no second description of where the mountain
	 * is.
	 */
	setGondola(t: number): { at: Vec2; altitude: number; heading: Vec2 } | null;
	/**
	 * Turn a SCREEN-relative direction into a world one, using the camera as it actually stands.
	 *
	 * This is the seam trap 7 and trap 15 keep being paid for, and it exists so they stop being
	 * payable. Up-on-screen is decided by where the camera is (`render/camera.ts`), and when the rig
	 * TURNS — the slide, the chase, a hub that follows a player's heading — the thumb's meaning turns
	 * with it. Today `Game.svelte` knows that: it keeps its own `bearing` and rotates the stick by it
	 * with a hand-written 2×2. Which means the angle exists in two places, and every new camera has to
	 * remember to update both. That is precisely trap 15 — a `bearing` accepted, typed, documented and
	 * never passed — and it is why the chase's side offset has not shipped: there is no way to give the
	 * rig an angle from in here without the controls silently disagreeing by that angle.
	 *
	 * With this, there is one place. The renderer knows every rotation it has applied, because it
	 * applied them; the caller asks what a thumb means and gets an answer that cannot be stale. After
	 * the one call site moves over, a camera change is a camera change rather than a camera change plus
	 * a control change somebody has to remember.
	 *
	 * Identical arithmetic to the block it replaces, deliberately — this is a move, not a fix, and the
	 * slide must steer exactly as it does today.
	 */
	steer(asked: Vec2): Vec2;
	/**
	 * The hub island, or nothing.
	 *
	 * Built ONCE from the floe the simulation is holding and then kept, because unlike a floe the
	 * island never breaks, shrinks, sinks or drifts — which makes it cheaper than the ice it replaces
	 * rather than dearer (`render/island.ts` builds the whole 116 m of it in seven draw calls). Calling
	 * it again with the same floe is free: the id is checked, so a caller may put this in its draw loop
	 * without building a hundred and sixteen metres of terrain sixty times a second.
	 *
	 * `null` tears it down, so leaving a hub for a mountain cannot leave an island under the mountain.
	 *
	 * **It also hides the floe field**, and that is a decision rather than a side effect. The island
	 * draws its own ground — the terrain IS a plot of `groundHeight` for the same floe — so a hub that
	 * drew both would have a 116 m ice disc inside a 116 m island, z-fighting along every hill. The
	 * renderer settles that here instead of relying on the caller to stop passing `setFloes` the floe
	 * it is standing on: one ground per mode, decided in one place.
	 */
	setIsland(floe: Floe | null): void;
	/**
	 * The player's igloo, or nothing.
	 *
	 * A SIBLING of `setIsland` rather than part of it, and the reason is what changes: an igloo grows a
	 * room when a child buys one, and 116 m of terrain must not be rebuilt to add a dome to it. Two
	 * verbs, two lifetimes.
	 *
	 * Keyed by `iglooKey` rather than by a deep compare, so calling this once a frame costs a string
	 * comparison — the same contract `setIsland` has, for the same reason: a house rebuilt sixty times
	 * a second reads as "the hub is slow" rather than as a wrong call. `null` tears it down.
	 *
	 * `IglooSpec` and the key both come from `render/igloo.ts`, so this file learns nothing about plans,
	 * plots or purchases. It knows there is a thing, that the thing has an identity, and that identities
	 * can change.
	 */
	setIgloo(spec: IglooSpec | null): void;
	/**
	 * Put the horizon in: a skyline of icebergs beyond everything anybody can reach.
	 *
	 * Called once, with the size of the sea and the round's seed. Pure scenery, and the only scenery
	 * in the game — see `render/bergs.ts` for why a sea with nothing on its horizon reads as a
	 * diorama however good the ice in the middle of it looks.
	 */
	/**
	 * How fast this is meant to feel, from 0 (standing) to 1 (flat out).
	 *
	 * Widens the lens. Presentation only and deliberately not derived inside the renderer: the
	 * simulation knows what "flat out" means in each mode and the renderer does not.
	 */
	setRush(fraction: number): void;
	/**
	 * @param corridor How long the route is, when the ice is a LINE rather than an arena. Moves the
	 *   fins into the gaps the player is jumping instead of ringing a sea they cannot see the edge of.
	 */
	setSea(radius: number, seed: number, corridor?: number): void;
	/**
	 * Put the sea at this height.
	 *
	 * Zero everywhere except on the slide, where the mountain descends two hundred metres and an
	 * ocean at zero would swallow it whole from the second segment on. Dropping the water to the
	 * bottom of the run turns that into the point of the mode: you are racing down a mountain TOWARD
	 * the sea, and the finish is the shoreline.
	 */
	setSeaLevel(y: number): void;
	/**
	 * Draw the mountain, once, from the course the simulation is using.
	 *
	 * The slide's floes are drawn as ONE ribbon rather than as forty discs (`render/chute.ts`) — the
	 * discs are how the physics answers "is there ice here", and drawn literally they look like
	 * pancakes hanging in the air.
	 */
	setCourse(course: readonly Floe[]): void;
	/**
	 * Draw the blocks of ice a chase course carries, once, from the course itself.
	 *
	 * Separate from `setFloes` because a floe's hills come from its island VARIANT and are cloned per
	 * variant (`render/floeField.ts`), while these are per-platform and never move — see
	 * `render/blocks.ts`.
	 */
	setBlocks(course: readonly Floe[]): void;
	/**
	 * Show the sea lion at this point along the chase course, or hide it.
	 *
	 * Built the first time it is asked for and kept, because three of the four modes never need one
	 * and a creature nobody can see still costs a matrix and a frustum test every frame.
	 */
	setHunter(spot: Vec2 | null, heading: Vec2, altitude: number, seconds: number, onIce: boolean): void;
	/** Show exactly these snowballs and no others. Drawn from a fixed pool — see `snowball.ts`. */
	setSnowballs(snowballs: readonly Snowball[]): void;
	/**
	 * Show exactly these eliminated players, each watching from a chunk of ice at the given spot.
	 *
	 * The spots come from `sim/spectate.ts` and are derived rather than stored, so this is the
	 * renderer reading the world as usual. Positions are floe-LOCAL in the simulation's sense but the
	 * chunks live outside the tilting group — they are separate ice on the same sea, and a chunk that
	 * pivoted with the floe would be welded to it.
	 */
	setSpectators(spots: ReadonlyMap<string, Vec2>): void;
	/** Advance anything that animates on wall-clock time rather than on ticks — the ocean and the bob. */
	setTime(seconds: number): void;
	render(): void;
	dispose(): void;
	/**
	 * Draw somebody else's little scene into the bottom-left corner of this renderer's buffer, and
	 * hand back the canvas it landed on so the caller can copy it somewhere.
	 *
	 * This exists so the page holds exactly ONE WebGL context. The customise sheet's turntable
	 * (`render/preview.ts`) began as a second `WebGLRenderer` on its own canvas, which is one line of
	 * code and looks free — and is not: contexts are a capped, process-wide resource, and when the
	 * browser hits the cap it takes the OLDEST context away. That is the game's. Under five parallel
	 * test pages it happened every run, and the symptom was not a broken preview but a frozen game
	 * behind a working picker. A phone with other tabs open is the same machine with a smaller cap.
	 *
	 * The caller must draw the inset BEFORE its own `render()`, which clears the whole buffer again —
	 * so the corner is never presented to a screen, only copied out of.
	 */
	drawInset(inset: Scene, camera: Camera, width: number, height: number): HTMLCanvasElement;
}

export function createScene(canvas: HTMLCanvasElement): SceneHandles {
	const renderer = new WebGLRenderer({
		canvas,
		antialias: true,
		// No stencil buffer and no depth-less passes: nothing here needs either, and on tile-based
		// mobile GPUs an unused stencil attachment is real bandwidth per frame.
		stencil: false,
		powerPreference: 'high-performance'
	});
	// Capped at 2. Uncapped, a modern phone renders at 3× into a canvas nobody can tell apart from
	// 2×, and pays for it in exactly the frame budget this game has none of to spare.
	renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio ?? 1, 2));

	// Filmic tone mapping, and it is the single largest thing in this file for how the game LOOKS.
	//
	// A polar day is a scene made almost entirely of white things lit brightly, and with the default
	// linear mapping every one of those surfaces clips to pure #ffffff. Snow, ice, a bank, the flank
	// of a mountain and a penguin's belly all landed on the same value, so nothing in the picture had
	// a shape — it read as flat pale shapes cut out of paper, which is exactly what "looks like crap"
	// was pointing at. ACES rolls the top end off instead of cutting it, so the difference between
	// bright white and brighter white survives to the screen.
	//
	// Exposure is a MEASUREMENT, like the light intensities below: at 1.0 the whole scene went grey,
	// because the curve pulls midtones down and nothing here was ever near the top of the range.
	renderer.toneMapping = ACESFilmicToneMapping;
	renderer.toneMappingExposure = 1.25;

	// NO shadow map — and the reason this file used to give was WRONG, which is worth more than the
	// conclusion it happened to reach.
	//
	// What it said: a soft 1024 map on the sun was tried, produced a BLANK SCENE with no console
	// error, and was abandoned as unobservable. The suspect in `backlog/stories/09-the-look.md` was
	// the two hand-written `ShaderMaterial`s below — with the flag on, three recompiles every program
	// and injects the shadow chunks, and a material that declares none of the shadow uniforms can
	// fail to LINK, which under software GL looks exactly like a blank screen.
	//
	// Measured instead of argued (2026-08-21, this scene, headless chromium on SwiftShader, one frame
	// read back as pixels): the flag on, the sun casting, a retargeted 1024 ortho box, penguins
	// marked as casters and the ice as a receiver. It RENDERS — and it renders identically with the
	// sky and the ocean swapped for `MeshBasicMaterial`, so the ShaderMaterials are not the cause of
	// anything. Three only injects shadow code into a material declaring `lights: true` and neither
	// of them does. Whatever blanked the first attempt was in the attempt.
	//
	// What kills it is the SUN'S DIRECTION, which is a geometry problem and not a bug. `SUN_POSITION`
	// is 53° up at an azimuth 128° from the way the camera looks, so a 1.7 m penguin throws a 1.3 m
	// shadow directly AWAY from the viewer — behind its own body. Measured on the classic round: the
	// whole feature moves 461 pixels of a 960×400 frame by at most 30/255, and costs 41 → 61 draw
	// calls. In a Royal it is 172 → 245, because the shadow box covers several floes' worth of
	// penguins. Forty per cent of the draw-call budget (`CLAUDE.md`) for a tenth of a per cent of the
	// picture is not a trade worth making.
	//
	// Turning the sun sideways does expose the shadows — and flattens every penguin, because their
	// fronts face the camera and that is where the faces are. Screenshotted both ways; front-lit
	// characters are worth more than ground shadows in a game about cute characters. So the grounding
	// this was reached for has to come from the OTHER half of story 09 §1: contact AO baked into
	// `bake.ts`, and a blob per prop. It costs nothing per frame and does not depend on where the sun
	// is.
	//
	// One more thing that run found, for whoever tries again: `PCFSoftShadowMap` is deprecated in
	// three 0.185 and silently falls back to `PCFShadowMap`. Asking for it by name is asking for a
	// soft map and shipping a hard one.

	const scene = new Scene();
	// Fog does the horizon: the ocean plane ends somewhere, and fading it into the sky colour is
	// cheaper and calmer than a skybox, which would be another asset to ship. The far value has to
	// sit inside the distance the top of the frame actually reaches (see CAMERA_PITCH_DEGREES) or
	// the sea never finishes fading and there is no horizon line to rock against.
	scene.fog = new Fog(SKY, FOG_NEAR, FOG_FAR);
	// Whatever the ocean does not cover is sky. Without this the clear colour is black, which shows
	// as a dark band the moment the floe tips the camera's far edge past the water.
	scene.background = new Color(SKY);

	// A polar day is not one flat colour, and the flat one was the single biggest thing making this
	// look like a diagram: the band above the horizon rendered as the same #9fd8ef from the water's
	// edge to the top of the frame. The dome puts a deeper blue overhead fading to exactly SKY at
	// the horizon — exactly, because that is the colour the fog and the ocean shader both fade INTO,
	// and a seam there is the one artefact a gradient can introduce.
	const sky = createSky();
	scene.add(sky.mesh);

	// And something IN it. A gradient has no shapes in it, so a still frame of this game was a
	// diagram with a blue band across the top — see `render/clouds.ts` for the four degrees of visible
	// sky they have to fit inside, which is the only hard part.
	const clouds = createClouds(HAZE);
	scene.add(clouds.root);

	/**
	 * The field of view, and how far it opens at speed.
	 *
	 * A camera that keeps a constant distance and a constant angle from a penguin sliding at twelve
	 * metres a second reads as a penguin sliding at four: nothing in the frame changes except the
	 * scenery going past, and there is not much scenery on a mountain of ice. Widening the lens as
	 * the speed comes up stretches the edges of the frame, which is the whole of what a speed
	 * sensation is made of in a game without motion blur.
	 *
	 * Eight degrees, and not more: past that the near rim of the run starts to bow and a child reads
	 * it as the ice bending rather than as going fast.
	 */
	const BASE_FOV = 58;
	const RUSH_FOV = 66;
	const camera = new PerspectiveCamera(BASE_FOV, 1, 0.5, 400);

	// Hemisphere light does the work — pale sky above, cold sea bounce below, which is what makes
	// flat-shaded ice read as ice instead of as a white disc. The directional adds one clear light
	// direction so faces separate; ambient stops the shadowed side going black.
	//
	// The three intensities are MEASURED, not derived, and the difference cost two rounds. Reasoning
	// from "a Lambert surface facing the sky receives intensity × colour, so keep the sum near 1"
	// gives a floe at roughly half brightness — three's lighting pipeline does not map intensity to
	// output that directly. What the screen actually shows: a sum near 4.7 clips the ice to pure
	// white and the rim facets with it; a sum near 1.6 renders it a dull grey. A sum near 3.05 puts
	// the flat top at about 88% brightness, which reads as sunlit ice and still leaves the rim and
	// the underside somewhere darker to be seen against.
	//
	// This is also the whole of what fixed the grey floe. A displaced "snow drift" disc was added at
	// the same time and credited with it; it was a CircleGeometry, which is a triangle fan with one
	// interior vertex, so its displacement had nothing to act on and it contributed a flat overlay
	// and a draw call. The lighting was doing the work alone.
	for (const light of polarDayLights()) scene.add(light);

	const ocean = createOcean();
	scene.add(ocean.mesh);

	const floes = createFloeField();
	scene.add(floes.root);

	// In WORLD space, outside every floe's group. It used to live inside the one tilting group, so a
	// ball thrown across a tilted floe tilted with it — which was right when there was one floe and
	// is wrong the moment a snowball crosses open water between two that are tilting differently.
	// The simulation has always put snowballs in world coordinates; this now draws them there.
	const snowballs = createSnowballField();
	scene.add(snowballs.root);

	// Outside `tilting`, deliberately. See `iceChunk.ts`.
	const chunks = createChunkField();
	scene.add(chunks.root);

	/** The horizon, once somebody has said how big the sea is. See `setSea`. */
	let bergs: Bergs | null = null;
	let sharks: Sharks | null = null;
	let seaLion: SeaLion | null = null;
	let blocks: Blocks | null = null;
	/** Where the water is. Zero everywhere but the slide — see `setSeaLevel`. */
	let seaLevel = 0;
	/**
	 * The cloud deck's altitude, or null while it belongs to the sea.
	 *
	 * Null rather than a copy of `seaLevel`, so `setSeaLevel` can move the clouds in four modes without
	 * being able to drag a mountain's deck back down to the waterline. `Game.svelte` calls `setCourse`
	 * and then `setSeaLevel` on a chute, so the second one WOULD have undone the first.
	 */
	let deckAltitude: number | null = null;
	/**
	 * How far the sea is held DOWN so it cannot come through a hub's ground. See SEA_CLEARANCE.
	 *
	 * Separate from `seaLevel` because they answer different questions and one of them is the
	 * caller's: `seaLevel` is where the mode says the water is, and this is the renderer refusing to
	 * draw it through the floor. Folding them would let a `setSeaLevel` call silently undo the fix.
	 */
	let seaDrop = 0;
	/** The mountain, on the slide. See `setCourse`. */
	let chute: Chute | null = null;
	/**
	 * Is something hunting the player right now? Set by `setHunter`, read by the camera.
	 *
	 * This is how the chase gets its side swing without anybody passing a camera number in, and without
	 * this file asking which mode it is — which `modes/guard.test.ts` forbids and rightly. It is not a
	 * mode check, it is the same question the mode's own descriptor asks (`hunted`): there IS a reason to
	 * look anywhere but straight down the route, and the reason is behind you. `Game.svelte` calls
	 * `setHunter` before it frames, every frame, in every mode — with null in the four that have nothing
	 * chasing anybody — so this cannot go stale.
	 */
	let hunting = false;

	/** The ride up, built with the mountain it climbs. See `setGondola`. */
	let gondola: Gondola | null = null;
	/**
	 * The turn a follow camera has settled into, and whether the caller has taken over the conversion.
	 *
	 * `handedOver` is the whole safety mechanism for a camera that turns. The rig turning is only half of
	 * such a change: the thumb's direction has to turn with it, or walking north-east re-aims the camera,
	 * which re-aims what "up" means, which re-aims the penguin — a feedback loop rather than an offset,
	 * and it reads as the controls fighting the player. So the renderer REFUSES to apply a rotation the
	 * caller cannot report, until the caller has stopped doing its own trigonometry and started asking
	 * (`steer`). Until then a hub is a fixed compass, exactly as it is today.
	 *
	 * That is a handshake rather than a hope, and it is here because this is the third time tonight that
	 * trap 15 — a bearing accepted, typed, documented and never passed — has been one edit away.
	 */
	let followTurn = 0;
	let handedOver = false;

	/** The hub, and the floe it was built from. See `setIsland`. */
	let island: Island | null = null;
	let islandFloe = -1;
	/** The igloo, and what it was built from. See `setIgloo`. */
	let igloo: Igloo | null = null;
	let iglooBuilt = '';

	const actors = new Map<string, Actor>();

	/** Where the camera is looking, chased toward whatever floe the local penguin is standing on. */
	const focus = { x: 0, y: 0, z: 0 };
	/**
	 * Every rotation the rig currently has, radians. What `steer` answers from.
	 *
	 * Written by whichever camera verb ran last, so it cannot describe a rig that is no longer standing
	 * there. Zero in the two arena modes, where the camera never turns at all.
	 */
	let applied = 0;

	/** The radius the current camera distance was solved for, and that distance. */
	let fitted = FLOE_RADIUS;
	let distance = solveDistance(camera, FLOE_RADIUS);
	/**
	 * The follow distance, or null while the camera is fitting an arena.
	 *
	 * Kept rather than inferred, because `setSize` re-solves the fit and would otherwise put a hub
	 * camera back into orbit for the frame after a rotation — the one frame a player is looking at
	 * hardest.
	 */
	let following: number | null = null;

	return {
		setSize(width, height) {
			renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio ?? 1, 2));
			renderer.setSize(width, height, false);
			camera.aspect = width / height;
			// The fit depends on the aspect ratio, so a resize has to solve it again for whatever is
			// currently being framed rather than for the floe the round happened to start on. A FOLLOW
			// camera does not: its distance is metres, and being independent of the aspect ratio is the
			// entire property that lets the hub be played on a tall screen.
			distance = following ?? solveDistance(camera, fitted);
			place(camera, distance, focus);
		},
		addActor(id, actor) {
			actors.set(id, actor);
			// World space. An actor used to be parented into the single tilting group, which gave it
			// the floe's tilt for free; with several floes it would have to be re-parented mid-jump,
			// so the tilt is handed to the actor instead (`Actor.setSurface`) and it stands on the
			// ice it is actually over.
			scene.add(actor.root);
		},
		setFloes(views, seconds, playingTicks) {
			floes.update(views, seconds, playingTicks);
		},
		setSea(radius, seed, corridor) {
			bergs?.dispose();
			if (bergs) scene.remove(bergs.root);
			bergs = createBergs(radius, seed);
			scene.add(bergs.root);

			// And the fins. Built with the horizon rather than beside it because they answer the same
			// question — how big is this sea and what is in it — and because a caller who has to
			// remember two verbs to furnish the water will one day remember one (trap 8).
			sharks?.dispose();
			if (sharks) scene.remove(sharks.root);
			sharks = createSharks(radius, seed ^ 0x5ea, corridor);
			sharks.root.position.y = seaLevel;
			scene.add(sharks.root);
		},
		setCourse(course) {
			chute?.dispose();
			if (chute) scene.remove(chute.root);
			chute = createChute(course);
			scene.add(chute.root);
			// The ride up, hung on the run's own segments. Built here because the cable's anchors ARE the
			// mountain: a second description of where it goes is a cable through a hillside (trap 8's
			// shape). Hidden until somebody asks for a `t`.
			gondola?.dispose();
			if (gondola) scene.remove(gondola.root);
			gondola = createGondola(course);
			gondola.update(-1);
			scene.add(gondola.root);

			// And the haze moves back, a long way, because a mountain is not an arena.
			//
			// `FOG_NEAR`/`FOG_FAR` are measured against a 15 m floe: the sea has to finish fading
			// inside the distance the top of the frame reaches, or there is no horizon line for the
			// ice to rock against. A chute is two hundred metres long and runs AWAY from the camera,
			// so the same numbers fade the middle distance of the mountain into the sky — which is
			// most of the picture, and exactly why the slide read as washed out in every screenshot of
			// it. This is the only place in the game where the subject is further away than the sea.
			//
			// And the COLOUR moves with them, which the sea's horizon cannot supply — see
			// MOUNTAIN_SKY. All four surfaces that meet up there are set from the one value.
			if (scene.fog instanceof Fog) {
				scene.fog.near = MOUNTAIN_FOG_NEAR;
				scene.fog.far = MOUNTAIN_FOG_FAR;
				scene.fog.color.set(MOUNTAIN_SKY);
			}
			ocean.setHaze(MOUNTAIN_FOG_NEAR, MOUNTAIN_FOG_FAR);
			ocean.setFade(MOUNTAIN_SKY, MOUNTAIN_SKY);
			sky.setUnder(MOUNTAIN_SKY);

			// And the clouds move UP the mountain. See MOUNTAIN_DECK_FRACTION — this is the fix for a
			// racer looking down on the weather, and it is derived from the run rather than dialled in, so
			// a taller mountain gets a higher deck without anybody editing a number.
			let summit = -Infinity;
			let finish = Infinity;
			for (const segment of course) {
				if (segment.altitude > summit) summit = segment.altitude;
				if (segment.altitude < finish) finish = segment.altitude;
			}
			if (Number.isFinite(summit) && Number.isFinite(finish)) {
				deckAltitude = summit - (summit - finish) * MOUNTAIN_DECK_FRACTION;
				// Centred on the MIDDLE of the run rather than on its start, for the same reason the
				// horizon is (`setSea` on a chase): a deck around the start line is behind the racer for
				// three quarters of the descent.
				const middle = course[Math.floor(course.length / 2)]?.center ?? ORIGIN;
				clouds.setDeck(middle, deckAltitude, MOUNTAIN_DECK_SPREAD);
			}
		},
		setBlocks(course) {
			blocks?.dispose();
			if (blocks) scene.remove(blocks.root);
			blocks = createBlocks(course);
			scene.add(blocks.root);
		},
		setIsland(floe) {
			if (floe === null) {
				island?.dispose();
				if (island) scene.remove(island.root);
				island = null;
				islandFloe = -1;
				floes.root.visible = true;
				// Back to the sea's own curve. `setCourse` never needs to undo itself because a round is
				// a fresh scene, and this one does: the hub is the mode you LEAVE, and an arena inheriting
				// a 240 m fade has no horizon to rock against (see FOG_FAR).
				if (scene.fog instanceof Fog) {
					scene.fog.near = FOG_NEAR;
					scene.fog.far = FOG_FAR;
				}
				ocean.setHaze(FOG_NEAR, FOG_FAR);
				seaDrop = 0;
				ocean.mesh.position.y = OCEAN_Y + seaLevel;
				return;
			}
			// The same island, asked for again: nothing to do. See the interface — this is what makes the
			// verb safe to call from a draw loop, and 116 m of terrain rebuilt per frame is the kind of
			// mistake that reads as "the hub is slow" rather than as a wrong call.
			if (island && islandFloe === floe.id) return;
			island?.dispose();
			if (island) scene.remove(island.root);
			island = createIsland(floe);
			islandFloe = floe.id;
			scene.add(island.root);
			// Hold the sea under the ground, by exactly the shortfall and no more.
			//
			// DERIVED rather than dialled in, and that is the point: the hub's walkable datum is asked
			// of the same function the island's mesh is a plot of and the penguins stand on, so if that
			// ground ever rises — an `altitude` on the floe, a thicker plateau — the shortfall goes to
			// zero and this stops doing anything on its own. A hand-typed drop would still be dropping
			// the sea 25 cm under an island that had already been raised, and the second fix would be
			// invisible until somebody noticed the water sitting low round the beach.
			const datum = floe.altitude + groundHeight(floe, floe.center);
			seaDrop = Math.max(0, SEA_CLEARANCE - (datum - SEA_SURFACE_MAX));
			ocean.mesh.position.y = OCEAN_Y + seaLevel - seaDrop;
			// One ground per mode. See the interface for why this is settled here.
			floes.root.visible = false;
			// And the haze moves back, because a hub is not an arena either. See ISLAND_FOG_NEAR.
			if (scene.fog instanceof Fog) {
				scene.fog.near = ISLAND_FOG_NEAR;
				scene.fog.far = ISLAND_FOG_FAR;
			}
			ocean.setHaze(ISLAND_FOG_NEAR, ISLAND_FOG_FAR);
		},
		setGondola(t) {
			if (!gondola) return null;
			return gondola.update(t);
		},
		setIgloo(spec) {
			if (spec === null) {
				igloo?.dispose();
				if (igloo) scene.remove(igloo.root);
				igloo = null;
				iglooBuilt = '';
				return;
			}
			const key = iglooKey(spec);
			// The same igloo, asked for again: nothing to do. See the interface.
			if (igloo && iglooBuilt === key) return;
			igloo?.dispose();
			if (igloo) scene.remove(igloo.root);
			igloo = createIgloo(spec);
			iglooBuilt = key;
			scene.add(igloo.root);
		},
		setSeaLevel(y) {
			seaLevel = y;
			ocean.mesh.position.y = OCEAN_Y + seaLevel - seaDrop;
			// The fins swim in the water, wherever the water is. On the mountain that is two hundred
			// metres down, and a shark left at zero would be circling in the sky halfway up the run.
			if (sharks) sharks.root.position.y = y;
			// And the clouds sit over the WATER — unless a mountain has claimed them. See `deckAltitude`.
			if (deckAltitude === null) clouds.setDeck(ORIGIN, y, 1);
		},
		setFocus(center, radius, altitude = 0, bearing = 0, descent = 0) {
			// Chased rather than snapped, so jumping a gap pans across the water instead of cutting.
			// Presentation only — the simulation has no camera — and per FRAME, which is why it is a
			// fraction rather than a rate: this is the one place in the renderer allowed to be
			// frame-rate dependent, and at 60 or 120 Hz the difference is a fifth of a second either
			// way on a movement that only happens when somebody changes floes.
			focus.x += (center.x - focus.x) * FOCUS_CHASE;
			focus.z += (center.z - focus.z) * FOCUS_CHASE;
			// And DOWN, on the slide: the ice a racer is standing on is lower than the ice they started
			// on, and a camera that stayed at sea level ends up looking at the underside of a mountain.
			focus.y += (altitude - focus.y) * FOCUS_CHASE;
			// Re-solving the fit is a 28-step search and only worth doing when the size it is
			// solving for actually moved — a shrinking floe moves it a few millimetres a tick.
			if (Math.abs(radius - fitted) > 0.05) {
				fitted = radius;
				distance = solveDistance(camera, radius);
			}
			following = null;
			// The swing, and it is only ever applied once the caller asks this file what a thumb means:
			// a rig rotated by an angle the controls do not know about is thirty degrees of wrong steering,
			// which is trap 15's exact shape. See `steer` and `handedOver`.
			const total = bearing + (handedOver && hunting ? HUNTED_SIDE_BEARING : 0);
			applied = total;
			place(camera, distance, focus, total, descent);
		},
		setFollow(at, metres, altitude = 0, opts) {
			following = metres;
			distance = metres;
			// The turn is kept HERE, so `steer` and the rig cannot be given two different answers.
			if (opts?.heading) {
				followTurn = followBearing(followTurn, opts.heading.facing, opts.heading.speed);
			}
			// And it is only APPLIED once the caller asks this file what a thumb means. See `handedOver`.
			const bearing = handedOver ? followTurn + (opts?.side ?? 0) : 0;
			applied = bearing;
			// Chased, like the arena focus, and FASTER than it. The arena's 0.09 is tuned for something
			// that moves once — when a player jumps to another floe — and a camera that lazy behind a
			// walking penguin leaves them a metre off centre for as long as they keep walking. This is
			// about a tenth of a second of trail, which reads as a camera following rather than as a
			// camera lagging.
			focus.x += (at.x - focus.x) * FOLLOW_CHASE;
			focus.z += (at.z - focus.z) * FOLLOW_CHASE;
			focus.y += (altitude - focus.y) * FOLLOW_CHASE;
			place(camera, distance, focus, bearing, opts?.descent ?? 0);
		},
		setHunter(spot, heading, altitude, seconds, onIce) {
			hunting = spot !== null;
			if (spot === null) {
				if (seaLion) seaLion.root.visible = false;
				return;
			}
			if (!seaLion) {
				seaLion = createSeaLion();
				scene.add(seaLion.root);
			}
			seaLion.root.visible = true;
			seaLion.update(spot, heading, altitude, seconds, onIce);
		},
		setRush(fraction) {
			const want = BASE_FOV + (RUSH_FOV - BASE_FOV) * Math.max(0, Math.min(1, fraction));
			// Chased, not set: the speed itself is noisy — a landing, a bump, a nudge from a rival —
			// and a lens that answered every one of those would be a lens nobody could look through.
			if (Math.abs(want - camera.fov) < 0.02) return;
			camera.fov += (want - camera.fov) * 0.04;
			camera.updateProjectionMatrix();
		},
		steer(asked) {
			// Asking is the handshake. See `handedOver` — from here on the renderer may turn the rig by
			// angles the caller never computed, because the caller is no longer computing any.
			handedOver = true;
			// The cheap path first: two arena modes never turn, and a rotation by zero is four trig
			// calls and two multiplies per tick to arrive back where it started.
			if (applied === 0) return asked;
			const cos = Math.cos(applied);
			const sin = Math.sin(applied);
			return { x: asked.x * cos - asked.z * sin, z: asked.x * sin + asked.z * cos };
		},
		setSnowballs(inFlight) {
			snowballs.update(inFlight);
		},
		setSpectators(spots) {
			chunks.update(spots, actors);
		},
		setTime(seconds) {
			ocean.setTime(seconds);
			// The gondola, which is the only thing on the island that moves. Seconds handed on rather
			// than read: `render/loop.ts` is the only file in this app that looks at a clock.
			island?.update(seconds);
			clouds.setTime(seconds);
			chunks.setTime(seconds);
			bergs?.setTime(seconds);
			sharks?.setTime(seconds);
		},
		render() {
			// The dome travels with the camera, which it did NOT before and which the slide proves it
			// has to. Its gradient is measured from its own centre, so a camera that has descended a
			// hundred and fifty metres down a mountain is looking at the dome's lower hemisphere: every
			// `up` on screen clamps to zero and the entire sky becomes the horizon band. That was
			// survivable while the band was another pale blue and is not now it is warm — the mountain
			// gets a cream sky and reads as a desert. Recentred, the ramp is relative to the eye in
			// every mode, which is what a sky is. One position copy a frame, no draw call, no state.
			sky.mesh.position.copy(camera.position);
			renderer.render(scene, camera);
		},
		drawInset(inset, insetCamera, width, height) {
			// Clamped to the buffer it is being drawn into: a preview box bigger than the game's own
			// canvas (a phone in a tiny window, a huge device pixel ratio) would otherwise ask for a
			// viewport off the edge and get nothing back.
			const buffer = renderer.getDrawingBufferSize(new Vector2());
			const w = Math.max(1, Math.min(Math.round(width), buffer.x));
			const h = Math.max(1, Math.min(Math.round(height), buffer.y));

			// Scissor as well as viewport: without it the clear that comes with the render wipes the
			// whole buffer, and the frame the caller is about to draw would start from a corner-shaped
			// hole. Both are given in DRAWING-BUFFER pixels, origin bottom-left.
			renderer.setScissorTest(true);
			renderer.setViewport(0, 0, w, h);
			renderer.setScissor(0, 0, w, h);
			renderer.render(inset, insetCamera);
			renderer.setScissorTest(false);
			// Handed back the way it was found. The game's own render follows immediately and would
			// otherwise draw itself into the corner this just used.
			renderer.setViewport(0, 0, buffer.x, buffer.y);
			return renderer.domElement;
		},
		dispose() {
			// Every owner, not just the convenient ones. `renderer.dispose()` releases the renderer's
			// own programs and render lists and frees NO geometry or material — so before this list
			// existed, the floe's geometry, its three materials and the actors' materials were
			// stranded on the GPU on every teardown.
			for (const actor of actors.values()) actor.dispose();
			actors.clear();
			chunks.dispose();
			snowballs.dispose();
			floes.dispose();
			bergs?.dispose();
			sharks?.dispose();
			seaLion?.dispose();
			blocks?.dispose();
			chute?.dispose();
			island?.dispose();
			igloo?.dispose();
			gondola?.dispose();
			ocean.dispose();
			clouds.dispose();
			sky.dispose();
			renderer.dispose();
		}
	};
}

/**
 * Place the camera so the whole floe fits, whatever shape the screen is.
 *
 * A fixed camera position works on one aspect ratio and crops the floe on every other, and "the rim
 * you fell off was off-screen" is the least acceptable way to lose. Portrait is the hard case: the
 * horizontal field of view is the narrow one there, so the distance is solved against both axes and
 * whichever demands more wins.
 *
 * The camera does not rotate with the floe and does not follow the player. Both were considered and
 * rejected in `docs/DESIGN.md` §4: a camera that rolls with a tilting horizon is a motion-sickness
 * generator, and one that follows a player hides the opponent about to shove them.
 */
function solveDistance(camera: PerspectiveCamera, radius: number): number {
	// Margin around the arena. Every percent here is a percent smaller that every penguin appears,
	// so it buys only enough room that the rim is never flush against the screen edge.
	//
	// A floor under the radius, because a Royal's floes shrink to nothing as they sink: framing a
	// floe of 0.4 m would put the camera two metres above a penguin's head, and the player watching
	// their ice disappear needs to see the one they are about to jump to.
	const needed = Math.max(radius, FLOE_MIN_FRAMED) * 1.08;

	// The points that must be on screen: the rim, all the way round, at ice level AND at the height
	// of a penguin standing on it — a penguin at the near rim is the tallest thing in the frame and
	// is exactly who is about to fall off.
	const samples: [number, number, number][] = [];
	for (let i = 0; i < 24; i++) {
		const a = (i / 24) * Math.PI * 2;
		const x = Math.sin(a) * needed;
		const z = Math.cos(a) * needed;
		samples.push([x, 0, z], [x, PENGUIN_HEIGHT * 1.6, z]);
	}

	// Solved by search rather than in closed form, and that is a decision worth the four lines it
	// costs. The obvious trigonometry — fit the rim ellipse's half-height, which is radius·sin(pitch)
	// — is WRONG in a way that looks right: it treats the near and far rims as symmetric about the
	// look-at point, when the near rim is far closer to the camera and therefore projects much
	// further down the screen. The first version did that and cropped the near rim clean off the
	// bottom of the frame. Asking the projection matrix itself removes the whole class of error, and
	// this runs once per resize.
	let low = needed;
	let high = needed * 10;
	for (let i = 0; i < 28; i++) {
		const mid = (low + high) / 2;
		if (allVisible(camera, mid, samples)) high = mid;
		else low = mid;
	}
	return high;
}

/**
 * The smallest radius the camera will frame, metres.
 *
 * See `solveDistance`. A sinking floe passes through every size on its way to nothing, and following
 * it down would zoom the camera into the ice.
 */
const FLOE_MIN_FRAMED = 4.5;

/** The sun's direction as a unit vector, once. The ocean's specular and the sky's disc share it. */
const SUN_DIRECTION = normalise(SUN_POSITION);

/**
 * How much of the gap the FOLLOW camera closes each frame. See `setFollow`.
 *
 * Frame-rate dependent, like `FOCUS_CHASE` and for the same reason — but it runs every frame here
 * rather than once a jump, so the 60-versus-120 Hz difference is a real one: at 120 Hz the trail is
 * half as long. It is presentation either way, the simulation has no camera, and a child who cannot
 * tell 0.09 s of trail from 0.18 s is not the player this number is for.
 */
const FOLLOW_CHASE = 0.16;

/**
 * How slowly a follow camera swings round to face where the player is going, per frame.
 *
 * A twentieth of `FOLLOW_CHASE` and less than half of the slide's `BEARING_CHASE`, because a course's
 * heading is a property of the ground and a player's heading is a property of a thumb. `docs/DESIGN.md`
 * §4 refuses a camera that rolls with a tilting horizon on motion-sickness grounds, and a camera that
 * snapped to a child's steering would be the same argument with a different axis.
 */
const FOLLOW_TURN_CHASE = 0.02;

/**
 * And the hard ceiling on that, radians per frame — about 41°/s at 60 Hz.
 *
 * The chase above is proportional, so a U-turn starts at three and a half degrees a FRAME: the one
 * input a child gives most often (letting go and running back the other way) would whip the world
 * round. This is what stops it, and it is the reason the pair is a chase AND a cap rather than either
 * one alone: proportional keeps small corrections gentle, the cap keeps the big one survivable.
 */
const FOLLOW_TURN_MAX = 0.012;

/**
 * Below this speed the camera does not turn at all, metres per second.
 *
 * A thumb resting on glass is never still — the same fact the stick's own dead zone exists for — and a
 * heading derived from a velocity of almost nothing swings through the whole circle. Without this the
 * camera would drift round a penguin that the player believes is standing still, which is the
 * unexplainable-motion problem the dead zone was added for in the first place. 40% of `WALK_SPEED`:
 * far enough above thumb noise to be intent, far below the pace a child actually walks at.
 */
const FOLLOW_TURN_MIN_SPEED = WALK_SPEED * 0.4;

/**
 * Where a follow camera should be pointing next, given where it points now and where the player is
 * going.
 *
 * Exported and pure because the CALLER has to own the result: this angle turns the rig and rotates the
 * thumb's direction, and those two have to be the same number (see `setFollow`). Handing out the
 * policy rather than the answer is what keeps them one value instead of two that agree today.
 *
 * The conversion from a penguin's `facing` to a camera bearing is DERIVED here rather than written as
 * the identity it happens to equal. `Penguin.facing` is `atan2(x, z)`, so the direction it is walking
 * is `(sin f, cos f)`, and the bearing that turns the rig's resting −z onto a direction is
 * `atan2(dir.x, −dir.z)` — the same expression `Game.svelte` uses for a course heading. It reduces to
 * `π − f`, and writing that instead would be prose about geometry, which is trap 7 exactly.
 *
 * @param speed metres per second, for the dead zone. See FOLLOW_TURN_MIN_SPEED.
 */
export function followBearing(current: number, facing: number, speed: number): number {
	if (speed < FOLLOW_TURN_MIN_SPEED) return current;
	const want = Math.atan2(Math.sin(facing), -Math.cos(facing));
	// The SHORT way round. A plain subtraction takes the long way whenever the pair straddles ±π,
	// which is the one heading a player crosses constantly — walking back toward the camera.
	const gap = Math.atan2(Math.sin(want - current), Math.cos(want - current));
	const step = Math.max(-FOLLOW_TURN_MAX, Math.min(FOLLOW_TURN_MAX, gap * FOLLOW_TURN_CHASE));
	return current + step;
}

/**
 * How much of the gap to the new floe the camera closes each frame.
 *
 * Slow enough to read as a pan and fast enough that a player who has just jumped is not looking at
 * where they were. It only ever runs when somebody changes floes.
 */
const FOCUS_CHASE = 0.09;

function place(
	camera: PerspectiveCamera,
	distance: number,
	focus: { x: number; y?: number; z: number },
	bearing = 0,
	descent = 0
): void {
	// From `camera.ts`, because this placement is also what decides which way is up on SCREEN, and
	// `input/joystick.ts` has to derive its sign from the same numbers rather than describe them.
	// The whole rig is then translated onto whichever floe is being framed.
	const at = cameraPlacement(distance);
	const lift = focus.y ?? 0;
	// The rig TURNS on the slide, and only there. Everywhere else `bearing` is zero and this is the
	// fixed camera `docs/DESIGN.md` §4 argues for — a camera that chases a player hides the opponent
	// about to shove them, and one that rolls with a tilting floe is a motion-sickness generator.
	//
	// A chute is the exception that proves it: the run goes where it likes, and a fixed camera turns a
	// curving course into one you steer backwards. The whole rig rotates about the focus, so the
	// PITCH is untouched and the horizon stays level — and `Game.svelte` rotates the stick by the same
	// angle, which is what keeps "push up to go faster" true.
	const cos = Math.cos(bearing);
	const sin = Math.sin(bearing);
	const offsetX = at.x * cos - at.z * sin;
	const offsetZ = at.x * sin + at.z * cos;
	// Lifted by however far the GROUND drops over the distance the camera is standing back.
	//
	// The rig's pitch is 27° from horizontal (`camera.ts`) and that is right over a sea, which is
	// flat. A chute descends at about 26°, so on the mountain the same rig ended up almost exactly
	// parallel to the ice — and a degree the wrong way put the camera UNDER the run, looking up at
	// its underside. Adding the drop keeps the angle 27° relative to the SURFACE, which is what the
	// number was chosen against.
	camera.position.set(offsetX + focus.x, at.y + lift + distance * descent, offsetZ + focus.z);
	camera.lookAt(focus.x, lift + PENGUIN_HEIGHT * 0.55, focus.z);
	camera.updateMatrixWorld(true);
	camera.updateProjectionMatrix();
}

/** The fit is solved around a floe at the origin and then translated; only the size matters here. */
const ORIGIN = { x: 0, z: 0 };

function allVisible(
	camera: PerspectiveCamera,
	distance: number,
	samples: readonly [number, number, number][]
): boolean {
	place(camera, distance, ORIGIN);
	const p = new Vector3();
	for (const [x, y, z] of samples) {
		p.set(x, y, z).project(camera);
		if (Math.abs(p.x) > 1 || Math.abs(p.y) > 1) return false;
	}
	return true;
}

interface Ocean {
	mesh: Mesh;
	setTime(seconds: number): void;
	/**
	 * Fade on the same schedule as `scene.fog`.
	 *
	 * A `ShaderMaterial` gets no fog uniforms from the scene, so the sea applies the curve by hand —
	 * which means the two copies have to be moved together or the sea fades on a different schedule
	 * from everything in it, and the seam lands exactly on the horizon.
	 */
	setHaze(near: number, far: number): void;
	/**
	 * The two colours the sea disappears into: the one in the middle distance and the one AT the
	 * horizon.
	 *
	 * Two rather than one, because the dome above the water is not one colour either. Measured on
	 * `shots/phone-landscape-royal.png`: the last band of sea rendered (69, 168, 226) and the haze
	 * band immediately above it (232, 213, 182) — a step of 163 in red, with the boundary landing
	 * exactly where the eye is already looking for a line. That is the seam fog exists to prevent,
	 * and it appeared the moment the horizon band was warmed. The sea now arrives at the same colour
	 * the sky is showing where the two meet.
	 */
	setFade(mid: number, horizon: number): void;
	dispose(): void;
}

/**
 * The sea.
 *
 * A displaced plane with a hand-written shader rather than a water library: the whole effect is
 * three sine waves and a two-colour ramp, it runs entirely on the GPU, and it adds nothing to the
 * download. The waves here are DECORATION — the floe's actual tilt comes from `sim/floe.ts` and the
 * two are deliberately not synchronised, because the swell that matters is the one the player feels
 * through the penguin, not the one they see in the distance.
 */
function createOcean(): Ocean {
	// 400 units across with 160 segments — 2.5 m per quad. The wavelengths below are 20–35 m, so
	// this is about eight vertices per wave, which is the point at which sine displacement stops
	// looking faceted. The first version used 600 units at 90 segments (6.7 m per quad) against
	// 84 m wavelengths and produced a flat gradient with no visible water at all.
	const geometry = new PlaneGeometry(400, 400, 160, 160);
	geometry.rotateX(-Math.PI / 2);

	const material = new ShaderMaterial({
		uniforms: {
			uTime: { value: 0 },
			// Three colours where there were two, and all three a step more saturated than the pair
			// they replace. The sea was 60% of the frame and read as corrugated blue plastic: partly
			// the regular striping below, partly that #0d3a5c-to-#4da0c9 is a narrow, desaturated
			// range that no amount of wave detail can make look wet. uAbyss is the new one — the
			// colour the water goes toward in the MIDDLE distance, before the haze takes it, because a
			// sea that is one brightness from the floe to the horizon is a painted floor.
			uDeep: { value: [0.04, 0.24, 0.47] },
			uShallow: { value: [0.28, 0.71, 0.87] },
			uAbyss: { value: [0.02, 0.15, 0.36] },
			// ONE uniform for two jobs, and they are the same colour for a reason rather than by
			// coincidence: the sea fades into the sky it reflects. Two uniforms here could drift
			// apart, and the seam would land exactly on the horizon.
			uSky: { value: new Color(SKY).toArray() },
			// What the sea becomes at the very end of its fade, where it touches the dome's warm
			// horizon band. See `setFade`.
			uHorizon: { value: new Color(HAZE).toArray() },
			uFogNear: { value: FOG_NEAR },
			uFogFar: { value: FOG_FAR },
			// The same triple the DirectionalLight is placed at, normalised on the CPU because it
			// never changes. A sea lit from somewhere other than the sun is uncanny before it is
			// identifiable.
			uSun: { value: SUN_DIRECTION }
		},
		vertexShader: `
			uniform float uTime;
			varying float vHeight;
			varying float vFogDepth;
			varying vec3 vNormal;
			varying vec3 vView;
			varying vec2 vWorld;
			void main() {
				vec3 p = position;
				// Three waves at unrelated angles and speeds. Cheap, and enough that the surface
				// never looks like it is scrolling in one direction. Wavelengths of 20-37 m: long
				// enough to read as ocean swell rather than chop, short enough that a dozen of them
				// fit between the floe and the horizon. The first version used 84 m waves, of which
				// barely one was ever on screen, and the sea rendered as a flat gradient.
				float a1 = p.x * 0.31 + uTime * 1.15;
				float a2 = p.z * 0.22 - uTime * 0.85;
				float a3 = (p.x + p.z) * 0.17 + uTime * 0.55;
				// And two SHORTER ones, which is what stopped the sea reading as corrugated plastic.
				// Three waves of similar length produce a beat pattern that repeats visibly — evenly
				// spaced stripes of light and dark all the way to the horizon, which was the single
				// most synthetic thing in the frame. Wavelengths of 12 m and 14 m at a fifth of the
				// amplitude break that up without adding a second sea.
				//
				// 12 m is the FLOOR, not a taste: the plane is 2.5 m a quad, so this is under five
				// vertices a wave and anything shorter turns into aliasing that crawls as the camera
				// pans. Detail below that belongs in the fragment shader, and does — see the mottle.
				float a4 = (p.x * 0.47 - p.z * 0.25) + uTime * 1.9;
				float a5 = (p.x * 0.19 + p.z * 0.41) - uTime * 1.5;
				float h  = sin(a1) * ${SWELL[0]};
				h       += sin(a2) * ${SWELL[1]};
				h       += sin(a3) * ${SWELL[2]};
				h       += sin(a4) * ${SWELL[3]};
				h       += sin(a5) * ${SWELL[4]};
				p.y += h;
				vHeight = h;
				vWorld = p.xz;

				// The surface normal, ANALYTICALLY. The height field is three sines whose derivatives
				// are three cosines, so the exact normal costs three more cosines and no screen-space
				// derivatives at all — which is what makes a specular highlight affordable here. The
				// previous version had no normal and lit the water by crest height alone; that reads
				// as a painted ramp, and the sea never caught the sun that is plainly in the sky.
				float dx = ${SWELL[0]} * 0.31 * cos(a1) + ${SWELL[2]} * 0.17 * cos(a3)
				         + ${SWELL[3]} * 0.47 * cos(a4) + ${SWELL[4]} * 0.19 * cos(a5);
				float dz = ${SWELL[1]} * 0.22 * cos(a2) + ${SWELL[2]} * 0.17 * cos(a3)
				         - ${SWELL[3]} * 0.25 * cos(a4) + ${SWELL[4]} * 0.41 * cos(a5);
				vNormal = normalize(vec3(-dx, 1.0, -dz));

				vec4 world = modelMatrix * vec4(p, 1.0);
				vView = normalize(cameraPosition - world.xyz);
				vec4 mv = viewMatrix * world;
				vFogDepth = -mv.z;
				gl_Position = projectionMatrix * mv;
			}
		`,
		fragmentShader: `
			uniform float uTime;
			uniform vec3 uDeep;
			uniform vec3 uShallow;
			uniform vec3 uAbyss;
			uniform vec3 uSky;
			uniform vec3 uHorizon;
			uniform vec3 uSun;
			uniform float uFogNear;
			uniform float uFogFar;
			varying float vHeight;
			varying float vFogDepth;
			varying vec3 vNormal;
			varying vec3 vView;
			varying vec2 vWorld;
			void main() {
				vec3 n = normalize(vNormal);
				vec3 v = normalize(vView);

				// Fog is applied by hand because a ShaderMaterial does not inherit scene.fog, and
				// without it the ocean ends in a hard line across the sky. Computed FIRST now, because
				// the foam and the mottle below both have to be gone by the time the haze is: detail at
				// a wavelength of a few metres, four hundred metres out, is one pixel of noise crawling
				// as the camera pans.
				float fogFactor = smoothstep(uFogNear, uFogFar, vFogDepth);

				// The patchiness. Two sines at unrelated angles and a wavelength around sixty metres —
				// far too long to read as a wave and exactly the scale at which the eye notices that
				// every crest is as bright as every other crest. This is what the striping was really
				// made of: not the waves, but their perfect uniformity.
				float mottle = sin(vWorld.x * 0.11 + vWorld.y * 0.07) * sin(vWorld.y * 0.13 - vWorld.x * 0.05);

				// Crest ramp, kept, but SOFTER than the -0.62/0.68 it was: that range put nearly the
				// whole colour span across a single wave, which is where the hard light-and-dark banding
				// came from. Widened, the swell is a gradient again and the crests below carry the
				// contrast instead.
				float crest = smoothstep(-0.85, 0.85, vHeight);
				vec3 colour = mix(uDeep, uShallow, crest * (0.8 + 0.2 * mottle));
				colour += pow(crest, 5.0) * 0.16;

				// Deeper with distance, and only in the middle distance: the sea has to get darker
				// somewhere between the ice and the haze or there is no depth cue at all between them.
				// Ends before the fog begins in earnest, so the two are not fighting over the same band.
				colour = mix(colour, uAbyss, smoothstep(10.0, 65.0, vFogDepth) * 0.5);

				// Water is a mirror at grazing angles and a window straight down — the one thing that
				// separates real water from a blue surface. Cheap Schlick fresnel, mixing toward the
				// sky the water would be reflecting.
				float fresnel = pow(1.0 - max(dot(n, v), 0.0), 4.0);
				colour = mix(colour, uSky, fresnel * 0.32);

				// Foam on the tallest crests, torn up by the mottle so it lands in PATCHES. A foam
				// band that depended on crest height alone would be one white stripe per wave, running
				// the full width of the sea — the striping again, in a brighter colour. Faded out with
				// the haze for the aliasing reason above.
				// The threshold is high and the band is narrow on purpose: at 0.74 the foam covered the
				// whole upper half of every swell and the sea turned into wide pale brushstrokes, which
				// is a different kind of fake from the striping but just as flat.
				// Faded on a ramp of its OWN rather than on the fog's, and that separation is the fix for
				// the sea under the mountain reading as knitted. Foam is a DETAIL, and a detail has to be
				// gone by the distance where it is smaller than a pixel; fog is ATMOSPHERE, and the
				// mountain moves it out to 380 m because the subject is far away there. Riding the fog, the
				// caps stayed at full strength across a quarter of a mile of water seen from above, and a
				// regular diamond of white on every crest is exactly what corrugation looks like.
				float caps = smoothstep(0.88, 0.995, crest + mottle * 0.12);
				colour += caps * 0.34 * (1.0 - smoothstep(45.0, 130.0, vFogDepth));

				// And the sun on the water. Blinn-Phong, tight and bright, so it reads as glitter on
				// the swell rather than as a sheen over everything.
				//
				// **It fired on nothing at all before this, and that was measured rather than
				// suspected: the same frame rendered with the whole term deleted was identical to the
				// pixel.** The reason is geometry. The sun is 53° above the horizon (SUN_POSITION),
				// so its mirror image in flat water is 53° BELOW it — a camera looking 27° down can
				// never see that reflection, and only a facet tilted about 13° off level brings it up
				// far enough. The swell's steepest gradient is 0.15, which is 8°. The highlight was
				// unreachable by arithmetic, and the comment above claimed it was glitter.
				//
				// So the normal is RIPPLED, and only near the camera. Two-metre ripples in the FRAGMENT
				// shader cost no vertices and cannot alias, because they fade out by forty metres and a
				// pixel of near water is smaller than a ripple. 0.55 is 29° of tilt, which is what it
				// takes to catch a sun that high; the exponent comes down from 90 to 50 with it,
				// because a lobe that tight on a facet that steep is a single pixel that flickers.
				float ripple = 1.0 - smoothstep(8.0, 40.0, vFogDepth);
				vec2 fine = vec2(
					sin(vWorld.x * 2.4 + uTime * 3.1) * cos(vWorld.y * 1.9 - uTime * 2.3),
					sin(vWorld.y * 2.1 - uTime * 2.7) * cos(vWorld.x * 1.7 + uTime * 1.9)
				);
				vec3 lit = normalize(n + vec3(fine.x, 0.0, fine.y) * 0.55 * ripple);
				vec3 halfway = normalize(uSun + v);
				float spec = pow(max(dot(lit, halfway), 0.0), 50.0);
				colour += spec * 0.65;

				// Two fade targets, and the second one is what closes the horizon seam. The sea used to
				// finish on uSky while the dome directly above it was showing the warm haze band, which
				// put a hard line across the picture at the one place the eye is already looking for
				// one. Only the LAST part of the fade warms — from about sixty metres out, which is a
				// band a couple of degrees tall on screen — so the middle distance keeps the cool blue
				// it needs to read as deep water.
				vec3 fade = mix(uSky, uHorizon, smoothstep(0.55, 1.0, fogFactor));
				gl_FragColor = vec4(mix(colour, fade, fogFactor), 1.0);
			}
		`
	});

	const mesh = new Mesh(geometry, material);
	mesh.position.y = OCEAN_Y;
	// The sea is enormous and always behind everything; skipping its frustum check saves a bounding
	// sphere test per frame and avoids it popping out of view when the camera pitches.
	mesh.frustumCulled = false;

	return {
		mesh,
		setTime(seconds) {
			const u = material.uniforms.uTime;
			if (u) u.value = seconds;
		},
		setHaze(near, far) {
			const n = material.uniforms.uFogNear;
			const f = material.uniforms.uFogFar;
			if (n) n.value = near;
			if (f) f.value = far;
		},
		setFade(mid, horizon) {
			const m = material.uniforms.uSky;
			const h = material.uniforms.uHorizon;
			if (m) m.value = new Color(mid).toArray();
			if (h) h.value = new Color(horizon).toArray();
		},
		dispose() {
			geometry.dispose();
			material.dispose();
		}
	};
}

/**
 * Unit vector, on the CPU, once.
 *
 * The sun's direction is a constant, and normalising a constant in a fragment shader is a square
 * root per pixel of ocean for a value that never changes.
 */
function normalise([x, y, z]: readonly [number, number, number]): [number, number, number] {
	const length = Math.hypot(x, y, z);
	return [x / length, y / length, z / length];
}

interface Sky {
	mesh: Mesh;
	/**
	 * The colour the dome shows BELOW the horizon line.
	 *
	 * SKY everywhere but the mountain, where the camera pitches far enough down that the whole frame
	 * is under the horizon and this is the only sky colour on screen. See MOUNTAIN_SKY, and see the
	 * third ramp in the shader for why the region exists at all.
	 */
	setUnder(colour: number): void;
	dispose(): void;
}

/**
 * The sky, as a gradient dome.
 *
 * `scene.background` was a single flat colour, which is what a diagram uses and what made the band
 * above the horizon read as paper. This is one sphere seen from the inside, with a two-stop ramp
 * from ZENITH overhead to exactly SKY at eye level.
 *
 * Three details, each of which is a visible artefact when missed. It renders **inside out**
 * (`BackSide`) and with the depth test off, so it can never occlude anything and never needs
 * sorting against the sea. It is **not fogged** — fog is what fades the ocean INTO this, and fogging
 * the sky as well would fade it into itself and flatten the horizon back out. And the horizon stop
 * is the SAME constant the fog and the ocean shader fade to rather than a similar-looking blue: a
 * two-percent difference there draws a hard line exactly where the eye is already looking for one.
 *
 * Radius 300 sits inside the camera's 400 far plane with room to spare; the dome is centred on the
 * camera every frame in nothing at all, because the camera never moves more than a few metres and
 * the arena is 15 across.
 */
function createSky(): Sky {
	const geometry = new SphereGeometry(300, 24, 16);
	const material = new ShaderMaterial({
		side: BackSide,
		depthWrite: false,
		depthTest: false,
		fog: false,
		uniforms: {
			uZenith: { value: new Color(ZENITH).toArray() },
			uSky: { value: new Color(SKY).toArray() },
			uHaze: { value: new Color(HAZE).toArray() },
			// And what it becomes a long way under it. See the third ramp in the shader.
			uDeepUnder: { value: new Color(MOUNTAIN_DEEP).toArray() },
			// What the dome is under the horizon. See `setUnder`.
			uUnder: { value: new Color(SKY).toArray() },
			// DERIVED from the one place the sun lives, not typed in again. A sky whose sun is
			// somewhere other than the light's own direction is the mistake `SUN_POSITION`'s comment
			// exists to prevent, and it is invisible in a diff.
			uSun: { value: SUN_DIRECTION },
			/** The disc and its glow. Warm, because that is the only warm thing in a polar sky. */
			uSunColour: { value: new Color(0xfff6e2).toArray() }
		},
		vertexShader: `
			varying float vUp;
			varying vec3 vDir;
			void main() {
				// Height on the sphere, 0 at the horizon and 1 at the top. Taken from the geometry
				// rather than from a world position, so the ramp cannot shift as the camera pitches.
				vDir = normalize(position);
				vUp = vDir.y;
				gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
			}
		`,
		fragmentShader: `
			uniform vec3 uZenith;
			uniform vec3 uSky;
			uniform vec3 uHaze;
			uniform vec3 uUnder;
			uniform vec3 uDeepUnder;
			uniform vec3 uSun;
			uniform vec3 uSunColour;
			varying float vUp;
			varying vec3 vDir;
			void main() {
				float up = clamp(vUp, 0.0, 1.0);
				// Two ramps, because the sky does two different things. The first six degrees go from
				// the bright haze band on the horizon up to the ordinary sky — that is what draws the
				// level line the floe rocks against, and without it the sea's own fade met an
				// identical blue and there was no horizon at all (measured on screen, 2026-08-16).
				vec3 colour = mix(uHaze, uSky, smoothstep(0.0, 0.11, up));
				// The second is the deep blue overhead, curved AWAY from the horizon: an exponent
				// below one reaches the middle of the ramp within twenty degrees, and twenty degrees
				// is the entire sky this camera ever shows, so it painted zenith blue across the
				// whole band. At 1.6 the deep colour is only really there when a phone tips up.
				colour = mix(colour, uZenith, pow(up, 1.6));
				// And a third, BELOW the horizon, which the slide is what proves is needed. The frame
				// is not always looking level: the chute camera is lifted by its descent and pitches
				// about 44° down, so every pixel of its sky is under the horizon line — where up
				// clamps to zero and the dome is pure haze from edge to edge. A warm band is right ON
				// the horizon and reads as a desert across a whole screen, which is what the mountain
				// got. Under it the dome goes back to uUnder, which is also what the scene fog fades TO,
				// so the far end of the mountain dissolves into the dome without a seam.
				//
				// The ramp starts at -0.03 rather than at 0, and that is a measurement: the ocean plane's
				// far edge sits about 1.7° below the horizon, so holding the warm colour to -0.03 makes
				// the dome EXACTLY the colour the sea arrives at where the two touch (see
				// the ocean's own setFade) instead of 89% of it. It then falls away by -0.11 rather than -0.16,
				// because every degree of warm band below the horizon is a band of beige across any
				// camera that looks a long way down — which is the island at 6.3° and the mountain at
				// 15°, and it read as a desert in both.
				colour = mix(colour, uUnder, smoothstep(-0.03, -0.11, vUp));
				// And a FOURTH, a long way under it, which is the only sky the mountain ever shows.
				//
				// A chute camera pitches about 44° down, so its frame runs from 15° to 73° BELOW level:
				// every ramp above this one has finished by the top edge and the slide got one flat colour
				// from corner to corner (measured on the slide shot — solid blue, no
				// horizon, no gradient, and the level artist's new ice sitting in a void). Deepening with
				// depression is also what the eye expects: looking down from height you see haze near the
				// horizon and darker air below it. It costs nothing in the other four modes, where the sea
				// covers every direction this ramp reaches.
				// The band is NARROW — on a chute the dome only shows between the top edge and the ridge —
				// so the ramp has to finish inside it. -0.16 to -0.55 is 9° to 33° under level, which is
				// where that sky actually is.
				colour = mix(colour, uDeepUnder, smoothstep(-0.16, -0.55, vUp));

				// The sun, in two parts: a wide glow that warms the sky around it, and the disc.
				//
				// Both are derived from uSun, which is where the light actually comes from — see
				// SUN_POSITION for why that means NEITHER is on screen at the moment, and what it would
				// cost to put them there. The disc is a degree and a half across rather than the
				// half-degree the real one is, because at half a degree it is four pixels on a phone;
				// the threshold is a cosine because a normalised dot product is what a shader has.
				float toSun = max(dot(normalize(vDir), uSun), 0.0);
				colour += uSunColour * pow(toSun, 6.0) * 0.35;
				colour = mix(colour, uSunColour, smoothstep(0.99955, 0.99985, toSun));
				gl_FragColor = vec4(colour, 1.0);
			}
		`
	});

	const mesh = new Mesh(geometry, material);
	// Drawn first, before anything that might otherwise be sorted behind it, and never culled: it
	// surrounds the camera, so a bounding-sphere test can only ever say yes.
	mesh.renderOrder = -1;
	mesh.frustumCulled = false;

	return {
		mesh,
		setUnder(colour) {
			const u = material.uniforms.uUnder;
			if (u) u.value = new Color(colour).toArray();
		},
		dispose() {
			geometry.dispose();
			material.dispose();
		}
	};
}
