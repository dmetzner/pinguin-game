/**
 * Die Insel: the hub, and the first mode in this game that is not a round.
 *
 * Nobody is eliminated, nothing shrinks, nobody wins, nobody may attack anybody, and you cannot walk
 * into the sea. Four of those five are one line each below, because they are all the same shape as
 * something a round already does — `sim/island.ts` argues each of them at the place it happens.
 */
import {
	holdOnTheIsland,
	ISLAND_ZONES,
	islandFloes,
	spawnOnTheIsland,
	washAshore,
	zoneUnder
} from '../island';
import type { Door, GameMode, Landmark } from './mode';
import { neverEnds, noAttacks, nothing } from './policy';

/**
 * One `Door` per zone, built once at module load.
 *
 * Built once rather than per call so a caller can compare identity across ticks — "am I still in the
 * door I was in last frame" is a question the UI will ask, and a fresh object every tick makes the
 * answer always no.
 *
 * It is also the whole mapping from `IslandZone.leads` to `Door.opens`: a zone that leads to the shop
 * opens NOTHING, which is what lets Der Laden be a place on the island — a building with a sign you
 * can stand in front of — before it is a screen (story 10d).
 */
const DOORS: ReadonlyMap<string, Door> = new Map(
	ISLAND_ZONES.map((zone) => [
		zone.id,
		{
			id: zone.id,
			name: zone.name,
			kind: zone.leads.kind,
			opens: zone.leads.kind === 'mode' ? zone.leads.mode : null
		}
	])
);

/**
 * The places worth walking to: the five zones, as somewhere to go rather than as a door.
 *
 * The same list twice over, deliberately, because they are two different facts about a place — what
 * happens when you stand in it (`DOORS`) and whether it is worth crossing the island for
 * (`LANDMARKS`). A future hub might have a bench nobody can enter, or a door nobody would walk to.
 */
const LANDMARKS: readonly Landmark[] = ISLAND_ZONES.map((zone) => ({
	at: zone.at,
	radius: zone.radius
}));

export const ISLAND: GameMode = {
	id: 'island',
	name: 'Insel',
	/**
	 * NINE: the player and eight wanderers.
	 *
	 * The number is chosen against the five landmarks, not against a frame budget. Eight is roughly one
	 * or two penguins at each place plus a few walking between them, which is what reads as a town
	 * rather than as a queue; four left the island looking abandoned and sixteen turned the Rathausplatz
	 * into a crowd nobody could find the shop through.
	 *
	 * What it trades against is DRAW CALLS, not ticks — the simulation is 3% of a 60 Hz frame with
	 * THIRTY penguins on ten floes, so nine is not a simulation cost at all. Nine is also under a third
	 * of the biggest game this renderer has already been measured at (209 draw calls for a Royal), and
	 * `DETAIL_RANGE` drops the gait, the lean, the waddle and the name tag for anything far away, which
	 * on a 58 m island is most of them. If this number ever needs to come down it will be for the
	 * SPRITES — a name tag is its own draw call — and not for anything in here.
	 */
	players: { min: 1, max: 12, solo: 9 },

	floes: () => islandFloes(),
	spawn: spawnOnTheIsland,
	// Straight into `playing`: no countdown, because there is nothing to count down to. See
	// `GameMode.opening` for why this is not a fourth `RoundPhase`.
	opening: 'playing',
	// Nothing counts down to a place, so this is inert here — `stepRound` never enters the countdown
	// branch for a mode that opens in `playing`. Zero rather than three seconds so that a reader who
	// finds it is told which of the two facts is true, instead of wondering which one wins.
	opensAfter: 0,
	open: nothing,

	// The island does not shrink, sink, break or drift. A hub with a clock is not a hub.
	reshape: nothing,
	advance: nothing,
	// AFTER everybody has moved, which is the only correct place for a wall: the shore holds you and
	// the buildings are solid. See `holdOnTheIsland`.
	settle: holdOnTheIsland,
	overboard: washAshore,
	attackStrength: noAttacks,
	ends: neverEnds,

	standings: null,

	/**
	 * The hub's whole interaction, and it is a lookup rather than an event.
	 *
	 * `zoneUnder` already answers "which place is this penguin standing in", and it answers null for a
	 * penguin in the air or out of it — so a door cannot open because somebody was shoved over it.
	 */
	doorUnder: (_world, p) => {
		const zone = zoneUnder(p);
		return zone ? (DOORS.get(zone.id) ?? null) : null;
	},
	// Roaming is not a round: nothing starts, nothing ends, nobody wins. See `GameMode.isRound` for why
	// this is a field of its own rather than something read off `opening`.
	isRound: false,

	// The island is the one mode with no arena to fit, which is exactly why it is the one that can be
	// played on a tall screen (`backlog/stories/11-portrait.md`).
	framing: 'follow',
	portrait: true,
	// A fixed distance behind the player. Fitting the arena here would frame a 58 m disc and draw a
	// penguin at two percent of the screen, which is the thing `framing: 'arena'` cannot do on a hub.
	view: 14,
	lift: 0,
	// Its own scenery, because its ground is permanent: nothing here breaks, shrinks, tips or sinks, so
	// none of the machinery an arena's ice needs applies. `hub` rather than `island` on purpose — see
	// `Scenery`, which records both the naming argument and the guard collision behind it.
	scenery: 'hub',
	courseHeading: null,
	onTheBelly: false,
	// Nobody is ever out here, so this decides nothing — `true` is the answer that costs nothing if
	// that ever stops being true, because `spectatorSpots` on a world with no eliminated penguins is an
	// empty map.
	sidelines: true,
	// No fighting in a hub, so no Ball button. Same rule as the mountain and for the same reason.
	throwing: false,
	// **No Zack either, and this one earns its own line.** `attackStrength` is zero here too, so a
	// dash could not shove anybody, and a burst of speed toward the nearest neighbour was a control
	// that did nothing describable — Daniel found it a dead button in the corner where a real
	// interaction belongs (2026-08-22). What actually happens when you walk up to somebody is
	// `npc/talk.ts`: proximity, no press, which the design already argued for on its own terms before
	// this button gave it a reason to exist ("a hub whose people need a button pressed at them is a
	// hub where most children never find out anybody lives there"). Removing Zack is what frees that
	// corner rather than repurposing it — an "interact" button here would be a worse feature than the
	// one already built.
	dashing: false,
	// Somebody else is always crossing the square. See `BotStyle` and `bot.roam`.
	bot: 'roam',
	landmarks: LANDMARKS,
	hunted: false,

	copy: {
		who: 'Zuhause',
		rules: 'Lauf herum · geh zu einem Platz · dort gehen die Spiele los',
		// UNREACHABLE: the island never ends (`ends` returns null), so no result screen is ever shown
		// for it. Answered rather than omitted because `ModeCopy` is total, and answered HONESTLY
		// rather than with the classic round's sentences, so nothing here can be mistaken for a rule.
		verdicts: {
			won: 'Auf der Insel gewinnt niemand.',
			lost: 'Auf der Insel verliert niemand.',
			theirs: () => 'Auf der Insel gewinnt niemand.',
			nobody: 'Auf der Insel gewinnt niemand.',
			none: 'Auf der Insel gewinnt niemand.'
		},
		outOfIt: {
			headline: 'Auf der Insel',
			hint: 'Hier kann dir nichts passieren.'
		},
		dash: { label: 'Zack!', aria: 'Schneller laufen' }
	}
};
