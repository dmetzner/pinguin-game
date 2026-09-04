import { describe, expect, it } from 'vitest';
import { DEFAULT_LOOK } from '../look';
import { mainFloe } from '../sim/archipelago';
import { FLOE_RADIUS, JUMP_APEX, WALK_SPEED } from '../sim/constants';
import { createWorld } from '../sim/world';
import {
	ANGLE_TOLERANCE,
	decode,
	encode,
	HEIGHT_TOLERANCE,
	MOVE_TOLERANCE,
	POS_TOLERANCE,
	RADIUS_TOLERANCE
} from './protocol';
import { capture } from './snapshot';

/** A world with something worth losing in the encoding: motion, height, a shrunk floe, a winner. */
function busyWorld() {
	const world = createWorld(['a', 'b', 'c'], 11);
	const [a, b, c] = world.penguins;
	if (!a || !b || !c) throw new Error('roster');
	a.pos = { x: 1.234_56, z: -2.876_54 };
	a.vel = { x: WALK_SPEED, z: -1.5 };
	a.height = JUMP_APEX;
	a.heightVel = -2.25;
	a.facing = Math.PI - 0.001;
	a.stunTicks = 71;
	a.dashCooldown = 39;
	b.phase = 'falling';
	b.fallTicks = 53;
	c.phase = 'out';
	mainFloe(world).radius = 4.267_81;
	mainFloe(world).slope = { x: 0.2299, z: -0.1234 };
	mainFloe(world).weightSlope = { x: -0.05, z: 0.05 };
	world.round.phase = 'over';
	world.round.winner = 'a';
	world.tick = 4321;
	world.snowballs = [
		{
			id: 7,
			owner: 'b',
			pos: { x: -3.21, z: 4.56 },
			vel: { x: 8, z: -8 },
			height: 1.5,
			heightVel: 2,
			ticks: 30
		}
	];
	world.nextSnowballId = 8;
	return world;
}

describe('the wire format', () => {
	it('carries a whole world back within the accuracy it advertises', () => {
		// Asserted against the exported tolerances rather than against copied numbers, so a scale and
		// the claim beside it cannot drift — the same rule the jump constants are held to.
		const snap = capture(busyWorld());
		const round = decode(encode({ kind: 'snapshot', snapshot: snap }));
		expect(round?.kind).toBe('snapshot');
		if (round?.kind !== 'snapshot') return;
		const back = round.snapshot;

		expect(back.tick).toBe(snap.tick);
		expect(back.roundPhase).toBe('over');
		expect(back.roundTicks).toBe(snap.roundTicks);
		expect(back.winner).toBe(0);
		expect(back.nextSnowballId).toBe(8);
		expect(back.floeRadius).toBeCloseTo(snap.floeRadius, 3);
		expect(Math.abs(back.floeRadius - snap.floeRadius)).toBeLessThanOrEqual(RADIUS_TOLERANCE);
		expect(Math.abs(back.slope.x - snap.slope.x)).toBeLessThanOrEqual(ANGLE_TOLERANCE);

		for (const [i, p] of snap.penguins.entries()) {
			const q = back.penguins[i];
			if (!q) throw new Error('lost a penguin');
			expect(Math.abs(q.pos.x - p.pos.x)).toBeLessThanOrEqual(POS_TOLERANCE);
			expect(Math.abs(q.pos.z - p.pos.z)).toBeLessThanOrEqual(POS_TOLERANCE);
			expect(Math.abs(q.vel.x - p.vel.x)).toBeLessThanOrEqual(POS_TOLERANCE);
			expect(Math.abs(q.height - p.height)).toBeLessThanOrEqual(HEIGHT_TOLERANCE);
			expect(Math.abs(q.facing - p.facing)).toBeLessThanOrEqual(ANGLE_TOLERANCE);
			// The discrete fields are not approximations and must survive exactly. A phase that came
			// back one off would be a penguin that is alive on one screen and drowned on another.
			expect(q.phase).toBe(p.phase);
			expect(q.fallTicks).toBe(p.fallTicks);
			expect(q.stunTicks).toBe(p.stunTicks);
			expect(q.dashCooldown).toBe(p.dashCooldown);
			expect(q.throwCooldown).toBe(p.throwCooldown);
		}

		const ball = back.snowballs[0];
		if (!ball) throw new Error('lost a snowball');
		expect(ball.id).toBe(7);
		expect(ball.owner).toBe(1);
		expect(ball.ticks).toBe(30);
	});

	it('stays inside the size the decision was costed on', () => {
		// `docs/DECISIONS/0005` justified the whole feature on roughly 20 bytes per penguin and about
		// 2.4 KB/s for six at 20 Hz. That is a promise about a free-tier budget and a school wifi, so
		// it is checked rather than asserted in prose.
		const world = createWorld(['a', 'b', 'c', 'd', 'e', 'f'], 3);
		const bytes = encode({ kind: 'snapshot', snapshot: capture(world) });
		expect(bytes.length / world.penguins.length).toBeLessThan(25);
		expect((bytes.length * 20) / 1024).toBeLessThan(3);
	});

	it('carries a run of inputs without losing which tick each belongs to', () => {
		const frames = [
			{ move: { x: 1, z: 0 }, jump: true, throw: false, dash: false },
			{ move: { x: -0.5, z: 0.25 }, jump: false, throw: true, dash: false },
			{ move: { x: 0, z: -1 }, jump: false, throw: false, dash: true }
		];
		const back = decode(encode({ kind: 'input', fromTick: 900, frames }));
		expect(back?.kind).toBe('input');
		if (back?.kind !== 'input') return;
		expect(back.fromTick).toBe(900);
		expect(back.frames).toHaveLength(3);
		for (const [i, f] of frames.entries()) {
			const g = back.frames[i];
			if (!g) throw new Error('lost a frame');
			expect(Math.abs(g.move.x - f.move.x)).toBeLessThanOrEqual(MOVE_TOLERANCE);
			expect(Math.abs(g.move.z - f.move.z)).toBeLessThanOrEqual(MOVE_TOLERANCE);
			// The three buttons share a byte; a shift wrong there swaps a jump for a shove.
			expect(g.jump).toBe(f.jump);
			expect(g.throw).toBe(f.throw);
			expect(g.dash).toBe(f.dash);
		}
	});

	it('round-trips the cold messages too', () => {
		const hello = decode(encode({ kind: 'hello', name: 'Hüpf Lotte', look: DEFAULT_LOOK }));
		expect(hello).toEqual({ kind: 'hello', name: 'Hüpf Lotte', look: DEFAULT_LOOK });

		const welcome = decode(
			encode({
				kind: 'welcome',
				seed: 99,
				you: 1,
				roster: [{ id: 'a', name: 'Käpt’n Fips', look: DEFAULT_LOOK }]
			})
		);
		expect(welcome?.kind).toBe('welcome');
		expect(decode(encode({ kind: 'bye' }))).toEqual({ kind: 'bye' });
	});
});

describe('bytes from a peer nobody controls', () => {
	// Every one of these arrived from another device. A message that can throw is a message that can
	// end somebody else's round from across the room, which is worse than any desync.
	it('returns null rather than throwing on anything malformed', () => {
		expect(decode(new Uint8Array(0))).toBeNull();
		expect(decode(new Uint8Array([99, 1, 2, 3]))).toBeNull();
		expect(decode(new Uint8Array([1, 0x7b, 0x7b, 0x7b]))).toBeNull();
		// A snapshot header that promises more penguins than it carries.
		const truncated = encode({ kind: 'snapshot', snapshot: capture(createWorld(['a', 'b'], 1)) });
		expect(decode(truncated.subarray(0, 25))).toBeNull();
	});

	it('does not let a hostile value wrap into a plausible one', () => {
		// A position of a million metres has to come back clamped, not wrapped round into somewhere
		// on the floe: a peer that can put a penguin wherever it likes by overflowing an int16 has
		// defeated the entire point of the host holding the world.
		const world = createWorld(['a'], 1);
		const a = world.penguins[0];
		if (!a) throw new Error('roster');
		a.pos = { x: 1e9, z: -1e9 };
		const round = decode(encode({ kind: 'snapshot', snapshot: capture(world) }));
		if (round?.kind !== 'snapshot') throw new Error('not a snapshot');
		const back = round.snapshot.penguins[0];
		if (!back) throw new Error('lost a penguin');
		expect(back.pos.x).toBeGreaterThan(FLOE_RADIUS);
		expect(back.pos.z).toBeLessThan(-FLOE_RADIUS);
	});
});
