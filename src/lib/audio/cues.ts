/**
 * What just happened, worked out by watching the world.
 *
 * The simulation emits no events and it is not going to: an event list is state, it would have to be
 * cleared by somebody, and it would have to survive a client's replay in `net/predict.ts` — where a
 * hundred ticks are re-simulated in one frame and every "event" in them has already been heard. So
 * the sound layer DERIVES what happened by comparing the world with the last time it looked, which
 * is invariant 2 again: reads the world, never writes to it.
 *
 * That also gives the replay problem a free answer. A re-simulated tick changes nothing this watcher
 * has not already seen, so no correction can make a snowball whoosh twice.
 *
 * Three shapes of cue live here, and the middle one is the one to understand before adding anything:
 *
 *  * **A change** — a jump, a hit, a splash. Something is true now that was not true last look.
 *  * **A DISTANCE** — a footstep, a scrape down the mountain. Emitted once per metre travelled
 *    rather than once per so many ticks, which is the same decision `render/penguin.ts` made about
 *    the gait and for the same reason: this game is built on the gap between pushing and moving, so a
 *    penguin who is sliding without walking must not sound like one who is walking. It also makes
 *    the RATE carry the speed for free — a fast sledge scrapes more often than a slow one, with no
 *    number describing how fast anything is.
 *  * **A BEAT** — the sea, a bird, the wind. Keyed to `world.round.ticks`, the world's own clock,
 *    because a wall clock here would give a slow phone a different soundtrack and would fire inside
 *    a replay. Ambience is the one thing in the game that has to happen when nothing is happening,
 *    and a hub with nothing in it was most of what "the sounds are off" meant.
 *
 * Pure: no clock, no randomness, no browser. `sound.ts` is where anything can make a noise.
 */

import { nearestWithSlack, TALK_RANGE, TALK_RANGE_EXIT } from '../npc/talk';
import { breakWarning, floeUnder } from '../sim/archipelago';
import { alongCourse } from '../sim/chase';
import { isDashing } from '../sim/combat';
import { COUNTDOWN_TICKS, TICK_RATE } from '../sim/constants';
import { modeFor } from '../sim/modes/registry';
import type { Penguin, Vec2, World } from '../sim/types';
import { distance, distanceSq } from '../sim/vec';

export type Cue =
	/** Someone left the ice. */
	| 'jump'
	/** Someone flapped in mid-air — the second jump. A different sound, because it is a rescue. */
	| 'flap'
	/** Someone's feet are back on the ground. The squash on landing, as a noise. */
	| 'land'
	/** One footfall of the local player, on grass. */
	| 'stepGrass'
	/** The same, on the beach. */
	| 'stepSand'
	/** A metre of the local player's belly down the mountain. */
	| 'sled'
	/** A snowball was thrown. */
	| 'throw'
	/** A shove was committed to. */
	| 'dash'
	/** Somebody was hit by anything at all — the one sound that says the fight is happening. */
	| 'hit'
	/** Somebody went in the water. */
	| 'splash'
	/** One beat of the countdown, on the tick the number on screen changes. */
	| 'count'
	/** The countdown ended. */
	| 'go'
	/** The round ended and the local player won it. */
	| 'win'
	/** The round ended and they did not. */
	| 'lose'
	/** The ice under the local player has started to crack. Once, when the warning begins. */
	| 'creak'
	/** A floe broke in two. Anywhere in the sea — it is the loudest thing that happens in a Royal. */
	| 'crack'
	/**
	 * The sea lion is close behind the local player. Once, when it first gets close.
	 *
	 * A warning rather than a running commentary: the danger in a chase is behind you and the camera
	 * looks forward, so a child sprinting for the next platform can be four metres from being eaten
	 * with nothing on screen saying so. It is the same job the crack does in a Royal.
	 */
	| 'growl'
	/**
	 * And the breath of it, while it is still there.
	 *
	 * The growl announces the approach once; this is what stops "once" from meaning "and then
	 * silence" for the twenty seconds a child spends being chased. Slow enough to be a presence
	 * rather than a commentary, and it stops the moment they pull away.
	 */
	| 'huff'
	/** The local player has walked into a door with a game behind it. */
	| 'door'
	/** And into a place that opens nothing — a shop with no counter yet, a bench, a view. */
	| 'arrive'
	/** Somebody on the island is close enough to say something, and has just become so. */
	| 'greet'
	/** The sea, on the shore of a place calm enough to hear it. */
	| 'wave'
	/** Something with wings, over the island. */
	| 'bird'
	/** Moving air, on a course fast enough to have any. */
	| 'wind';

/**
 * How close the sea lion has to get before it says something, in metres.
 *
 * Under `CHASE_HUNTER_HEADSTART`, and that is the whole constraint. At twelve — two platforms, which
 * is what "close" looks like — the round STARTS inside the threshold, so the latch closed on the
 * first look and the growl never happened at all. Seven is about a platform and a gap: far enough
 * that it means the sea lion has actually gained on you, near enough that the warning arrives before
 * the mistake.
 */
const GROWL_LEAD = 7;

/**
 * How far away something can happen and still be worth a noise, in metres.
 *
 * **This is the fix for the thing a Royal sounded like.** Thirty penguins jump, throw, shove and
 * drown across a sea 78 m wide, all of it announced at full volume into a mono speaker with no
 * distance in it — so the finale was a wall of blips belonging to penguins the player could not see,
 * and the one splash that mattered was somewhere inside it. Sound in this game is confirmation of
 * something on screen (see `sound.ts`), and out there there is nothing on screen to confirm:
 * `Game.svelte` stops animating a penguin past its own detail range and draws it as a dot with no
 * name over it.
 *
 * Twenty-four metres, and it is a MEASUREMENT rather than a preference. A classic arena is 15.2 m
 * across and a penguin crossing its rim is at most 22.8 m from a player standing on the opposite
 * edge, so nothing in the game everybody is actually playing is ever cut. A Royal's sea is 78 m
 * across with 61 m between its furthest two penguins, and that is the half this silences. The
 * neighbouring floes — everybody who could jump at you — are inside it either way.
 */
export const EARSHOT = 24;

/**
 * How far the local player walks between footsteps, in metres.
 *
 * Two of the renderer's gait cycles, which is what puts the sound on the same FOOT every time
 * (`render/penguin.ts` turns the legs over every 1/2.4 m). One per cycle is the honest reading of the
 * animation and it is unusable: the waddle is a fast little wobble — 8.6 cycles a second at
 * `WALK_SPEED` — and at that rate footsteps are not footsteps, they are a sewing machine.
 */
export const FOOTFALL_METRES = 0.84;

/**
 * Where the beach starts, as a fraction of the island's radius.
 *
 * The renderer draws the sand across its outermost ring, from 53 m of 58 (`render/island.ts`), and
 * this is the same line — a footstep must not sound like grass while the picture shows sand. Being a
 * fraction rather than the metres means the two agree at any island size, which is the closest thing
 * to a shared definition available from a module that may not import the renderer.
 */
export const BEACH_FROM = 0.91;

/** How far the local player slides between scrapes, in metres. */
export const SCRAPE_METRES = 1.1;

/**
 * How fast the local player has to be going before the belly is on the ice, in metres per second.
 *
 * `render/penguin.ts` drops the bird onto its front at 4.5 m/s and stands it back up below that, so
 * this is that number: the scrape has to start on the frame the belly does, or a child hears ice
 * being scraped by a penguin standing upright on it.
 */
export const SLED_SPEED = 4.5;

/**
 * How often the sea lion breathes while it is close, in ticks.
 *
 * A second and a half. The animal is 7 m behind a child who is running for their life, and the rate
 * is the whole difference between a presence and a nag: at half a second it is a commentary on being
 * chased, and at four it reads as having got away.
 */
const HUFF_TICKS = 90;

/**
 * Ambience, in ticks between one and the next, with an offset so they do not all land together.
 *
 * Slow — a wave every four and a half seconds, a bird every eleven. The rate is the whole design of
 * an ambient sound: often enough that the place is not dead, rare enough that it never becomes the
 * thing you are listening to. At a second apart these would be an effect rather than a place.
 */
const BEATS: readonly { readonly cue: Cue; readonly ticks: number; readonly from: number }[] = [
	{ cue: 'wave', ticks: 270, from: 90 },
	{ cue: 'bird', ticks: 660, from: 300 },
	{ cue: 'wind', ticks: 210, from: 60 }
];

/**
 * The nearest penguin close enough to talk to this one, or null.
 *
 * Deliberately the same rule `npc/talk.ts` uses to choose a speaker — its range, and both of them on
 * their feet — because the greeting has to land on the frame the bubble opens on. `TALK_RANGE` is
 * imported rather than copied for that reason: two numbers for one distance is a sound that arrives
 * before or after the thing it belongs to, and the drift would be silent.
 *
 * It does not ask WHO they are. `npc/` knows which roster slot is which character; this only needs
 * to know that somebody is there, and asking less keeps a noise out of the business of a cast list.
 *
 * `staying` is the current companion's id, so they can keep the conversation out to `TALK_RANGE_EXIT`
 * — the same slack `npc/talk.ts`'s own `nearest` gives the islander already being talked to, via the
 * SAME `nearestWithSlack` helper, and for the same reason: a wanderer (or a player) hovering right at
 * `TALK_RANGE` otherwise crosses it once a tick, and this function used to report null on every
 * crossing, which retriggered `greet` on every one back (Daniel, 2026-08-22: "just bip bip bip
 * endless"). Sharing the helper rather than two copies of the same loop is what keeps the chime and
 * the bubble from being able to drift apart on the next edit to either.
 */
function nearestTalker(world: World, me: Penguin, staying: string | null): string | null {
	if (me.phase !== 'skating' || me.height > 0) return null;
	const candidates = world.penguins.filter(
		(p) => p.id !== me.id && p.phase === 'skating' && p.height <= 0
	);
	const found = nearestWithSlack(
		candidates,
		(p) => distanceSq(p.pos, me.pos),
		(p) => p.id,
		staying,
		TALK_RANGE,
		TALK_RANGE_EXIT
	);
	return found?.id ?? null;
}

/** What the watcher remembers about one penguin between looks. */
interface Seen {
	airborne: boolean;
	airJumps: number;
	throwCooldown: number;
	stunTicks: number;
	dashing: boolean;
	phase: Penguin['phase'];
}

export interface CueWatcher {
	/** Everything that happened since the last call, in no particular order. */
	poll(world: World, me: string): readonly Cue[];
}

export function createCueWatcher(): CueWatcher {
	const seen = new Map<string, Seen>();
	/**
	 * One-shot latches, and one-shot on purpose.
	 *
	 * A client is corrected by rewinding to the host's state and replaying, so `round.phase` can go
	 * from 'over' back to 'playing' and forward to 'over' again inside a single frame. Comparing
	 * against the previous phase would announce the result twice; a latch announces it once, which
	 * is how many times the round ended.
	 */
	let started = false;
	let roundOver = false;
	/**
	 * Whether the sea lion was already close last look.
	 *
	 * A latch rather than a comparison, so it announces itself once per approach: at walking pace a
	 * player hovers around the threshold for seconds at a time, and a growl per tick would be a
	 * chainsaw.
	 */
	let hunterClose = false;
	/**
	 * The first look is a BASELINE and says nothing at all.
	 *
	 * Not only for the penguins. A watcher built mid-round — which is what a client joining a room
	 * in progress is — would otherwise announce the whistle for a round that started before it was
	 * listening, and a result it did not see happen.
	 */
	let primed = false;
	/** Floe ids that were on screen last look, so a break can be noticed by one going missing. */
	let iceSeen: number[] = [];
	/** Whether the ice under the local player was already creaking when we last looked. */
	let creaking = false;
	/** The number the countdown was showing last look, so the beat lands with the digit. */
	let counting = 0;
	/** Which door the local player was standing in, by id. */
	let doorway: string | null = null;
	/** And who was close enough to talk to them, by id. */
	let companion: string | null = null;
	/** Where the local player was, so travel can be measured rather than timed. */
	let wasAt: Vec2 | null = null;
	/** Metres walked and metres slid since the last footfall and the last scrape. */
	let walked = 0;
	let scraped = 0;
	/** Which slice of the world's clock each ambient sound last landed in. */
	const beats = new Map<Cue, number>();

	return {
		poll(world, me) {
			const cues: Cue[] = [];
			const add = (cue: Cue) => {
				// A four-penguin scrum can land three hits on one tick, and three copies of one thud is
				// a click rather than three thuds. One of each per tick is all a player can hear.
				if (!cues.includes(cue)) cues.push(cue);
			};

			const spec = modeFor(world.mode);
			const mine = world.penguins.find((p) => p.id === me) ?? null;

			if (!started && world.round.phase === 'playing') {
				started = true;
				if (primed) add('go');
			}
			if (!roundOver && world.round.phase === 'over') {
				roundOver = true;
				if (primed) add(world.round.winner === me ? 'win' : 'lose');
			}

			// The countdown, as the number on the screen rather than as a tick count: `Game.svelte`
			// rounds the same expression UP so it reads 2 · 1, and a beat that landed anywhere else
			// would be a sound with nothing to be the sound OF.
			const shown =
				world.round.phase === 'countdown'
					? Math.ceil((COUNTDOWN_TICKS - world.round.ticks) / TICK_RATE)
					: 0;
			// The first look says nothing at all (see `primed`) and for this one cue that is wrong: a
			// watcher is built in `onMount`, one frame ahead of tick one, so the gate would eat the
			// first digit of every round and leave a two-second countdown with a single beat in it. A
			// countdown that has only just started is not stale news — it is the news.
			const opening = world.round.phase === 'countdown' && world.round.ticks <= 1;
			if ((primed || opening) && shown > 0 && shown !== counting) add('count');
			counting = shown;

			/**
			 * Is this near enough to be worth hearing?
			 *
			 * Measured from the local penguin while they are still in it, and from nowhere once they
			 * are out: the camera then frames whatever fight they can still reach (`Game.svelte`), so
			 * for a spectator the whole board is on screen and all of it is theirs to hear.
			 */
			const inEarshot = (at: Vec2): boolean => {
				if (mine?.phase !== 'skating') return true;
				return distance(mine.pos, at) <= EARSHOT;
			};

			for (const p of world.penguins) {
				const was = seen.get(p.id);
				const now: Seen = {
					airborne: p.height > 0,
					airJumps: p.airJumps,
					throwCooldown: p.throwCooldown,
					stunTicks: p.stunTicks,
					dashing: isDashing(p),
					phase: p.phase
				};
				seen.set(p.id, now);
				// Without a baseline every penguin appears to have just started doing whatever it is
				// already doing, and a round would open on four simultaneous everything. `seen` is
				// written only here, so on the first poll this is empty and every penguin skips.
				if (!was) continue;
				if (!inEarshot(p.pos)) continue;

				if (!was.airborne && now.airborne && now.phase === 'skating') add('jump');
				// And the landing, which is the one the ART DIRECTION asks for: a squash on touching
				// down is on that document's short list of what makes these games feel the way they do,
				// and it was drawn without a sound under it. On the mountain it is also every bump.
				if (was.airborne && !now.airborne && now.phase === 'skating') add('land');
				// The flap is the counter going DOWN, which happens exactly once per use and cannot be
				// confused with landing (where it goes back up).
				if (now.airJumps < was.airJumps) add('flap');
				// The cooldown JUMPING UP is the throw. Watching the snowball array instead would miss
				// a ball that was thrown and expired between two frames, which at 30 fps is possible.
				if (now.throwCooldown > was.throwCooldown) add('throw');
				if (!was.dashing && now.dashing) add('dash');
				// A stun that got LONGER is a fresh hit — including one landed on an already-stunned
				// penguin, which is exactly the moment a player most wants to hear.
				if (now.stunTicks > was.stunTicks) add('hit');
				if (was.phase === 'skating' && now.phase === 'falling') add('splash');
			}

			// The ice. A floe that was in the sea and is not any more broke or went under, which is the
			// loudest thing that happens in a Royal and the one a player is least able to see coming
			// if it happens behind them.
			const iceNow = world.floes.map((floe) => floe.id);
			if (primed && iceSeen.some((id) => !iceNow.includes(id))) add('crack');
			iceSeen = iceNow;

			// And the creak, which is personal: the ice under YOU has started to give. Latched, so
			// three seconds of warning make one sound rather than a hundred and eighty.
			const under = mine ? floeUnder(world.floes, mine.pos) : null;
			const warned = !!under && breakWarning(under, world.round.ticks) > 0;
			if (primed && warned && !creaking) add('creak');
			creaking = warned;

			/**
			 * True on the first look inside a new slice of the world's clock.
			 *
			 * Called only where it is wanted, and that is deliberate: the first call after a silence
			 * has nothing to compare against and reports nothing, so a sound cannot arrive the
			 * instant it becomes relevant merely because a boundary went past while it was not.
			 */
			const beat = (cue: Cue, ticks: number, from = 0): boolean => {
				const slice = Math.floor((world.round.ticks + from) / ticks);
				const before = beats.get(cue);
				beats.set(cue, slice);
				return primed && before !== undefined && before !== slice;
			};

			// And the sea lion, which is the same job the creak does: the danger is BEHIND the player
			// and the camera looks forward. Latched with hysteresis — it has to fall clearly back
			// before it can announce itself again, or a player running level with the threshold sets
			// it off every second.
			if (spec.hunted && mine && mine.phase === 'skating') {
				const lead = alongCourse(world.floes, mine.pos) - world.hunterAt;
				if (primed && !hunterClose && lead < GROWL_LEAD) add('growl');
				if (lead < GROWL_LEAD) hunterClose = true;
				else if (lead > GROWL_LEAD * 1.8) hunterClose = false;
				// And its breathing, on a beat, for as long as it is there. The growl is the news; this
				// is the fact, and a chase where the news is twenty seconds old sounds like nothing is
				// behind you at all.
				if (hunterClose && beat('huff', HUFF_TICKS)) add('huff');
			} else {
				hunterClose = false;
			}

			// The door the player is standing in. A place rather than a trigger (`sim/island.ts`), so
			// this is the id CHANGING rather than an event to catch: walk out of the shop and into the
			// square and there is one sound, on the frame the prompt on screen changes with it.
			//
			// TWO sounds, because there are two things that can be under your feet, and the screen
			// already tells them apart: a door with a game behind it raises the biggest button in the
			// game, and a door that opens nothing raises nothing (`GameMode.Door.opens` — null is
			// deliberate, so Der Laden can be a building before it is a screen). One chime for both
			// would be the sound promising something the picture does not, which is this file's one
			// unforgivable failure mode: it is confirmation, never information.
			const door = mine ? (spec.doorUnder?.(world, mine) ?? null) : null;
			if (primed && door && door.id !== doorway) add(door.opens ? 'door' : 'arrive');
			doorway = door?.id ?? null;

			// And the islanders. Whoever is close enough to talk is about to (`npc/talk.ts`), so this is
			// the greeting under a speech bubble that is already opening — the same latch-on-change the
			// door uses, so walking from one penguin to the next greets the second one and standing
			// still says nothing. Derived from the positions rather than from the conversation: who is
			// within arm's reach of whom is a fact about the world, and what they SAY is not.
			const near = mine ? nearestTalker(world, mine, companion) : null;
			if (primed && near && near !== companion) add('greet');
			companion = near;

			// How far the local player has travelled since the last look, which is what the ground
			// under them and the ice under their belly are both measured in.
			const travelled = mine && wasAt ? distance(wasAt, mine.pos) : 0;
			wasAt = mine ? { x: mine.pos.x, z: mine.pos.z } : null;
			const afoot = !!mine && mine.phase === 'skating' && mine.height <= 0;

			if (primed && afoot && spec.scenery === 'hub') {
				walked += travelled;
				if (walked >= FOOTFALL_METRES) {
					walked %= FOOTFALL_METRES;
					// Grass or sand, from the same line the renderer draws it at. Only the local player's
					// own feet: nine penguins wandering a town would be nine sets of footsteps in one
					// speaker, and the eight who are not you are somebody the camera is behind.
					const island = world.floes[0];
					const out = island ? distance(island.center, mine.pos) : 0;
					add(island && out > island.radius * BEACH_FROM ? 'stepSand' : 'stepGrass');
				}
			} else {
				walked = 0;
			}

			// The mountain, where the same distance is a scrape instead. `onTheBelly` is the mode
			// saying a penguin travels on its front here; the speed is the renderer's threshold for
			// actually lying down on it.
			if (primed && afoot && spec.onTheBelly && Math.hypot(mine.vel.x, mine.vel.z) > SLED_SPEED) {
				scraped += travelled;
				if (scraped >= SCRAPE_METRES) {
					scraped %= SCRAPE_METRES;
					add('sled');
				}
			} else {
				scraped = 0;
			}

			// Ambience, on the world's own clock. A hub gets the sea and the birds; a course gets the
			// air going past. An arena gets neither: there is a fight on, and the point of ambience is
			// that it fills a silence rather than a gap between two thuds.
			const ambient: readonly Cue[] =
				spec.scenery === 'hub'
					? (['wave', 'bird'] as const)
					: spec.scenery === 'arena'
						? []
						: (['wind'] as const);
			for (const each of BEATS) {
				if (ambient.includes(each.cue) && beat(each.cue, each.ticks, each.from)) add(each.cue);
			}

			primed = true;
			return cues;
		}
	};
}
