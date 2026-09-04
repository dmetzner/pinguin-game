import { describe, expect, it } from 'vitest';
import { gapBetween, JUMP_RANGE, layout } from './archipelago';
import {
	AIR_JUMP_APEX,
	AIR_JUMP_SPEED,
	AIR_JUMPS,
	DOUBLE_JUMP_AIRTIME,
	JUMP_AIRTIME,
	JUMP_APEX,
	JUMP_SPEED,
	ROYAL_PLAYERS,
	WALK_SPEED
} from './constants';
import { step } from './step';
import type { InputFrame, World } from './types';
import { NO_INPUT } from './types';
import { createWorld, findPenguin } from './world';

const JUMPING: InputFrame = { ...NO_INPUT, jump: true };

/**
 * A round in play, with one penguin to measure and one standing well out of its way.
 *
 * TWO of them, and that is not padding: a world with a single penguin is a round with a winner, so
 * `endRoundIfDecided` finishes it on the first tick and every input after that is frozen. The first
 * version of this file had one, and every assertion about the second jump failed for that reason
 * rather than for anything to do with jumping.
 */
function alone(): World {
	const world = createWorld(['me', 'far'], 3);
	world.round.phase = 'playing';
	const far = findPenguin(world, 'far');
	if (far) far.pos = { x: 5, z: 5 };
	return world;
}

/** Step until the penguin is at the top of its arc, and answer how high that was. */
function apexOf(world: World, id: string): number {
	const p = findPenguin(world, id);
	if (!p) throw new Error('no penguin');
	let highest = 0;
	for (let i = 0; i < 300 && (p.height > 0 || i < 2); i++) {
		step(world, new Map());
		highest = Math.max(highest, p.height);
		if (p.height === 0 && i > 2) break;
	}
	return highest;
}

describe('the second jump', () => {
	it('exists, and there is exactly one of it', () => {
		// Two would make the rim optional, and the rim is the game.
		expect(AIR_JUMPS).toBe(1);
		// A flap, not a launch: weaker than pushing off solid ice.
		expect(AIR_JUMP_SPEED).toBeLessThan(JUMP_SPEED);
	});

	it('lifts a penguin that has already left the ice', () => {
		const world = alone();
		const me = findPenguin(world, 'me');
		if (!me) throw new Error('no penguin');

		step(world, new Map([['me', JUMPING]]));
		// A few ticks into the fall, when a badly judged jump is visibly going to come up short.
		for (let i = 0; i < 30; i++) step(world, new Map());
		expect(me.height).toBeGreaterThan(0);
		expect(me.heightVel).toBeLessThan(0);

		const before = me.heightVel;
		step(world, new Map([['me', JUMPING]]));
		expect(me.heightVel).toBeGreaterThan(before);
		expect(me.heightVel).toBeGreaterThan(0);
	});

	it('SETS the climb rather than adding to it', () => {
		// Added, a player mashing the button at the top of a jump would climb out of the round. The
		// flap is a rescue from a bad arc, not a ladder.
		const world = alone();
		const me = findPenguin(world, 'me');
		if (!me) throw new Error('no penguin');
		step(world, new Map([['me', JUMPING]]));
		step(world, new Map([['me', JUMPING]]));
		expect(me.heightVel).toBeLessThanOrEqual(AIR_JUMP_SPEED);
	});

	it('is spent once used, until the feet touch ice again', () => {
		const world = alone();
		const me = findPenguin(world, 'me');
		if (!me) throw new Error('no penguin');

		step(world, new Map([['me', JUMPING]]));
		expect(me.airJumps).toBe(AIR_JUMPS);
		for (let i = 0; i < 20; i++) step(world, new Map());
		step(world, new Map([['me', JUMPING]]));
		expect(me.airJumps).toBe(0);

		// Asking again, mid-air, does nothing at all.
		for (let i = 0; i < 10; i++) step(world, new Map());
		const climbing = me.heightVel;
		step(world, new Map([['me', JUMPING]]));
		expect(me.heightVel).toBeLessThan(climbing);

		// Down, and it is back.
		for (let i = 0; i < 200 && me.height > 0; i++) step(world, new Map());
		expect(me.height).toBe(0);
		expect(me.airJumps).toBe(AIR_JUMPS);
	});

	it('buys real airtime, and the derived number says how much', () => {
		// Asserted against `DOUBLE_JUMP_AIRTIME` rather than a measured constant, so the number the
		// map is reasoned about with cannot drift away from what the simulation does.
		expect(DOUBLE_JUMP_AIRTIME).toBeGreaterThan(JUMP_AIRTIME);
		expect(AIR_JUMP_APEX).toBeGreaterThan(0.4);

		const world = alone();
		const me = findPenguin(world, 'me');
		if (!me) throw new Error('no penguin');
		step(world, new Map([['me', JUMPING]]));
		// Flap at the top of the first arc, which is where it is worth the most.
		for (let i = 0; i < Math.round((JUMP_AIRTIME / 2) * 60) - 1; i++) step(world, new Map());
		step(world, new Map([['me', JUMPING]]));

		let ticks = 0;
		while (me.height > 0 && ticks < 400) {
			step(world, new Map());
			ticks++;
		}
		const airtime = (ticks + Math.round((JUMP_AIRTIME / 2) * 60)) / 60;
		expect(airtime).toBeGreaterThan(JUMP_AIRTIME);
		expect(airtime).toBeCloseTo(DOUBLE_JUMP_AIRTIME, 1);
	});

	it('goes higher than one jump alone', () => {
		const single = apexOf(alone(), 'me');
		expect(single).toBeCloseTo(0, 1);

		const world = alone();
		step(world, new Map([['me', JUMPING]]));
		for (let i = 0; i < 22; i++) step(world, new Map());
		step(world, new Map([['me', JUMPING]]));
		const me = findPenguin(world, 'me');
		if (!me) throw new Error('no penguin');
		let highest = 0;
		for (let i = 0; i < 200 && me.height > 0; i++) {
			step(world, new Map());
			highest = Math.max(highest, me.height);
		}
		expect(highest).toBeGreaterThan(JUMP_APEX);
	});
});

describe('the sea against the jump', () => {
	it('leaves every gap crossable WITHOUT the second jump', () => {
		// The flap is the margin, not the plan: a child who never discovers it must still be able to
		// play the mode. So the map is laid out against the single-jump range, and this is the test
		// that keeps it that way when somebody tunes the jump.
		for (let seed = 0; seed < 60; seed++) {
			const floes = layout(ROYAL_PLAYERS, seed * 977 + 3);
			for (const floe of floes) {
				if (floe.sinkAtTick === Infinity) continue;
				const nearest = floes
					.filter((other) => other.id !== floe.id)
					.map((other) => gapBetween(floe, other))
					.sort((a, b) => a - b)[0];
				expect(nearest).toBeLessThanOrEqual(JUMP_RANGE);
			}
		}
	});

	it('gives a comfortable margin once the flap is used', () => {
		// How much easier the second jump makes the same gap: a good half a penguin's length of
		// slack, which is what turns "mistimed by a tenth of a second" from a drowning into a scare.
		const singleReach = WALK_SPEED * JUMP_AIRTIME;
		const doubleReach = WALK_SPEED * DOUBLE_JUMP_AIRTIME;
		expect(doubleReach - singleReach).toBeGreaterThan(0.8);
	});
});
