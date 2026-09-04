import { describe, expect, it } from 'vitest';
import { STORAGE_NAMESPACE } from './brand';
import { retiredKeys, storageKeys } from './storageKeys';

/**
 * The rule `storageKeys.ts` states about itself, made enforceable.
 *
 * That file's whole point is that **an existing value is never edited**, because changing a key does
 * not migrate anything — it strands whatever was saved under the old one, silently, for every player
 * who already had it. A comment saying so is worth having and cannot fail; these can.
 */
describe('persisted keys', () => {
	it('never reuses a name that an older build already wrote', () => {
		// The expensive mistake is not deleting a key, it is RESURRECTING one. `floe.mode` held the
		// mode a child last chose, back when a mode was picked by a button beside the game; `floe.royal`
		// held a boolean from when there were two modes and one of them was a flag. Both are still on
		// the device of anybody who played an earlier build, so a future key that happens to pick the
		// same name gets a value from a different era of the game — and the read SUCCEEDS, which is
		// what makes it worse than a crash.
		const live = new Set<string>(Object.values(storageKeys));
		for (const dead of retiredKeys) {
			expect(live.has(dead), `${dead} is retired and must never be a live key again`).toBe(false);
		}
	});

	it('and the two lists are not empty, so neither loop passes by having nothing to do', () => {
		// A `for` over an empty array passes forever, which is the same way a `.not.toMatch` against a
		// pattern that matches nothing passes forever. `purity.test.ts` guards itself this way and so
		// does `brand.test.ts`.
		expect(Object.keys(storageKeys).length).toBeGreaterThan(2);
		expect(retiredKeys.length).toBeGreaterThan(1);
	});

	it('keeps every key inside the namespace that carries no product name', () => {
		// Invariant 5, and the reason a sibling project is a cautionary tale: its repository name and
		// every one of its stored keys still carry a codename it outgrew, because the keys were
		// written before the name settled. Retired names are checked too — a poisoned name outside the
		// namespace would mean an older build had written outside it.
		for (const value of [...Object.values(storageKeys), ...retiredKeys]) {
			expect(value.startsWith(`${STORAGE_NAMESPACE}.`)).toBe(true);
		}
	});
});
