/**
 * Every shape the simulation works with. This file imports NOTHING — not Three.js, not Svelte,
 * not a store. That is invariant 1 (see `CLAUDE.md`), and `purity.test.ts` enforces it by
 * scanning the tree rather than by trusting this comment.
 *
 * The world is 2.5D on purpose: penguins live on the XZ plane and carry a single `height` above
 * the floe surface. There is no third axis of collision and no orientation beyond a facing angle,
 * because nothing in the game needs one — see `docs/DECISIONS/0002-no-physics-engine.md`.
 */

/** A point or direction on the ice. `y` is deliberately absent; height is a separate scalar. */
export interface Vec2 {
	x: number;
	z: number;
}

/**
 * What one player asked for during one tick.
 *
 * This is the ONLY thing that crosses into the simulation from outside — a thumb, a bot, or (from
 * phase 3) the network all produce exactly this. `move` is camera-relative and already normalised
 * to a disc: the joystick does that conversion, so the simulation never sees raw touch pixels.
 */
export interface InputFrame {
	/** Desired direction, magnitude 0..1. Magnitude is a speed request, not just a direction. */
	move: Vec2;
	/** True on the tick the jump was requested. Edge-triggered; holding does not re-jump. */
	jump: boolean;
	/** Throw a snowball. Edge-triggered; the cooldown lives in the simulation, not in the button. */
	throw: boolean;
	/** Dash forward. Edge-triggered. Contact during a dash is the shove. */
	dash: boolean;
}

export const NO_INPUT: Readonly<InputFrame> = Object.freeze({
	move: Object.freeze({ x: 0, z: 0 }),
	jump: false,
	throw: false,
	dash: false
});

/**
 * Where a penguin is in its own little lifecycle.
 *
 * `falling` exists as a state rather than as an instant removal because the splash needs time to
 * read: a penguin that vanishes the frame it crosses the rim looks like a bug to an eight-year-old,
 * who did not see the rim.
 */
export type PenguinPhase = 'skating' | 'falling' | 'out';

export interface Penguin {
	readonly id: string;
	/** Position on the floe plane, in metres, floe centre at the origin. */
	pos: Vec2;
	/** Velocity in metres per second, along the floe plane. */
	vel: Vec2;
	/** Metres above the floe surface. 0 while skating; positive mid-jump. */
	height: number;
	/** Vertical speed in metres per second. Only meaningful while airborne. */
	heightVel: number;
	/** Which way the penguin is looking, radians, atan2(x, z) so 0 points at +Z. */
	facing: number;
	phase: PenguinPhase;
	/** Ticks spent in `falling`, so the renderer can drive the splash and the sim can time the exit. */
	fallTicks: number;

	/**
	 * Ticks of lost control remaining.
	 *
	 * While this is above zero the penguin's `InputFrame` is ignored ENTIRELY — and nothing else is.
	 * It keeps its momentum, it still collides, and the rim still takes it. Being carried off the
	 * edge while unable to act is the intended outcome of every attack in the game, not a case to
	 * guard against.
	 */
	stunTicks: number;
	/**
	 * Ticks until another dash is allowed — and, read from the top, the dash itself.
	 *
	 * ONE counter, three questions: `isDashing`, `isShoving` and `dashReadiness` in `combat.ts` are
	 * all slices of it. A second counter used to run alongside, set in the same statement and
	 * decremented in the same line, which is redundant state two people have to keep in step and one
	 * more number in every phase-3 snapshot.
	 */
	dashCooldown: number;
	/** Ticks until another snowball is allowed. */
	throwCooldown: number;
	/**
	 * Mid-air jumps left before landing. Refilled the moment the feet touch ice.
	 *
	 * A counter rather than a boolean because `AIR_JUMPS` decides how many there are, and a game that
	 * wants two later should not have to find every `!usedTheFlap` in the tree. It has to be real
	 * state — a client predicting its own penguin and a host stepping it must agree on whether the
	 * flap is still available, or a corrected snapshot takes a jump away mid-gap.
	 */
	airJumps: number;
}

/**
 * A snowball in flight.
 *
 * Simulated rather than hitscan, and that is a gameplay decision rather than a fidelity one: a
 * visible arc is what lets a player see one coming and step out of it, which is the counterplay the
 * whole ranged attack needs in order not to be a tax on standing still.
 */
export interface Snowball {
	readonly id: number;
	/** Who threw it. A snowball never hits its own thrower. */
	readonly owner: string;
	pos: Vec2;
	vel: Vec2;
	height: number;
	heightVel: number;
	/** Ticks since it was thrown, so it can expire rather than skittering across the ice forever. */
	ticks: number;
}

/**
 * Which game this world is.
 *
 * It used to be derived — a world with one floe was the classic round and a world with several was a
 * Royal — and that was better while it held, because a derived fact cannot disagree with the thing
 * it describes. It stopped holding when the SLIDE arrived: a mountain chute is also several floes,
 * so the shape of the sea no longer says which game is being played. One field, set once, at
 * construction. The chase is a fourth arrangement of the same floes — a line of them with holes in
 * it — which is the second time that argument has been made and the last time it needed making.
 *
 * The literals are the KEY SET of the register in `sim/modes/registry.ts`, which is typed
 * `Record<Mode, GameMode>`: adding one here without writing a descriptor is a compile error, which
 * is the one place a new minigame could otherwise be forgotten. They are also wire values
 * (`net/protocol.ts`) and storage values (`lib/storageKeys.ts`), so an existing one is never renamed.
 *
 * **Nothing outside `sim/modes/` may compare one of them** — `modes/guard.test.ts` scans for it.
 * Whatever the comparison was asking, the descriptor answers.
 */
export type Mode = 'classic' | 'royal' | 'slide' | 'chase' | 'island';

/**
 * A hill of ice on a floe: something to climb, stand on and be pushed off.
 *
 * Stored in NORMALISED floe coordinates — `at` and `radius` are fractions of the floe's radius —
 * for one reason: the renderer scales a floe's mesh as it shrinks, and its decorations with it, so
 * anything the simulation says about the surface has to shrink the same way or the drawn iceberg
 * and the one you can stand on drift apart. Height is in metres and does NOT scale, because the
 * mesh's own height does not either.
 */
export interface Mound {
	/** Middle, as a fraction of the floe's radius from its centre. */
	at: Vec2;
	/** Footprint, as a fraction of the floe's radius. */
	radius: number;
	/** How high it stands above the ice, in metres. */
	height: number;
}

/**
 * The floe's own state.
 *
 * `slope` is a gradient, not an angle: the surface height at (x, z) is `-(slope.x * x + slope.z * z)`,
 * so downhill is simply `-slope` and the acceleration along the surface is `G * -slope` for the small
 * angles this game stays inside. Storing the gradient rather than two Euler angles is what keeps
 * `step()` free of trigonometry per penguin.
 */
export interface Floe {
	readonly id: number;
	/**
	 * Where the middle of this floe sits, in world metres.
	 *
	 * The classic round has exactly one floe and its centre is the origin, so every number in that
	 * game reads the way it always did. Pingu Royal has a handful of them scattered across the sea,
	 * and a penguin's position is WORLD space in both — anything that wants floe-local coordinates
	 * subtracts this (`localTo` in `archipelago.ts`).
	 */
	center: Vec2;
	radius: number;
	/**
	 * The radius this floe had before anything started taking it away.
	 *
	 * Kept so `radius` can be a pure function of the tick count rather than a value decremented in
	 * place. `round.ts` already learned that lesson once: a shrink accumulated tick by tick cannot be
	 * asked "how wide were you at second forty" by a test, and it drifts between a host and a client
	 * that ran a different number of ticks.
	 */
	readonly fullRadius: number;
	/** Combined gradient: swell plus weight. What the penguins actually feel. */
	slope: Vec2;
	/** The weight component alone, kept separately because it is smoothed across ticks. */
	weightSlope: Vec2;
	/**
	 * The tick this floe's end begins, or `Infinity` for one that never ends.
	 *
	 * This is Royal's whole clock. A WHOLE floe breaks in two when it arrives (`round.ts`), and a
	 * PIECE simply goes under — see `piece`.
	 */
	sinkAtTick: number;
	/**
	 * A fragment of a floe that already broke.
	 *
	 * A piece does not break again: it tips, drifts and goes under over `sinkTicks`. Without the
	 * distinction a floe would halve forever and the sea would fill with slivers nobody can stand on.
	 */
	piece: boolean;
	/** How long a piece takes to go under once it starts. Ignored by a floe that breaks instead. */
	sinkTicks: number;
	/**
	 * Which way the crack runs, radians.
	 *
	 * Decided when the sea is laid out rather than when the ice breaks, because the renderer draws
	 * the crack during the warning — three seconds before it opens — and a crack that appeared in one
	 * place and then split somewhere else would teach a child the wrong thing about where to stand.
	 */
	breakAngle: number;
	/**
	 * How far below the start of the world this floe sits, in metres. Zero at sea level.
	 *
	 * The sea is flat, so every floe in the classic round and in a Royal is at zero and the number
	 * does nothing. A SLIDE is a mountain: its ice descends, and both the renderer and the penguins
	 * standing on it read this so that they descend together.
	 *
	 * It is presentation in the strict sense — the simulation's own physics is 2.5D on a plane and
	 * this changes nothing about it — but it lives on the floe rather than in the renderer because
	 * `sim/slide.ts` is what decides where the mountain goes.
	 */
	altitude: number;
	/**
	 * How far along the course this floe is, in metres from the start. Zero everywhere else.
	 *
	 * A chase used to run in a straight line down −z, so "how far have I got" was just `-z` and the
	 * sea lion was a place on the same axis. A course that BENDS breaks that: two racers the same
	 * distance down the route can have wildly different z once the run has turned, and the hunter
	 * would eat the one on the outside of the corner. This is the distance a racer has actually
	 * travelled to reach this platform, measured along the polyline the course is.
	 */
	along: number;
	/**
	 * Bolted to a mountain rather than floating on the sea.
	 *
	 * An anchored floe does not bob and does not feel the swell; its tilt is its own and constant.
	 * That is the whole difference between a floe and a slope, and it is why a chute can be built out
	 * of the same objects: gravity already comes from a floe's gradient (`step.ts`), so ice with a
	 * permanent gradient IS a slide.
	 */
	anchored: boolean;
	/**
	 * Which side of a chute segment has no wall: −1, 0 for both walled, or 1.
	 *
	 * The banked walls are what make a slide rideable rather than a ledge, so the danger has to come
	 * from somewhere: it comes from here, and from the gaps. Meaningless off the mountain.
	 */
	openSide: -1 | 0 | 1;
	/**
	 * A permanent tilt, added to the swell and the weight rather than replacing them.
	 *
	 * Zero everywhere on the sea. On a slide it is the fall line, and it is what the penguins are
	 * accelerating down.
	 */
	tilt: Vec2;
	/**
	 * How fast this floe is drifting, metres per second. Zero for anything not broken.
	 *
	 * The penguins standing on a drifting floe are carried with it (`round.ts`), which is what makes
	 * riding a fragment away from the fight a thing that happens rather than a thing that looks
	 * broken.
	 */
	drift: Vec2;
	/**
	 * The hills on this floe: real ground, not decoration.
	 *
	 * They come from the same seed the renderer builds its islands from (`moundsFor`), so the
	 * iceberg drawn on the ice and the one a penguin climbs are the same object described twice —
	 * which is the only arrangement that cannot drift.
	 */
	mounds: readonly Mound[];
	/**
	 * A seed for what this floe LOOKS like: its rim, its drifts of snow, its rocks.
	 *
	 * In the simulation it means nothing at all — every floe is a circle here. It lives on the floe
	 * rather than in the renderer so that two devices drawing the same seeded sea draw the same
	 * islands, and so a player can say "meet me at the one with the two rocks".
	 */
	shape: number;
}

/** Where a round is in its own little lifecycle. */
export type RoundPhase = 'countdown' | 'playing' | 'over';

export interface Round {
	phase: RoundPhase;
	/** Ticks spent in THIS phase, reset at every transition. */
	ticks: number;
	/** Who won, or null for a draw — which happens when the last two go in on the same tick. */
	winner: string | null;
}

export interface World {
	/** Ticks elapsed. Time is `tick / TICK_RATE`; the simulation never reads a clock. */
	tick: number;
	seed: number;
	/** Which game this is. See `Mode` — it stopped being derivable when the slide arrived. */
	mode: Mode;
	/**
	 * How far along the chase course the sea lion has got, in metres. Zero in every other mode.
	 *
	 * A PLACE rather than a creature, and `sim/chase.ts` argues why at length: a hunter that is a
	 * position on one axis is readable at a glance, deterministic, replayable, and cannot be cheesed
	 * by running in circles. The renderer draws a sea lion there; nothing in the simulation knows
	 * what a sea lion is.
	 */
	hunterAt: number;
	round: Round;
	/**
	 * Every floe in the sea, nearest thing to a map this game has.
	 *
	 * ALWAYS at least one, and the classic round is exactly one at the origin — so "the floe" is
	 * `floes[0]` there, and `sim/archipelago.ts` owns every question of the form "which floe is this
	 * penguin over". An array rather than an optional second field because a penguin's support has
	 * to be looked up the same way in both games, or Royal becomes a second code path through
	 * `step()` and the determinism argument in `docs/DECISIONS/0001` stops holding.
	 */
	floes: Floe[];
	penguins: Penguin[];
	snowballs: Snowball[];
	/**
	 * The next snowball's id.
	 *
	 * On the world rather than a module-level counter, because a module counter is shared state
	 * between two worlds and phase 3 runs a re-simulation alongside the live one. It would also make
	 * `createWorld` non-deterministic across a page's lifetime, which invariant 1 forbids.
	 */
	nextSnowballId: number;
	/**
	 * The next id to hand a floe, for the fragments a break leaves behind.
	 *
	 * On the world for the same reason `nextSnowballId` is: a module counter is shared between two
	 * worlds, and phase 3 runs a re-simulation alongside the live one.
	 */
	nextFloeId: number;
}
