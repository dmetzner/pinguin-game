/**
 * Every minigame this game has, as data.
 *
 * **This is the only module allowed to know which mode is which.** `modes/guard.test.ts` scans
 * `src/` for `=== 'classic'`-shaped comparisons and fails on any outside this directory, in the same
 * spirit as `sim/purity.test.ts` and `lib/brand.test.ts` — including the part where it proves itself
 * non-vacuous by being fed the violations it exists to catch.
 *
 * Adding the twenty-sixth minigame is meant to be: write a descriptor, add its id to `Mode`, list it
 * here. TypeScript enforces the second half — `MODES` is a total `Record<Mode, GameMode>`, so a
 * literal added to the union without a descriptor is a compile error rather than an
 * `undefined` at the first tick.
 */
import type { Mode } from '../types';
import { CHASE } from './chase';
import { CLASSIC } from './classic';
import { ISLAND } from './island';
import type { GameMode } from './mode';
import { ROYAL } from './royal';
import { SLIDE } from './slide';

export type { BotStyle, Door, Ending, Framing, GameMode, ModeCopy, Scenery } from './mode';
export { CHASE, CLASSIC, ISLAND, ROYAL, SLIDE };

/**
 * The register. Total over `Mode` by construction.
 *
 * Keys are on the wire (`net/protocol.ts`) and in storage (`lib/storageKeys.ts`), so an existing one
 * is never renamed — the same rule `storageKeys.ts` states for itself.
 */
const MODES: Record<Mode, GameMode> = {
	classic: CLASSIC,
	royal: ROYAL,
	slide: SLIDE,
	chase: CHASE,
	island: ISLAND
};

/**
 * What a world opens in when nobody said.
 *
 * The classic round, because it is the one every constant in the game was tuned against and the one
 * a stored preference from an older build degrades to.
 */
export const DEFAULT_MODE: Mode = CLASSIC.id;

/** Every mode, in a stable order. For anything that has to list them. */
export const ALL_MODES: readonly GameMode[] = Object.values(MODES);

/**
 * The descriptor for a mode. The one lookup.
 *
 * Total, so there is no fallback to reason about: `Mode` is the key set of `MODES`. Untrusted input —
 * a query string, a stored preference, a message from another device — goes through `resolveMode`
 * first, which is where the degrading happens.
 */
export function modeFor(id: Mode): GameMode {
	return MODES[id];
}

/** Is this a mode this build knows? The type guard `resolveMode` is built on. */
export function isModeId(value: unknown): value is Mode {
	return typeof value === 'string' && Object.hasOwn(MODES, value);
}

/**
 * Whatever arrived, as a mode this build can actually play.
 *
 * The one place unknown ids degrade, and they degrade rather than throwing. Three callers and three
 * reasons: a stored preference may have been written by an older build (this key held a BOOLEAN
 * before there were three modes), a query string may have been typed by a child, and a `welcome`
 * from another device may name a minigame that shipped after this one. A client meeting a newer
 * minigame plays the classic round; it does not die.
 */
export function resolveMode(value: unknown): Mode {
	return isModeId(value) ? value : DEFAULT_MODE;
}

/**
 * The order the mode button offers them in, and it is not every mode.
 *
 * A cycle rather than a row of buttons, because the row beside the game is already four wide on a
 * 568 px screen — and because a child finds a mode by pressing the thing again, not by reading a
 * menu. The island is deliberately NOT in it: it is the place the games are reached FROM, so
 * offering it as a fifth thing to cycle past would be the menu this cycle exists to avoid.
 */
export const MODE_CYCLE: readonly Mode[] = [CLASSIC.id, ROYAL.id, SLIDE.id, CHASE.id];

/** The one the button offers next. Anything off the cycle starts it again from the beginning. */
export function nextMode(id: Mode): Mode {
	const at = MODE_CYCLE.indexOf(id);
	return MODE_CYCLE[(at + 1) % MODE_CYCLE.length] ?? DEFAULT_MODE;
}
