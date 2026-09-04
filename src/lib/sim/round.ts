/**
 * A round that starts, ends, and names a winner.
 *
 * Three phases and one rule each: nobody may act during the countdown, the world changes while
 * playing, and once someone has won nothing anyone presses matters. All of it pure — the round knows
 * about ticks and never about a clock.
 *
 * What it deliberately does NOT know is which game it is running. It used to: there was a
 * `if (!isRoyal(world))` in the middle of `stepRound`, a `world.mode === 'slide'` in
 * `attackStrength`, and two more in `endRoundIfDecided`. All four are now questions asked of
 * `sim/modes/` — the phase machine here, the game's own rules there.
 */

import { ROUND_GRACE_TICKS, ROUND_OVER_TICKS, TICK_RATE } from './constants';
import { modeFor, ROYAL } from './modes/registry';
import type { Round, RoundPhase, World } from './types';

// The ice arithmetic moved to `ice.ts` when the mode registry arrived: how wide a floe is at tick N is
// shared between modes, and WHICH of those rules applies is the mode's business. Re-exported because
// this is where every caller has always found it.
export { floeRadiusAt, royalMiddleRadiusAt, sinkingRadiusAt } from './ice';
// And `alive` lives beside the endings that ask it, for the import direction `sim/modes/policy.ts`
// explains: nothing in `modes/` may import this file, because this file asks the registry.
export { alive } from './modes/policy';

/**
 * A fresh round, in the phase the mode opens in.
 *
 * `countdown` for anything that is a round. The island opens in `playing`, because roaming has
 * nothing to count down to — see `GameMode.opening`.
 */
export function createRound(phase: RoundPhase = 'countdown'): Round {
	return { phase, ticks: 0, winner: null };
}

/**
 * Is this a Pingu Royal?
 *
 * It used to be derived from the sea — one floe meant the classic round, several meant a Royal —
 * which was the better arrangement while it was true, because a derived fact cannot disagree with
 * what it describes. The SLIDE ended it: a mountain chute is forty floes and is not a Royal.
 *
 * It asks the REGISTRY rather than comparing a string, and the two things it used to gate — which ice
 * rule runs and how long the backstop is — are now `GameMode.reshape` and `GameMode.ends`. What is
 * left is a question the outside still wants to ask about the shape of the sea.
 */
export function isRoyal(world: World): boolean {
	return modeFor(world.mode) === ROYAL;
}

/**
 * May anybody hit anybody yet?
 *
 * False for the first `ROUND_GRACE_TICKS` of play, and false for the whole of a mode that forbids it.
 * Everything that CAUSES a stun asks this — the snowball, the shove, the stomp — so there is one
 * answer rather than three, and the grace cannot be half-implemented by a new attack that forgets to
 * check.
 */
export function attacksAllowed(world: World): boolean {
	return attackStrength(world) > 0;
}

/**
 * How hard anybody may hit anybody, 0..1.
 *
 * The mode decides. Three of them ramp up over `ROUND_GRACE_FADE_TICKS` after the opening grace and
 * two never allow an attack at all (`modes/policy.ts` argues both). Everything that knocks somebody
 * about scales by this, so the protection cannot be half-implemented by an attack that forgot to ask.
 */
export function attackStrength(world: World): number {
	return modeFor(world.mode).attackStrength(world);
}

/** Seconds of that grace left, for the HUD. Zero once the fight is on. */
export function graceLeft(world: World): number {
	if (world.round.phase !== 'playing') return ROUND_GRACE_TICKS / TICK_RATE;
	return Math.max(0, ROUND_GRACE_TICKS - world.round.ticks) / TICK_RATE;
}

/**
 * Should this penguin's input be ignored this tick?
 *
 * The one place the answer lives, and it now has three reasons rather than one: the countdown has
 * not finished, the round is over, or the penguin is stunned. `step` asks once and substitutes
 * NO_INPUT — the seam that already existed for stun, widened rather than duplicated.
 */
export function inputIsFrozen(world: World): boolean {
	return world.round.phase !== 'playing';
}

/**
 * Should the penguins be held still entirely — not merely deaf to their controls?
 *
 * Only during the countdown, and the distinction is not pedantry. Ignoring input still leaves
 * gravity running, so on a floe that is already wobbling a player slides for two seconds before
 * they are allowed to do anything about it, and can be in the water before the round starts. That
 * is the least acceptable way to lose there is.
 *
 * Once the round is OVER the opposite is right: physics keeps running and everyone slides to a
 * halt, because a world that freezes on the instant of victory looks like a crash.
 */
export function motionIsFrozen(world: World): boolean {
	return world.round.phase === 'countdown';
}

/**
 * Advance the round's own state, and let the mode reshape the world. Called BEFORE anyone moves.
 *
 * Deliberately split from `endRoundIfDecided`: the radius has to be set before the rim check reads
 * it, and the end condition has to be judged after the fall it is judging. Doing both here made the
 * round miss the tick on which the second-to-last penguin actually became `out`, so a round with a
 * clear winner sat in `playing` for one more tick than it should — invisible in play, and exactly
 * the kind of off-by-one that a phase-3 client and host disagree about.
 */
export function stepRound(world: World): void {
	const round = world.round;
	round.ticks++;

	if (round.phase === 'countdown') {
		// How long the controls stay asleep is the MODE's, not a global three seconds: a countdown and a
		// gondola ride up a mountain are the same phase seen from two ends. See `GameMode.opensAfter`,
		// which also records why this cannot disturb the no-hitting grace.
		if (round.ticks >= modeFor(world.mode).opensAfter) {
			round.phase = 'playing';
			round.ticks = 0;
		}
		return;
	}
	if (round.phase === 'over') return;

	modeFor(world.mode).reshape(world);
}

/** Judge the end condition, AFTER everyone has moved and fallen. */
export function endRoundIfDecided(world: World): void {
	const round = world.round;
	if (round.phase !== 'playing') return;

	const done = modeFor(world.mode).ends(world);
	if (!done) return;

	round.phase = 'over';
	round.ticks = 0;
	round.winner = done.winner;
}

/** Has the result been on screen long enough to offer a rematch? */
export function canRestart(world: World): boolean {
	return world.round.phase === 'over' && world.round.ticks >= ROUND_OVER_TICKS;
}
