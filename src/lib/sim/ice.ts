/**
 * How much ice there is, and what a break leaves behind.
 *
 * All of it pure and expressed against the tick count rather than accumulated in place, for the
 * reason `round.ts` learned once and this file inherits: a radius decremented tick by tick cannot be
 * asked "how wide were you at second forty" by a test that did not simulate up to it, and it drifts
 * between a host and a client that ran a different number of ticks.
 *
 * Split out of `round.ts` because the ROUND is a phase machine — countdown, play, result — and how
 * the ice behaves during the play is a property of the MODE. `sim/modes/` picks one of the two
 * arrangements below as its `reshape`, and the round no longer has to know which game it is running.
 */
import { breakInTwo, penguinsOn } from './archipelago';
import {
	DT,
	FLOE_MIN_RADIUS,
	FLOE_RADIUS,
	ROYAL_MIDDLE_SHRINK_TICKS,
	SHRINK_RATE,
	SHRINK_START_TICKS
} from './constants';
import type { Floe, World } from './types';
import { add, scale } from './vec';

/**
 * How wide the floe is at a given point in the round.
 *
 * Continuous rather than in chunks — see SHRINK_START_TICKS for why that is a deliberate deviation
 * from the story as written.
 */
export function floeRadiusAt(playingTicks: number): number {
	const shrinking = Math.max(0, playingTicks - SHRINK_START_TICKS);
	return Math.max(FLOE_MIN_RADIUS, FLOE_RADIUS - shrinking * DT * SHRINK_RATE);
}

/**
 * How wide a sinking floe is at a given tick.
 *
 * Against the floe's ORIGINAL radius rather than its current one — see the note at the top.
 */
export function sinkingRadiusAt(floe: Floe, playingTicks: number): number {
	if (playingTicks < floe.sinkAtTick) return floe.fullRadius;
	const gone = (playingTicks - floe.sinkAtTick) / Math.max(1, floe.sinkTicks);
	return Math.max(0, floe.fullRadius * (1 - gone));
}

/**
 * The middle floe of a Royal, which never sinks but does close in.
 *
 * It starts shrinking once the ring is gone, at the classic rate, so the finale is the ending this
 * game already has: a handful of penguins on ice that is running out. Without it a Royal that came
 * down to two cautious survivors would sit on a full-size disc until the backstop.
 */
export function royalMiddleRadiusAt(floe: Floe, playingTicks: number): number {
	const shrinking = Math.max(0, playingTicks - ROYAL_MIDDLE_SHRINK_TICKS);
	return Math.max(FLOE_MIN_RADIUS, floe.fullRadius - shrinking * DT * SHRINK_RATE);
}

/**
 * The classic arrangement: one floe, and it shrinks.
 *
 * **`floes[0]` and only `floes[0]`.** That is exactly what it did when this lived inside
 * `round.ts` behind `if (!isRoyal(world))`, which means the SLIDE and the CHASE were running it too
 * — see the note on `shrinkTheStartLine` in `sim/modes/policy.ts`, which is where that inheritance
 * is now written down instead of hidden in a negation.
 */
export function shrinkTheOneFloe(world: World): void {
	const only = world.floes[0];
	if (only) only.radius = floeRadiusAt(world.round.ticks);
}

/**
 * A Royal: the ring BREAKS one floe at a time and the middle closes in afterwards.
 */
export function sinkTheRing(world: World): void {
	breakArrivedFloes(world, world.round.ticks);

	for (const floe of world.floes) {
		floe.radius =
			floe.sinkAtTick === Infinity
				? royalMiddleRadiusAt(floe, world.round.ticks)
				: sinkingRadiusAt(floe, world.round.ticks);
	}

	driftBrokenIce(world);

	// Ice with nothing left of it is removed rather than kept at radius zero: `floeUnder` already
	// ignores it, and a sea that only ever grows is a list that a fifteen-minute round would fill
	// with slivers nobody can see.
	world.floes = world.floes.filter((floe) => floe.radius > 0.05 || floe.sinkAtTick === Infinity);
}

/**
 * Split every floe whose time has come, in place.
 *
 * A whole floe BREAKS: it leaves two smaller pieces drifting apart, each with its own few seconds
 * left. That is the difference between ice that melts — which happens at the rim, where nobody is
 * looking, and reads as the arena quietly getting smaller — and ice that gives way under somebody,
 * which is a thing that happens AT a moment and can be seen coming (`breakWarning`).
 *
 * A penguin standing over the crack when it opens is over water, and `step.ts` takes it. Nothing
 * here has to know that.
 */
function breakArrivedFloes(world: World, playingTicks: number): void {
	const breaking = world.floes.filter(
		(floe) => !floe.piece && floe.sinkAtTick !== Infinity && playingTicks >= floe.sinkAtTick
	);
	if (breaking.length === 0) return;

	for (const floe of breaking) {
		const pieces = breakInTwo(floe, playingTicks, world.nextFloeId);
		world.nextFloeId += pieces.length;
		const at = world.floes.indexOf(floe);
		world.floes.splice(at, 1, ...pieces);
	}
}

/**
 * Carry the broken ice, and everyone standing on it.
 *
 * A fragment that slid out from under its passengers would be a rug pull rather than a raft: the
 * penguins would stand still in world space while their ice left, which reads as the penguins
 * moving. So whoever is on it moves with it — that is what makes riding a piece away from the fight
 * something a player can decide to do.
 */
function driftBrokenIce(world: World): void {
	for (const floe of world.floes) {
		if (floe.drift.x === 0 && floe.drift.z === 0) continue;
		const step = scale(floe.drift, DT);
		for (const p of penguinsOn(floe, world.penguins)) {
			p.pos = add(p.pos, step);
		}
		floe.center = add(floe.center, step);
	}
}
