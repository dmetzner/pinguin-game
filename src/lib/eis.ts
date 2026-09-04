/**
 * Eis: what a child has earned, and the island save it lives in.
 *
 * **This is deliberately not in `sim/`, and that is the whole design of it.** A `World` is pure and
 * replayable — the same seed is the same round on every device, which is what makes the simulation
 * testable, the bots single-code-path and phase 3's host/client agreement possible at all. A wallet
 * is the opposite kind of thing: it is one child's history, it differs per device, and it changes
 * without a tick. A round that read it would stop being replayable, and the failure would be
 * intermittent (`CLAUDE.md` invariant 1 lists that as the worst way for a networking bug to break).
 *
 * So the division is: the ROUND reports what happened — it ended, and who won — and this file decides
 * what that is worth. Nothing in `sim/` needed a new field for it, and deliberately: a price is not a
 * fact about a world. Putting `earned` on a `Result` would move economy arithmetic inside the pure
 * module and give two devices replaying one seed a number to disagree about, which is the same
 * category error as keeping the wallet there, one step smaller.
 *
 * **Nothing bought with this may ever change a penguin's speed, grip, jump or snowball.** That is a
 * hard line of the same kind as "no free text between players" (`docs/DECISIONS/0004`), and it is
 * written here, where the earning is, so nobody later reads its absence as an oversight. The audience
 * is 8–12: the child who has been playing for a week and the child who opened the app five minutes
 * ago have to be able to lose to each other. Deko is decoration and hats are hats.
 */
import { readJson, writeJson } from './storage';
import { storageKeys } from './storageKeys';

/**
 * The island save, version 1: one key holding one object, rather than a key per fact, because a wallet
 * and the igloo it paid for are one thing that must never be half-written.
 *
 * **Which is exactly how this file ate the igloo.** `earn` wrote `{ version, eis }` — a complete
 * replacement of the blob — so the first round a child finished after buying a room deleted their
 * house. It would not have surfaced as a wallet bug: it would have surfaced as the igloo feature
 * appearing not to save, in a build where the igloo code was correct. Found by the igloo engineer
 * reading this file before writing theirs, which is the only way it was ever going to be found before
 * it happened to a child.
 *
 * So every field this build does not own is CARRIED THROUGH untouched, and the rule for the next
 * person adding one is the same: a partial write to a shared blob is a delete of everything it left
 * out.
 */
export interface IslandSave {
	/** Which shape this blob is. See `SAVE_VERSION`. */
	readonly version: number;
	/** Eis in hand. A whole number, never negative. */
	readonly eis: number;
	/**
	 * Whatever `lib/igloo.ts` last wrote. **Opaque here: read, kept, written back, never inspected.**
	 *
	 * `unknown` rather than a shape, deliberately. This file has no business knowing what a room is,
	 * and typing it here would mean two modules owning one definition — the version of this bug that
	 * costs a rename instead of a house. Absent on a save from before the igloo existed, which reads as
	 * a fresh igloo and is the ordinary path.
	 */
	readonly igloo?: unknown;
}

/**
 * The version this build writes and the only one it reads.
 *
 * Two version markers exist and they do different jobs, which is worth saying once so neither gets
 * bumped for the other's reason:
 *
 *  * **The key** (`floe.island.v1`) is the nuclear option. Bumping it strands the old blob untouched,
 *    which is what you want the day the shape is unrecognisable and a future build might still want
 *    to migrate it. `storageKeys.ts` is where that decision is recorded, and the old name goes on the
 *    retired list rather than being deleted in silence.
 *  * **This field** is the ordinary path: a blob whose version this build does not understand reads
 *    as a FRESH island rather than throwing, which is `storage.ts`'s discipline — a store that
 *    misbehaves costs a hat, never the game.
 */
export const SAVE_VERSION = 1;

/** A child who has never played. Also what any save this build cannot read degrades to. */
const FRESH: IslandSave = { version: SAVE_VERSION, eis: 0 };

/**
 * The ceiling, and it is a display constraint rather than a game rule.
 *
 * A hand-edited or corrupted blob can hold `1e309`, which parses to `Infinity` and puts "∞ Eis" in
 * the corner of the screen; JSON round-tripping it produces `null` on the way back out. Clamped on
 * READ, so the number the interface prints is always a number. Ten million is far past anything the
 * payouts below can reach in a childhood.
 */
const EIS_MAX = 10_000_000;

/**
 * What finishing a round pays, and what winning one adds on top.
 *
 * **Eis comes from FINISHING, with a bonus for winning — never from winning alone.** An eight-year-old
 * who loses six rounds in a row has to end up with something, or the games become work: this is the
 * one number in the file that is about how a child feels rather than about how much anything costs.
 *
 * The RATIO is the decision, not the two values. A win is worth three and a third finishes, so a
 * child who never once wins still earns at 30% of the rate of a child who always does — enough that
 * an afternoon of losing is visibly progress, not enough that winning stops being the point. Ten for
 * a win and three for a loss are also numbers an eight-year-old can add up in their head, which is
 * why they are 3 and 7 rather than 4 and 11.
 *
 * Two things the story asks for are deliberately NOT here yet, and both are scope rather than
 * disagreement:
 *
 *  * **The first-round-of-the-day bonus.** It needs a clock and a stored date, it is the one part of
 *    this that cannot be tested without faking time, and a gift whose rule a child cannot see is not
 *    read as a gift. It wants its own story with the calendar edge cases (a timezone change, a device
 *    whose clock is wrong, midnight arriving mid-round) thought about once.
 *  * **The chase bonus for reaching the shore.** Mostly already paid: reaching the shore in a chase IS
 *    winning it (`chase.ts` ends the mode when somebody arrives), so it collects the win bonus. A
 *    per-mode top-up would need a price list keyed by mode outside `sim/modes/`, which is the table
 *    the registry refactor just finished deleting.
 */
export const EIS_FOR_FINISHING = 3;
export const EIS_FOR_WINNING = 7;

/** How a round ended, from the point of view of the player in front of the screen. */
export interface Outcome {
	/**
	 * Did the round actually end?
	 *
	 * True on the result screen and nowhere else. A round the host walked out of never finished, and a
	 * player who put the phone down mid-Royal has not earned anything yet — but a player who was
	 * eliminated in the first ten seconds and watched the rest from a chunk of ice HAS finished it, and
	 * that is the case this whole payout shape exists to serve.
	 */
	readonly finished: boolean;
	readonly won: boolean;
}

/** What that outcome is worth. Pure: the one place the payout shape is expressed. */
export function eisFor(outcome: Outcome): number {
	if (!outcome.finished) return 0;
	return EIS_FOR_FINISHING + (outcome.won ? EIS_FOR_WINNING : 0);
}

/**
 * The island save, as this build understands it.
 *
 * Coerced rather than trusted, in the same spirit as `look.ts`: a blob written by an older build, by a
 * hand in the developer console, or by a browser that truncated it is not a reason to fail on the way
 * to the first frame. Anything unrecognisable is a fresh island.
 */
export function readSave(): IslandSave {
	const stored = readJson<unknown>(storageKeys.island, null);
	if (typeof stored !== 'object' || stored === null) return FRESH;
	const save = stored as Partial<IslandSave>;
	// A version this build cannot read is not merged, it is REPLACED — including anything else in it.
	//
	// **Who pays, because that is the part worth knowing before improving this.** Not a developer with
	// two tabs open: the child most likely to hit it is the one on a school tablet serving a cached old
	// build, who played a newer one at home and comes back to a fresh island. That is a real loss to a
	// real player, and it is still the right trade — writing back bytes whose meaning this build does
	// not know, into a blob it is also editing, is how you CORRUPT a save rather than lose it, and a
	// corrupt save fails later, further away, and unexplainably.
	//
	// So: if you are here to make this kinder, the fix is not to merge unknown versions. It is to make
	// the key's version the nuclear option it is documented as (`storageKeys.ts`) so an unreadable blob
	// is left untouched under its own name for a build that can migrate it — never to write half-
	// understood data back into a blob this build is editing.
	if (save.version !== SAVE_VERSION) return FRESH;
	const eis = coerceEis(save.eis);
	// Carried, not rebuilt. `undefined` is not spread as a key, so a save from before the igloo existed
	// stays exactly as small as it was rather than growing an empty field.
	return save.igloo === undefined
		? { version: SAVE_VERSION, eis }
		: { version: SAVE_VERSION, eis, igloo: save.igloo };
}

/** Eis in hand. The one reader anything on screen goes through. */
export function myEis(): number {
	return readSave().eis;
}

/**
 * Add to the pile, and hand back the new total.
 *
 * Returns rather than being asked again, because the write may not have stuck — a locked-down tablet
 * or Safari in private browsing throws on `setItem` — and a child on that device should still watch
 * the number go up for the rest of the session. What they lose is the number surviving a reload, which
 * is the same bargain every other stored thing in this game makes.
 */
export function earn(eis: number): number {
	// ONE read, then the whole save written back with one field changed. The spread is the fix for the
	// bug in this file's docblock: `{ version, eis }` on its own is a complete replacement of the blob,
	// and every field somebody else owns disappears from it silently.
	const save = readSave();
	const total = coerceEis(save.eis + eis);
	writeJson(storageKeys.island, {
		...save,
		version: SAVE_VERSION,
		eis: total
	} satisfies IslandSave);
	return total;
}

/** A whole number of Eis, never negative, never past the ceiling, never `NaN`. */
function coerceEis(value: unknown): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
	return Math.min(EIS_MAX, Math.max(0, Math.floor(value)));
}
