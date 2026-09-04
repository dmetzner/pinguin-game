import { afterEach, describe, expect, it } from 'vitest';
import { STORAGE_NAMESPACE } from './brand';
import { readJson, writeJson } from './storage';
import { storageKeys } from './storageKeys';

const LOOK_KEY = storageKeys.look;
const NAME_KEY = storageKeys.name;

/**
 * Install a `localStorage` for the length of one test.
 *
 * The suite runs in the `node` environment, where there is no `localStorage` at all — which is
 * itself one of the cases this module has to survive, so the absent case needs no stub.
 */
function withStorage(store: Storage | (() => never) | null): void {
	if (store === null) {
		Reflect.deleteProperty(globalThis, 'localStorage');
		return;
	}
	Object.defineProperty(globalThis, 'localStorage', {
		configurable: true,
		get: typeof store === 'function' ? store : () => store
	});
}

function memoryStorage(): Storage {
	const map = new Map<string, string>();
	return {
		get length() {
			return map.size;
		},
		clear: () => map.clear(),
		getItem: (k) => map.get(k) ?? null,
		key: (i) => [...map.keys()][i] ?? null,
		removeItem: (k) => void map.delete(k),
		setItem: (k, v) => void map.set(k, v)
	};
}

afterEach(() => withStorage(null));

describe('persisting a choice', () => {
	it('round-trips a value through a working store', () => {
		withStorage(memoryStorage());
		expect(writeJson(NAME_KEY, 'Hüpf Lotte')).toBe(true);
		expect(readJson(NAME_KEY, 'fallback')).toBe('Hüpf Lotte');
	});

	it('returns the fallback for a key nothing has written', () => {
		withStorage(memoryStorage());
		expect(readJson(LOOK_KEY, { body: 3 })).toEqual({ body: 3 });
	});
});

describe('when the browser will not cooperate', () => {
	it('degrades to the fallback when there is no localStorage at all', () => {
		// A locked-down school tablet, which is squarely this audience. The failure a player should
		// see is "my hat did not stick", never a blank screen on the way to the first frame.
		withStorage(null);
		expect(readJson(NAME_KEY, 'Standard')).toBe('Standard');
		expect(writeJson(NAME_KEY, 'egal')).toBe(false);
	});

	it('degrades when the property access itself throws', () => {
		// Not a hypothetical: some privacy configurations throw on the `localStorage` GETTER rather
		// than on the call, so a `typeof` guard outside a try block would itself be the crash.
		withStorage(() => {
			throw new Error('access denied');
		});
		expect(readJson(NAME_KEY, 'Standard')).toBe('Standard');
		expect(writeJson(NAME_KEY, 'egal')).toBe(false);
	});

	it('degrades when the write throws, as Safari private browsing does on a full quota', () => {
		const store = memoryStorage();
		store.setItem = () => {
			throw new Error('QuotaExceededError');
		};
		withStorage(store);
		expect(writeJson(NAME_KEY, 'egal')).toBe(false);
	});

	it('treats a malformed stored value as absent rather than throwing', () => {
		// How a value written by an older build, or edited by hand in devtools, has to behave.
		const store = memoryStorage();
		store.setItem(LOOK_KEY, '{ not json');
		withStorage(store);
		expect(readJson(LOOK_KEY, { body: 0 })).toEqual({ body: 0 });
	});
});

describe('the key list', () => {
	it('puts every key under the domain-descriptive namespace', () => {
		// Invariant 5, asserted over the LIST rather than over one key, so a key added later is
		// covered by the loop rather than by whoever remembers to extend an assertion.
		const keys = Object.values(storageKeys);
		expect(keys.length).toBeGreaterThan(0);
		for (const key of keys) expect(key.startsWith(`${STORAGE_NAMESPACE}.`)).toBe(true);
	});

	it('gives each key its own name', () => {
		// Two entries resolving to the same string would have one choice silently overwrite the
		// other — a bug that reads as "my hat keeps changing my name" and is unfindable from that.
		const keys = Object.values(storageKeys);
		expect(new Set(keys).size).toBe(keys.length);
	});
});
