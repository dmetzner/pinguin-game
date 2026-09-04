/**
 * The four letters a child reads out across a table.
 *
 * This is an interface for eight-year-olds before it is anything else, and every decision here comes
 * from that. Codes are consonant–vowel–consonant–vowel, so every one of them is a PRONOUNCEABLE
 * nonsense word — "DUKE", "BALA" — rather than a string of letters that has to be spelled out one at
 * a time. A code you can say is a code you can shout across a room.
 *
 * The alphabet leaves out the letters that look like each other on a phone screen and the ones that
 * sound like each other when a code is said out loud: no I (reads as l), no O (reads as 0), no Q, no
 * Y, no C against K, no V against F. What is left still gives over two thousand codes, which is far
 * more than the number of rooms open at one moment will ever be.
 *
 * The round seed comes from the code, so everybody in a room agrees on the arrangement without
 * anyone sending it — and typing the same code twice gives the same starting positions, which is a
 * property children find and enjoy rather than one that needs hiding.
 */

/** No I, O, Q, Y — glyphs that read as something else. No C or V — sounds that hear as K and F. */
const CONSONANTS = 'BDFGHJKLMNPRSTWXZ';
/** A, E, U only. Held apart from each other when said quickly by a child. */
const VOWELS = 'AEU';

export const ROOM_CODE_LENGTH = 4;

/**
 * Codes that happen to spell something, and are therefore not codes.
 *
 * German-first and deliberately short, because the pattern can only produce four-letter nonsense and
 * the accidents it can make are few and knowable. This is not a profanity filter with ambitions —
 * it is the list of words THIS alphabet can build, and a test walks every code past it.
 */
const BLOCKED = new Set(['FUDE', 'HURE', 'KAKA', 'MUFU', 'PUPU', 'TUNE']);

/**
 * Every legal code, in order.
 *
 * Built once rather than derived per call, and that is what makes `roomCodeFromSeed` a plain index:
 * an earlier version generated a code arithmetically and SKIPPED past blocked ones, which quietly
 * made two different seeds produce the same room. Removing them from the list instead keeps the
 * mapping one-to-one, which is the property the whole thing rests on.
 */
const CODES: readonly string[] = (() => {
	const out: string[] = [];
	for (const c1 of CONSONANTS)
		for (const v1 of VOWELS)
			for (const c2 of CONSONANTS)
				for (const v2 of VOWELS) {
					const code = `${c1}${v1}${c2}${v2}`;
					if (!BLOCKED.has(code)) out.push(code);
				}
	return out;
})();

/** How many rooms there are. Exported so a test checks the claim rather than trusting arithmetic. */
export const ROOM_CODES = CODES.length;

/** A code from a number. Deterministic, and one seed to exactly one room. */
export function roomCodeFromSeed(seed: number): string {
	const n = ((Math.floor(seed) % ROOM_CODES) + ROOM_CODES) % ROOM_CODES;
	return CODES[n] ?? CODES[0] ?? 'BABA';
}

/**
 * What a misread letter was probably meant to be — but only where a consonant belongs.
 *
 * The direction matters and it is easy to get backwards. These letters are not IN the alphabet;
 * they are what somebody TYPES after misreading one that is. A displayed D can be read as an O or a
 * zero, so an O in a consonant position means D. The same letter in a vowel position means nothing
 * at all, because no code ever shows a consonant there — which is why this is applied per position
 * rather than across the whole string, as the first version did.
 */
const MISREAD: Record<string, string> = {
	O: 'D',
	'0': 'D',
	I: 'L',
	'1': 'L',
	'5': 'S',
	'8': 'B',
	'6': 'G',
	'2': 'Z',
	// Not misread — misheard. A code shouted across a table arrives as a sound, and these two pairs
	// are the ones German ears do not separate.
	C: 'K',
	V: 'F'
};

/**
 * Clean up whatever was typed, or return null.
 *
 * Generous on purpose. A child typing a code they were shown produces lower case, a stray space, and
 * sometimes the digit they saw where a letter was. Every one of those IS the code that was meant, so
 * it is corrected rather than rejected — "nope" to a code that was almost right is where a
 * nine-year-old gives up and goes to do something else.
 */
export function normaliseRoomCode(typed: string): string | null {
	const cleaned = typed.toUpperCase().replace(/[^A-Z0-9]/g, '');
	if (cleaned.length !== ROOM_CODE_LENGTH) return null;

	let code = '';
	for (const [i, typedLetter] of [...cleaned].entries()) {
		const allowed = i % 2 === 0 ? CONSONANTS : VOWELS;
		const letter = allowed.includes(typedLetter)
			? typedLetter
			: (MISREAD[typedLetter] ?? typedLetter);
		if (!allowed.includes(letter)) return null;
		code += letter;
	}
	// A blocked code is not a room, so joining one has to fail the same way a typo does.
	return BLOCKED.has(code) ? null : code;
}

/**
 * The seed a code stands for.
 *
 * Every peer derives it from the code alone, so the arrangement of a round is agreed before anybody
 * has sent a byte. Multiplying and mixing rather than simply indexing, so two codes one letter apart
 * do not give two seeds one apart — that would put the next room along on a visibly similar starting
 * ring, and a rematch there would feel like a rerun.
 */
export function seedFromCode(code: string): number {
	let hash = 0x9e37;
	for (const letter of code)
		hash = (Math.imul(hash ^ letter.charCodeAt(0), 0x01000193) >>> 0) ^ (hash >>> 7);
	return hash >>> 0;
}
