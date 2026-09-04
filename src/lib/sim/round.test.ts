import { describe, expect, it } from 'vitest';
import { mainFloe } from './archipelago';
import { createBot } from './bot';
import {
	COUNTDOWN_TICKS,
	FLOE_MIN_RADIUS,
	FLOE_RADIUS,
	ROUND_MAX_TICKS,
	ROUND_OVER_TICKS,
	SHRINK_DONE_TICKS,
	SHRINK_START_TICKS,
	TICK_RATE
} from './constants';
import { alive, canRestart, floeRadiusAt } from './round';
import { type InputMap, step } from './step';
import { NO_INPUT, type World } from './types';
import { length } from './vec';
import { createWorld, findPenguin } from './world';

const IDLE: InputMap = new Map();

function run(w: World, ticks: number, inputs: InputMap = IDLE): void {
	for (let i = 0; i < ticks; i++) step(w, inputs);
}

/** Push a penguin into the water and wait for it to finish going. */
function drown(w: World, id: string): void {
	const p = findPenguin(w, id);
	if (!p) throw new Error(`no penguin ${id}`);
	p.pos = { x: 0, z: mainFloe(w).radius + 5 };
	while (p.phase !== 'out') step(w, IDLE);
}

describe('the countdown', () => {
	it('freezes everyone until it finishes', () => {
		const w = createWorld(['a', 'b'], 5);
		const a = findPenguin(w, 'a');
		if (!a) throw new Error('no penguin');
		const before = { ...a.pos };

		// Full stick, the whole countdown. Nothing may move — the floe is already wobbling, which is
		// the first thing a player should learn, but nobody is skating yet.
		const pushing: InputMap = new Map([['a', { ...NO_INPUT, move: { x: 1, z: 0 } }]]);
		run(w, COUNTDOWN_TICKS - 1, pushing);

		expect(w.round.phase).toBe('countdown');
		expect(a.pos.x).toBeCloseTo(before.x, 6);
		expect(a.pos.z).toBeCloseTo(before.z, 6);

		step(w, pushing);
		expect(w.round.phase).toBe('playing');

		run(w, 30, pushing);
		expect(a.pos.x).toBeGreaterThan(before.x + 0.2);
	});

	it('lets the floe wobble while it counts', () => {
		// Frozen inputs, not a frozen world. A still screen for two seconds would read as a hang.
		const w = createWorld(['a', 'b'], 5);
		run(w, 30);
		expect(length(mainFloe(w).slope)).toBeGreaterThan(0);
	});
});

describe('the shrinking floe', () => {
	it('holds its size, then shrinks, then stops at the floor', () => {
		expect(floeRadiusAt(0)).toBe(FLOE_RADIUS);
		expect(floeRadiusAt(SHRINK_START_TICKS)).toBe(FLOE_RADIUS);
		expect(floeRadiusAt(SHRINK_START_TICKS + TICK_RATE)).toBeLessThan(FLOE_RADIUS);
		expect(floeRadiusAt(ROUND_MAX_TICKS)).toBe(FLOE_MIN_RADIUS);
	});

	it('reaches the floor inside a round, at the pace the design asks for', () => {
		// Asserted against the DERIVED SHRINK_DONE_TICKS rather than either hand-written number,
		// because the first version of the constant's comment disagreed with its own arithmetic: it
		// claimed "about 26 s of shrinking" for a rate that consumed the ice in 11.5 s, giving
		// 30–45 s rounds against the 60–90 s in `docs/DESIGN.md`.
		let measured = SHRINK_START_TICKS;
		while (floeRadiusAt(measured) > FLOE_MIN_RADIUS && measured < ROUND_MAX_TICKS) measured++;
		expect(measured).toBeCloseTo(SHRINK_DONE_TICKS, -1);

		// It has to bite well before the backstop, and not so early that a round is over in half a
		// minute — nobody would ever see the penguin they customised in phase 2.
		expect(SHRINK_DONE_TICKS).toBeLessThan(ROUND_MAX_TICKS * 0.8);
		expect(SHRINK_DONE_TICKS / TICK_RATE).toBeGreaterThan(35);
	});

	it('tips harder for the same crowd offset as it shrinks', () => {
		// The interaction story 02 asks to VERIFY rather than assume: weight tilt is normalised by
		// the radius, so a penguin two metres off-centre leans a small floe more than a large one.
		// It makes the endgame livelier for free — worth knowing, and worth a test so that a future
		// change to `weightTargetSlope` cannot quietly remove it.
		const wide = createWorld(['a'], 1);
		const tight = createWorld(['a'], 1);
		mainFloe(tight).radius = FLOE_MIN_RADIUS;
		for (const w of [wide, tight]) {
			const p = findPenguin(w, 'a');
			if (!p) throw new Error('no penguin');
			p.pos = { x: 2, z: 0 };
		}
		run(wide, COUNTDOWN_TICKS + 200);
		run(tight, COUNTDOWN_TICKS + 200);
		expect(Math.abs(mainFloe(tight).weightSlope.x)).toBeGreaterThan(
			Math.abs(mainFloe(wide).weightSlope.x)
		);
	});
});

describe('ending', () => {
	it('ends immediately with a single player', () => {
		// A solo round has already been won by the only person in it; sitting in `playing` forever
		// would leave the practice floe with no way out.
		const w = createWorld(['only'], 3);
		run(w, COUNTDOWN_TICKS + 1);
		expect(w.round.phase).toBe('over');
		expect(w.round.winner).toBe('only');
	});

	it('names the last penguin standing', () => {
		const w = createWorld(['a', 'b', 'c'], 4);
		run(w, COUNTDOWN_TICKS + 1);
		expect(w.round.phase).toBe('playing');

		drown(w, 'b');
		expect(w.round.phase).toBe('playing');
		drown(w, 'c');

		expect(w.round.phase).toBe('over');
		expect(w.round.winner).toBe('a');
		expect(alive(w)).toEqual(['a']);
	});

	it('calls it a draw when the last two go in on the same tick', () => {
		// A draw rather than a crash, and rather than an arbitrary winner picked by array order.
		const w = createWorld(['a', 'b'], 6);
		run(w, COUNTDOWN_TICKS + 1);

		for (const id of ['a', 'b']) {
			const p = findPenguin(w, id);
			if (!p) throw new Error('no penguin');
			p.pos = { x: 0, z: mainFloe(w).radius + 5 };
		}
		while (w.round.phase === 'playing') step(w, IDLE);

		expect(w.round.phase).toBe('over');
		expect(w.round.winner).toBeNull();
		expect(alive(w)).toEqual([]);
	});

	it('ignores input once the round is over, but keeps the physics running', () => {
		// Two worlds from the same seed, one being pushed and one not. They must end up identical —
		// the input is ignored — while both still slide under the slope, because a world that froze
		// on the instant of victory would look like a crash rather than an ending.
		const pushed = createWorld(['only'], 3);
		const left = createWorld(['only'], 3);
		run(pushed, COUNTDOWN_TICKS + 1);
		run(left, COUNTDOWN_TICKS + 1);
		expect(pushed.round.phase).toBe('over');

		run(pushed, 90, new Map([['only', { ...NO_INPUT, move: { x: 1, z: 0 } }]]));
		run(left, 90);

		const a = findPenguin(pushed, 'only');
		const b = findPenguin(left, 'only');
		expect(a?.pos).toEqual(b?.pos);
		// And something did happen: the slope carried them somewhere.
		expect(length(a?.vel ?? { x: 0, z: 0 })).toBeGreaterThan(0);
	});

	it('offers a rematch only after the result has had a moment to land', () => {
		const w = createWorld(['only'], 3);
		run(w, COUNTDOWN_TICKS + 1);
		expect(canRestart(w)).toBe(false);
		run(w, ROUND_OVER_TICKS);
		expect(canRestart(w)).toBe(true);
	});

	it('always terminates, even with nobody doing anything', () => {
		// The backstop. Two cautious players on a shrinking floe must not circle each other forever,
		// and a test that can assert termination is what makes that a fact rather than a hope.
		const w = createWorld(['a', 'b', 'c', 'd'], 9);
		const bots = ['a', 'b', 'c', 'd'].map((id) => createBot(id, 'easy', w.seed));

		for (let i = 0; i < ROUND_MAX_TICKS + COUNTDOWN_TICKS + 10; i++) {
			if (w.round.phase === 'over') break;
			step(w, new Map(bots.map((b) => [b.id, b.think(w)])));
		}
		expect(w.round.phase).toBe('over');
	});
});
