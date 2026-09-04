import { describe, expect, it } from 'vitest';
import { mainFloe } from './archipelago';
import { createBot, type Difficulty } from './bot';
import {
	BOT_AGGRESSION,
	BOT_REACTION_TICKS,
	COUNTDOWN_TICKS,
	FLOE_RADIUS,
	TICK_RATE
} from './constants';
import { type InputMap, step } from './step';
import type { World } from './types';
import { length } from './vec';
import { createWorld, findPenguin } from './world';

const LEVELS: Difficulty[] = ['easy', 'normal', 'hard'];

function arena(ids: string[], seed = 11): World {
	const w = createWorld(ids, seed);
	for (let i = 0; i < COUNTDOWN_TICKS + 1; i++) step(w, new Map());
	return w;
}

describe('a bot produces an input a thumb could have produced', () => {
	it.each(LEVELS)('never asks for more than a full stick (%s)', (level) => {
		// The contract, and the reason there is no "is this a bot" branch anywhere in `step`: a bot
		// hands over exactly what the joystick hands over. A move vector longer than 1 would be a
		// speed no player can request.
		const w = arena(['me', 'bot']);
		const bot = createBot('bot', level, w.seed);

		for (let i = 0; i < TICK_RATE * 20; i++) {
			const frame = bot.think(w);
			expect(length(frame.move)).toBeLessThanOrEqual(1 + 1e-9);
			expect(Number.isFinite(frame.move.x)).toBe(true);
			expect(Number.isFinite(frame.move.z)).toBe(true);
			step(w, new Map([['bot', frame]]));
		}
	});

	it('asks for nothing at all once it is in the water', () => {
		const w = arena(['me', 'bot']);
		const bot = createBot('bot', 'hard', w.seed);
		const p = findPenguin(w, 'bot');
		if (!p) throw new Error('no bot');
		p.phase = 'out';

		const frame = bot.think(w);
		expect(frame.move).toEqual({ x: 0, z: 0 });
		expect(frame.jump).toBe(false);
		expect(frame.dash).toBe(false);
	});
});

describe('a bot keeps its own footing', () => {
	it('heads for the middle when it drifts too far out', () => {
		// Self-preservation outranks aggression. Without that ordering bots chase players off the
		// edge and follow them in, which reads as broken rather than as easy.
		const w = arena(['me', 'bot']);
		const bot = createBot('bot', 'easy', w.seed);
		const p = findPenguin(w, 'bot');
		const me = findPenguin(w, 'me');
		if (!p || !me) throw new Error('missing penguin');

		// Parked near the rim, with the only rival standing further out still — the tempting
		// direction is outward.
		p.pos = { x: FLOE_RADIUS * 0.85, z: 0 };
		p.vel = { x: 0, z: 0 };
		me.pos = { x: FLOE_RADIUS * 0.98, z: 0 };
		mainFloe(w).slope = { x: 0, z: 0 };

		let inward = 0;
		for (let i = 0; i < 40; i++) {
			if (bot.think(w).move.x < 0) inward++;
			step(w, new Map());
			mainFloe(w).slope = { x: 0, z: 0 };
		}
		expect(inward).toBeGreaterThan(30);
	});

	it('survives a whole round more often than it falls in, on easy', () => {
		// Not a skill assertion — a sanity one. A bot that walks into the sea unprompted makes the
		// game look broken, and an easy bot is meant to be beatable, not suicidal.
		let survived = 0;
		for (let seed = 0; seed < 8; seed++) {
			const w = arena(['a', 'b'], seed);
			const bot = createBot('b', 'easy', w.seed);
			for (let i = 0; i < TICK_RATE * 25 && w.round.phase === 'playing'; i++) {
				step(w, new Map([['b', bot.think(w)]]));
			}
			if (findPenguin(w, 'b')?.phase === 'skating') survived++;
		}
		expect(survived).toBeGreaterThanOrEqual(6);
	});
});

describe('difficulty means something', () => {
	it('a hard bot beats an easy one more often than not', () => {
		// The property that actually matters, asserted end to end over a set of seeded rounds.
		//
		// The first version of this test counted how often the requested DIRECTION changed, on the
		// theory that a shorter reaction delay means more changes. It measured the wander term
		// instead and came out backwards — easy bots change direction far more, because their error
		// term is five times larger. Difficulty is not "how twitchy"; it is "who wins".
		let hardWins = 0;
		let decided = 0;

		for (let seed = 0; seed < 12; seed++) {
			const w = arena(['easy', 'hard'], seed);
			const bots = [createBot('easy', 'easy', w.seed), createBot('hard', 'hard', w.seed)];

			for (let i = 0; i < TICK_RATE * 80 && w.round.phase === 'playing'; i++) {
				step(w, new Map(bots.map((b) => [b.id, b.think(w)])));
			}
			if (w.round.winner === null) continue;
			decided++;
			if (w.round.winner === 'hard') hardWins++;
		}

		expect(decided).toBeGreaterThan(6);
		expect(hardWins / decided).toBeGreaterThan(0.5);
	});

	it('gives the easy setting the slowest reactions', () => {
		// The dial itself, so a re-tune that accidentally inverts the table is caught even when the
		// round-level test above happens to stay green.
		expect(BOT_REACTION_TICKS.easy).toBeGreaterThan(BOT_REACTION_TICKS.normal);
		expect(BOT_REACTION_TICKS.normal).toBeGreaterThan(BOT_REACTION_TICKS.hard);
		expect(BOT_AGGRESSION.easy).toBeLessThan(BOT_AGGRESSION.hard);
	});
});

describe('determinism', () => {
	it('replays a whole round against bots exactly', () => {
		// The property invariant 1 exists for, exercised end to end: same seed, same bots, same
		// world. A `Math.random()` anywhere in `bot.ts` breaks this and nothing else would notice.
		const play = () => {
			const w = createWorld(['a', 'b', 'c'], 4242);
			const bots = ['a', 'b', 'c'].map((id) => createBot(id, 'normal', w.seed));
			for (let i = 0; i < TICK_RATE * 30; i++) {
				const inputs: InputMap = new Map(bots.map((b) => [b.id, b.think(w)]));
				step(w, inputs);
			}
			return JSON.stringify(w);
		};
		expect(play()).toBe(play());
	});
});
