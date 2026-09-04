/**
 * Penguins hitting each other, and snowballs hitting penguins.
 *
 * One rule with three deliveries — see `docs/DESIGN.md` §5. Every attack in this game does the same
 * two things, a knockback and a spell of lost control, and differs only in how much of each. A child
 * who works out any one of them has worked out the whole combat system.
 *
 * Pure, like everything else in `sim/`. No clock, no randomness, no renderer.
 */
import {
	AIM_CONE,
	AIM_RANGE,
	BUMP_RESTITUTION,
	BUMP_SEPARATION_SPEED,
	CONTACT_RADIUS_SQ,
	DASH_COOLDOWN_TICKS,
	DASH_HOT_TICKS,
	DASH_SPEED,
	DASH_TICKS,
	DT,
	PENGUIN_HEIGHT,
	PENGUIN_RADIUS,
	SHOVE_KNOCKBACK,
	SHOVE_STUN_TICKS,
	SIDELINE_KNOCKBACK,
	SIDELINE_RANGE,
	SIDELINE_STUN_TICKS,
	SIDELINE_THROW_COOLDOWN_TICKS,
	SNOWBALL_GRAVITY,
	SNOWBALL_KNOCKBACK,
	SNOWBALL_LIFETIME_TICKS,
	SNOWBALL_LIFT,
	SNOWBALL_RADIUS,
	SNOWBALL_SPAWN_HEIGHT,
	SNOWBALL_SPEED,
	SNOWBALL_STUN_TICKS,
	STOMP_BOUNCE,
	STOMP_HEIGHT_GAP,
	STOMP_KNOCKBACK,
	STOMP_STUN_TICKS,
	THROW_COOLDOWN_TICKS
} from './constants';
import { attackStrength, attacksAllowed } from './round';
import type { InputFrame, Penguin, Snowball, Vec2, World } from './types';
import { add, distanceSq, dot, fromHeading, length, normalize, scale, sub, vec, ZERO } from './vec';

/** A snowball hits within this distance, squared. */
const SNOWBALL_HIT_SQ = (PENGUIN_RADIUS + SNOWBALL_RADIUS) ** 2;

// ---------------------------------------------------------------------------
// Dash state, derived rather than stored
// ---------------------------------------------------------------------------

/**
 * A dash is ONE counter, read three ways.
 *
 * `dashCooldown` runs from DASH_COOLDOWN_TICKS down to zero and the two windows are slices of it:
 * the move itself is the first DASH_TICKS, and the part that shoves is the first DASH_HOT_TICKS of
 * that. There used to be a second counter running alongside, decremented in the same statement and
 * floored at the same place, which is redundant state that two people have to keep in lockstep — and
 * one number fewer is one number fewer in every phase-3 snapshot.
 */
export function isDashing(p: Penguin): boolean {
	return p.dashCooldown > DASH_COOLDOWN_TICKS - DASH_TICKS;
}

export function isShoving(p: Penguin): boolean {
	return p.dashCooldown > DASH_COOLDOWN_TICKS - DASH_HOT_TICKS;
}

/** 0 while the dash is recharging, 1 when it is available. What the button's ring draws. */
export function dashReadiness(p: Penguin): number {
	return 1 - p.dashCooldown / DASH_COOLDOWN_TICKS;
}

// ---------------------------------------------------------------------------
// Hits
// ---------------------------------------------------------------------------

/**
 * What one attack does to one penguin, accumulated rather than applied.
 *
 * Every hit in the game goes through `addHit` into one of these, and the accumulator is drained
 * once at the end of the tick. That is the shape the collision resolution needs anyway (see
 * `resolveCollisions`), and making it the shape of ALL hits is what finally makes the "one place"
 * claim below true.
 */
interface Impulse {
	push: Vec2;
	stunTicks: number;
	bounce: boolean;
}

function emptyImpulse(): Impulse {
	return { push: ZERO, stunTicks: 0, bounce: false };
}

/**
 * Record a hit: a push, and a spell of lost control.
 *
 * **The one place either of those is written.** That was the claim in the first version of this
 * file and it was not true — only the snowball used it, while the shove and the stomp each
 * open-coded the same two lines, so the invariant was enforced for one attack out of three and the
 * comment misled anyone who checked.
 *
 * Stun is the LONGER of what is already running and what has just landed, never the sum. Stacking
 * would let two players hold a third permanently helpless, which is the single experience most
 * likely to make an eight-year-old put the phone down.
 */
function addHit(into: Impulse, direction: Vec2, speed: number, stunTicks: number): void {
	into.push = add(into.push, scale(normalize(direction), speed));
	into.stunTicks = Math.max(into.stunTicks, stunTicks);
}

/** Drain an accumulated impulse into the penguin it was collected for. */
function applyImpulse(p: Penguin, impulse: Impulse): void {
	p.vel = add(p.vel, impulse.push);
	p.stunTicks = Math.max(p.stunTicks, impulse.stunTicks);
	if (impulse.bounce) p.heightVel = STOMP_BOUNCE;
}

// ---------------------------------------------------------------------------
// Per-tick bookkeeping
// ---------------------------------------------------------------------------

/** Count every timer down by one. Nothing else — starting moves is `tryDash` and `tryThrow`. */
export function tickCooldowns(p: Penguin): void {
	if (p.stunTicks > 0) p.stunTicks--;
	if (p.dashCooldown > 0) p.dashCooldown--;
	if (p.throwCooldown > 0) p.throwCooldown--;
}

/**
 * Start a dash, if the input asked and the cooldown allows.
 *
 * Same shape and same signature as `tryThrow`, deliberately: between them they are the complete
 * list of things a penguin can choose to do, which is what a bot author in story 02 reads.
 *
 * Cooldowns live here, in the simulation, rather than in a disabled button. A cooldown enforced by
 * the UI is not a rule: a bot has no button, and from phase 3 the inputs arrive over a network from
 * a client that can send whatever it likes.
 */
export function tryDash(p: Penguin, input: InputFrame): boolean {
	if (!input.dash || p.dashCooldown > 0 || p.height > 0) return false;
	p.dashCooldown = DASH_COOLDOWN_TICKS;
	// SET, not add — see DASH_SPEED. Adding stacked the lunge on top of a run-up and threw the
	// dasher off the far rim.
	p.vel = scale(fromHeading(p.facing), DASH_SPEED);
	return true;
}

/**
 * Choose what a snowball thrown by `thrower` should be aimed at.
 *
 * Nearest target inside a cone in front, rather than nearest overall. The cone is what keeps facing
 * meaningful: you cannot hit someone behind you, so turning to face a threat stays a real action
 * with a real cost on ice. Within the cone the aim is exact, because precise aiming with a second
 * thumb is a skill this audience does not have and the intended skill is positioning.
 *
 * Exported for the bots in story 02, which need to ask the same question the aim assist asks.
 */
export function aimTarget(world: World, thrower: Penguin): Penguin | undefined {
	const forward = fromHeading(thrower.facing);
	const cosCone = Math.cos(AIM_CONE);
	let best: Penguin | undefined;
	let bestDistanceSq = AIM_RANGE ** 2;

	for (const other of world.penguins) {
		if (other.phase !== 'skating' || other.id === thrower.id) continue;
		const to = sub(other.pos, thrower.pos);
		const distanceSquared = to.x * to.x + to.z * to.z;
		if (distanceSquared < 1e-12 || distanceSquared > bestDistanceSq) continue;
		if (dot(scale(to, 1 / Math.sqrt(distanceSquared)), forward) < cosCone) continue;
		best = other;
		bestDistanceSq = distanceSquared;
	}
	return best;
}

/** Throw, if the input asked and the cooldown allows. Returns the snowball, or undefined. */
export function tryThrow(world: World, thrower: Penguin, input: InputFrame): Snowball | undefined {
	if (!input.throw || thrower.throwCooldown > 0 || !attacksAllowed(world)) return undefined;
	thrower.throwCooldown = THROW_COOLDOWN_TICKS;

	const target = aimTarget(world, thrower);
	const direction = target ? normalize(sub(target.pos, thrower.pos)) : fromHeading(thrower.facing);

	const ball: Snowball = {
		id: world.nextSnowballId++,
		owner: thrower.id,
		pos: { ...thrower.pos },
		// The thrower's own velocity is added, so a snowball thrown while sliding backwards goes
		// where it looks like it should. Without it, throwing while moving fast produces a ball that
		// visibly lags the arm that threw it.
		vel: add(thrower.vel, scale(direction, SNOWBALL_SPEED)),
		height: SNOWBALL_SPAWN_HEIGHT,
		heightVel: SNOWBALL_LIFT,
		ticks: 0
	};
	world.snowballs.push(ball);
	return ball;
}

/**
 * Throw from the sidelines, from a chunk of ice beside the arena.
 *
 * The same road into the world as everything else — an `InputFrame` with `throw` set — and the same
 * `Snowball`, deliberately carrying no "weak" flag of its own. What makes it weak is WHO threw it:
 * `snowballHit` asks whether the owner is out, so there is no second piece of state that can
 * disagree with `phase`, and nothing new goes over the wire in phase 3.
 *
 * Aimed at the nearest penguin still on the ice rather than through the aim cone: a spectator's
 * `facing` is whatever it happened to be when they fell in, and asking a child to turn a penguin
 * they can no longer steer would make the whole thing a joke.
 */
export function trySidelineThrow(
	world: World,
	thrower: Penguin,
	from: Vec2,
	input: InputFrame
): Snowball | undefined {
	if (!input.throw || thrower.throwCooldown > 0 || thrower.phase !== 'out') return undefined;
	if (!attacksAllowed(world)) return undefined;

	const target = nearestOnTheIce(world, from);
	if (!target) return undefined;
	thrower.throwCooldown = SIDELINE_THROW_COOLDOWN_TICKS;

	const to = sub(target.pos, from);
	const distance = length(to);
	const ball: Snowball = {
		id: world.nextSnowballId++,
		owner: thrower.id,
		pos: { ...from },
		vel: scale(normalize(to), SNOWBALL_SPEED),
		height: SNOWBALL_SPAWN_HEIGHT,
		// Lofted in proportion to the throw, so a ball aimed at the far side of the sea arcs over the
		// water instead of skipping into it half way. The flat `SNOWBALL_LIFT` is solved for
		// AIM_RANGE, and the sidelines throw further than that by design.
		heightVel: SNOWBALL_LIFT * Math.max(1, distance / AIM_RANGE),
		ticks: 0
	};
	world.snowballs.push(ball);
	return ball;
}

/** The nearest penguin still in the round. What a spectator throws at. */
function nearestOnTheIce(world: World, from: Vec2): Penguin | undefined {
	let best: Penguin | undefined;
	let bestSq = SIDELINE_RANGE ** 2;
	for (const p of world.penguins) {
		if (p.phase !== 'skating') continue;
		const d = distanceSq(p.pos, from);
		if (d < bestSq) {
			bestSq = d;
			best = p;
		}
	}
	return best;
}

/** The first penguin this ball is touching, or undefined. */
function snowballVictim(ball: Snowball, penguins: readonly Penguin[]): Penguin | undefined {
	for (const target of penguins) {
		if (target.phase !== 'skating') continue;
		// A snowball never hits its thrower — otherwise throwing while sliding forward hits you in
		// the back of the head, which is both absurd and unexplainable.
		if (target.id === ball.owner) continue;
		// The scalar height tests come FIRST: they reject every ball flying over a head or under a
		// jumper without touching the distance maths at all.
		if (ball.height > target.height + PENGUIN_HEIGHT) continue;
		// Under the feet. A snowball can be JUMPED, which is the counterplay a ranged attack has to
		// have in a game whose other two attacks both require closing the distance — and it is a
		// skill an eight-year-old discovers by accident and then does on purpose forever.
		if (ball.height + SNOWBALL_RADIUS < target.height) continue;
		if (distanceSq(target.pos, ball.pos) > SNOWBALL_HIT_SQ) continue;
		return target;
	}
	return undefined;
}

/**
 * Advance every snowball and resolve what it hits.
 *
 * Iterated backwards so a ball can be spliced out the moment it lands or expires without disturbing
 * the indices of the ones not yet visited.
 */
export function stepSnowballs(world: World): void {
	// Hoisted: this used to be recomputed inside the loop, so every snowball in flight allocated its
	// own filtered array of penguins, every tick. Measured at ~4× the cost of the whole function.
	const penguins = world.penguins;

	for (let i = world.snowballs.length - 1; i >= 0; i--) {
		const ball = world.snowballs[i];
		if (!ball) continue;

		ball.ticks++;
		ball.heightVel -= SNOWBALL_GRAVITY * DT;
		ball.height += ball.heightVel * DT;
		ball.pos = add(ball.pos, scale(ball.vel, DT));

		if (ball.height <= 0 || ball.ticks >= SNOWBALL_LIFETIME_TICKS) {
			world.snowballs.splice(i, 1);
			continue;
		}

		const victim = snowballVictim(ball, penguins);
		if (!victim) continue;

		// A third of everything, if it came from the sidelines. Read off the THROWER rather than off
		// the ball: one fact, in one place, and a spectator's snowball cannot be mistaken for a real
		// one by anything downstream.
		const fromSidelines = penguins.find((p) => p.id === ball.owner)?.phase === 'out';
		const strength = attackStrength(world);
		const hit = emptyImpulse();
		addHit(
			hit,
			ball.vel,
			(fromSidelines ? SIDELINE_KNOCKBACK : SNOWBALL_KNOCKBACK) * strength,
			(fromSidelines ? SIDELINE_STUN_TICKS : SNOWBALL_STUN_TICKS) * strength
		);
		applyImpulse(victim, hit);
		world.snowballs.splice(i, 1);
	}
}

// ---------------------------------------------------------------------------
// Contact
// ---------------------------------------------------------------------------

/**
 * Resolve every penguin-to-penguin contact this tick.
 *
 * **Impulses are collected across all pairs first and applied afterwards, and that is the whole
 * point of the function.** Resolving each pair as it is found makes the outcome depend on the order
 * of `world.penguins`: with six penguins in a scrum the first in the array gets to act on a world
 * nobody else has touched yet, and everyone after it acts on a world already moved. It is a real
 * advantage, it is invisible, and in phase 3 it is worse than unfair — a host and a client that
 * iterate differently disagree about who got shoved, which reads to a player as lag.
 *
 * `combat.test.ts` asserts this directly by resolving the same scrum with the array reversed.
 *
 * The accumulator is created lazily and keyed by the penguin OBJECT: the overwhelming majority of
 * ticks have nobody touching anybody, and those now allocate nothing at all.
 */
export function resolveCollisions(world: World): void {
	const penguins = world.penguins;
	// The opening seconds of a round: penguins still collide and still separate, because two bodies
	// in the same place is a physics problem rather than an attack, but nothing here STUNS anybody
	// yet. A FRACTION rather than a flag — see `round.attackStrength` — because a rule that flips at
	// one tick is a rule a client running ahead of the host disagrees with, and an 8 m/s shove is a
	// big thing to disagree about.
	const strength = attackStrength(world);
	let impulses: Map<Penguin, Impulse> | undefined;

	const impulseFor = (p: Penguin): Impulse => {
		impulses ??= new Map();
		let existing = impulses.get(p);
		if (!existing) {
			existing = emptyImpulse();
			impulses.set(p, existing);
		}
		return existing;
	};

	for (let i = 0; i < penguins.length; i++) {
		const a = penguins[i];
		if (a?.phase !== 'skating') continue;

		for (let j = i + 1; j < penguins.length; j++) {
			const b = penguins[j];
			if (b?.phase !== 'skating') continue;

			// Squared first: most pairs on a six-penguin floe are not touching, and rejecting them
			// without a square root is what makes an idle tick nearly free.
			const gapSq = distanceSq(b.pos, a.pos);
			if (gapSq >= CONTACT_RADIUS_SQ) continue;

			// Two penguins at different heights are not touching. This is what makes a stomp a
			// distinct move rather than a shove that happens to arrive from above, and it is why a
			// penguin can jump over a dashing opponent.
			if (Math.abs(a.height - b.height) > STOMP_HEIGHT_GAP) {
				// A stomp is nothing but an attack, so through the grace it simply does not happen —
				// there is no separation to do either, the two are not at the same height.
				if (strength > 0) resolveStomp(a, b, gapSq, strength, impulseFor);
				continue;
			}

			resolveGroundContact(a, b, gapSq, strength, impulseFor);
		}
	}

	if (!impulses) return;
	for (const [p, impulse] of impulses) applyImpulse(p, impulse);
}

/**
 * The contact normal from `a` to `b`.
 *
 * Degenerate case: exactly co-located, which spawn jitter makes unlikely and a simultaneous stomp
 * makes possible. A fixed axis rather than a division by zero — arbitrary, but deterministic, which
 * is the property that matters.
 */
function contactNormal(a: Penguin, b: Penguin, gapSq: number): Vec2 {
	if (gapSq < 1e-12) return vec(1, 0);
	return scale(sub(b.pos, a.pos), 1 / Math.sqrt(gapSq));
}

function resolveStomp(
	a: Penguin,
	b: Penguin,
	gapSq: number,
	strength: number,
	impulseFor: (p: Penguin) => Impulse
): void {
	const [above, below] = a.height > b.height ? [a, b] : [b, a];
	// Only on the way DOWN. Rising through someone is passing them, not landing on them.
	if (above.heightVel > 0) return;

	const normal = contactNormal(a, b, gapSq);
	addHit(
		impulseFor(below),
		above === a ? normal : scale(normal, -1),
		STOMP_KNOCKBACK * strength,
		STOMP_STUN_TICKS * strength
	);
	// A set rather than an accumulation, and deferred like everything else: `above.heightVel` is
	// read by later pairs in the same tick, so bouncing here would change their answer.
	impulseFor(above).bounce = true;
}

function resolveGroundContact(
	a: Penguin,
	b: Penguin,
	gapSq: number,
	strength: number,
	impulseFor: (p: Penguin) => Impulse
): void {
	const normal = contactNormal(a, b, gapSq);
	const overlap = PENGUIN_RADIUS * 2 - Math.sqrt(gapSq);

	// Position correction, applied as a separation velocity rather than by teleporting the two
	// apart. Teleporting looks like a stutter and fights the slope every tick.
	const separation = scale(normal, (overlap / 2) * BUMP_SEPARATION_SPEED);
	const impulseA = impulseFor(a);
	const impulseB = impulseFor(b);
	impulseA.push = sub(impulseA.push, separation);
	impulseB.push = add(impulseB.push, separation);

	// A shove is a dash that made contact. Checked on BOTH, so two penguins dashing into each other
	// both get shoved — the fair outcome, and it reads as a proper collision.
	const aShoves = isShoving(a);
	const bShoves = isShoving(b);
	// The shove is an attack; the push that keeps two bodies out of each other is not. Through the
	// opening grace only the second one happens, which is why `strength` is threaded down here rather
	// than checked at the top: penguins must still not stand inside one another.
	if (aShoves) {
		addHit(impulseB, normal, SHOVE_KNOCKBACK * strength, SHOVE_STUN_TICKS * strength);
	}
	if (bShoves) {
		addHit(impulseA, scale(normal, -1), SHOVE_KNOCKBACK * strength, SHOVE_STUN_TICKS * strength);
	}
	if (aShoves || bShoves) return;

	// An ordinary bump. Equal and opposite, so nobody gains speed from being touched, and only the
	// CLOSING component is reflected — two penguins already moving apart are not pulled back together.
	const closing = dot(sub(b.vel, a.vel), normal);
	if (closing >= 0) return;
	const exchange = scale(normal, closing * BUMP_RESTITUTION);
	impulseA.push = add(impulseA.push, exchange);
	impulseB.push = sub(impulseB.push, exchange);
}
