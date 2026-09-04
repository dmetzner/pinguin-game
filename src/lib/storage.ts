/**
 * The guarded read/write every persisted value goes through.
 *
 * `localStorage` is not reliably available: Safari in private browsing throws on write, a locked-down
 * school tablet can have it disabled entirely, and both are exactly this audience. None of what is
 * stored here is important enough to interrupt a game for — a hat is not a save file — so every
 * failure degrades to "the default look, this session only" rather than to an exception on the way
 * to the first frame.
 */
import type { StorageKey } from './storageKeys';

function available(): Storage | null {
	try {
		// The access itself can throw, which is why this is inside the try rather than a typeof check.
		return globalThis.localStorage ?? null;
	} catch {
		return null;
	}
}

/** Read and parse, or fall back. Anything malformed is treated as absent. */
export function readJson<T>(key: StorageKey, fallback: T): T {
	const store = available();
	if (!store) return fallback;
	try {
		const raw = store.getItem(key);
		return raw === null ? fallback : (JSON.parse(raw) as T);
	} catch {
		return fallback;
	}
}

/** Write, or shrug. Returns whether it stuck, for the rare caller that wants to know. */
export function writeJson(key: StorageKey, value: unknown): boolean {
	const store = available();
	if (!store) return false;
	try {
		store.setItem(key, JSON.stringify(value));
		return true;
	} catch {
		return false;
	}
}
