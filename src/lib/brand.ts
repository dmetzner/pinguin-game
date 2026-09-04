/**
 * The only place the product name lives.
 *
 * Inherited wholesale from a sibling project, and specifically from the mistake it records: its
 * repository name, its codename and every one of its stored keys still disagree, because the keys
 * were written before the name settled and renaming them would have stranded real users' data behind
 * a key nothing reads.
 *
 * So: this repository is `pinguin-game`, the codename is below, and **nothing persisted ever
 * contains either**. Stored keys use the domain-descriptive `floe.` namespace (`storageKeys.ts`),
 * and `brand.test.ts` enforces both halves. Renaming the game is this file plus some copy.
 */
export const APP = {
	/** Internal codename. Not a decision about what this is called on a phone's home screen. */
	name: 'PinguIsland',
	/** One line, for the document title and the eventual manifest. */
	tagline: 'Wer bleibt am längsten auf der Scholle?'
} as const;

/**
 * The namespace every persisted key sits under. Domain-descriptive on purpose — see above.
 * Never change this value: it would strand whatever is already stored under the old one.
 */
export const STORAGE_NAMESPACE = 'floe';
