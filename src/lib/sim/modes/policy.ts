/**
 * The shared answers a mode can give to the questions `step.ts` and `round.ts` ask it.
 *
 * A descriptor in this directory is mostly a choice between these: two modes drown you at the rim
 * and two put you back on the course, three ramp their attacks up after the opening grace and two
 * never allow one at all. Written once here, chosen by name there — so "the classic ending" is one
 * function with one docblock rather than a rule re-derived in every new minigame.
 *
 * Nothing in `sim/modes/` may import `round.ts` or `step.ts`: those two ask the registry, so the
 * arrow only ever points this way. That is why the pieces below live here and not beside their
 * callers.
 */
import { ROUND_GRACE_FADE_TICKS, ROUND_GRACE_TICKS, SLIDE_RECOVER_TICKS } from '../constants';
import { shrinkTheOneFloe } from '../ice';
import type { Floe, Penguin, World } from '../types';
import { ZERO } from '../vec';
import type { Ending } from './mode';

/**
 * Everyone who has not gone in the water. What every ending asks.
 *
 * Here rather than in `round.ts` for the import direction above; `round.ts` re-exports it, which is
 * where every caller has always found it.
 */
export function alive(world: World): readonly string[] {
	return world.penguins.filter((p) => p.phase !== 'out').map((p) => p.id);
}

/** A hook that does nothing. Named, so a descriptor says so out loud instead of omitting a field. */
export function nothing(): void {}

/**
 * How hard anybody may hit anybody, 0..1: zero through the opening grace, then up to full over
 * `ROUND_GRACE_FADE_TICKS`.
 *
 * The fade is not politeness. A rule that flips at one tick is a rule a client running `LEAD_TICKS`
 * ahead of the host disagrees with, and an 8 m/s shove is a big thing to disagree about —
 * `session.test.ts` measured 0.69 m of correction and refused it.
 */
export function graceFade(world: World): number {
	if (world.round.phase !== 'playing') return 0;
	const since = world.round.ticks - ROUND_GRACE_TICKS;
	if (since <= 0) return 0;
	return Math.min(1, since / ROUND_GRACE_FADE_TICKS);
}

/**
 * Nobody may hit anybody, ever.
 *
 * The slide, because six penguins shoulder to shoulder on a five-metre chute at 8 m/s do not need
 * help knocking each other off — with the shove live, half the field was in the sea within a second
 * of the grace lifting and the winner was whoever happened not to be touched. And the island,
 * because a hub is not a fight. Contact still SEPARATES in both; it just does not stun or launch.
 */
export function noAttacks(): number {
	return 0;
}

/**
 * The rim, as the end of your round.
 *
 * Through `falling` rather than straight to `out`, because a penguin that vanishes on the frame it
 * crosses the rim looks like a bug to an eight-year-old, who did not see the rim.
 */
export function drown(_world: World, p: Penguin): void {
	p.phase = 'falling';
	p.fallTicks = 0;
}

/**
 * Put a racer who has left the course back on it, stopped, and dizzy for a moment.
 *
 * Used by the slide and the chase, which are the two modes where the water is a cost rather than the
 * end of your round. The chase asks for it more loudly than the slide does: a platformer whose every
 * missed landing ends the round is a platformer an eight-year-old plays for fifteen seconds, and the
 * mode already has a punishment for being slow — the thing behind you keeps coming while you climb
 * out, so a fall costs exactly the ground the sea lion makes up. That is a far better rule than
 * drowning, because the player can SEE the cost arriving.
 *
 * Back on the LAST ice they touched — the nearest segment to where they went over — rather than at
 * the start or the next checkpoint: they lose their speed and the seconds it takes to get it back,
 * which is exactly the cost of a mistake in a race and nothing more.
 *
 * Except over a GAP, and that exception is the difference between a penalty and a trap. Set down on
 * the segment before a hole, a racer starts from a standstill with five metres of run-up and has to
 * clear three and a half metres of nothing — which they cannot, so they fall in again, and again,
 * and the race never ends. Measured: everybody stuck at segment 16 of 57 for the remaining forty
 * seconds. If the nearest segment has no neighbour ahead of it, the recovery is on the far side of
 * the hole: falling in already cost the two seconds, and it must not also cost the race.
 */
export function recoverOnTheCourse(world: World, p: Penguin): void {
	let nearest: Floe | undefined;
	let at = -1;
	let best = Infinity;
	for (const [i, floe] of world.floes.entries()) {
		const d = (floe.center.x - p.pos.x) ** 2 + (floe.center.z - p.pos.z) ** 2;
		if (d < best) {
			best = d;
			nearest = floe;
			at = i;
		}
	}
	if (!nearest) return;
	const next = world.floes[at + 1];
	if (next && next.id !== nearest.id + 1) nearest = next;
	p.pos = { x: nearest.center.x, z: nearest.center.z };
	p.vel = ZERO;
	p.height = 0;
	p.heightVel = 0;
	p.stunTicks = Math.max(p.stunTicks, SLIDE_RECOVER_TICKS);
}

/**
 * The classic ending: one penguin left, or nobody, or the backstop.
 *
 * Nobody happens when the last two go in on the same tick, which is a draw rather than a crash.
 *
 * The backstop is the second half. A round that has run its full length with several players still
 * circling each other has stopped being a game; it ends as a draw rather than continuing forever. A
 * Royal gets a longer one, because its own clock — the sinking ring — takes about a hundred seconds
 * to run.
 */
export function lastStanding(world: World, maxTicks: number): Ending | null {
	const standing = alive(world);
	if (standing.length <= 1) return { winner: standing[0] ?? null };
	if (world.round.ticks >= maxTicks) return { winner: null };
	return null;
}

/**
 * A race: it ends when somebody ARRIVES.
 *
 * Every other mode in this game ends when one penguin is left, and a race that waited for that would
 * keep going after the winner had crossed — with the winner standing at the bottom watching, which
 * is the least satisfying way to win anything. The last-one-standing rule stays underneath it, for
 * the run where everybody else falls in.
 */
export function firstToArrive(
	world: World,
	arrived: (world: World, p: Penguin) => boolean,
	maxTicks: number
): Ending | null {
	const first = world.penguins.find((p) => arrived(world, p));
	if (first) return { winner: first.id };
	return lastStanding(world, maxTicks);
}

/** It does not end. The island: nobody is eliminated, nothing shrinks, nobody wins. */
export function neverEnds(): Ending | null {
	return null;
}

/**
 * The classic shrink, applied to `floes[0]` of a mountain or a chase course.
 *
 * **This is inherited behaviour and it is almost certainly wrong.** It is exactly what the code did
 * before the registry existed: `round.ts` shrank `floes[0]` for every mode that was not a Royal, and
 * the slide and the chase were not Royals. So the first chute segment — built 5.2 m wide — is set to
 * `FLOE_RADIUS` (7.6 m) on the first playing tick, and a chase's start line (6.5 m) likewise, and
 * both then shrink to `FLOE_MIN_RADIUS` over the following forty-five seconds. A racer can stand on
 * two and a half metres of ice the renderer never drew, which is `docs/DESIGN.md` rule 2 — every
 * death is explainable in the second after it happens — failing in the player's favour.
 *
 * It is preserved here rather than fixed because this refactor is not allowed to change behaviour,
 * and named rather than left implicit in a negation so the fix is a one-line change to two
 * descriptors instead of an archaeology exercise.
 */
export function shrinkTheStartLine(world: World): void {
	shrinkTheOneFloe(world);
}
