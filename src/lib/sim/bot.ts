/**
 * A bot, which is a thing that produces an `InputFrame`.
 *
 * That is the whole of the contract, and it is the reason invariant 1 was worth the trouble: a bot
 * hands `step` exactly what a thumb hands it, so there is no second code path inside the simulation
 * and no "is this a bot" branch anywhere. Whatever a bot can do, a player can do.
 *
 * Pure in the same sense as the rest of `sim/`: no clock, and randomness only from a seed the world
 * carries, so a round against bots replays exactly.
 */
import { floeUnder, JUMP_RANGE, localTo, reachableFrom } from './archipelago';
import { alongCourse } from './chase';
import { aimTarget, isDashing } from './combat';
import {
	BOT_AGGRESSION,
	BOT_DANGER_FRACTION,
	BOT_ESCAPE_LEAD_TICKS,
	BOT_LEAP_LOOKAHEAD,
	BOT_REACTION_TICKS,
	BOT_SHOVE_RANGE,
	BOT_WANDER,
	BOT_WARMUP_TICKS,
	JUMP_APEX,
	ROUND_GRACE_TICKS,
	SLIDE_SEGMENT_STEP,
	TICK_RATE,
	WALK_SPEED
} from './constants';
import type { Landmark } from './modes/mode';
import { modeFor } from './modes/registry';
import { createRng, type Rng, range } from './rng';
import { attacksAllowed } from './round';
import { segmentHeading } from './slide';
import type { Floe, InputFrame, Penguin, Vec2, World } from './types';
import {
	add,
	distance,
	distanceSq,
	fromHeading,
	heading,
	length,
	normalize,
	scale,
	sub,
	ZERO
} from './vec';

export type Difficulty = 'easy' | 'normal' | 'hard';

/**
 * The three numbers a wanderer needs, all DERIVED rather than chosen.
 *
 * They live here rather than in `constants.ts` only because that file is held elsewhere as this is
 * written; they belong there, and moving them is a cut and paste. Derived is the part that matters:
 * `JUMP_APEX` and `JUMP_AIRTIME` are exported precisely so a test cannot drift from a constant, and a
 * hand-typed "two seconds" here would still say two seconds the afternoon somebody halves the walk
 * speed.
 */

/** How close counts as arrived: a third of a second of walking. */
const ROAM_ARRIVED = WALK_SPEED / 3;
/**
 * How much of a full stick a wanderer ever asks for.
 *
 * **Added because "full stick" was the actual bug.** `paceToward`'s easing only softens the last few
 * tens of centimetres — for the rest of every journey it requested `min(1, away / ROAM_ARRIVED)`,
 * which reaches 1 a third of a second in, so eight background penguins spent almost the whole walk
 * at the SAME speed the player's own thumb produces at full deflection. That reads as traffic, not
 * as a town, and it is the whole of "they run a bit too fast and much" (Daniel, 2026-08-22). A place
 * only has room for these to differ ONE way — a wanderer must never out-pace the player, or catching
 * up to ask a question becomes the objective — so this is a ceiling on the request `paceToward`
 * already shapes, not a second speed system.
 */
const ROAM_PACE = 0.55;
/**
 * How long a penguin stands about once it gets somewhere, in ticks. Five to fourteen seconds.
 *
 * Measured against the walk rather than guessed: the island's journeys run five to nineteen seconds,
 * so six seconds of standing used to be about a third of a wanderer's life spent still — and at
 * `ROAM_PACE` the same walk takes almost twice as long, which would have made an already-brief pause
 * a smaller fraction still. Raised alongside the pace cut for the same reason: "stay or move slowly"
 * needs more of both, not less of one and unchanged of the other.
 */
const ROAM_IDLE_MIN = TICK_RATE * 5;
const ROAM_IDLE_MAX = TICK_RATE * 14;
/**
 * How small a stick request counts as standing still, as a fraction of walking pace.
 *
 * `paceToward` only asks for this little within a few tens of centimetres of the spot, so this IS
 * "have I arrived" — derived from the one thing that already knows, rather than from a second flag on
 * the errand that could disagree with it.
 */
const ROAM_STILL = 0.25;
/**
 * How much longer than the walk itself a bot will keep trying before giving up and going elsewhere,
 * as a multiple of the flat-ground time.
 *
 * A bot that could not reach its spot — because it is being leaned on, or because the route climbs —
 * has to give up rather than push at it for the rest of the round. Three times the walk is generous
 * enough that climbing Der Berg never trips it and short enough that being stuck is self-healing.
 */
const ROAM_PATIENCE = 3;
/**
 * The chance per tick that an idling penguin hops, for the pleasure of it.
 *
 * **This is the trap from `backlog/stories/08-the-chase.md`, and it is safe HERE for two reasons that
 * are specific to a hub rather than for none.** There, a 2%-a-tick hop drowned five bots of six in
 * ten seconds: a hop plus the mid-air flap is a metre and a half of airtime with air control, which on
 * a three-metre platform is three metres of drift into open water. On an island there is no gap to
 * drift into — the ground is one continuous 58 m disc — and `island.holdOnTheIsland` clamps every
 * skating penguin every tick REGARDLESS of height, so the worst a hop at the beach can do is bump an
 * invisible wall. It is also an order of magnitude rarer than the tic it replaces, and only while
 * standing still, so it reads as a penguin enjoying itself rather than as a bot vibrating.
 */
const ROAM_HOP_CHANCE = 0.004;

export interface Bot {
	readonly id: string;
	/** What this bot wants to do this tick. */
	think(world: World): InputFrame;
}

/**
 * Where a wandering penguin is going, and what it means to do when it gets there.
 *
 * Closure state rather than part of `Intent`, and that is the whole design: an `Intent` is re-decided
 * every `reactionTicks` — a third of a second — and an errand that was re-rolled that often would be
 * a penguin changing its mind six times on the way across the square, which is the random walk this
 * exists to avoid. An errand lasts until it is finished.
 */
interface Errand {
	/** The exact spot, not the middle of the place: see `Landmark`. */
	readonly spot: Vec2;
	/** Ticks left standing about, once it has arrived. */
	idleLeft: number;
	/** Ticks left trying to get there at all. See `ROAM_PATIENCE`. */
	walkLeft: number;
}

/** What the bot last decided. Re-decided only every `reactionTicks` — see BOT_REACTION_TICKS. */
interface Intent {
	/** Where it is trying to go, as a direction. */
	move: Vec2;
	target: string | null;
	wander: number;
	/**
	 * The floe it is running for, when the ice under it is going under.
	 *
	 * Null in the classic round, where there is nowhere else to be. In a Royal this outranks every
	 * other intention a bot can hold: a bot that keeps fighting on sinking ice drowns on schedule,
	 * and twenty-nine of them doing it at once is not an opponent, it is a countdown.
	 */
	escapeTo: Floe | null;
}

export function createBot(id: string, difficulty: Difficulty, seed: number): Bot {
	const reactionTicks = BOT_REACTION_TICKS[difficulty];
	const wanderAmount = BOT_WANDER[difficulty];
	const aggression = BOT_AGGRESSION[difficulty];

	// One generator per bot, seeded from the world's seed mixed with a hash of the id, so two bots
	// in the same round do not make identical decisions and the whole round still replays.
	const rng: Rng = createRng(seed ^ hashId(id));

	/** Where this bot waits out the opening grace: its own bearing, so a floe's three spread out. */
	const stationAngle = (hashId(id) % 360) * (Math.PI / 180);

	let intent: Intent = { move: ZERO, target: null, wander: 0, escapeTo: null };
	let sinceDecision: number = reactionTicks;
	/** This bot's current errand, on a mode that has places to walk to. See `Errand`. */
	let errand: Errand | null = null;

	return {
		id,
		think(world) {
			const me = world.penguins.find((p) => p.id === id);
			if (!me) return idle();
			// Out of the round, still in the game: a knocked-out bot lobs the occasional weak snowball
			// from its chunk of ice, exactly as a knocked-out child can. Rarely, and never in unison —
			// the cooldown is three seconds and the dice make it look like a crowd rather than a
			// firing squad. `combat.trySidelineThrow` does the aiming; a bot only decides WHEN.
			if (me.phase === 'out') {
				return { move: ZERO, jump: false, throw: rng.next() < 0.02, dash: false };
			}
			if (me.phase !== 'skating') return idle();

			// How this mode is PLAYED, asked of the registry rather than of the mode's name. One branch
			// per style, and a style shared between modes is the whole point: a twenty-sixth minigame
			// declares an existing one and adds nothing here.
			const spec = modeFor(world.mode);

			// A wanderer takes none of the rest of this file. It does not fight, does not hold a station,
			// does not flee and does not read the gradient for a rim it can never reach — so it returns
			// its own frame here rather than being threaded through `decide` and `steer` as a fourth kind
			// of intent. That keeps the four shipped modes untouched by this feature, which is worth more
			// than the shared code path would have been.
			if (spec.bot === 'roam' && spec.landmarks) {
				errand = keepGoing(spec.landmarks, errand, me, rng);
				const move = paceToward(errand.spot, me.pos);
				return {
					move,
					// Only while standing about, and only rarely. See `ROAM_HOP_CHANCE` for why the tic
					// that drowned a chase field is harmless on a hub — and `ROAM_STILL` for why the test
					// is the stick rather than the errand's own idle counter. Measured: gated on the
					// counter it fired for the whole WALK too, because `idleLeft` is only spent once a bot
					// has arrived, and eight penguins hopping every second and a half across the island
					// is the vibrating-machinery look this feature exists to avoid.
					jump: length(move) < ROAM_STILL && me.height === 0 && rng.next() < ROAM_HOP_CHANCE,
					// Nobody may attack anybody here (`attackStrength` is zero for the whole mode), so a
					// wanderer that threw or dashed would be pressing a button with nothing behind it.
					throw: false,
					dash: false
				};
			}

			// Aggression comes UP over the first seconds of real play rather than switching on: see
			// `BOT_WARMUP_TICKS`. `warmth` is also what `shouldThrow` scales by, so a bot in its first
			// second of the fight is hesitant with everything rather than only with its feet.
			const warmth = warmupFraction(world);
			if (++sinceDecision >= reactionTicks) {
				sinceDecision = 0;
				intent = decide(world, me, rng, wanderAmount, aggression * warmth, stationAngle);
			}

			// Steering is re-derived every tick from the CURRENT position even though the decision is
			// stale, so a bot does not walk into the sea while it waits to think again. The delay is
			// meant to slow its judgement, not its balance.
			const goal = steer(world, me, intent);
			const throwing = shouldThrow(world, me, intent, aggression * warmth, rng);
			const dashing = shouldDash(world, me, intent);

			const style = spec.bot;

			// A gap in the chute is jumped, not steered around: `shouldLeap` covers a Royal's floes and
			// this covers the mountain's, and both are the same question — is the ice about to run out
			// in front of me.
			const overTheGap =
				(style === 'downhill' && gapAhead(world, me)) || (style === 'flee' && atTheEdge(world, me));

			// The idle hop: 2% a tick, and it is what stops a bot reading as a thing on rails. It is
			// also LETHAL in a chase, and finding that out was worth the whole diagnosis. A hop plus
			// the mid-air flap is a metre and a half of airtime with air control, which on a 7.6 m
			// floe is decoration and on a 3 m platform is three metres of drift into open water:
			// five bots out of six drowned in the first ten seconds, none of them anywhere near a
			// gap. Where the jump is a TOOL, it is not also a tic.
			const fidget =
				style !== 'flee' && !dashing && me.height === 0 && rng.next() < aggression * 0.02;

			return {
				move: goal,
				// Jumping is rare and defensive — a bot hops when something is about to arrive, which
				// is also the counterplay a player is supposed to discover — EXCEPT when it is leaving
				// a floe, where the jump is the whole manoeuvre and must not be left to a dice roll.
				jump: overTheGap || shouldLeap(world, me, intent) || fidget,
				throw: throwing,
				dash: dashing
			};
		}
	};
}

function idle(): InputFrame {
	return { move: ZERO, jump: false, throw: false, dash: false };
}

/**
 * The stick, for a penguin walking to a spot.
 *
 * The magnitude EASES OFF on arrival, and that is not polish — `types.InputFrame` defines `move`'s
 * magnitude as a speed request rather than only a direction, and a bot that asked for full pace right
 * up to its spot would walk past it and oscillate, which is the machinery-on-rails look this whole
 * feature exists to avoid.
 *
 * It also solves standing still on a slope for free, which a hard stop does not. Releasing the stick
 * inside a zone on Der Berg means releasing it on a 0.3 gradient, and `step.ts` scales grip by
 * deflection (trap 1) — so a bot that let go would slide off the mountain while "idling". Easing off
 * instead settles it where the shrinking request balances gravity: a few tens of centimetres downhill
 * of its spot, standing, exactly as a penguin on a slope should look.
 */
function paceToward(spot: Vec2, from: Vec2): Vec2 {
	const want = sub(spot, from);
	const away = length(want);
	if (away < 1e-6) return ZERO;
	return scale(want, (Math.min(1, away / ROAM_ARRIVED) * ROAM_PACE) / away);
}

/**
 * Carry on with this errand, or take a new one.
 *
 * Three ways an errand ends and they are all here rather than spread through `think`: it arrived and
 * has finished standing about, it never arrived and has run out of patience, or there was no errand to
 * begin with.
 */
function keepGoing(
	landmarks: readonly Landmark[],
	errand: Errand | null,
	me: Penguin,
	rng: Rng
): Errand {
	if (!errand) return newErrand(landmarks, me, rng);

	if (distance(errand.spot, me.pos) > ROAM_ARRIVED) {
		errand.walkLeft--;
		// Out of patience. Somewhere else is a better idea than pushing at this for the rest of the
		// round — and it means a bot that is being leaned on, or that picked a spot it cannot hold,
		// heals itself instead of standing in one place looking broken.
		return errand.walkLeft > 0 ? errand : newErrand(landmarks, me, rng);
	}

	errand.idleLeft--;
	return errand.idleLeft > 0 ? errand : newErrand(landmarks, me, rng);
}

/**
 * Pick somewhere to go, and a spot in it to stand.
 *
 * Never the place it is already standing in, which is the difference between an inhabitant and a
 * decoration: a bot that could re-pick its own landmark would sometimes stand at one for a whole
 * round. It falls back to the full list only if it is somehow inside all of them at once — which the
 * layout makes impossible (`island.test.ts` proves the zones do not overlap) but which must not become
 * an empty choice if that ever stops being true.
 *
 * The SPOT is inside the radius on its own bearing, not the middle. Six bots aiming at one point
 * arrive on top of each other and `combat.resolveCollisions` separates them — correctly, and hard
 * enough to matter — which is the bug `awayFromTheHunter` records paying for on a chase platform.
 */
function newErrand(landmarks: readonly Landmark[], me: Penguin, rng: Rng): Errand {
	const elsewhere = landmarks.filter((place) => distance(place.at, me.pos) > place.radius);
	const options = elsewhere.length > 0 ? elsewhere : landmarks;
	const place = options[Math.min(options.length - 1, Math.floor(rng.next() * options.length))];
	if (!place) return { spot: me.pos, idleLeft: ROAM_IDLE_MIN, walkLeft: ROAM_IDLE_MIN };

	const angle = rng.next() * Math.PI * 2;
	const out = place.radius * range(rng, 0.2, 0.7);
	const spot = { x: place.at.x + Math.sin(angle) * out, z: place.at.z + Math.cos(angle) * out };
	// The budget is the walk itself, times `ROAM_PATIENCE`. Derived per errand rather than one number
	// for the whole island, so crossing it and stepping off the square cost what they actually cost.
	const walk = (distance(spot, me.pos) / WALK_SPEED) * TICK_RATE;
	return {
		spot,
		idleLeft: Math.round(range(rng, ROAM_IDLE_MIN, ROAM_IDLE_MAX)),
		walkLeft: Math.ceil(walk * ROAM_PATIENCE) + ROAM_IDLE_MIN
	};
}

/**
 * Pick a goal. Called once every `reactionTicks`, not every tick.
 *
 * Self-preservation outranks aggression, always: a bot that is drifting toward the rim heads for
 * the middle even with a target in front of it. Without that ordering, bots chase players off the
 * edge and follow them in, which reads as broken rather than as easy.
 */
function decide(
	world: World,
	me: Penguin,
	rng: Rng,
	wanderAmount: number,
	aggression: number,
	stationAngle: number
): Intent {
	const wander = (rng.next() * 2 - 1) * wanderAmount;
	const under = floeUnder(world.floes, me.pos);
	const home = under ? localTo(under, me.pos) : me.pos;
	const style = modeFor(world.mode).bot;

	// And in a chase there is one thing to do too: go. A fleeing bot does not fight, does not hold a
	// station and does not stop to look — the thing behind it is faster than standing still, which is
	// the whole rule of the mode expressed as behaviour.
	if (style === 'flee') {
		return {
			move: awayFromTheHunter(world, me, Math.sin(stationAngle)),
			target: null,
			wander: wander * 0.3,
			escapeTo: null
		};
	}

	// On the mountain there is only one thing to do: go down it, and stay on it. No stations, no
	// targets, no fighting — a racer that stopped to shove somebody would simply lose, which is the
	// same reason a child does not do it either.
	if (style === 'downhill') {
		return {
			move: downhill(world, me, under),
			target: null,
			wander: wander * 0.35,
			escapeTo: null
		};
	}

	// While nobody may attack anybody, a bot holds a STATION: its own spot on its own floe, half way
	// out, kept against the tilt. No target, because there is nothing it could do with one.
	//
	// Three wrong versions before this. Chasing through the grace put everyone in contact with a full
	// dash ready the tick it expired. Walking to the middle was worse — three penguins converging on
	// one point overlap, the separation impulse that keeps bodies apart accumulates while they push,
	// and the whistle threw every floe's passengers off the rim at once. Standing still was worst of
	// all, and the most instructive: the ice TILTS, so three seconds of standing still is three
	// seconds of sliding, and the field died at the rim just as the grace ended. Holding a station is
	// the only version that is actually what a player does with those seconds.
	if (!attacksAllowed(world)) {
		return {
			move: toStation(me, under, stationAngle),
			target: null,
			wander: wander * 0.3,
			escapeTo: null
		};
	}

	// Leaving beats everything, including standing up. A floe that has started to go, or is about to,
	// is not a place to win a fight on.
	const leaving = escapeFloe(world, me, under);
	if (leaving) {
		return {
			move: normalize(sub(leaving.center, me.pos)),
			target: null,
			wander,
			escapeTo: leaving
		};
	}

	if (inDanger(me, under)) {
		return { move: normalize(scale(home, -1)), target: null, wander, escapeTo: null };
	}

	const prey = nearestRival(world, me, under);
	// An unaggressive bot spends most of its time keeping its footing near the middle, which is what
	// makes the easy setting easy: it is not bad at fighting, it mostly is not fighting.
	if (!prey || rng.next() > aggression) {
		return { move: normalize(scale(home, -0.6)), target: null, wander, escapeTo: null };
	}
	return { move: normalize(sub(prey.pos, me.pos)), target: prey.id, wander, escapeTo: null };
}

/**
 * How far into its warm-up the round is: 0 while nobody may attack, 1 once the opening is over.
 *
 * A fraction rather than a switch, because the switch is what made the whistle a massacre.
 */
function warmupFraction(world: World): number {
	if (!attacksAllowed(world)) return 0;
	const since = world.round.ticks - ROUND_GRACE_TICKS;
	return Math.max(0, Math.min(1, since / BOT_WARMUP_TICKS));
}

/**
 * Is the run about to stop being there?
 *
 * A gap is a missing segment, and at full speed a penguin clears it without doing anything — the
 * jump matters when the bend before it has cost them their speed. A bot checks the ice a third of a
 * second in front of its own nose, which at 12 m/s is four metres.
 */
function gapAhead(world: World, me: Penguin): boolean {
	if (me.height > 0) return false;
	const speed = length(me.vel);
	if (speed < 1) return false;
	const ahead = {
		x: me.pos.x + (me.vel.x / speed) * Math.max(3, speed * 0.35),
		z: me.pos.z + (me.vel.z / speed) * Math.max(3, speed * 0.35)
	};
	return !floeUnder(world.floes, ahead);
}

/**
 * The way down the chute: hold a LINE, rather than aim at a point.
 *
 * Aiming at the centre of a segment further down the hill is the obvious control law and it does not
 * survive contact with speed. At 15 m/s the target moves faster than the correction arrives, so a bot
 * oscillates across the run, climbs the bank, and goes over the top of it — five of six, at the same
 * corner, every seed.
 *
 * So this is cross-track control instead, which is what a person actually does: work out how far off
 * the line you are, and lean back toward it by an amount proportional to the error. The line is the
 * middle of the run on a straight and a little to the inside through a bend, which is the racing line
 * and also the side a mistake is survivable on.
 */
function downhill(world: World, me: Penguin, under: Floe | null): Vec2 {
	if (!under) return ZERO;
	const at = world.floes.indexOf(under);
	if (at < 0) return ZERO;

	const along = segmentHeading(under);
	const across = { x: -along.z, z: along.x };

	// Where the run is going a second or so from now, which is what decides the line to hold.
	const speed = length(me.vel);
	const lead = Math.max(2, Math.round((speed * 1.1) / SLIDE_SEGMENT_STEP) + 1);
	const soon = world.floes[Math.min(at + lead, world.floes.length - 1)] ?? under;
	const turning = Math.sign(along.x * segmentHeading(soon).z - along.z * segmentHeading(soon).x);

	// The line: the middle, biased to the inside of whatever is coming.
	const wanted = turning * under.radius * 0.3;
	const offset = (me.pos.x - under.center.x) * across.x + (me.pos.z - under.center.z) * across.z;
	const error = offset - wanted;

	// Lean back toward the line, and never further across than along: a bot that turns broadside at
	// 15 m/s scrubs all its speed and then cannot clear the next gap, which is how they were arriving
	// at one doing 2 m/s.
	const correction = Math.max(-0.9, Math.min(0.9, -error * 0.4));
	return normalize({
		x: along.x + across.x * correction,
		z: along.z + across.z * correction
	});
}

/**
 * Toward this bot's own spot on the floe it is standing on.
 *
 * Half way out and on its own bearing, so the penguins sharing a floe spread around it rather than
 * piling into the middle — and close enough to the station that the answer is usually "stay", which
 * is what makes it look like waiting rather than pacing.
 */
function toStation(me: Penguin, under: Floe | null, angle: number): Vec2 {
	if (!under) return ZERO;
	const station = {
		x: under.center.x + Math.sin(angle) * under.radius * 0.45,
		z: under.center.z + Math.cos(angle) * under.radius * 0.45
	};
	const to = sub(station, me.pos);
	return length(to) < 0.6 ? ZERO : normalize(to);
}

/**
 * The floe to run for, or null to stay put.
 *
 * A bot commits `BOT_ESCAPE_LEAD_TICKS` before its ice actually starts going, so the crossing is a
 * decision rather than a scramble — and it aims at the nearest floe it could reach in one jump,
 * which is the same `JUMP_RANGE` the sea was laid out against. If nothing is in range it stays and
 * fights, because a bot swimming toward ice it cannot reach is a bot that drowns looking silly.
 */
function escapeFloe(world: World, me: Penguin, under: Floe | null): Floe | null {
	if (!under || under.sinkAtTick === Infinity) return null;
	if (world.round.ticks < under.sinkAtTick - BOT_ESCAPE_LEAD_TICKS) return null;

	let best: Floe | null = null;
	let bestSq = Number.POSITIVE_INFINITY;
	for (const floe of reachableFrom(world.floes, under)) {
		const d = distanceSq(floe.center, me.pos);
		if (d < bestSq) {
			bestSq = d;
			best = floe;
		}
	}
	return best;
}

/**
 * Jump NOW, because the ice ends here and the next floe is across the gap.
 *
 * Only at the rim, and only while heading out over it: a bot that jumped the moment it decided to
 * leave would land back on the floe it is trying to escape, and a bot that jumped late would already
 * be in the water. `RIM_LEAP_MARGIN` is how much rim is left when it commits.
 */
function shouldLeap(world: World, me: Penguin, intent: Intent): boolean {
	const to = intent.escapeTo;
	if (!to || me.height > 0) return false;
	const under = floeUnder(world.floes, me.pos);
	if (!under || under.id === to.id) return false;
	// Distance still to cover before the rim, against how far out this tick's velocity is carrying
	// it. Leaping at the rim rather than at a fixed radius keeps it right on a floe that is shrinking
	// under the bot's feet, which is exactly when this fires.
	const local = localTo(under, me.pos);
	const toRim = under.radius - length(local);
	return (
		toRim < 0.9 && distanceSq(to.center, me.pos) < (JUMP_RANGE + to.radius + under.radius) ** 2
	);
}

/**
 * Turn a stale intent into this tick's stick position.
 *
 * Two corrections on top of the stored direction: the wander, which is what stops a bot walking the
 * exact shortest path and reading as machinery, and an uphill bias, because the whole game is about
 * the gradient and a bot that ignored it would be beaten by the floe rather than by the player.
 */
function steer(world: World, me: Penguin, intent: Intent): Vec2 {
	const target = world.penguins.find((p) => p.id === intent.target);
	const under = floeUnder(world.floes, me.pos);
	// While escaping, the stored direction is the only one that matters: chasing a rival across a
	// sinking floe is how a bot ends up in the water with a target still selected.
	const leaving = intent.escapeTo;
	// "Toward the middle" means the middle of the ice this bot is STANDING on. It used to mean the
	// origin, which is the same thing in the classic round and catastrophic in a Royal: every bot on
	// an outer floe walked steadily toward the centre of the sea and straight off its own rim. In the
	// first Royal that ran, twenty-four of thirty were in the water inside nine seconds, none of them
	// pushed by anybody, all of them at the rim facing home.
	const middle = under ? under.center : ZERO;
	const base = leaving
		? normalize(sub(leaving.center, me.pos))
		: target && target.phase === 'skating'
			? normalize(sub(target.pos, me.pos))
			: intent.move.x === 0 && intent.move.z === 0
				? normalize(sub(middle, me.pos))
				: intent.move;

	// Uphill is -slope, on the ice this bot is actually standing on. Reading a different floe's
	// gradient would make a bot on the far side of the sea lean for no reason anyone can see.
	const uphill = scale(under ? under.slope : ZERO, -1);
	const blended = add(base, scale(uphill, 2.2));
	const wandered = heading(blended) + intent.wander;
	return fromHeading(wandered);
}

function shouldThrow(
	world: World,
	me: Penguin,
	intent: Intent,
	aggression: number,
	rng: Rng
): boolean {
	if (me.throwCooldown > 0 || !intent.target) return false;
	// Ask the same question the player's aim assist asks, rather than a second opinion — that is why
	// `aimTarget` is exported. A bot that could hit what the assist cannot would be cheating.
	if (!aimTarget(world, me)) return false;
	return rng.next() < aggression * 0.35;
}

function shouldDash(world: World, me: Penguin, intent: Intent): boolean {
	if (me.dashCooldown > 0 || isDashing(me) || me.height > 0 || !intent.target) return false;
	const target = world.penguins.find((p) => p.id === intent.target);
	if (target?.phase !== 'skating') return false;
	// Only from inside its own reach, and only when roughly facing them — a dash launched sideways
	// throws the bot somewhere useless, which is the mistake a human makes once and stops making.
	if (distanceSq(target.pos, me.pos) > BOT_SHOVE_RANGE ** 2) return false;
	const toward = normalize(sub(target.pos, me.pos));
	const facing = fromHeading(me.facing);
	return toward.x * facing.x + toward.z * facing.z > 0.8;
}

/**
 * Drifting outward, or already too far out. Either one sends the bot back toward the middle.
 *
 * Measured against the floe it is ON — in a Royal "the middle" is the middle of this floe, fifteen
 * metres from the origin, and a bot that measured from the origin would walk into the sea to get
 * "home".
 */
function inDanger(me: Penguin, under: Floe | null): boolean {
	if (!under) return false;
	const local = localTo(under, me.pos);
	const outward = length(local) / Math.max(under.radius, 0.001);
	if (outward > BOT_DANGER_FRACTION) return true;
	// Moving outward fast enough that it will be in trouble before it next thinks.
	const drift = local.x * me.vel.x + local.z * me.vel.z;
	return outward > 0.4 && drift > 0;
}

/**
 * The nearest rival worth chasing — and in a Royal, only one on the SAME floe.
 *
 * Without that filter a bot walks off its own rim toward somebody standing on the next island, which
 * is both suicidal and completely baffling to watch.
 */
function nearestRival(world: World, me: Penguin, under: Floe | null): Penguin | undefined {
	let best: Penguin | undefined;
	let bestSq = Number.POSITIVE_INFINITY;
	for (const other of world.penguins) {
		if (other.id === me.id || other.phase !== 'skating') continue;
		if (under && floeUnder(world.floes, other.pos)?.id !== under.id) continue;
		// Ignore anyone mid-jump: they cannot be shoved (see STOMP_HEIGHT_GAP) and chasing one is
		// how a bot ends up standing under a stomp.
		if (other.height > JUMP_APEX * 0.6) continue;
		const d = distanceSq(other.pos, me.pos);
		if (d < bestSq) {
			bestSq = d;
			best = other;
		}
	}
	return best;
}

/** A small stable hash, so each bot's generator differs but the round still replays. */
function hashId(id: string): number {
	let h = 2166136261;
	for (let i = 0; i < id.length; i++) {
		h ^= id.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return h >>> 0;
}

/**
 * Where a fleeing bot goes: the middle of the next platform down the line.
 *
 * The next PLATFORM rather than simply "forward", because the course jitters side to side and a bot
 * running straight down the middle walks off into the water at the first offset one. It aims at the
 * nearest floe that is further along than it is, which is the same decision a child makes and for
 * the same reason.
 */
function awayFromTheHunter(world: World, me: Penguin, lane = 0): Vec2 {
	const mine = alongCourse(world.floes, me.pos);
	let best: Floe | null = null;
	let nearest = Infinity;
	for (const floe of world.floes) {
		const at = floe.along;
		// Strictly ahead, and by enough that the platform it is standing on does not qualify.
		if (at <= mine + 0.5) continue;
		if (at < nearest) {
			nearest = at;
			best = floe;
		}
	}
	// Nothing ahead means the shore is behind it, which only happens once — keep going anyway.
	if (!best) return { x: 0, z: -1 };

	// Not at the CENTRE of it: at this bot's own lane across it.
	//
	// Six bots aiming at one point on a three-metre platform arrive on top of each other, and
	// `combat.resolveCollisions` then separates them — correctly, and hard enough to send them off at
	// eight metres a second. A jump at that speed clears the NEXT platform entirely, so the pile-up
	// at one gap drowned the field at the one after it, and every symptom pointed at the jump.
	// `lane` is a fixed per-bot number, so a bot keeps its side of the route rather than swapping
	// lanes every time it re-decides.
	const across = { x: 1, z: 0 };
	const aim = {
		x: best.center.x + across.x * lane * best.radius * 0.55,
		z: best.center.z
	};
	const to = sub(aim, me.pos);
	const size = length(to);
	return size < 1e-6 ? { x: 0, z: -1 } : scale(to, 1 / size);
}

/**
 * Is the ice about to run out in front of a fleeing bot?
 *
 * The same question `gapAhead` asks on the mountain, against the platform it is aiming AT rather
 * than the segment it is on: a chase course is discs with real water between them, so the answer is
 * "the next thing I want to stand on is further away than I am from the edge of this one".
 */
function atTheEdge(world: World, me: Penguin): boolean {
	const under = floeUnder(world.floes, me.pos);
	if (!under || me.height > 0) return false;
	const heading = awayFromTheHunter(world, me);
	// The lane is left out here on purpose: this asks "is there ice straight in front of me", and the
	// answer must not depend on which part of the next platform this particular bot is aiming for.
	// A jump takes off from near the rim. Half a metre inside it is close enough to commit and far
	// enough that a bot does not hop on the spot in the middle of a platform.
	const ahead = {
		x: me.pos.x + heading.x * BOT_LEAP_LOOKAHEAD,
		z: me.pos.z + heading.z * BOT_LEAP_LOOKAHEAD
	};
	return !floeUnder(world.floes, ahead);
}
