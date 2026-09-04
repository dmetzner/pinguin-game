import { describe, expect, it } from 'vitest';
import { mainFloe } from './archipelago';
import {
	aimTarget,
	dashReadiness,
	isDashing,
	isShoving,
	resolveCollisions,
	stepSnowballs,
	tickCooldowns,
	tryDash,
	tryThrow
} from './combat';
import {
	AIM_RANGE,
	DASH_COOLDOWN_TICKS,
	DASH_HOT_TICKS,
	DASH_SPEED,
	FLOE_RADIUS,
	PENGUIN_RADIUS,
	ROUND_GRACE_FADE_TICKS,
	ROUND_GRACE_TICKS,
	SHOVE_KNOCKBACK,
	SHOVE_STUN_TICKS,
	SNOWBALL_LIFETIME_TICKS,
	SNOWBALL_RANGE,
	SNOWBALL_STUN_TICKS,
	STOMP_STUN_TICKS,
	THROW_COOLDOWN_TICKS,
	TICK_RATE,
	WALK_SPEED
} from './constants';
import { type InputMap, step } from './step';
import { type InputFrame, NO_INPUT, type Penguin, type World } from './types';
import { length } from './vec';
import { createWorld, findPenguin } from './world';

/**
 * An `InputFrame` with everything off, plus whatever the test cares about.
 *
 * Spread from `NO_INPUT` rather than spelled out: adding `throw` and `dash` had to edit every
 * hand-written frame literal in the tree, which is a cost already paid once.
 */
function frame(over: Partial<InputFrame> = {}): InputFrame {
	return { ...NO_INPUT, move: { x: 0, z: 0 }, ...over };
}

/**
 * A world whose penguins are placed by hand rather than on the spawn ring.
 *
 * The round is put straight into `playing`, and a bystander is parked at the far rim BEHIND the
 * origin. Both are needed since story 02: a countdown holds everyone completely still, and a round
 * with one player left has already been won, so it would end mid-test and freeze every input.
 *
 * Behind rather than anywhere: every test here faces +z, so a penguin at -z is outside the aim cone
 * and cannot become an accidental target. It is never given an input and never touches anyone.
 */
const BYSTANDER = '_bystander';

function arena(...places: [string, number, number][]): World {
	const w = createWorld([...places.map(([id]) => id), BYSTANDER], 1);
	w.round.phase = 'playing';
	// Past the opening grace AND its fade, so attacks land at full strength. Every attack in the game is refused for the first three seconds of a
	// round (`round.attacksAllowed`), which is the point of this file, so these tests start after it.
	w.round.ticks = ROUND_GRACE_TICKS + ROUND_GRACE_FADE_TICKS;
	const parked = findPenguin(w, BYSTANDER);
	if (parked) {
		parked.pos = { x: 0, z: -FLOE_RADIUS * 0.85 };
		parked.vel = { x: 0, z: 0 };
	}
	for (const [id, x, z] of places) {
		const p = findPenguin(w, id);
		if (!p) throw new Error(`no penguin ${id}`);
		p.pos = { x, z };
		p.vel = { x: 0, z: 0 };
		p.facing = 0;
	}
	mainFloe(w).slope = { x: 0, z: 0 };
	return w;
}

function get(w: World, id: string): Penguin {
	const p = findPenguin(w, id);
	if (!p) throw new Error(`no penguin ${id}`);
	return p;
}

describe('bumping', () => {
	it('pushes two overlapping penguins apart', () => {
		const w = arena(['a', 0, 0], ['b', PENGUIN_RADIUS * 1.5, 0]);
		resolveCollisions(w);
		expect(get(w, 'a').vel.x).toBeLessThan(0);
		expect(get(w, 'b').vel.x).toBeGreaterThan(0);
	});

	it('leaves penguins that are not touching alone', () => {
		const w = arena(['a', 0, 0], ['b', PENGUIN_RADIUS * 2 + 0.1, 0]);
		resolveCollisions(w);
		expect(get(w, 'a').vel).toEqual({ x: 0, z: 0 });
		expect(get(w, 'b').vel).toEqual({ x: 0, z: 0 });
	});

	it('is symmetric — nobody gains speed from being touched', () => {
		const w = arena(['a', 0, 0], ['b', PENGUIN_RADIUS, 0]);
		get(w, 'a').vel = { x: 4, z: 0 };
		const before = get(w, 'a').vel.x + get(w, 'b').vel.x;
		resolveCollisions(w);
		// The separation term is equal and opposite, and so is the exchange, so total momentum along
		// the contact normal is conserved. An asymmetric resolution is how a "shove" that nobody
		// performed appears in a scrum.
		expect(get(w, 'a').vel.x + get(w, 'b').vel.x).toBeCloseTo(before, 6);
	});

	it('does not pull apart two penguins already separating', () => {
		const w = arena(['a', 0, 0], ['b', PENGUIN_RADIUS, 0]);
		get(w, 'a').vel = { x: -5, z: 0 };
		get(w, 'b').vel = { x: 5, z: 0 };
		resolveCollisions(w);
		// Only the separation push applies; the restitution term must not reverse them back together.
		expect(get(w, 'a').vel.x).toBeLessThan(-4.9);
		expect(get(w, 'b').vel.x).toBeGreaterThan(4.9);
	});

	it('resolves co-located penguins without producing NaN', () => {
		// Exactly on top of each other is reachable after a simultaneous stomp. A normalise of the
		// zero vector would put NaN into a velocity, and a NaN position poisons every collision test
		// that penguin is in for the rest of the round.
		const w = arena(['a', 0, 0], ['b', 0, 0]);
		resolveCollisions(w);
		for (const id of ['a', 'b']) {
			expect(Number.isFinite(get(w, id).vel.x)).toBe(true);
			expect(Number.isFinite(get(w, id).vel.z)).toBe(true);
		}
	});
});

describe('evaluation order', () => {
	it('produces the same outcome whichever order the penguins are stored in', () => {
		// The trap `backlog/stories/01` names by hand, and the reason impulses are collected across
		// every pair before any of them is applied. Resolved pair-by-pair, the first penguin in the
		// array acts on a world nobody has touched and everyone after it acts on a world already
		// moved — a real, invisible advantage. In phase 3 it is worse than unfair: a host and a
		// client iterating differently disagree about who got shoved, and that reads as lag.
		const places: [string, number, number][] = [
			['a', 0, 0],
			['b', 0.6, 0.2],
			['c', -0.5, 0.4],
			['d', 0.1, -0.7]
		];
		const forwards = arena(...places);
		const backwards = arena(...places);
		backwards.penguins.reverse();

		get(forwards, 'a').vel = { x: 3, z: 1 };
		get(backwards, 'a').vel = { x: 3, z: 1 };
		tryDash(get(forwards, 'c'), frame({ dash: true }));
		tryDash(get(backwards, 'c'), frame({ dash: true }));

		resolveCollisions(forwards);
		resolveCollisions(backwards);

		for (const id of ['a', 'b', 'c', 'd']) {
			expect(get(backwards, id).vel.x, `${id}.vel.x`).toBeCloseTo(get(forwards, id).vel.x, 10);
			expect(get(backwards, id).vel.z, `${id}.vel.z`).toBeCloseTo(get(forwards, id).vel.z, 10);
			expect(get(backwards, id).stunTicks, `${id}.stunTicks`).toBe(get(forwards, id).stunTicks);
		}
	});
});

describe('the shove', () => {
	it('knocks back and stuns on contact during a dash', () => {
		const w = arena(['a', 0, 0], ['b', PENGUIN_RADIUS * 1.6, 0]);
		tryDash(get(w, 'a'), frame({ dash: true }));
		resolveCollisions(w);

		expect(get(w, 'b').vel.x).toBeGreaterThan(SHOVE_KNOCKBACK * 0.9);
		expect(get(w, 'b').stunTicks).toBe(SHOVE_STUN_TICKS);
		// The dasher is not stunned by its own shove.
		expect(get(w, 'a').stunTicks).toBe(0);
	});

	it('shoves both when two penguins dash into each other', () => {
		const w = arena(['a', 0, 0], ['b', PENGUIN_RADIUS * 1.6, 0]);
		tryDash(get(w, 'a'), frame({ dash: true }));
		tryDash(get(w, 'b'), frame({ dash: true }));
		resolveCollisions(w);

		expect(get(w, 'a').vel.x).toBeLessThan(-SHOVE_KNOCKBACK * 0.9);
		expect(get(w, 'b').vel.x).toBeGreaterThan(SHOVE_KNOCKBACK * 0.9);
		expect(get(w, 'a').stunTicks).toBe(SHOVE_STUN_TICKS);
		expect(get(w, 'b').stunTicks).toBe(SHOVE_STUN_TICKS);
	});

	it('is far stronger than an ordinary bump', () => {
		// The two must not be confusable. Ordinary contact happens constantly on a floe this size,
		// and if a brush felt like an attack the game would read as random.
		const shoved = arena(['a', 0, 0], ['b', PENGUIN_RADIUS * 1.6, 0]);
		tryDash(get(shoved, 'a'), frame({ dash: true }));
		get(shoved, 'a').vel = { x: 4, z: 0 };
		resolveCollisions(shoved);

		const bumped = arena(['a', 0, 0], ['b', PENGUIN_RADIUS * 1.6, 0]);
		get(bumped, 'a').vel = { x: 4, z: 0 };
		resolveCollisions(bumped);

		expect(get(shoved, 'b').vel.x).toBeGreaterThan(get(bumped, 'b').vel.x * 3);
	});

	it('enforces its cooldown in the simulation rather than in a button', () => {
		const w = arena(['a', 0, 0]);
		const a = get(w, 'a');

		expect(tryDash(a, frame({ dash: true }))).toBe(true);
		expect(length(a.vel)).toBeCloseTo(DASH_SPEED, 6);

		// A held button, or a client sending `dash` every tick, must not produce a second dash.
		expect(tryDash(a, frame({ dash: true }))).toBe(false);

		for (let i = 0; i < DASH_COOLDOWN_TICKS - 1; i++) tickCooldowns(a);
		expect(tryDash(a, frame({ dash: true }))).toBe(false);
		tickCooldowns(a);
		expect(tryDash(a, frame({ dash: true }))).toBe(true);
	});

	it('reports its readiness as one number that reaches 1 exactly when it is usable', () => {
		// The HUD ring used to derive this in the route, which meant the page imported a combat
		// constant to compute a combat fact.
		const w = arena(['a', 0, 0]);
		const a = get(w, 'a');
		expect(dashReadiness(a)).toBe(1);

		tryDash(a, frame({ dash: true }));
		expect(dashReadiness(a)).toBe(0);

		for (let i = 0; i < DASH_COOLDOWN_TICKS; i++) tickCooldowns(a);
		expect(dashReadiness(a)).toBe(1);
		expect(tryDash(a, frame({ dash: true }))).toBe(true);
	});

	it('is the same lunge from a standstill as from a sprint', () => {
		// The regression guard for a bug found by looking at the screen, not by reading the code:
		// the dash used to ADD its speed to whatever the penguin already had. Measured at 11.8 m/s
		// mid-game, which on ice is a 16 m brake on a 6.5 m floe — the shove killed its own user more
		// reliably than its target. Setting also makes the reach learnable.
		const still = arena(['a', 0, 0]);
		tryDash(get(still, 'a'), frame({ dash: true }));

		const sprinting = arena(['a', 0, 0]);
		get(sprinting, 'a').vel = { x: 0, z: WALK_SPEED };
		tryDash(get(sprinting, 'a'), frame({ dash: true }));

		expect(length(get(sprinting, 'a').vel)).toBeCloseTo(length(get(still, 'a').vel), 9);
		expect(length(get(still, 'a').vel)).toBeCloseTo(DASH_SPEED, 9);
	});

	it('plants rather than sailing off the rim', () => {
		// A dash from the dead centre must not reach the edge on its own. With ICE_DRAG alone the
		// stopping distance would be DASH_SPEED / ICE_DRAG ≈ 14 m against a 6.5 m radius; DASH_DRAG
		// is what turns the launch into a lunge.
		const w = arena(['a', 0, 0]);
		const a = get(w, 'a');
		const idle: InputMap = new Map();
		tryDash(a, frame({ dash: true }));
		for (let i = 0; i < TICK_RATE * 2; i++) step(w, idle);

		expect(a.phase).toBe('skating');
		expect(length(a.pos)).toBeLessThan(FLOE_RADIUS * 0.6);
		expect(length(a.pos)).toBeGreaterThan(1);
	});

	it('stops shoving before the dash itself ends', () => {
		// The tail of the move is recovery you are committed to, and that gap is the counterplay:
		// dodging the first fifth of a second buys a free approach on someone who cannot turn yet.
		const w = arena(['a', 0, 0]);
		const a = get(w, 'a');
		tryDash(a, frame({ dash: true }));
		expect(isShoving(a)).toBe(true);

		for (let i = 0; i < DASH_HOT_TICKS; i++) tickCooldowns(a);
		expect(isShoving(a)).toBe(false);
		expect(isDashing(a)).toBe(true);
	});

	it('cannot be started while stunned', () => {
		// Enforced by `step`, which substitutes NO_INPUT for a stunned penguin rather than making
		// every action carry its own guard. Driving it through `step` is therefore the honest test —
		// calling `tryDash` directly would be testing a rule that no longer lives there.
		const w = arena(['a', 0, 0]);
		const a = get(w, 'a');
		a.stunTicks = 30;
		step(w, new Map([['a', frame({ dash: true })]]));
		expect(a.dashCooldown).toBe(0);
		expect(length(a.vel)).toBeLessThan(1);
	});
});

describe('the stomp', () => {
	it('lands on a penguin below and bounces the jumper off', () => {
		const w = arena(['jumper', 0, 0], ['victim', PENGUIN_RADIUS, 0]);
		const jumper = get(w, 'jumper');
		jumper.height = 0.8;
		jumper.heightVel = -2;

		resolveCollisions(w);

		expect(get(w, 'victim').stunTicks).toBe(STOMP_STUN_TICKS);
		expect(get(w, 'victim').vel.x).toBeGreaterThan(0);
		// The bounce is what stops a held jump button becoming a permanent lock on whoever is under it.
		expect(jumper.heightVel).toBeGreaterThan(0);
	});

	it('does not stomp on the way up', () => {
		// Rising through someone is passing them, not landing on them.
		const w = arena(['jumper', 0, 0], ['victim', PENGUIN_RADIUS, 0]);
		const jumper = get(w, 'jumper');
		jumper.height = 0.8;
		jumper.heightVel = 3;

		resolveCollisions(w);
		expect(get(w, 'victim').stunTicks).toBe(0);
	});

	it('lets a jump clear a dashing opponent entirely', () => {
		// The counterplay to a shove, and the reason the height gap is checked before the shove is.
		const w = arena(['dasher', 0, 0], ['hopper', PENGUIN_RADIUS, 0]);
		tryDash(get(w, 'dasher'), frame({ dash: true }));
		const hopper = get(w, 'hopper');
		hopper.height = 0.85;
		hopper.heightVel = 1;

		resolveCollisions(w);
		expect(hopper.stunTicks).toBe(0);
		expect(hopper.vel).toEqual({ x: 0, z: 0 });
	});
});

describe('snowballs', () => {
	it('aims at the nearest target inside the forward cone', () => {
		// facing 0 is +z, per `heading()`.
		const w = arena(['me', 0, 0], ['near', 0, 3], ['far', 0, 7], ['behind', 0, -2]);
		expect(aimTarget(w, get(w, 'me'))?.id).toBe('near');
	});

	it('ignores anyone behind the thrower', () => {
		const w = arena(['me', 0, 0], ['behind', 0, -2]);
		// Facing must mean something, or turning to meet a threat stops being a real action.
		expect(aimTarget(w, get(w, 'me'))).toBeUndefined();
	});

	it('ignores anyone out of range', () => {
		const w = arena(['me', 0, 0], ['distant', 0, AIM_RANGE + 1]);
		expect(aimTarget(w, get(w, 'me'))).toBeUndefined();
	});

	it('ignores anyone already in the water', () => {
		const w = arena(['me', 0, 0], ['sinking', 0, 3]);
		get(w, 'sinking').phase = 'falling';
		expect(aimTarget(w, get(w, 'me'))).toBeUndefined();
	});

	it('flies, hits, stuns and is consumed', () => {
		const w = arena(['me', 0, 0], ['target', 0, 4]);
		const ball = tryThrow(w, get(w, 'me'), frame({ throw: true }));
		expect(ball).toBeDefined();
		expect(w.snowballs).toHaveLength(1);

		for (let i = 0; i < TICK_RATE && w.snowballs.length > 0; i++) stepSnowballs(w);

		expect(w.snowballs).toHaveLength(0);
		expect(get(w, 'target').stunTicks).toBe(SNOWBALL_STUN_TICKS);
		expect(get(w, 'target').vel.z).toBeGreaterThan(0);
	});

	it('never hits its own thrower', () => {
		// Throwing while sliding forward adds the thrower's velocity to the ball, so without the
		// owner check a fast player hits themselves in the back of the head.
		const w = arena(['me', 0, 0]);
		const me = get(w, 'me');
		me.vel = { x: 0, z: 9 };
		tryThrow(w, me, frame({ throw: true }));
		for (let i = 0; i < TICK_RATE * 2; i++) stepSnowballs(w);
		expect(me.stunTicks).toBe(0);
	});

	it('expires rather than skittering across the ice forever', () => {
		const w = arena(['me', 0, 0]);
		tryThrow(w, get(w, 'me'), frame({ throw: true }));
		for (let i = 0; i < SNOWBALL_LIFETIME_TICKS + 1; i++) stepSnowballs(w);
		expect(w.snowballs).toHaveLength(0);
	});

	it('holds its cooldown against a held button', () => {
		const w = arena(['me', 0, 0]);
		const me = get(w, 'me');
		expect(tryThrow(w, me, frame({ throw: true }))).toBeDefined();
		expect(tryThrow(w, me, frame({ throw: true }))).toBeUndefined();

		for (let i = 0; i < THROW_COOLDOWN_TICKS; i++) tickCooldowns(me);
		expect(tryThrow(w, me, frame({ throw: true }))).toBeDefined();
	});

	it('cannot be thrown while stunned', () => {
		// Through `step`, for the same reason as the dash: the stun rule lives at that seam now.
		const w = arena(['me', 0, 0]);
		get(w, 'me').stunTicks = 20;
		step(w, new Map([['me', frame({ throw: true })]]));
		expect(w.snowballs).toHaveLength(0);
	});

	it('reaches the range the aim assist is willing to lock on at', () => {
		// Asserting the DERIVED reach, not a copied number. The first version left the ball flat from
		// 0.95 m with no lift: it hit the ice after 0.50 s and 6.5 m, while AIM_RANGE happily locked
		// on to targets 11 m away. The ranged attack silently could not reach two thirds of what it
		// aimed at, and nothing in the code said so.
		expect(SNOWBALL_RANGE).toBeCloseTo(AIM_RANGE, 6);

		const w = arena(['me', 0, 0]);
		const me = get(w, 'me');
		const ball = tryThrow(w, me, frame({ throw: true }));
		if (!ball) throw new Error('no snowball');

		let travelled = 0;
		for (let i = 0; i < SNOWBALL_LIFETIME_TICKS && w.snowballs.length > 0; i++) {
			stepSnowballs(w);
			if (w.snowballs.length > 0) travelled = length(ball.pos);
		}
		expect(travelled).toBeGreaterThan(AIM_RANGE * 0.92);
	});

	it('gives each snowball its own id, from the world rather than a module counter', () => {
		// A module-level counter is shared state between two worlds, and phase 3 runs a
		// re-simulation alongside the live one.
		const a = arena(['me', 0, 0]);
		const b = arena(['me', 0, 0]);
		const first = tryThrow(a, get(a, 'me'), frame({ throw: true }));
		const second = tryThrow(b, get(b, 'me'), frame({ throw: true }));
		expect(first?.id).toBe(second?.id);
	});
});

describe('being stunned', () => {
	it('ignores input entirely but keeps sliding', () => {
		const w = arena(['a', 0, 0]);
		const a = get(w, 'a');
		a.vel = { x: 0, z: 5 };
		a.stunTicks = 60;

		// Full stick against the slide, for half a second. A stun that merely slowed you down would
		// let a player escape the knockback that was supposed to finish them.
		const inputs: InputMap = new Map([['a', frame({ move: { x: 0, z: -1 } })]]);
		for (let i = 0; i < 30; i++) step(w, inputs);

		expect(a.vel.z).toBeGreaterThan(3);
		expect(a.stunTicks).toBe(30);
	});

	it('still gets carried over the rim while helpless', () => {
		// The intended outcome of every attack in the game, and exactly what an optimisation that
		// skipped stunned penguins in `stepPenguins` would silently remove. Knocked outward near the
		// edge with no controls, the penguin has to go in the water.
		const w = arena(['a', 0, FLOE_RADIUS - 1]);
		const a = get(w, 'a');
		a.vel = { x: 0, z: SHOVE_KNOCKBACK };
		a.stunTicks = SHOVE_STUN_TICKS;

		const fighting: InputMap = new Map([['a', frame({ move: { x: 0, z: -1 } })]]);
		for (let i = 0; i < TICK_RATE && a.phase === 'skating'; i++) step(w, fighting);

		expect(a.phase).not.toBe('skating');
	});

	it('recovers exactly on schedule', () => {
		const w = arena(['a', 0, 0]);
		const a = get(w, 'a');
		a.stunTicks = 5;
		for (let i = 0; i < 5; i++) tickCooldowns(a);
		expect(a.stunTicks).toBe(0);
	});

	it('takes the longer of two stuns rather than adding them', () => {
		// Stacking would let two players hold a third permanently helpless, which is the single
		// experience most likely to make an eight-year-old put the phone down.
		const w = arena(['a', 0, 0], ['b', PENGUIN_RADIUS * 1.6, 0]);
		const b = get(w, 'b');
		b.stunTicks = SHOVE_STUN_TICKS;
		tryDash(get(w, 'a'), frame({ dash: true }));
		resolveCollisions(w);
		expect(b.stunTicks).toBe(SHOVE_STUN_TICKS);
	});
});
