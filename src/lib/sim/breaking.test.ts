import { describe, expect, it } from 'vitest';
import { breakWarning, floeUnder, layout, penguinsOn } from './archipelago';
import {
	COUNTDOWN_TICKS,
	ROYAL_PIECE_FRACTION,
	ROYAL_PIECE_SINK_TICKS,
	ROYAL_PLAYERS,
	ROYAL_WARN_TICKS,
	TICK_RATE
} from './constants';
import { step } from './step';
import type { Floe, World } from './types';
import { createWorld, spawnPenguin } from './world';

/** A Royal in play, with the clock wound forward to just before `floe` gives way. */
function justBefore(floe: Floe, world: World, lead = ROYAL_WARN_TICKS + 5): void {
	world.round.phase = 'playing';
	world.round.ticks = floe.sinkAtTick - lead;
}

/**
 * The floe that goes FIRST.
 *
 * Not `floes[1]`: the ring sinks from the outside in, so the array order and the clock order are
 * deliberately different. Winding the clock to the last floe's moment breaks every other floe in
 * the same tick, which is a different test and a confusing way to fail this one.
 */
function firstToGo(world: World): Floe | undefined {
	return world.floes
		.filter((f) => f.sinkAtTick !== Infinity)
		.sort((a, b) => a.sinkAtTick - b.sinkAtTick)[0];
}

function royal(seed = 31): World {
	const world = createWorld(
		Array.from({ length: ROYAL_PLAYERS }, (_, i) => `p${i}`),
		seed,
		'royal'
	);
	world.round.phase = 'playing';
	return world;
}

describe('ice that breaks', () => {
	it('warns before it goes, for five whole seconds', () => {
		// The failure this replaces: a floe that quietly shrank. It happens at the RIM, where nobody
		// is looking, and by the time a child notices the ice is smaller they are standing on the last
		// of it. Three seconds is two strides and a jump.
		const world = royal();
		const doomed = firstToGo(world);
		expect(doomed).toBeDefined();
		if (!doomed) return;

		expect(breakWarning(doomed, doomed.sinkAtTick - ROYAL_WARN_TICKS - 1)).toBe(0);
		expect(breakWarning(doomed, doomed.sinkAtTick - ROYAL_WARN_TICKS / 2)).toBeCloseTo(0.5, 1);
		expect(breakWarning(doomed, doomed.sinkAtTick)).toBe(1);
		// FIVE seconds, not three. A floe is up to fifteen metres across and a penguin walks at
		// 3.6 m/s, so three seconds meant the ice decided who lived by where they happened to be
		// standing when it started cracking; five is enough to cross the widest floe in the sea.
		expect(ROYAL_WARN_TICKS / TICK_RATE).toBe(5);
	});

	it('does not warn about ice that is never going anywhere', () => {
		// Non-vacuousness: a warning that fired for the middle floe as well would put a countdown on
		// the one piece of ice in a Royal that is safe.
		const world = royal();
		const middle = world.floes[0];
		expect(middle?.sinkAtTick).toBe(Infinity);
		if (middle) expect(breakWarning(middle, 99_999)).toBe(0);
	});

	it('breaks into two smaller floes that drift apart', () => {
		const world = royal();
		const doomed = firstToGo(world);
		if (!doomed) throw new Error('nothing doomed');
		justBefore(doomed, world);
		const before = world.floes.length;
		const wasWhere = { ...doomed.center };

		// Past the moment.
		for (let i = 0; i < ROYAL_WARN_TICKS + 30; i++) step(world, new Map());

		expect(world.floes.some((f) => f.id === doomed.id)).toBe(false);
		expect(world.floes.length).toBe(before + 1);

		const pieces = world.floes.filter((f) => f.piece);
		expect(pieces).toHaveLength(2);
		for (const piece of pieces) {
			// Smaller than the floe it came off — two of them do not cover the original, which is what
			// makes a break a loss of space rather than a rearrangement.
			expect(piece.fullRadius).toBeLessThan(doomed.fullRadius);
			expect(piece.fullRadius).toBeCloseTo(doomed.fullRadius * ROYAL_PIECE_FRACTION, 1);
			// Moving, and away from where the floe used to be.
			expect(Math.hypot(piece.drift.x, piece.drift.z)).toBeGreaterThan(0);
		}
		const [a, b] = pieces;
		if (!a || !b) return;
		// Apart from each other, and on opposite sides of where their parent was.
		const gap = Math.hypot(a.center.x - b.center.x, a.center.z - b.center.z);
		expect(gap).toBeGreaterThan(0);
		expect(Math.hypot(a.center.x - wasWhere.x, a.center.z - wasWhere.z)).toBeGreaterThan(0);
	});

	it('breaks along the crack it advertised', () => {
		// The renderer draws the crack from `breakAngle` during the warning; the simulation splits
		// across the same angle. A child told where the ice would give way and then dropped somewhere
		// else has been lied to by the one cue that was supposed to save them.
		const world = royal(77);
		const doomed = firstToGo(world);
		if (!doomed) throw new Error('nothing doomed');
		const angle = doomed.breakAngle;
		justBefore(doomed, world);
		for (let i = 0; i < ROYAL_WARN_TICKS + 5; i++) step(world, new Map());

		const [a, b] = world.floes.filter((f) => f.piece);
		if (!a || !b) throw new Error('no pieces');
		// The halves separate ACROSS the crack, so the line between their centres is perpendicular
		// to it.
		const between = Math.atan2(a.center.x - b.center.x, a.center.z - b.center.z);
		const difference = Math.abs(Math.sin(between - angle));
		expect(difference).toBeGreaterThan(0.95);
	});

	it('carries the penguins standing on a piece along with it', () => {
		// A fragment that slid out from under its passengers would be a rug pull rather than a raft:
		// the penguins would stand still in world space while their ice left.
		const world = royal(12);
		const doomed = firstToGo(world);
		if (!doomed) throw new Error('nothing doomed');
		justBefore(doomed, world);
		for (let i = 0; i < ROYAL_WARN_TICKS + 5; i++) step(world, new Map());

		const piece = world.floes.find((f) => f.piece);
		if (!piece) throw new Error('no piece');
		const rider = spawnPenguin('rider', { ...piece.center });
		world.penguins.push(rider);
		expect(penguinsOn(piece, world.penguins).map((p) => p.id)).toContain('rider');

		const before = { ...rider.pos };
		const wasAt = { ...piece.center };
		for (let i = 0; i < 30; i++) step(world, new Map());

		const floeMoved = Math.hypot(piece.center.x - wasAt.x, piece.center.z - wasAt.z);
		const riderMoved = Math.hypot(rider.pos.x - before.x, rider.pos.z - before.z);
		expect(floeMoved).toBeGreaterThan(0.1);
		// Carried, not dragged: the penguin travelled with the ice rather than standing still on the
		// sea. Not exactly equal — it is also sliding on a tilting surface, which is the game.
		expect(riderMoved).toBeGreaterThan(floeMoved * 0.5);
		expect(floeUnder(world.floes, rider.pos)?.id).toBe(piece.id);
	});

	it('takes a penguin standing over the crack', () => {
		// The drama the whole feature is for: the ice gives way UNDER somebody. Nothing in `round.ts`
		// knows about this — the pieces simply do not cover where the penguin is standing, and
		// `step.ts` does what it always does over open water.
		const world = royal(5);
		const doomed = firstToGo(world);
		if (!doomed) throw new Error('nothing doomed');
		const victim = spawnPenguin('victim', { ...doomed.center });
		world.penguins.push(victim);
		justBefore(doomed, world);

		for (let i = 0; i < ROYAL_WARN_TICKS + 90 && victim.phase === 'skating'; i++) {
			// Held exactly on the crack, so this is about the ice and not about sliding.
			victim.pos = { ...doomed.center };
			victim.vel = { x: 0, z: 0 };
			step(world, new Map());
		}
		expect(victim.phase).not.toBe('skating');
	});

	it('lets a fragment go under, and then forgets it', () => {
		// A sea that only ever grows is a list a long round fills with slivers nobody can see or
		// stand on. Pieces are dropped from the world once there is nothing left of them.
		const world = royal(9);
		const doomed = firstToGo(world);
		if (!doomed) throw new Error('nothing doomed');
		justBefore(doomed, world);
		for (let i = 0; i < ROYAL_WARN_TICKS + ROYAL_PIECE_SINK_TICKS + 60; i++) step(world, new Map());

		expect(world.floes.some((f) => f.piece)).toBe(false);
		// And the middle is still there: a Royal whose last ice disappeared would drown everybody.
		expect(world.floes.some((f) => f.sinkAtTick === Infinity)).toBe(true);
	});

	it('never breaks a piece a second time', () => {
		// Otherwise the ice halves forever and the sea fills with slivers.
		const world = royal(21);
		world.round.ticks = 0;
		for (let i = 0; i < COUNTDOWN_TICKS + 60 * 100; i++) step(world, new Map());
		for (const floe of world.floes) {
			expect(floe.fullRadius).toBeGreaterThan(1);
		}
	});

	it('is the same break from the same seed', () => {
		// Breaking ice changes the shape of the world mid-round, which is exactly where an unseeded
		// value would finally show up. The pieces have to land in the same places on two devices.
		const shape = (world: World) =>
			world.floes.map((f) => `${f.id}:${f.center.x.toFixed(3)}:${f.radius.toFixed(3)}`).join('|');
		const a = royal(404);
		const b = royal(404);
		for (let i = 0; i < 60 * 40; i++) {
			step(a, new Map());
			step(b, new Map());
		}
		expect(shape(a)).toBe(shape(b));
		// And something actually broke in those forty seconds, or the comparison above is two
		// identical untouched seas agreeing about nothing.
		expect(a.floes.filter((f) => !f.piece).length).toBeLessThan(layout(ROYAL_PLAYERS, 404).length);
	});
});
