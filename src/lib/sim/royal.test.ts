import { describe, expect, it } from 'vitest';
import { floeUnder } from './archipelago';
import { createBot } from './bot';
import { COUNTDOWN_TICKS, ROYAL_MAX_TICKS, ROYAL_PLAYERS, TICK_RATE } from './constants';
import { alive, isRoyal } from './round';
import { step } from './step';
import type { InputFrame, World } from './types';
import { NO_INPUT } from './types';
import { createWorld } from './world';

/**
 * Thirty penguins, all bots, played to the end.
 *
 * The unit tests around it check pieces; this checks the thing itself, because every interesting
 * failure in Pingu Royal is an interaction: bots that do not leave sinking ice, a sea that strands
 * somebody, a round that never ends because the last two are standing on different floes and cannot
 * reach each other.
 */
function playRoyal(seed: number, players = ROYAL_PLAYERS) {
	const ids = Array.from({ length: players }, (_, i) => `p${i}`);
	const world = createWorld(ids, seed, 'royal');
	const bots = ids.map((id) => createBot(id, 'normal', world.seed));
	const inputs = new Map<string, InputFrame>();

	/** Ticks at which somebody went in, so the pacing can be asserted rather than assumed. */
	const eliminations: number[] = [];
	let out = 0;

	while (world.round.phase !== 'over' && world.tick < COUNTDOWN_TICKS + ROYAL_MAX_TICKS + 60) {
		inputs.clear();
		for (const bot of bots) inputs.set(bot.id, bot.think(world));
		step(world, inputs);

		const nowOut = world.penguins.filter((p) => p.phase === 'out').length;
		for (let i = out; i < nowOut; i++) eliminations.push(world.tick);
		out = nowOut;
	}
	return { world, eliminations };
}

describe('a Royal, start to finish', () => {
	it('is a Royal because of the sea, not because of a flag', () => {
		// `isRoyal` asks how many floes there are. A stored mode could disagree with the world it
		// describes; this cannot.
		expect(isRoyal(createWorld(['a', 'b'], 1, 'royal'))).toBe(true);
		expect(isRoyal(createWorld(['a', 'b'], 1))).toBe(false);
	});

	it('ends, with a winner, inside its own clock', () => {
		const { world } = playRoyal(101);
		expect(world.round.phase).toBe('over');
		expect(alive(world).length).toBeLessThanOrEqual(1);
		// A draw is legal (the last two can go in together) but a Royal that runs to the backstop with
		// a crowd still standing means the sinking ring stopped herding anybody.
		expect(world.round.ticks).toBeLessThan(ROYAL_MAX_TICKS);
	});

	it('does not drown everybody the moment the first floe goes', () => {
		// The failure this mode is most likely to have: thirty bots that do not understand sinking ice
		// all go in within a second of each other, and the round is decided by the map. Spread is what
		// makes it a game — no single second may account for a third of the field.
		const { eliminations } = playRoyal(202);
		expect(eliminations.length).toBeGreaterThan(5);

		const perSecond = new Map<number, number>();
		for (const tick of eliminations) {
			const second = Math.floor(tick / TICK_RATE);
			perSecond.set(second, (perSecond.get(second) ?? 0) + 1);
		}
		const worst = Math.max(...perSecond.values());
		expect(worst).toBeLessThan(ROYAL_PLAYERS / 3);
	});

	it('finishes on the middle floe', () => {
		// The ring goes under and the middle does not, so whoever is left is standing on it. If a
		// survivor is anywhere else, a floe outlived its own sinking.
		const { world } = playRoyal(303);
		for (const p of world.penguins) {
			if (p.phase === 'out') continue;
			expect(floeUnder(world.floes, p.pos)?.id).toBe(0);
		}
	});

	it('replays exactly from the same seed', () => {
		// The determinism the whole of `sim/` exists for, over thirty penguins and a sea that changes
		// shape underneath them — which is where an unseeded value or a Map iteration order would
		// finally show up.
		const a = playRoyal(404);
		const b = playRoyal(404);
		expect(fingerprint(a.world)).toBe(fingerprint(b.world));
		expect(a.eliminations).toEqual(b.eliminations);
	});

	it('is a different round from a different seed', () => {
		// Non-vacuousness for the test above: identical worlds would satisfy it too.
		expect(fingerprint(playRoyal(404).world)).not.toBe(fingerprint(playRoyal(405).world));
	});

	it('gives a player who does nothing at all a chance to be taken by the ice', () => {
		// A penguin standing still on an outer floe must eventually be in the water — not because
		// anybody shoved it, but because the ice it is on leaves. That is the mode's whole pressure,
		// and if it is missing the round is just a bigger classic one.
		const ids = Array.from({ length: ROYAL_PLAYERS }, (_, i) => `p${i}`);
		const world = createWorld(ids, 606, 'royal');
		// Somebody who spawned out on the ring rather than in the middle — the middle never sinks, so
		// a penguin standing still there is taken by the shrink at the very end instead, which is the
		// classic ending and a different assertion.
		const idle = world.penguins.find((p) => floeUnder(world.floes, p.pos)?.id !== 0);
		expect(idle).toBeDefined();
		if (!idle) return;

		const inputs = new Map<string, InputFrame>();
		for (const id of ids) inputs.set(id, NO_INPUT);
		while (world.tick < COUNTDOWN_TICKS + ROYAL_MAX_TICKS && idle.phase !== 'out') {
			step(world, inputs);
		}
		expect(idle.phase).toBe('out');
	});
});

/** Enough of the world to tell two runs apart, rounded so float noise is not the subject. */
function fingerprint(world: World): string {
	return world.penguins
		.map((p) => `${p.id}:${p.phase}:${p.pos.x.toFixed(4)}:${p.pos.z.toFixed(4)}`)
		.join('|');
}
