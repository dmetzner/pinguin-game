import { afterEach, describe, expect, it } from 'vitest';
import {
	EIS_FOR_FINISHING,
	EIS_FOR_WINNING,
	earn,
	eisFor,
	myEis,
	readSave,
	SAVE_VERSION
} from './eis';
import { storageKeys } from './storageKeys';

/**
 * The wallet: what a round pays, and the ways a browser can refuse to hold the answer.
 *
 * The payout half is pure arithmetic and the persistence half is `storage.ts`'s discipline applied to
 * a second kind of value, so both are testable without a DOM — which is the whole reason the wallet
 * is a module in `lib/` rather than a field on a `World`.
 */

/** Install a `localStorage` for the length of one test. The same shape `storage.test.ts` uses. */
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

/** A store with something already in it, written the way a browser would have written it. */
function storageHolding(raw: string): Storage {
	const store = memoryStorage();
	store.setItem(storageKeys.island, raw);
	return store;
}

afterEach(() => withStorage(null));

describe('what a round pays', () => {
	it('pays for FINISHING, so six losses in a row are still progress', () => {
		// The one rule in this feature that is about how a child feels: Eis never comes from winning
		// alone. An eight-year-old who loses every round for an afternoon has to end up with something,
		// or the games are work.
		expect(eisFor({ finished: true, won: false })).toBe(EIS_FOR_FINISHING);
		expect(eisFor({ finished: true, won: false })).toBeGreaterThan(0);
	});

	it('pays more for winning, as a bonus ON TOP rather than instead', () => {
		// Asserted as the sum of the two exported constants rather than against a copied 10, so the
		// numbers and the sentence describing them cannot drift — the shape is "finishing plus a bonus",
		// and a build that made winning its own separate payout would fail here.
		expect(eisFor({ finished: true, won: true })).toBe(EIS_FOR_FINISHING + EIS_FOR_WINNING);
	});

	it('keeps a loser earning at a rate that is visibly progress but not the point', () => {
		// The RATIO is the decision, not either number. Derived from the constants: raise the win bonus
		// far enough that losing stops mattering and this fails.
		const losing = EIS_FOR_FINISHING;
		const winning = EIS_FOR_FINISHING + EIS_FOR_WINNING;
		expect(losing / winning).toBeGreaterThan(0.2);
		expect(losing / winning).toBeLessThan(0.5);
	});

	it('pays nothing for a round that never ended', () => {
		// A host who walked out, or a phone put down mid-Royal. Being ELIMINATED is not this case: that
		// player is on the result screen when the round ends and has finished it.
		expect(eisFor({ finished: false, won: false })).toBe(0);
		expect(eisFor({ finished: false, won: true })).toBe(0);
	});
});

describe('keeping it', () => {
	it('starts a child who has never played at nothing', () => {
		withStorage(memoryStorage());
		expect(myEis()).toBe(0);
	});

	it('adds up across rounds and hands back the new total', () => {
		withStorage(memoryStorage());
		expect(earn(eisFor({ finished: true, won: false }))).toBe(EIS_FOR_FINISHING);
		expect(earn(eisFor({ finished: true, won: true }))).toBe(
			EIS_FOR_FINISHING * 2 + EIS_FOR_WINNING
		);
		expect(myEis()).toBe(EIS_FOR_FINISHING * 2 + EIS_FOR_WINNING);
	});

	it('writes one blob under one key, with its version in it', () => {
		const store = memoryStorage();
		withStorage(store);
		earn(4);
		const raw = store.getItem(storageKeys.island);
		expect(raw).not.toBeNull();
		expect(JSON.parse(raw ?? '')).toEqual({ version: SAVE_VERSION, eis: 4 });
		// And nothing else: a wallet spread across several keys is a wallet that can be half-written.
		expect(store.length).toBe(1);
	});
});

describe('sharing one blob with the igloo', () => {
	// The bug this whole describe exists for: `earn` wrote `{ version, eis }`, which is a complete
	// REPLACEMENT of the blob, so the first round finished after buying a room deleted the room. It
	// would not have read as a wallet bug — it would have read as the igloo not saving, in a build where
	// the igloo code was correct. Every assertion that existed before this passed the whole time, which
	// is the point: a partial write to a shared object is invisible to every test of the part it writes.
	const HOUSE = { rooms: [{ size: 2, at: { x: 1, z: 0 } }], deko: [] };

	it('keeps a field it does not own when Eis is credited', () => {
		withStorage(storageHolding(JSON.stringify({ version: SAVE_VERSION, eis: 5, igloo: HOUSE })));
		earn(EIS_FOR_FINISHING);
		expect(readSave().igloo).toEqual(HOUSE);
		expect(myEis()).toBe(5 + EIS_FOR_FINISHING);
	});

	it('writes it back BYTE FOR BYTE rather than reconstructing it', () => {
		// Opaque means opaque: this file must not coerce, clamp, reshape or drop anything inside a field
		// another module owns — including shapes it would consider nonsense, because the day it thinks it
		// understands the igloo is the day a rename here loses somebody's house.
		for (const igloo of [HOUSE, 'a string', 42, [], null, { unknown: { nested: true } }]) {
			withStorage(storageHolding(JSON.stringify({ version: SAVE_VERSION, eis: 1, igloo })));
			earn(1);
			expect(readSave().igloo, JSON.stringify(igloo)).toEqual(igloo);
		}
	});

	it('survives round after round, which is how the bug would have been met', () => {
		withStorage(storageHolding(JSON.stringify({ version: SAVE_VERSION, eis: 0, igloo: HOUSE })));
		for (let round = 0; round < 5; round++) earn(eisFor({ finished: true, won: false }));
		expect(readSave().igloo).toEqual(HOUSE);
		expect(myEis()).toBe(EIS_FOR_FINISHING * 5);
	});

	it('does not invent the field on a save that never had one', () => {
		// The other half. A save from before the igloo existed must stay exactly as small as it was — an
		// empty `igloo` key written by the wallet is the wallet claiming to own it.
		const store = memoryStorage();
		withStorage(store);
		earn(3);
		expect(JSON.parse(store.getItem(storageKeys.island) ?? '')).toEqual({
			version: SAVE_VERSION,
			eis: 3
		});
	});
});

describe('a save this build cannot read', () => {
	it('returns a fresh island for a version it does not understand', () => {
		// The ordinary path when the shape changes, and the reason the blob carries a version at all:
		// a child running an older build meets a newer save and starts again rather than crashing.
		withStorage(storageHolding(JSON.stringify({ version: SAVE_VERSION + 1, eis: 500 })));
		expect(myEis()).toBe(0);
	});

	it('returns a fresh island for a blob that is not an island at all', () => {
		// Truncated by a browser, hand-edited in a console, or written by a build that used this name
		// for something else — which is exactly what `retiredKeys` in `storageKeys.ts` exists to stop
		// happening on purpose.
		for (const raw of ['null', '7', '"eis"', '[]', '{', 'true']) {
			withStorage(storageHolding(raw));
			expect(myEis(), raw).toBe(0);
		}
	});

	it('clamps a number that would print as ∞ in the corner of the screen', () => {
		// Written as RAW JSON rather than through `JSON.stringify`, because that is the only way this
		// value can exist: `1e309` parses to Infinity, and stringifying Infinity produces `null` — so a
		// blob that came from a hand-edited console really does hold the exponent, and the round trip
		// cannot reproduce it. Unclamped it puts "∞ Eis" on the HUD and then loses the value entirely on
		// the next write.
		withStorage(storageHolding(`{"version":${SAVE_VERSION},"eis":1e309}`));
		const held = myEis();
		expect(Number.isFinite(held)).toBe(true);
		expect(held).toBeGreaterThanOrEqual(0);
	});

	it('clamps everything else a stored total should not be', () => {
		for (const eis of [-20, Number.NaN, 3.7, 'lots', null]) {
			withStorage(storageHolding(JSON.stringify({ version: SAVE_VERSION, eis })));
			const held = myEis();
			expect(Number.isInteger(held), String(eis)).toBe(true);
			expect(held, String(eis)).toBeGreaterThanOrEqual(0);
		}
	});

	it('keeps a whole number of Eis rather than a fraction of one', () => {
		withStorage(storageHolding(JSON.stringify({ version: SAVE_VERSION, eis: 3.7 })));
		expect(myEis()).toBe(3);
	});
});

describe('a browser that will not hold it', () => {
	it('reads as nothing where there is no localStorage at all', () => {
		// A locked-down school tablet, squarely this audience. `storage.ts` is what makes this a
		// one-liner; the point of asserting it here is that a missing store must not throw on the way to
		// the first frame of a hub that wants to draw the number.
		withStorage(null);
		expect(myEis()).toBe(0);
	});

	it('still counts what was earned this session when the write cannot stick', () => {
		// Safari in private browsing throws on `setItem`. The child watches the number go up for the
		// rest of the session and loses it on reload, which is the same bargain a hat makes — and far
		// better than an exception at the moment they won something.
		withStorage({
			...memoryStorage(),
			setItem: () => {
				throw new DOMException('QuotaExceededError');
			}
		});
		expect(() => earn(10)).not.toThrow();
		expect(earn(10)).toBe(10);
	});

	it('does not throw when the store itself is unreachable', () => {
		// Some embedded browsers throw on the property ACCESS rather than on the call.
		withStorage(() => {
			throw new DOMException('SecurityError');
		});
		expect(() => earn(3)).not.toThrow();
		expect(myEis()).toBe(0);
	});
});
