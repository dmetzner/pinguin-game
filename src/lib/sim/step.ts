/**
 * One tick of the world. The whole game, minus everything you can see.
 *
 * Read the order of operations before changing anything: it is load-bearing. Steering happens
 * BEFORE gravity, so the downhill pull of the current tick is never something the player could have
 * already corrected for; drag is applied to the result rather than to the input, so a shove decays
 * on ice time rather than on stick time. Both were the other way round at first and the game felt,
 * in order, unresponsive and then weightless.
 */

import { floeUnder, groundGradient, groundHeight, groundSlope, penguinsOn } from './archipelago';
import {
	isDashing,
	resolveCollisions,
	stepSnowballs,
	tickCooldowns,
	tryDash,
	trySidelineThrow,
	tryThrow
} from './combat';
import {
	AIR_CONTROL,
	AIR_JUMP_SPEED,
	AIR_JUMPS,
	DASH_DRAG,
	DT,
	FALL_SPEED,
	FALL_TICKS,
	G,
	ICE_DRAG,
	JUMP_GRAVITY,
	JUMP_SPEED,
	MOVE_GRIP,
	SLIDE_DRAG,
	SLIDE_GRIP,
	TICK_RATE,
	WALK_SPEED
} from './constants';
import { stepFloe } from './floe';
import { modeFor } from './modes/registry';
import { endRoundIfDecided, inputIsFrozen, motionIsFrozen, stepRound } from './round';
import { isChute } from './slide';
import { spectatorSpots } from './spectate';
import type { InputFrame, Penguin, Vec2, World } from './types';
import { NO_INPUT } from './types';
import { add, clampLength, heading, length, scale, sub, vec, ZERO } from './vec';

/** Inputs for one tick, keyed by penguin id. A missing penguin simply did nothing. */
export type InputMap = ReadonlyMap<string, InputFrame>;

/** The fraction of velocity that survives one tick, on ordinary ice and while dashing. */
const ICE_KEEP = Math.exp(-ICE_DRAG * DT);
const DASH_KEEP = Math.exp(-(ICE_DRAG + DASH_DRAG) * DT);
/**
 * A chute keeps far more speed than a floe does, and that is the difference between sliding and
 * skating. With the sea's drag a run settled at eight metres a second in half a second, which is a
 * walk downhill; at `SLIDE_DRAG` it accelerates for seconds and tops out half as fast again.
 */
const SLIDE_KEEP = Math.exp(-SLIDE_DRAG * DT);
const SLIDE_DASH_KEEP = Math.exp(-(SLIDE_DRAG + DASH_DRAG) * DT);

/**
 * Advance the world by exactly one tick, in place.
 *
 * In place rather than returning a new world, and that IS a deliberate exception to the
 * immutability the rest of `sim/` keeps: this runs sixty times a second and the snapshot the
 * renderer interpolates against is taken explicitly (`snapshot.ts`), which is a clearer seam than
 * a copy nobody asked for. Nothing outside this file writes to a `World`.
 */
export function step(world: World, inputs: InputMap): void {
	world.tick++;
	// The round first: it decides how wide the floe is this tick, and the rim check downstream has
	// to run against that radius rather than the previous one.
	stepRound(world);
	// Every floe tilts under the weight of whoever is standing on IT. One floe in the classic round,
	// a handful in a Royal — same call, same maths, no second code path.
	for (const floe of world.floes) {
		stepFloe(floe, penguinsOn(floe, world.penguins), world.tick / TICK_RATE, DT);
	}
	// The mode's own moving parts, before anybody moves: the sea lion advancing up a chase course, the
	// island holding everybody on its beach. See `GameMode.advance` — a hunter that advanced AFTER the
	// penguins would be judging this tick's positions against last tick's danger, which is half a
	// metre of lie at walking pace and always in the player's favour, right up to the frame where it
	// is not.
	modeFor(world.mode).advance(world);
	stepPenguins(world, inputs);
	// Contact and projectiles resolve AFTER everyone has moved, against the positions this tick
	// actually produced. Resolving them first would judge overlaps that no longer exist.
	resolveCollisions(world);
	// And then the world settles: walls, shores, anything that is simply not allowed to be stood in.
	// AFTER the separation above, so a penguin pushed into a building by another penguin ends up
	// outside the building rather than outside the other penguin.
	modeFor(world.mode).settle(world);
	stepSnowballs(world);
	// Last, on the world this tick actually produced. Judging it first missed the tick on which the
	// penultimate penguin finished falling.
	endRoundIfDecided(world);
}

/**
 * Move everyone, against whatever gradient the floe currently holds.
 *
 * Split out of `step` rather than inlined, and the reason is a bug this split was written to fix: a
 * test that set `world.floe.slope` and then called `step` was measuring the SWELL, because `step`
 * recomputes the gradient before anyone moves. Every skating assertion silently tested the wrong
 * thing and four of them passed anyway. With the two halves separate, a test that wants a penguin on
 * a 13° slope can simply put it on one.
 *
 * It is also the seam phase 3 needs: a client re-simulating its own penguin against a gradient the
 * host has already decided must run exactly this half and not the other.
 */
export function stepPenguins(world: World, inputs: InputMap): void {
	// Asked once for the whole world rather than per penguin: a countdown or a finished round
	// freezes everyone, and the answer cannot differ between them.
	const frozen = inputIsFrozen(world);
	// During the countdown nobody moves at all — not even under gravity. See `motionIsFrozen`.
	if (motionIsFrozen(world)) return;

	// Where the eliminated are watching from, worked out once and only if somebody out there is
	// actually throwing. It is a pure function of the world (`spectate.ts`) and allocates two maps,
	// which is nothing once in a while and real if it happened sixty times a second for nobody.
	let sidelines: ReadonlyMap<string, Vec2> | null = null;

	for (const p of world.penguins) {
		if (p.phase === 'out') {
			// Out of the round, not out of the game. A spectator keeps exactly one action — a weak
			// snowball from its chunk of ice — and it goes through the same `InputFrame` road as
			// everything else, so there is still no second way into the world.
			const asked = inputs.get(p.id);
			tickCooldowns(p);
			if (frozen || !asked?.throw) continue;
			sidelines ??= spectatorSpots(world);
			const from = sidelines.get(p.id);
			if (from) trySidelineThrow(world, p, from, asked);
			continue;
		}
		if (p.phase === 'falling') {
			stepFalling(p);
			continue;
		}
		tickCooldowns(p);

		// The stun rule, written ONCE. A stunned penguin is handed NO_INPUT rather than being
		// skipped: it must still feel the slope, still slide, still be carried over the rim. Losing
		// the controls is the whole of what a stun does, and being taken off the edge while it lasts
		// is the point of every attack in the game.
		//
		// Substituting the frame here rather than guarding inside each action is what stops the next
		// action from having to remember its own guard — there were three copies of this rule, and
		// story 02's round countdown ("nobody may act yet") wanted the same seam — and took it.
		const asked = inputs.get(p.id) ?? NO_INPUT;
		const acted = frozen || p.stunTicks > 0 ? NO_INPUT : asked;

		// The dash is allowed during the opening grace, and only its SHOVE is suppressed
		// (`combat.resolveCollisions`). It is a movement move as much as an attack, and two reasons
		// say it must stay live: taking a child's mobility during the seconds they are meant to be
		// finding their feet is the opposite of the point, and — the one that decides it — a rule
		// gated on the tick count is a rule a CLIENT disagrees with. A client predicts `LEAD_TICKS`
		// ahead of the host, so at the boundary it dashes at 10 m/s in a world where the host has not
		// allowed it yet, and the correction that follows is half a metre. `session.test.ts` measured
		// exactly that and refused it.
		tryDash(p, acted);
		tryThrow(world, p, acted);
		stepSkating(p, acted, world);
	}
}

function stepFalling(p: Penguin): void {
	p.fallTicks++;
	p.height -= FALL_SPEED * DT;
	// Keep drifting outward while falling — cutting the velocity at the rim reads as the penguin
	// hitting an invisible wall on its way down, which is worse than any physics inaccuracy.
	p.pos = add(p.pos, scale(p.vel, DT));
	if (p.fallTicks >= FALL_TICKS) p.phase = 'out';
}

function stepSkating(p: Penguin, input: InputFrame, world: World): void {
	const airborne = p.height > 0;
	// The ice under this penguin, or null over open water. In the classic round there is one floe and
	// this is always it; in a Royal it changes the moment somebody jumps a gap, and it is the same
	// lookup the rim check below uses — one answer, so a penguin cannot be tilted by ice it is not
	// standing on or drowned on ice it is.
	const under = floeUnder(world.floes, p.pos);

	// --- Steering -----------------------------------------------------------
	// The stick asks for a velocity; it does not set one. What it gets is a pull of at most
	// grip·dt toward that velocity, which is the entire reason ice feels like ice here. See the
	// note on MOVE_GRIP in `constants.ts` before touching this.
	//
	// The grip budget is scaled by how far the stick is pushed, and that factor is not a nicety —
	// without it, an untouched stick requests a velocity of zero and the steering brakes toward it
	// at full authority. That made letting go a perfect brake: it cancelled gravity exactly, the
	// floe's tilt became harmless, and a penguin left alone on a 13° slope drifted at 0.04 m/s
	// forever. A penguin accelerates by pushing against the ice, so not pushing has to mean no
	// force at all, and stopping has to be drag's job.
	const requested = clampLength(input.move, 1);
	const authority = length(requested);
	// On a chute the stick asks for the speed the racer ALREADY HAS, in the direction they want it.
	//
	// The intent has always been that the stick means "where to go, not how fast" — otherwise steering
	// is a brake, and a penguin sliding at 12 m/s whose stick asks for 3.6 pulls itself backwards every
	// time it tries to pick a line. The first version bought that with `length(p.vel) + WALK_SPEED`,
	// which is SELF-REFERENTIAL: holding the stick forward asks for 3.6 m/s more than you already have,
	// every tick, for ever. There is no ceiling in it. Equilibrium is drag against gravity plus the
	// whole grip budget — `0.4·v = 4.9 + 6.3` — which is 27.9 m/s, and it measured 22.0 in a mode
	// designed for 12.3.
	//
	// That one number WAS the mode. At 22 m/s the tightest circle a player can drive is `v²/grip` = 77 m
	// while the course turns at `SLIDE_SEGMENT_STEP / SLIDE_BEND_RATE` = 44 m — the run was physically
	// tighter than the racer, unfollowable at any skill level, which is what "unplayable" meant. Holding
	// the stick flat out, the one input an eight-year-old always gives, measured 13 falls per three
	// races against 3 for a player who eased off, and 2.83 m of unasked-for air off bumps tuned for
	// 0.17 m. Every other complaint about this mode is downstream of it.
	//
	// Asking for the CURRENT speed keeps all of the original intent and adds a ceiling: pointed forward
	// the request equals the velocity, so the stick adds nothing and gravity against drag sets the pace;
	// pointed across it rotates the velocity at the grip rate and costs only what a turn must cost.
	// `WALK_SPEED` is a floor so a racer on the start line can still push off.
	const onTheChute = !!under && isChute(under);
	const desiredVel = scale(
		requested,
		onTheChute ? Math.max(WALK_SPEED, length(p.vel)) : WALK_SPEED
	);
	// And you lean on a slide rather than pushing off it — see `SLIDE_GRIP`.
	const surfaceGrip = MOVE_GRIP * (onTheChute ? SLIDE_GRIP : 1);
	const grip = (airborne ? surfaceGrip * AIR_CONTROL : surfaceGrip) * authority * DT;
	const steer = clampLength(sub(desiredVel, p.vel), grip);
	let vx = p.vel.x + steer.x;
	let vz = p.vel.z + steer.z;

	// --- Gravity along the ice ----------------------------------------------
	// Only while actually touching it. A penguin in the air is not on a slope, which incidentally
	// makes jumping a real (small) way to shed a bad tilt — kept, because it is a decision a player
	// can discover, and the airtime is too short to abuse.
	if (!airborne && under) {
		// The floe's own tilt PLUS whatever hill the penguin is standing on. One term, because a
		// slope is a slope: `archipelago.groundSlope` returns an iceberg's sides in the same encoding
		// the swell uses, so standing on high ground is standing on something that wants you off it —
		// and no part of `step` has to know that ice can have hills on it.
		const hill = groundSlope(under, p.pos, world.floes);
		vx -= G * (under.slope.x + hill.x) * DT;
		vz -= G * (under.slope.z + hill.z) * DT;
	}

	// --- Ice drag -----------------------------------------------------------
	// Exponential, so it is framerate-independent and can never reverse a velocity, which a naive
	// `v -= v·k·dt` does the moment k·dt exceeds 1.
	//
	// A dashing penguin drags far harder, which is what makes the shove a lunge that plants rather
	// than a launch that sails off the rim. See DASH_DRAG.
	//
	// Both values are compile-time constants, so they are computed once at module load. This ran
	// `Math.exp` per penguin per tick — 360 transcendentals a second to choose between two numbers.
	const keep = onTheChute
		? isDashing(p)
			? SLIDE_DASH_KEEP
			: SLIDE_KEEP
		: isDashing(p)
			? DASH_KEEP
			: ICE_KEEP;
	vx *= keep;
	vz *= keep;

	// Where the ground was, and which way it was pointing, before this tick moved anybody. In WORLD
	// height, because the two readings are compared and `groundHeight` is measured from the floe's
	// own base: on a mountain consecutive segments sit 3.5 m apart, so comparing the raw values
	// across a handoff reads as a metre of lift at every disc boundary.
	const groundBefore = under ? under.altitude + groundHeight(under, p.pos, world.floes) : null;
	const leaning = under ? groundGradient(under, p.pos, world.floes) : ZERO;
	const wasAt = p.pos;

	p.vel = vec(vx, vz);
	p.pos = add(p.pos, scale(p.vel, DT));

	// `height` is measured from the ground UNDER the penguin, and the penguin has just moved, so the
	// ground may be somewhere else vertically.
	//
	// What that means depends entirely on whether the penguin was IN THE AIR.
	//
	// Airborne, the absolute height is the thing to preserve: an arc is unchanged by whatever passes
	// beneath it, so flying over a hill lands you on the slope rather than beside it.
	//
	// On the ice it is a question about the SHAPE of the ground, and the single expression that used
	// to do both got it wrong. A penguin on a constant slope is not falling — its velocity runs
	// along the surface — so ice descending underneath it is not air. A penguin running off the top
	// of an iceberg IS falling, because the ground dropped away faster than the ice it was standing
	// on was pointing. So the test is a CONVEX BREAK: how much further did the surface fall than its
	// own gradient predicted?
	//
	// Treating any descent as air was invisible until there was a slope steep enough to matter. On a
	// chute at 12 m/s the ice drops 0.1 m a tick, so a grounded penguin gained 0.1 m of air every
	// tick and the fall gravity chased it down again: a bird hovering above the run and dropping out
	// of the sky at intervals, reported as "no sliding, it is floating in the air and drops random",
	// which is the mechanism exactly. On a constant grade the two terms now cancel to zero.
	// Over open water there is no ground to measure against and the height is left exactly as it is —
	// the rim check below is what turns being over nothing into falling, and guessing a height of
	// zero out there would make a penguin mid-jump over a gap briefly stand on the sea.
	const nowOver = floeUnder(world.floes, p.pos);
	const groundAfter = nowOver ? nowOver.altitude + groundHeight(nowOver, p.pos, world.floes) : null;
	let leftTheGround = false;
	if (groundBefore !== null && groundAfter !== null) {
		const moved = sub(p.pos, wasAt);
		const predicted = leaning.x * moved.x + leaning.z * moved.z;
		if (airborne) {
			p.height = Math.max(0, p.height + groundBefore - groundAfter);
		} else {
			p.height = Math.max(0, predicted - (groundAfter - groundBefore));
			// Leaving the ground carries the vertical speed the SLOPE was giving you.
			//
			// `vel` is horizontal — this game has no third component and does not want one — so a
			// penguin sliding at 10 m/s down a 26° chute is modelled as moving 10 m/s sideways and
			// not at all downwards. Leave the ground with that, and the ice descends away from you
			// at five metres a second while you hang in the air with nothing pulling you back onto
			// it but gravity starting from zero. The result was a penguin lifting smoothly off the
			// run at the first bump and floating a metre over it for the rest of the segment.
			//
			// `predicted / DT` is the rate the surface under a moving point rises or falls, which is
			// precisely the vertical speed a body sliding along that surface has. Seeded here, an
			// ordinary bump is a bump; gravity is still what decides how long the air lasts. A real
			// jump overwrites it below, so a hop off a downhill is still a hop.
			if (p.height > 0 && p.heightVel === 0) {
				p.heightVel = predicted / DT;
				// And THIS tick's vertical motion is already in the height above: the surface
				// arithmetic accounted for the whole of it. Letting the integrator below add
				// `heightVel · dt` again subtracts the descent twice, which cancelled every crest in
				// the game — a penguin running off an iceberg landed back on it in the same tick.
				leftTheGround = true;
			}
		}
	}

	// --- Jumping ------------------------------------------------------------
	// Two jumps: one off the ice, and one flap in mid-air. The flap SETS the vertical speed rather
	// than adding to it, so it is a rescue from a badly judged arc rather than a way to stack height
	// — mashing the button at the top of a jump would otherwise climb out of the round entirely.
	if (input.jump) {
		if (!airborne) {
			p.heightVel = JUMP_SPEED;
			p.airJumps = AIR_JUMPS;
		} else if (p.airJumps > 0) {
			p.heightVel = AIR_JUMP_SPEED;
			p.airJumps--;
		}
	}
	if (!leftTheGround && (p.heightVel !== 0 || airborne)) {
		p.heightVel -= JUMP_GRAVITY * DT;
		p.height += p.heightVel * DT;
		if (p.height <= 0) {
			p.height = 0;
			p.heightVel = 0;
			// Refilled by landing, and only by landing. A penguin that has just been stomped back onto
			// the ice gets its flap back too, which is the right way round: the flap is what a player
			// reaches for when something has gone wrong.
			p.airJumps = AIR_JUMPS;
		}
	}

	// --- Facing -------------------------------------------------------------
	// Follows movement, not the stick: a penguin sliding backwards off a shove should look like it
	// is sliding backwards. Below a threshold the heading is left alone, so a penguin coasting to a
	// stop does not spin on the spot as the residual velocity wanders.
	if (length(p.vel) > 0.35) p.facing = heading(p.vel);

	// --- The rim ------------------------------------------------------------
	// Checked last, on the position this tick actually produced. A penguin still in the air keeps
	// its chance: crossing the rim mid-jump only commits you once you land, which is what makes
	// jumping a gap a thing you can do.
	// Recomputed rather than reusing `under` from the top of the tick: this penguin has MOVED since
	// then, and the whole point of a Royal is that the ice you are over changes mid-slide. Reading
	// the stale answer would let a penguin walk off a rim and keep skating on the memory of it.
	if (!airborne && !floeUnder(world.floes, p.pos)) {
		// What that COSTS is the mode's business, and this is the only place in the game that asks.
		// Two modes answer with the water — which is the whole point of the classic round and of a
		// Royal — two with the seconds it takes to climb back onto the course, and the island with its
		// beach. One rim check, five answers, and no flag anywhere that could be left set.
		modeFor(world.mode).overboard(world, p);
	}
}
