import { describe, expect, it } from 'vitest';
import { mainFloe } from './archipelago';
import {
	FALL_TICKS,
	FLOE_RADIUS,
	G,
	ICE_DRAG,
	JUMP_AIRTIME,
	JUMP_APEX,
	JUMP_SPEED,
	MAX_SLOPE,
	MOVE_GRIP,
	TICK_RATE,
	WALK_SPEED
} from './constants';
import { type InputMap, step, stepPenguins } from './step';
import { type InputFrame, NO_INPUT, type World } from './types';
import { length } from './vec';
import { createWorld } from './world';

/**
 * One penguin, parked dead centre and motionless, so a test starts from nothing.
 *
 * TWO penguins are created, not one, and the round is put straight into `playing`. Both are needed
 * since story 02: a world still in its countdown holds everyone completely still, and a round with a
 * single player has already been won — it ends on the first tick and freezes every input. The
 * second penguin is parked at the far rim, never given an input, and exists only to keep the round
 * from ending underneath the physics being measured.
 */
function solo(): World {
	const w = createWorld(['p', 'bystander'], 1);
	w.round.phase = 'playing';
	w.round.ticks = 0;

	const p = w.penguins[0];
	const bystander = w.penguins[1];
	if (!p || !bystander) throw new Error('createWorld returned too few penguins');
	p.pos = { x: 0, z: 0 };
	p.vel = { x: 0, z: 0 };
	p.facing = 0;
	bystander.pos = { x: 0, z: -FLOE_RADIUS * 0.7 };
	bystander.vel = { x: 0, z: 0 };
	return w;
}

function only(w: World) {
	const p = w.penguins[0];
	if (!p) throw new Error('world has no penguin');
	return p;
}

function inputs(move: { x: number; z: number }, jump = false): InputMap {
	// Spread from NO_INPUT so a new action field costs nothing here — adding `throw` and `dash`
	// had to edit this literal, which is why it is written this way now.
	const frame: InputFrame = { ...NO_INPUT, move, jump };
	return new Map([['p', frame]]);
}

const NONE: InputMap = new Map();

/** Run `ticks` ticks with a constant input, letting the floe do whatever it does. */
function run(w: World, ticks: number, input: InputMap = NONE): void {
	for (let i = 0; i < ticks; i++) step(w, input);
}

/**
 * Move the penguins over `ticks` ticks with the floe held at a fixed gradient.
 *
 * Uses `stepPenguins` rather than `step`, which is the entire point: `step` recomputes the gradient
 * from the swell before anyone moves, so a test that assigned `mainFloe(world).slope` and called `step`
 * measured the swell and not the slope it had just set. Five assertions in this file did exactly
 * that and four of them passed regardless.
 */
function onSlope(w: World, ticks: number, slope: { x: number; z: number }, input = NONE): void {
	mainFloe(w).slope = { ...slope };
	for (let i = 0; i < ticks; i++) stepPenguins(w, input);
}

describe('skating', () => {
	it('reaches walking speed and does not drift past it', () => {
		const w = solo();
		// Two seconds of full stick is far longer than the ~0.4 s the grip needs to close the gap.
		onSlope(w, TICK_RATE * 2, { x: 0, z: 0 }, inputs({ x: 0, z: 1 }));
		const speed = length(only(w).vel);
		// Drag bites at the top end, so the steady state sits just under the requested speed rather
		// than exactly on it. Asserting equality here would be asserting that drag does nothing.
		expect(speed).toBeGreaterThan(WALK_SPEED * 0.9);
		expect(speed).toBeLessThanOrEqual(WALK_SPEED);
	});

	it('cannot turn a fast slide around instantly — this is what makes it ice', () => {
		const w = solo();
		const p = only(w);
		p.vel = { x: 0, z: 8 };

		// Full stick straight into the slide. In one tick the velocity may lose at most the grip
		// budget plus what drag takes; if a refactor ever SETS velocity from the stick instead of
		// steering toward it, the penguin lands near -3.6 here instead of near +8.
		onSlope(w, 1, { x: 0, z: 0 }, inputs({ x: 0, z: -1 }));
		const mostOneTickCanTake = MOVE_GRIP / TICK_RATE + 8 * (1 - Math.exp(-ICE_DRAG / TICK_RATE));
		expect(p.vel.z).toBeGreaterThan(8 - mostOneTickCanTake * 1.01);
		expect(p.vel.z).toBeGreaterThan(7.5);

		// And it takes the better part of a second to come to a stop, let alone reverse.
		onSlope(w, Math.round(TICK_RATE * 0.5), { x: 0, z: 0 }, inputs({ x: 0, z: -1 }));
		expect(p.vel.z).toBeGreaterThan(0);
	});

	it('coasts when the stick is released instead of braking', () => {
		// The bug this exists for: steering used the full grip budget regardless of how far the
		// stick was pushed, so an untouched stick requested a velocity of zero and BRAKED toward it
		// at 9.5 m/s². That cancelled gravity almost exactly — a penguin abandoned on the steepest
		// slope the floe can make drifted at 0.04 m/s and stayed there. Letting go was a perfect
		// brake, tilt was harmless, and the whole design rests on tilt not being harmless.
		const w = solo();
		const p = only(w);
		p.vel = { x: 0, z: 5 };

		onSlope(w, TICK_RATE, { x: 0, z: 0 });

		// One second of drag alone: exp(-0.72) ≈ 0.487 of the original speed, and nothing else.
		expect(p.vel.z).toBeCloseTo(5 * Math.exp(-ICE_DRAG), 2);
		expect(p.vel.z).toBeGreaterThan(2);
	});

	it('slides downhill with no input, and settles at a terminal speed', () => {
		const w = solo();
		const p = only(w);
		mainFloe(w).slope = { x: 0, z: MAX_SLOPE };

		// Position is pinned to the origin every tick, because reaching terminal velocity takes
		// about four drag time constants (~5.5 s) and a penguin actually travelling at 2.8 m/s
		// leaves a 6.5 m floe well before then. This is a treadmill: the subject is the velocity
		// dynamics, and letting the penguin fall in the water halfway through would test the rim.
		for (let i = 0; i < TICK_RATE * 6; i++) {
			p.pos = { x: 0, z: 0 };
			stepPenguins(w, NONE);
		}

		// Downhill is -slope, so a +z gradient sends the penguin toward -z.
		expect(p.vel.z).toBeLessThan(0);
		// Terminal velocity of `v' = -G·slope - drag·v` is G·slope/drag.
		const terminal = (G * MAX_SLOPE) / ICE_DRAG;
		expect(Math.abs(p.vel.z)).toBeGreaterThan(terminal * 0.9);
		expect(Math.abs(p.vel.z)).toBeLessThan(terminal * 1.05);
	});

	it('lets a player walk uphill against the steepest slope the floe can make', () => {
		// The design claim in constants.ts is that tilt ALONE is never a death sentence — the tilt
		// is the terrain and the shove is the kill. If MOVE_GRIP is ever lowered below G·MAX_SLOPE,
		// that claim silently stops being true and the game becomes a waiting contest in the middle.
		expect(MOVE_GRIP).toBeGreaterThan(G * MAX_SLOPE);

		const w = solo();
		const p = only(w);
		// 1.5 s, not more: uphill progress settles around 3.5 m/s, and three seconds of it crosses
		// the whole floe and drops the penguin off the far rim — which is what the first version of
		// this test did, then blamed the slope for it.
		onSlope(w, Math.round(TICK_RATE * 1.5), { x: 0, z: -MAX_SLOPE }, inputs({ x: 0, z: -1 }));

		// Downhill is +z here, so making ground toward -z is walking uphill.
		expect(p.pos.z).toBeLessThan(-3);
		expect(p.phase).toBe('skating');
	});
});

describe('jumping', () => {
	it('reaches the apex and airtime the constants claim it does', () => {
		// Asserting the DERIVED values, not hand-copied numbers, so the two cannot drift: this is
		// the test that caught JUMP_SPEED/JUMP_GRAVITY delivering a 0.38 m hop while the comment
		// beside them promised 0.75 m.
		const w = solo();
		const p = only(w);

		onSlope(w, 1, { x: 0, z: 0 }, inputs({ x: 0, z: 0 }, true));
		expect(p.heightVel).toBeGreaterThan(0);

		let peak = 0;
		let airTicks = 1;
		for (let i = 0; i < TICK_RATE * 3; i++) {
			onSlope(w, 1, { x: 0, z: 0 });
			peak = Math.max(peak, p.height);
			if (p.height > 0) airTicks++;
		}

		expect(peak).toBeCloseTo(JUMP_APEX, 1);
		expect(airTicks / TICK_RATE).toBeCloseTo(JUMP_AIRTIME, 1);
		expect(p.height).toBe(0);
		expect(p.heightVel).toBe(0);
	});

	it('ignores a jump request while already airborne', () => {
		const w = solo();
		const p = only(w);
		onSlope(w, 1, { x: 0, z: 0 }, inputs({ x: 0, z: 0 }, true));
		const afterFirst = p.heightVel;

		// Holding the button must not re-launch. Without the `!airborne` guard a held jump is a
		// jetpack, and a jetpack over water is a penguin that never has to play the game.
		onSlope(w, 1, { x: 0, z: 0 }, inputs({ x: 0, z: 0 }, true));
		expect(p.heightVel).toBeLessThan(afterFirst);
		expect(p.heightVel).toBeLessThan(JUMP_SPEED);
	});

	it('does not feel the slope while in the air', () => {
		const slope = { x: 0, z: MAX_SLOPE };

		// Airborne over the same slope for the same number of ticks as a grounded penguin: the
		// grounded one must pick up speed downhill and the airborne one must barely move.
		const air = solo();
		onSlope(air, 1, slope, inputs({ x: 0, z: 0 }, true));
		const airborneStart = only(air).vel.z;
		onSlope(air, 20, slope);
		const airborneGain = Math.abs(only(air).vel.z - airborneStart);

		const grounded = solo();
		onSlope(grounded, 21, slope);
		const groundedGain = Math.abs(only(grounded).vel.z);

		expect(airborneGain).toBeLessThan(groundedGain * 0.2);
	});
});

describe('the rim', () => {
	it('starts falling past the rim and is out after FALL_TICKS', () => {
		const w = solo();
		const p = only(w);
		p.pos = { x: 0, z: FLOE_RADIUS + 0.5 };
		p.vel = { x: 0, z: 1 };

		step(w, NONE);
		expect(p.phase).toBe('falling');

		run(w, FALL_TICKS - 1);
		expect(p.phase).toBe('falling');
		step(w, NONE);
		expect(p.phase).toBe('out');
	});

	it('gives a penguin whose toes are over the edge the grace it can see', () => {
		// Exactly on the drawn rim is still on the ice. The art is where the player thinks the edge
		// is, and being stricter than the art reads as the game cheating.
		const w = solo();
		const p = only(w);
		p.pos = { x: 0, z: FLOE_RADIUS };

		onSlope(w, 1, { x: 0, z: 0 });
		expect(p.phase).toBe('skating');
	});

	it('does not commit a penguin that crosses the rim mid-jump', () => {
		// Jumping a gap has to be possible or the phase-1 stomp has no counterplay.
		const w = solo();
		const p = only(w);
		p.pos = { x: 0, z: FLOE_RADIUS + 0.2 };
		p.height = 1.2;
		p.heightVel = 1;

		step(w, NONE);
		expect(p.phase).toBe('skating');
	});

	it('keeps drifting outward while falling', () => {
		const w = solo();
		const p = only(w);
		p.pos = { x: 0, z: FLOE_RADIUS + 0.5 };
		p.vel = { x: 0, z: 3 };
		step(w, NONE);

		const atStart = p.pos.z;
		run(w, 10);
		expect(p.pos.z).toBeGreaterThan(atStart);
		expect(p.height).toBeLessThan(0);
	});

	it('stops simulating a penguin that is out', () => {
		const w = solo();
		const p = only(w);
		p.phase = 'out';
		p.pos = { x: 1, z: 2 };
		run(w, 30, inputs({ x: 1, z: 0 }));
		expect(p.pos).toEqual({ x: 1, z: 2 });
	});
});

describe('step composes both halves', () => {
	// `step` was split into `stepFloe` + `stepPenguins` so tests could hold the gradient still.
	// The risk that split introduces is a caller — or a future refactor — running one half and not
	// the other, which would be invisible: the game would simply stop wobbling, or stop moving.
	it('advances the tick, the floe and the penguins in one call', () => {
		const w = solo();
		const before = { ...mainFloe(w).slope };
		step(w, inputs({ x: 1, z: 0 }));

		expect(w.tick).toBe(1);
		expect(mainFloe(w).slope).not.toEqual(before);
		expect(only(w).vel.x).toBeGreaterThan(0);
	});

	it('drives the floe from the tick count and not from a clock', () => {
		// Two worlds stepped the same number of times must hold the same gradient, whatever the
		// wall clock did in between. This is the assertion that would go red if `stepFloe` were
		// ever handed `Date.now()` in place of `world.tick / TICK_RATE`.
		const a = createWorld(['p', 'q'], 7);
		const b = createWorld(['p', 'q'], 7);
		for (let i = 0; i < 137; i++) step(a, NONE);
		for (let i = 0; i < 137; i++) step(b, NONE);
		expect(mainFloe(a).slope).toEqual(mainFloe(b).slope);
	});
});

describe('determinism', () => {
	it('produces an identical world from the same seed and the same inputs', () => {
		// The whole of phase 3 rests on this. If it ever goes red, the cause is a `Math.random()`
		// or a `Date.now()` that has crept into `sim/` — check there before anything else.
		const script: InputMap[] = [];
		for (let i = 0; i < 400; i++) {
			const a = Math.sin(i * 0.31);
			const b = Math.cos(i * 0.17);
			script.push(
				new Map([
					[
						'p',
						{ move: { x: a, z: b }, jump: i % 37 === 0, throw: i % 23 === 0, dash: i % 51 === 0 }
					]
				])
			);
		}

		const runOnce = () => {
			const w = createWorld(['p', 'bystander'], 12345);
			w.round.phase = 'playing';
			for (const frame of script) step(w, frame);
			return JSON.stringify(w);
		};

		expect(runOnce()).toBe(runOnce());
	});

	it('produces different starting positions for different seeds', () => {
		const a = createWorld(['p', 'q'], 1);
		const b = createWorld(['p', 'q'], 2);
		expect(a.penguins[0]?.pos).not.toEqual(b.penguins[0]?.pos);
	});
});
