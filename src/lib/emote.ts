/**
 * What a player is allowed to say, which is six things and none of them are words.
 *
 * `docs/DECISIONS/0004` bans free text between players outright and names the replacement in one
 * line: "Communication is a fixed set of emotes." This file is that set. The rule it has to keep
 * holding is not "no swearing" — a filter would cover that and would still fail — it is that **the
 * channel has no capacity for anything we did not write**. Six symbols, no ordering that spells
 * anything, no combining, no repetition fast enough to be a code: that is why the gap below exists
 * as well as the duration.
 *
 * The DATA lives here and only here, because two other people consume it and neither may invent its
 * own list: `render/` animates a penguin (`move`, `ticks`) and the hub's button row draws a picker
 * (`glyph`, `label`, `aria`). A second list in either place is two lists that disagree about how
 * long a heart lasts, and the bubble outliving the animation is exactly the kind of mismatch nobody
 * files a bug about and everybody sees.
 *
 * Pure, no clock: time arrives as a tick count, the same way it does in the simulation. An emote is
 * deliberately NOT simulation state — it changes nothing about where a penguin is or what it can do,
 * so putting it on `World` would be a field the physics must carry, the wire must quantise and a
 * replay must reproduce, in exchange for nothing. It is expression, and it lives beside the look and
 * the name.
 */

/**
 * The id, and it is a WIRE value: phase 3 sends this string so a room can see each other's emotes.
 *
 * English like every other id in this codebase (`Mode`, `IslandZone.id`, `HatId`) and unrelated to
 * the German the player reads — a label is copy and can be rewritten in an afternoon, an id that has
 * been on the wire cannot.
 */
export type EmoteId = 'wave' | 'heart' | 'laugh' | 'grumpy' | 'dance' | 'oops';

/**
 * What the BODY does, as a small shared vocabulary rather than six bespoke animations.
 *
 * The character artist implements five moves; a seventh emote picks one of them and costs no
 * animation work at all. That is the same trade `BotStyle` makes in `sim/modes/mode.ts` — a style
 * shared between modes rather than one branch per mode — and it is the reason a set this small is
 * worth typing at all.
 */
export type EmoteMove = 'wave' | 'bounce' | 'spin' | 'stomp' | 'shrink';

export interface Emote {
	readonly id: EmoteId;
	/** German, on the chip. Short enough for a 56 px button under a glyph. */
	readonly label: string;
	/**
	 * What a child recognises before they can read the label — and, for the same reason, what the
	 * bubble over the head shows at a distance where three letters are unreadable.
	 */
	readonly glyph: string;
	/** The whole sentence, for a screen reader. A chip labelled "Grr!" says nothing on its own. */
	readonly aria: string;
	/**
	 * How long it plays, in ticks.
	 *
	 * The one number the animation and the bubble both read, so they cannot disagree about when the
	 * heart is over. Varied per emote because a wave is a gesture and a dance is a performance:
	 * giving them the same duration makes one look clipped and the other look stuck.
	 */
	readonly ticks: number;
	readonly move: EmoteMove;
}

/** One second, in ticks. The simulation runs at 60 Hz and this file counts in the same unit. */
const SECOND = 60;

/**
 * The six.
 *
 * Chosen against what an eight-year-old actually wants to say to somebody they cannot type to: hello,
 * I like you, that was funny, that was mean, look at me, I fell in. The owner named three of them
 * (hearts, angry, dance) and the other three are the ones missing from a conversation made only of
 * those — there was no way to greet anybody and no way to answer a joke.
 *
 * `grumpy` is in and is deliberately silly rather than aggressive: children need a way to say "hey!"
 * after being shoved into the sea, and denying it does not remove the feeling, it removes the outlet.
 * "Grr!" over a penguin's head is the whole of it — there is no target, no persistence and nothing to
 * escalate with, which is the property a fixed set has and a text box never can.
 */
export const EMOTES: readonly Emote[] = [
	{
		id: 'wave',
		label: 'Hallo!',
		glyph: '👋',
		aria: 'Hallo winken',
		ticks: 1.5 * SECOND,
		move: 'wave'
	},
	{
		id: 'heart',
		label: 'Lieb!',
		glyph: '💜',
		aria: 'Herzchen zeigen',
		ticks: 2 * SECOND,
		move: 'bounce'
	},
	{ id: 'laugh', label: 'Haha!', glyph: '😄', aria: 'Lachen', ticks: 2 * SECOND, move: 'bounce' },
	{
		id: 'grumpy',
		label: 'Grr!',
		glyph: '😠',
		aria: 'Schimpfen',
		ticks: 1.5 * SECOND,
		move: 'stomp'
	},
	{ id: 'dance', label: 'Tanz!', glyph: '🎵', aria: 'Tanzen', ticks: 3 * SECOND, move: 'spin' },
	{
		id: 'oops',
		label: 'Uups!',
		glyph: '💦',
		aria: 'Uups, reingefallen',
		ticks: 1.5 * SECOND,
		move: 'shrink'
	}
];

/**
 * The silence between two emotes, in ticks.
 *
 * Half a second, and it is a rule about the CHANNEL rather than about animation: a button that can be
 * hammered turns six symbols into a rhythm, and a rhythm is a code two children can agree on off-app.
 * Nobody is going to smuggle much through half a second of enforced quiet, but the cheapest moment to
 * decide that emotes are not a keyboard is before anybody builds a picker that repeats on hold.
 *
 * It is also, unrelatedly, what stops a penguin flickering between two animations mid-frame.
 */
export const EMOTE_GAP_TICKS = 30;

/**
 * One emote being played, by one penguin.
 *
 * A span rather than a flag plus a countdown: `until` is arithmetic done once at the press, so the
 * renderer, the bubble and the cooldown all read the same number and none of them has to be ticked.
 * That matters more than it looks — a counter decremented per frame is a counter that drifts when a
 * frame catches up on three ticks, which `render/loop.ts` does routinely.
 */
export interface EmoteBurst {
	readonly id: EmoteId;
	/** Whose penguin is doing it. A `Penguin.id`, so the renderer can find the body to animate. */
	readonly by: string;
	readonly from: number;
	readonly until: number;
}

/** The emote with this id, or null. Never throws: phase 3 will decode this off the wire. */
export function emoteById(id: string): Emote | null {
	return EMOTES.find((emote) => emote.id === id) ?? null;
}

/**
 * Start one, unless the last one is still going or its gap has not run out.
 *
 * Returns null rather than throwing or queueing, and the caller keeps the burst it already had. A
 * queue would let a child press six times and watch a performance they can no longer stop, which is
 * both the wrong toy and the repetition channel the gap exists to close.
 */
export function startEmote(
	id: EmoteId,
	by: string,
	tick: number,
	last: EmoteBurst | null
): EmoteBurst | null {
	const emote = emoteById(id);
	if (!emote) return null;
	if (last && tick < last.until + EMOTE_GAP_TICKS) return null;
	return { id: emote.id, by, from: tick, until: tick + emote.ticks };
}

/**
 * How far through it is, 0 to 1, or null once it is over.
 *
 * A phase rather than "is it playing", because that is what an animation actually needs and deriving
 * it in two places is how the bubble and the body end up a frame apart. Null is the whole "nothing to
 * draw" answer, so there is no second boolean to keep in step.
 */
export function emoteProgress(burst: EmoteBurst | null, tick: number): number | null {
	if (!burst || tick < burst.from || tick >= burst.until) return null;
	const span = burst.until - burst.from;
	return span > 0 ? (tick - burst.from) / span : null;
}

/** Whether another emote may be started yet. The picker greys out on this rather than guessing. */
export function emoteReady(last: EmoteBurst | null, tick: number): boolean {
	return !last || tick >= last.until + EMOTE_GAP_TICKS;
}
