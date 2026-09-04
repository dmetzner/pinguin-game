/**
 * Making a world, and reading facts back out of one.
 *
 * The only construction path. A `World` assembled by hand somewhere else is a world whose invariants
 * nobody checked — and the one that matters most is that the seed is recorded, because a round that
 * cannot be replayed cannot be debugged and, from phase 3, cannot be agreed on by two devices.
 *
 * It used to choose the sea and the spawn with a nested ternary over the mode. Both are now the
 * mode's own answer (`sim/modes/`), which is why adding the island added no branch here.
 */
import { DEFAULT_MODE, modeFor } from './modes/registry';
import { createRound } from './round';
import type { Mode, Penguin, World } from './types';

// The one definition of what a fresh penguin is. It lives in `spawn.ts` so that a mode descriptor can
// build an arrangement out of it without `sim/modes/` and this file importing each other; it is
// re-exported because this is where every caller has always found it.
export { spawnPenguin } from './spawn';

/**
 * A world, ready for its first tick.
 *
 * Three things come from the mode and nothing else does: the ice, where everybody stands on it, and
 * whatever else a fresh one needs — the chase's hunter headstart being the only example so far.
 */
export function createWorld(
	ids: readonly string[],
	seed: number,
	mode: Mode = DEFAULT_MODE
): World {
	const game = modeFor(mode);
	const floes = game.floes(seed, ids.length);
	const penguins: Penguin[] = game.spawn(ids, floes, seed);

	const world: World = {
		tick: 0,
		seed,
		mode,
		round: createRound(game.opening),
		hunterAt: 0,
		floes,
		penguins,
		snowballs: [],
		nextSnowballId: 1,
		// The ids the layout already used, so a piece can never collide with a floe that is still
		// whole.
		nextFloeId: floes.length
	};
	game.open(world);
	return world;
}

/**
 * The penguin with this id, or undefined.
 *
 * Use this rather than `penguins[0]`, even when there is only one. In phase 0 the local player IS
 * index 0 by construction; the moment bots join, index 0 is whichever spawn slot the array happened
 * to build first, and the failure is quiet — the HUD reports a bot's speed and the respawn revives
 * a bot instead of the player.
 */
export function findPenguin(world: World, id: string): Penguin | undefined {
	return world.penguins.find((p) => p.id === id);
}
