/**
 * Who this player is: one name, one look, one place that decides.
 *
 * It exists because there were two. `Game.svelte` read the stored name with a clock-derived fallback
 * and `Room.svelte` read it with a fixed one, so a player who had never opened "Mein Pinguin"
 * appeared in the room as one penguin and on their own screen as another — and, worse, every such
 * player in a room appeared under the SAME name, because a fixed fallback is the same fixed fallback
 * on every device. Two identical tags in one round is the exact failure `names.ts` exists to
 * prevent.
 *
 * The name is generated once and KEPT. A fresh name on every visit sounds harmless and is not: a
 * child recognises their penguin by its name over its head, and one that changes each time they open
 * the app is not theirs.
 */
import { coerceLook, DEFAULT_LOOK, type PenguinLook } from './look';
import { nameFromSeed } from './names';
import { readJson, writeJson } from './storage';
import { storageKeys } from './storageKeys';

/**
 * The player's name, generated and stored the first time it is asked for.
 *
 * The seed is a clock, and `sim/` purity does not reach here — this is an identity, not part of the
 * world. It is drawn ONCE, and every later call returns what was drawn.
 */
export function myName(): string {
	const stored = readJson<string | null>(storageKeys.name, null);
	if (typeof stored === 'string' && stored.length > 0) return stored;
	const fresh = nameFromSeed(Date.now() & 0xffff);
	writeJson(storageKeys.name, fresh);
	return fresh;
}

/** The player's colours and hat, clamped rather than thrown away if an older build wrote them. */
export function myLook(): PenguinLook {
	return coerceLook(readJson(storageKeys.look, DEFAULT_LOOK));
}

/** Store a chosen look. The only writer, so a change cannot land under a key nothing reads. */
export function setMyLook(look: PenguinLook): void {
	writeJson(storageKeys.look, look);
}

/** Store a rolled name. */
export function setMyName(name: string): void {
	writeJson(storageKeys.name, name);
}

/** Whether the sound is off. Kept with the rest of what makes a device this player's. */
export function isMuted(): boolean {
	// `unknown`, not `boolean`: the `=== true` is coercing whatever is actually in storage, and
	// asserting the type it is defending against would be claiming the check is unnecessary.
	return readJson<unknown>(storageKeys.muted, false) === true;
}

export function setMuted(muted: boolean): void {
	writeJson(storageKeys.muted, muted);
}
