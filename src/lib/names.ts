/**
 * Where a penguin's name comes from.
 *
 * There is no text field, and there will not be one — `docs/DECISIONS/0004` argues it in full. The
 * short version: a name floats over a head where children see it, so a free-text field is a
 * broadcast channel to minors whatever it was called, and the commonest thing a child types is not
 * profanity but their own first name and their school.
 *
 * **The word lists ARE the deliverable.** A generator over a mediocre list produces mediocre names,
 * and children will rightly resent being unable to type their own; over a good one, re-rolling is
 * the toy. Both lists below are written for a German-speaking eight-year-old's sense of humour:
 * sounds over meanings, and nothing that needs explaining.
 *
 * Pure and seeded, like everything the simulation touches, so a round replays and a shared seed
 * gives the same table of names on every device.
 */
import { createRng, type Rng } from './sim/rng';

/**
 * The descriptor. Mostly sounds rather than adjectives — "Schlitter" and "Watschel" are funny
 * because of how they feel to say, which is the register this list is aiming at.
 */
const FIRST = [
	'Flitzer',
	'Turbo',
	'Wackel',
	'Schlitter',
	'Donner',
	'Blitz',
	'Frosti',
	'Zucker',
	'Krümel',
	'Nebel',
	'Purzel',
	'Keks',
	'Rakete',
	'Kicher',
	'Brumm',
	'Hüpf',
	'Schlingel',
	'Wirbel',
	'Knuffel',
	'Pfeffer',
	'Marzipan',
	'Kringel',
	'Schnorchi',
	'Tapsi',
	'Watschel',
	'Rumpel',
	'Zappel',
	'Schnuffel',
	'Pudding',
	'Kompass',
	'Kapitän',
	'Professor',
	'Baron',
	'Käpt’n'
] as const;

/**
 * The name. Short, so the tag over the head stays small, and chosen to sound like a penguin rather
 * than like a person — a few ordinary short names are in there because children like them, but the
 * list leans on the nonsense end.
 */
const SECOND = [
	'Fips',
	'Knirps',
	'Bommel',
	'Bibo',
	'Nuri',
	'Pim',
	'Bo',
	'Momo',
	'Lulu',
	'Pieps',
	'Wuschel',
	'Schnuppe',
	'Flocke',
	'Trude',
	'Emil',
	'Frida',
	'Otto',
	'Lotte',
	'Rudi',
	'Nala',
	'Bruno',
	'Elli',
	'Suse',
	'Jonte',
	'Mats',
	'Hanni',
	'Toni',
	'Willi',
	'Fiete',
	'Ronja',
	'Ida',
	'Nils',
	'Pauli',
	'Mücke'
] as const;

/** How many different names exist. Exported so the test asserts against it rather than a copy. */
export const NAME_COMBINATIONS = FIRST.length * SECOND.length;

/**
 * The longest a generated name can be, in characters.
 *
 * A cap rather than an observation: the tag over the head is a canvas texture sized to the text, and
 * a very long one both crowds the penguin and costs a wider texture. `names.test.ts` holds every
 * combination to it, so a word added to either list cannot quietly break the longest pairing.
 */
export const MAX_NAME_LENGTH = 18;

function pick<T>(list: readonly T[], rng: Rng): T {
	const item = list[Math.floor(rng.next() * list.length)];
	// `noUncheckedIndexedAccess` is on and the index is provably in range; this satisfies the type
	// without a non-null assertion, which the house style avoids.
	if (item === undefined) throw new Error('empty word list');
	return item;
}

/** A name from a seed. The same seed always gives the same name. */
export function nameFromSeed(seed: number): string {
	const rng = createRng(seed);
	return `${pick(FIRST, rng)} ${pick(SECOND, rng)}`;
}

/**
 * A sequence of distinct names, for filling a round's worth of penguins.
 *
 * Distinct because two identical tags in one round is the one failure a player actually notices,
 * and with 1156 combinations a collision in a field of six is likely enough to plan for (about a
 * 1.3% chance per round) without being worth a general solution.
 */
export function namesFromSeed(seed: number, count: number): string[] {
	const rng = createRng(seed);
	const names: string[] = [];
	// Bounded rather than `while (true)`: with this many combinations the loop cannot realistically
	// run long, but a list shortened by a future edit must not be able to hang the game.
	for (let attempt = 0; attempt < count * 40 && names.length < count; attempt++) {
		const name = `${pick(FIRST, rng)} ${pick(SECOND, rng)}`;
		if (!names.includes(name)) names.push(name);
	}
	// If the lists were ever made too small to fill the round, number the leftovers rather than
	// hand back a short array the caller has to check.
	while (names.length < count) names.push(`${pick(FIRST, rng)} ${names.length + 1}`);
	return names;
}
