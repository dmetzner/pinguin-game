/**
 * Every key this game persists. The whole list, in one place.
 *
 * **Never edit an existing value.** Changing a key does not migrate anything — it strands whatever
 * was saved under the old one, silently, for every player who already had it. Adding a key is free;
 * renaming one is a data loss with no error message.
 *
 * The namespace is `floe.`, which is domain-descriptive and contains no product name. That is
 * invariant 5, and a sibling project is the cautionary tale: its repository name and every one of
 * its stored keys still carry a codename it outgrew, because the keys were written before the name
 * settled. `brand.test.ts` and `storage.test.ts` enforce it here.
 */
import { STORAGE_NAMESPACE } from './brand';

const key = (name: string) => `${STORAGE_NAMESPACE}.${name}`;

export const storageKeys = {
	/** The player's chosen colours and hat — a `PenguinLook`, JSON. */
	look: key('look'),
	/** The player's chosen name, a string from the generator in `names.ts`. Never free text. */
	name: key('name'),
	/** Whether the player has turned the sound off. Boolean, JSON. */
	muted: key('muted'),
	/**
	 * The island save: one key, one JSON blob, one version field. See `lib/eis.ts` for the shape.
	 *
	 * Eis is all it holds today and story 12 adds the igloo and what has been bought to the same
	 * object — one key rather than a key per fact, because a wallet and the igloo it paid for must
	 * never be half-written.
	 *
	 * The `.v1` in the name is the nuclear option and is not to be bumped for an ordinary change: the
	 * blob carries its own `version`, and a version this build does not understand reads as a fresh
	 * island. Bumping the KEY strands the old blob deliberately — for the day the shape is
	 * unrecognisable and a later build might still want to migrate it — and the old name goes on the
	 * retired list below rather than being reused.
	 */
	island: key('island.v1'),
	/**
	 * Has this device seen the landing screen and pressed "Los geht's!" on it.
	 *
	 * Boolean, JSON. Written once, the first time somebody presses through — never on the query-string
	 * deep links `e2e/` and `shots.spec.ts` use, which is what `routes/+page.svelte` reads this
	 * against rather than gating on it directly. `docs/DESIGN.md` §6 asks for a child playing within
	 * two seconds, and this key is the whole reason that promise survives having a landing screen at
	 * all: it is paid once per device, not once per visit.
	 */
	landingSeen: key('landing-seen')
} as const;

/**
 * Values that were persisted once and must never be reused.
 *
 * Not a list of keys to read — a list of names that are POISONED. Anybody who played an earlier build
 * still has these on their device, so giving one of them a new meaning is the same data loss as
 * renaming a live key, only harder to see: the read succeeds and returns something from a different
 * era of the game.
 *
 *  * `floe.royal` — a boolean, from when there were two modes and one of them was a flag.
 *  * `floe.mode` — the mode the player last chose, from when a mode was picked by a button beside the
 *    game. The island replaced it: the front door is a PLACE now, and a child who loved the mountain
 *    yesterday walks to the mountain today rather than being teleported onto it. The value was still
 *    being WRITTEN after nothing read it any more, which is worse than dead code — a value written to
 *    a child's device that nothing will ever look at again.
 *
 * Retired here rather than deleted in silence, because the knowledge that a name is taken is the part
 * that is expensive to rediscover.
 */
export const retiredKeys = [key('royal'), key('mode')] as const;

export type StorageKey = (typeof storageKeys)[keyof typeof storageKeys];
