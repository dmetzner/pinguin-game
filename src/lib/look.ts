/**
 * What a penguin looks like, as data.
 *
 * Deliberately free of Three.js: this is the thing that gets stored, shown in a picker and (from
 * phase 3) sent over the wire, so it must be plain values. `render/penguin.ts` reads it and builds
 * meshes; nothing here knows that meshes exist.
 *
 * The whole of `docs/DECISIONS/0003` pays off here — because penguins are built from primitives,
 * customisation is a few numbers rather than a mesh per combination.
 */
import { createRng } from './sim/rng';

export type HatId = 'none' | 'bobble' | 'crown' | 'cap' | 'party';

export interface PenguinLook {
	/** Index into `BODY_COLOURS`. An index rather than a hex so a stored look survives a re-palette. */
	body: number;
	/** Index into `BEAK_COLOURS`. */
	beak: number;
	hat: HatId;
	/** Index into `HAT_COLOURS`. Ignored when `hat` is 'none'. */
	hatColour: number;
}

/**
 * The body palette.
 *
 * Bright rather than naturalistic, for the reason recorded in `render/penguin.ts`: a real penguin's
 * back is near-black and renders as an unreadable blob at the distance a fixed camera has to sit.
 *
 * Every entry also has to be distinguishable from every other at arena distance, INCLUDING for the
 * common colour-vision deficiencies — which is why the set varies lightness as well as hue rather
 * than being a ring of saturated colours at one brightness. `look.test.ts` holds them apart.
 */
export const BODY_COLOURS = [
	// Ordered by lightness, and the ORDER is the documentation: each sits at least 0.025 of relative
	// luminance from its neighbours, so the set survives being seen without hue. The first attempt
	// was picked by eye and put violet within 0.008 of cornflower and coral within 0.008 of magenta —
	// two pairs a red-green-deficient player could not have separated. `look.test.ts` measures it.
	0x2b3f7a, // deep indigo   0.055
	0x7d3fb5, // violet        0.113
	0x3f6fd8, // cornflower    0.174
	0xe2574c, // coral         0.235
	0xe86bb0, // magenta       0.308
	0x25b08a, // jade          0.333
	0xf0a43a, // amber         0.454
	0x7fc9e8 // pale sky       0.521
] as const;

/** Beak and feet. A short list: it is a small part of the silhouette and more would be noise. */
export const BEAK_COLOURS = [0xf7a83c, 0xf7d13c, 0xf2764a, 0xffe9a8] as const;

/** Hats are their own colour, so a red hat on a red penguin is possible and looks deliberate. */
export const HAT_COLOURS = [0xe2574c, 0xffffff, 0x2b3f7a, 0x25b08a, 0xffd447, 0x1b1f2a] as const;

export const HATS: readonly HatId[] = ['none', 'bobble', 'crown', 'cap', 'party'];

/** The look a player gets before they have chosen anything. */
export const DEFAULT_LOOK: PenguinLook = { body: 0, beak: 0, hat: 'none', hatColour: 1 };

/** Every combination there is. Exported so the picker can say so and a test can check the claim. */
export const LOOK_COMBINATIONS =
	BODY_COLOURS.length * BEAK_COLOURS.length * (1 + (HATS.length - 1) * HAT_COLOURS.length);

/** A look from a seed. Used for the bots, so a round's opposition is varied but replayable. */
export function lookFromSeed(seed: number): PenguinLook {
	const rng = createRng(seed);
	const hat = HATS[Math.floor(rng.next() * HATS.length)] ?? 'none';
	return {
		body: Math.floor(rng.next() * BODY_COLOURS.length),
		beak: Math.floor(rng.next() * BEAK_COLOURS.length),
		hat,
		hatColour: Math.floor(rng.next() * HAT_COLOURS.length)
	};
}

/**
 * Narrow an unknown value — anything read back out of storage — into a valid look.
 *
 * Every field is clamped rather than validated-and-rejected, so a look stored by an older build,
 * or edited by hand, degrades to something wearable instead of throwing on the way to the first
 * frame. A game that refuses to start because a colour index moved is worse than a penguin in the
 * wrong hat.
 */
export function coerceLook(value: unknown): PenguinLook {
	if (typeof value !== 'object' || value === null) return { ...DEFAULT_LOOK };
	const raw = value as Record<string, unknown>;
	const index = (v: unknown, length: number) =>
		typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < length ? v : 0;
	const hat = HATS.find((h) => h === raw.hat) ?? DEFAULT_LOOK.hat;
	return {
		body: index(raw.body, BODY_COLOURS.length),
		beak: index(raw.beak, BEAK_COLOURS.length),
		hat,
		hatColour: index(raw.hatColour, HAT_COLOURS.length)
	};
}

/** The actual colours, resolved once, for the renderer. */
export interface ResolvedLook {
	body: number;
	belly: number;
	beak: number;
	hat: HatId;
	hatColour: number;
}

/** Cream, on every penguin. A varying belly made the silhouettes harder to tell apart, not easier. */
const BELLY = 0xfdf6e8;

export function resolveLook(look: PenguinLook): ResolvedLook {
	return {
		body: BODY_COLOURS[look.body] ?? BODY_COLOURS[0],
		belly: BELLY,
		beak: BEAK_COLOURS[look.beak] ?? BEAK_COLOURS[0],
		hat: look.hat,
		hatColour: HAT_COLOURS[look.hatColour] ?? HAT_COLOURS[0]
	};
}
