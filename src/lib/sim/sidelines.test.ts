import { describe, expect, it } from 'vitest';
import {
	ROUND_GRACE_FADE_TICKS,
	ROUND_GRACE_TICKS,
	SIDELINE_KNOCKBACK,
	SIDELINE_STUN_TICKS,
	SIDELINE_THROW_COOLDOWN_TICKS,
	SNOWBALL_KNOCKBACK,
	SNOWBALL_STUN_TICKS,
	THROW_COOLDOWN_TICKS
} from './constants';
import { spectatorSpots, watchingRing } from './spectate';
import { step } from './step';
import type { InputFrame, World } from './types';
import { createWorld, findPenguin } from './world';

const THROWING: InputFrame = { move: { x: 0, z: 0 }, jump: false, throw: true, dash: false };

/** A round in play, with `out` already knocked out and standing on its chunk. */
function afterElimination(outId: string, seed = 7): World {
	const world = createWorld(['a', 'b', outId], seed);
	world.round.phase = 'playing';
	// Past the opening grace and its fade, or nobody may throw anything: `attacksAllowed` holds every attack in
	// the game for the first three seconds, and a spectator's snowball is an attack.
	world.round.ticks = ROUND_GRACE_TICKS + ROUND_GRACE_FADE_TICKS;
	const gone = findPenguin(world, outId);
	if (!gone) throw new Error('no such penguin');
	gone.phase = 'out';
	return world;
}

describe('throwing from the sidelines', () => {
	it('lets an eliminated penguin throw, from its chunk of ice', () => {
		// The one thing elimination still cost this audience: a child out at forty seconds had a nice
		// view and nothing to do. Now they have exactly one action, and it comes down the same
		// `InputFrame` road as everything else — there is still no second way into the world.
		const world = afterElimination('gone');
		const from = spectatorSpots(world).get('gone');
		expect(from).toBeDefined();

		step(world, new Map([['gone', THROWING]]));

		expect(world.snowballs).toHaveLength(1);
		const ball = world.snowballs[0];
		expect(ball?.owner).toBe('gone');
		// Thrown from where they are WATCHING, not from the spot in the water where they went in. A
		// tick's worth of flight is already on it — `stepSnowballs` runs in the same tick — so this is
		// "within one frame of the chunk" rather than "exactly on it".
		const travelled = Math.hypot(
			(ball?.pos.x ?? 0) - (from?.x ?? 0),
			(ball?.pos.z ?? 0) - (from?.z ?? 0)
		);
		expect(travelled).toBeLessThan(0.5);
	});

	it('aims at somebody still on the ice, without being able to turn', () => {
		// A spectator's `facing` is whatever it happened to be when they fell in, and they cannot
		// steer any more — so the aim cone a player throws through would make this a joke. It picks
		// the nearest penguin still in the round instead.
		const world = afterElimination('gone');
		const victim = findPenguin(world, 'a');
		const other = findPenguin(world, 'b');
		if (!victim || !other) throw new Error('no penguins');
		const from = spectatorSpots(world).get('gone');
		if (!from) throw new Error('no spot');
		// One of them near the chunk, the other off to the SIDE — not further along the same line,
		// where "toward the near one" and "toward the far one" point the same way and the assertion
		// below would hold however badly the aim worked.
		victim.pos = { x: from.x * 0.6, z: from.z * 0.6 };
		other.pos = { x: -from.z * 0.6, z: from.x * 0.6 };

		step(world, new Map([['gone', THROWING]]));
		const ball = world.snowballs[0];
		expect(ball).toBeDefined();
		if (!ball) return;
		// Compared as ANGLES rather than as raw dot products: every point inside the ring is broadly
		// "inward" from a chunk on it, so an unnormalised dot is positive for both of them however
		// badly the aim worked — which is a test that cannot fail.
		const cosineTo = (at: { x: number; z: number }) => {
			const dx = at.x - from.x;
			const dz = at.z - from.z;
			const dot = ball.vel.x * dx + ball.vel.z * dz;
			return dot / (Math.hypot(ball.vel.x, ball.vel.z) * Math.hypot(dx, dz));
		};
		expect(cosineTo(victim.pos)).toBeGreaterThan(0.99);
		expect(cosineTo(other.pos)).toBeLessThan(0.9);
	});

	it('throws nothing when the round has nobody left to throw at', () => {
		// Everybody else already in the water: no target, no ball, and — importantly — no cooldown
		// burned, so a spectator is not punished for pressing while the arena is empty.
		const world = afterElimination('gone');
		for (const id of ['a', 'b']) {
			const p = findPenguin(world, id);
			if (p) p.phase = 'out';
		}
		step(world, new Map([['gone', THROWING]]));
		expect(world.snowballs).toEqual([]);
		expect(findPenguin(world, 'gone')?.throwCooldown).toBe(0);
	});

	it('hits for a third of a real snowball', () => {
		// The sidelines must be able to annoy somebody standing near the rim and must never decide the
		// round: a crowd of the eliminated ganging up on whoever knocked them out would be the least
		// fair ending this game could have. Asserted against the constants rather than numbers, so
		// tuning one of them cannot leave this claiming something that stopped being true.
		expect(SIDELINE_STUN_TICKS).toBeLessThan(SNOWBALL_STUN_TICKS / 2);
		expect(SIDELINE_KNOCKBACK).toBeLessThan(SNOWBALL_KNOCKBACK / 2);
		expect(SIDELINE_THROW_COOLDOWN_TICKS).toBeGreaterThan(THROW_COOLDOWN_TICKS * 3);

		const world = afterElimination('gone');
		const victim = findPenguin(world, 'a');
		const from = spectatorSpots(world).get('gone');
		if (!victim || !from) throw new Error('no setup');
		victim.pos = { x: from.x * 0.75, z: from.z * 0.75 };

		step(world, new Map([['gone', THROWING]]));
		// Fly until it lands on somebody.
		for (let i = 0; i < 200 && victim.stunTicks === 0; i++) step(world, new Map());

		expect(victim.stunTicks).toBeGreaterThan(0);
		expect(victim.stunTicks).toBeLessThanOrEqual(SIDELINE_STUN_TICKS);
	});

	it('is weak because the THROWER is out, not because of a flag on the ball', () => {
		// A `weak` field on the snowball would be a second piece of state that can disagree with
		// `phase`, and it would have to be encoded in every snapshot phase 3 sends. The owner already
		// says it.
		const world = afterElimination('gone');
		const victim = findPenguin(world, 'a');
		const from = spectatorSpots(world).get('gone');
		if (!victim || !from) throw new Error('no setup');
		victim.pos = { x: from.x * 0.75, z: from.z * 0.75 };
		step(world, new Map([['gone', THROWING]]));
		expect(world.snowballs[0]).toBeDefined();
		expect(Object.keys(world.snowballs[0] ?? {})).not.toContain('weak');
	});

	it('makes a spectator wait three seconds between throws', () => {
		const world = afterElimination('gone');
		step(world, new Map([['gone', THROWING]]));
		expect(world.snowballs).toHaveLength(1);
		const first = world.snowballs[0]?.id;

		// The very next tick, still asking: nothing, because the cooldown lives in the simulation
		// rather than in a disabled button.
		step(world, new Map([['gone', THROWING]]));
		expect(world.snowballs).toHaveLength(1);

		// Waited out, with the two on the ice held where they are: left to the physics for three
		// seconds they slide off the tilting floe, and then there is nobody to throw AT — which is a
		// different rule (asserted above) and would quietly make this test pass for the wrong reason.
		const onTheIce = ['a', 'b'].map((id) => findPenguin(world, id));
		for (let i = 0; i < SIDELINE_THROW_COOLDOWN_TICKS; i++) {
			for (const p of onTheIce) {
				if (!p) continue;
				p.pos = { x: 0, z: 0 };
				p.vel = { x: 0, z: 0 };
			}
			step(world, new Map());
		}
		step(world, new Map([['gone', THROWING]]));
		// A NEW ball, by id: the first one landed or expired long ago, so counting the array would
		// compare one against one and pass whether or not the second throw ever happened.
		expect(world.snowballs).toHaveLength(1);
		expect(world.snowballs[0]?.id).not.toBe(first);
	});

	it('gives a spectator nothing else: no steering, no jump, no dash', () => {
		// Being out has to keep meaning something. One action, and it is the one that cannot get them
		// back on the ice.
		const world = afterElimination('gone');
		const gone = findPenguin(world, 'gone');
		if (!gone) throw new Error('no penguin');
		const where = { ...gone.pos };

		step(
			world,
			new Map([['gone', { move: { x: 1, z: 1 }, jump: true, throw: false, dash: true }]])
		);

		expect(gone.pos).toEqual(where);
		expect(gone.height).toBe(0);
		expect(gone.dashCooldown).toBe(0);
		expect(gone.phase).toBe('out');
	});

	it('cannot throw before the round has started', () => {
		// The countdown freezes everybody, and a spectator is somebody.
		const world = createWorld(['a', 'gone'], 3);
		const gone = findPenguin(world, 'gone');
		if (!gone) throw new Error('no penguin');
		gone.phase = 'out';
		expect(world.round.phase).toBe('countdown');
		step(world, new Map([['gone', THROWING]]));
		expect(world.snowballs).toEqual([]);
	});

	it('watches from outside the sea, whatever size the sea is', () => {
		// The ring used to be a constant tied to the classic floe. In a Royal the sea is thirty metres
		// across, and a ring at eight would put the eliminated standing in the middle of the fight
		// they just lost.
		const classic = createWorld(['a'], 1);
		const royal = createWorld(
			Array.from({ length: 30 }, (_, i) => `p${i}`),
			1,
			'royal'
		);
		expect(watchingRing(royal)).toBeGreaterThan(watchingRing(classic) * 2);

		for (const floe of royal.floes) {
			const rimFromOrigin = Math.hypot(floe.center.x, floe.center.z) + floe.fullRadius;
			expect(watchingRing(royal)).toBeGreaterThan(rimFromOrigin);
		}
	});

	it('does not move the ring as the ice shrinks', () => {
		// Measured against each floe's full radius. A chunk that drifted inward all round would read
		// as the sea moving, and it is the one thing on screen that should be still.
		const world = createWorld(['a', 'b'], 2);
		const before = watchingRing(world);
		const floe = world.floes[0];
		if (floe) floe.radius = floe.fullRadius * 0.4;
		expect(watchingRing(world)).toBe(before);
	});

	it('leaves a penguin still in the round throwing full-strength snowballs', () => {
		// Non-vacuousness: everything above is about the weak path, and it would all pass if the
		// ordinary throw had quietly become weak too.
		const world = createWorld(['a', 'b'], 5);
		world.round.phase = 'playing';
		world.round.ticks = ROUND_GRACE_TICKS + ROUND_GRACE_FADE_TICKS;
		const thrower = findPenguin(world, 'a');
		const victim = findPenguin(world, 'b');
		if (!thrower || !victim) throw new Error('no penguins');
		victim.pos = { x: thrower.pos.x + 2, z: thrower.pos.z };
		thrower.facing = Math.atan2(victim.pos.x - thrower.pos.x, victim.pos.z - thrower.pos.z);

		step(world, new Map([['a', THROWING]]));
		for (let i = 0; i < 120 && victim.stunTicks === 0; i++) step(world, new Map());
		expect(victim.stunTicks).toBeGreaterThan(SIDELINE_STUN_TICKS);
	});
});
