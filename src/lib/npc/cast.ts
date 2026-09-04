/**
 * The penguins who live on the island, as characters rather than as opposition.
 *
 * Everywhere else in this game the other penguins are a crowd: names and colours drawn from the
 * round seed, so a rematch brings a different eight and nothing is lost. A hub is the opposite kind
 * of place. A child comes back to it every session, and the whole reason story 10 argues an island
 * beats a mode switch is that a place has people in it — which only works if they are the SAME
 * people. So the cast is hand-written, stable across every visit, and each of them owns a corner of
 * the island and something to say about it.
 *
 * **They are not a new kind of entity.** An islander is still a bot, which is still a thing that
 * returns an `InputFrame` (`sim/bot.ts`), still wandering with `BotStyle` `'roam'`, still stepped by
 * the same tick as everybody else. This file adds a name, a look and a voice on TOP of a penguin the
 * simulation already had, and nothing in `sim/` knows it exists — which is what keeps the island
 * replayable and keeps a character out of the physics.
 *
 * The ORDER of the list is load-bearing and is the one thing to be careful with: see `islanderAt`.
 */
import type { PenguinLook } from '../look';
import { nameFromSeed } from '../names';

/**
 * Who this is, internally. Never player-visible; the name is.
 *
 * English like every other id in the codebase, and stable, because the mission board keys on it and
 * a saved mission outlives a rename of the copy.
 */
export type IslanderId =
	| 'racer'
	| 'gondolier'
	| 'lookout'
	| 'shopkeeper'
	| 'neighbour'
	| 'professor'
	| 'joker'
	| 'granny'
	| 'chick';

export interface Islander {
	readonly id: IslanderId;
	/**
	 * The seed their name is drawn from, and the reason there is a seed here at all.
	 *
	 * The name is NOT typed out. `names.ts` is the only source of a player-visible penguin name in
	 * this game and `docs/DECISIONS/0004` is why — a hand-written name here would be the first
	 * exception to that rule, and the second one is always easier than the first. So each character
	 * gets a fixed seed, hand-picked so the generator hands back a name that suits them, and the name
	 * below is DERIVED. It cannot drift out of the curated space, because it never left it.
	 *
	 * The cost, stated so it is not a surprise: growing either word list re-rolls the whole cast. That is
	 * survivable precisely because no line of copy ever says a character's name — the bubble prints
	 * it, the lines do not.
	 */
	readonly seed: number;
	/** From the generator, at module load. See `seed`. */
	readonly name: string;
	/**
	 * Their colours and hat, fixed.
	 *
	 * Stable for the same reason the name is, and spread across the BODY palette specifically: that is
	 * the set `look.ts` measured for separability at arena distance, including without hue, so a
	 * distinct body is a penguin a child can tell apart across the square before any tag is readable.
	 *
	 * There are eight bodies and the cast is longer than that, so exactly one colour is used twice —
	 * by two characters who live at opposite ends of the island and wear different hats. `cast.test.ts`
	 * holds both halves of that: the palette is spent before anything repeats, and no two characters
	 * sharing a body share a home.
	 */
	readonly look: PenguinLook;
	/**
	 * The `IslandZone.id` they belong to.
	 *
	 * Where they SPAWN, and what they mostly have opinions about — not a leash. They roam like any
	 * other wanderer, and what they talk about follows their feet rather than this field (see
	 * `lines.ts`): a penguin standing on the square explaining the seal cave would be a penguin
	 * reciting rather than talking.
	 */
	readonly home: string;
}

/** A character before its name has been drawn. The list below is written in this shape and mapped. */
interface CastEntry extends Omit<Islander, 'name'> {}

/**
 * The cast, IN SPAWN ORDER, and that is the constraint that decides the order of this list.
 *
 * `sim/island.spawnOnTheIsland` deals penguins round the zones one at a time starting at the square,
 * and the player is always index 0 (`Game.svelte` builds its roster as `[me, ...bots]`). So penguin
 * index 1 lands at the first zone after the square, 2 at the second, and the deal wraps at
 * `ISLAND_ZONES.length`. Writing the cast in that same order is what makes the first frame of the
 * island a TOWN: everybody is standing where they belong, before anybody has taken a step.
 *
 * **The list is deliberately one longer than a solo island shows.** `ISLAND.players.solo` is nine —
 * the player and eight — so `chick` at the end waits for a tenth penguin, which `players.max` of
 * twelve already allows. That is the cheap way round the arithmetic: the deal wraps every
 * `ISLAND_ZONES.length` penguins, so a cast sized exactly to the solo game has to drop somebody
 * whenever a zone is added, and dropping a character to make room for a zone is a content decision
 * being forced by a modulus.
 *
 * `cast.test.ts` asserts the alignment against the real spawn rather than against this comment, over
 * a roster long enough to reach every character — so the day somebody re-orders `ISLAND_ZONES` the
 * test says which character ended up in the sea lion's cave rather than on their neighbour's
 * doorstep. It has already earned it once: `Mein Iglu` arrived as a sixth zone while this file was
 * being written, and the three assertions derived from `ISLAND_ZONES` went red the same afternoon.
 */
const CAST: readonly CastEntry[] = [
	// Eisarena. Competitive, out of breath, entirely happy about it.
	{ id: 'racer', seed: 49, home: 'arena', look: { body: 3, beak: 0, hat: 'cap', hatColour: 4 } },
	// Der Berg. Runs the gondola, talks like a sea captain, has never been to sea.
	{
		id: 'gondolier',
		seed: 256,
		home: 'mountain',
		look: { body: 0, beak: 2, hat: 'bobble', hatColour: 1 }
	},
	// Robbenhöhle. Keeps watch, from a safe distance, and would rather not.
	{ id: 'lookout', seed: 31, home: 'cave', look: { body: 7, beak: 3, hat: 'none', hatColour: 1 } },
	// Der Laden. Sorting hats for a shop that has not opened yet.
	{
		id: 'shopkeeper',
		seed: 29,
		home: 'shop',
		look: { body: 4, beak: 1, hat: 'party', hatColour: 3 }
	},
	// Mein Iglu — the player's OWN doorstep, which is why this one is not a barker for anything. A
	// neighbour who is frankly a bit nosy about your house, and the warmer of the only two places in
	// the game that can tell a child that SPENDING exists at all (the other is the build button).
	{
		id: 'neighbour',
		seed: 50,
		home: 'igloo',
		look: { body: 5, beak: 2, hat: 'bobble', hatColour: 0 }
	},
	// Rathausplatz. Explains things. Warmly, and slightly too much.
	{
		id: 'professor',
		seed: 4,
		home: 'square',
		look: { body: 2, beak: 0, hat: 'bobble', hatColour: 5 }
	},
	// Eisarena, the second one. Tells jokes at people who are trying to warm up.
	{ id: 'joker', seed: 234, home: 'arena', look: { body: 6, beak: 2, hat: 'party', hatColour: 0 } },
	// Der Berg, the second one. On the peak, because of course she is.
	{
		id: 'granny',
		seed: 15,
		home: 'mountain',
		look: { body: 1, beak: 3, hat: 'crown', hatColour: 1 }
	},
	// Robbenhöhle, the second one. Small, brave in the wrong direction.
	{ id: 'chick', seed: 17, home: 'cave', look: { body: 5, beak: 1, hat: 'none', hatColour: 1 } }
];

/** The cast, with their names drawn. Built once: a fresh name per call is a stranger per frame. */
export const ISLANDERS: readonly Islander[] = CAST.map((entry) => ({
	...entry,
	name: nameFromSeed(entry.seed)
}));

const BY_ID = new Map<IslanderId, Islander>(ISLANDERS.map((one) => [one.id, one]));

/**
 * The islander at this position in `world.penguins`, or null.
 *
 * **Index 0 is the player**, so the cast starts at 1 — and a world with more penguins than the cast
 * has characters simply runs out, which is the honest answer: an unnamed wanderer is a penguin like
 * any other, and inventing a ninth character on the fly would give a child somebody who is different
 * every time they walk past.
 *
 * By index rather than by `Penguin.id` because the ids in a solo game are `bot1`..`bot8` and binding
 * a character to a string that exists only in `Game.svelte`'s rival list would be a second place that
 * has to agree about the roster. The index is what `spawnOnTheIsland` deals against, so it is the
 * thing the layout already guarantees.
 */
export function islanderAt(index: number): Islander | null {
	return index >= 1 ? (ISLANDERS[index - 1] ?? null) : null;
}

/** By id, for the mission board and the line pools. Null rather than throwing, per house style. */
export function islanderById(id: string): Islander | null {
	return BY_ID.get(id as IslanderId) ?? null;
}

const INDEX_BY_ID = new Map<IslanderId, number>(ISLANDERS.map((one, i) => [one.id, i + 1]));

/**
 * The exact inverse of `islanderAt`: which spot in `world.penguins` this character stands in.
 *
 * For the one caller that has a `Speech` (`npc/talk.ts`'s own `by`) and needs the PENGUIN it came
 * from — a look-at during a conversation has to turn toward somewhere, and `Speech` carries an id
 * rather than a position for the same reason `Islander.home` is a zone and not a leash: the position
 * moves every tick and the id does not. `-1` rather than throwing, for a `Speech` built by a test
 * against a character this cast has since dropped.
 */
export function indexOfIslander(id: IslanderId): number {
	return INDEX_BY_ID.get(id) ?? -1;
}
