import { describe, expect, it } from 'vitest';
import { floeUnder, JUMP_RANGE } from './archipelago';
import { createBot } from './bot';
import {
	advanceHunter,
	alongCourse,
	chaseCourse,
	courseHeading,
	fleeing,
	hasEscaped,
	hunterSpeed,
	isCaught,
	platformUnder,
	shoreOf
} from './chase';
import {
	CHASE_BEND_RATE,
	CHASE_HUNTER_HEADSTART,
	CHASE_HUNTER_LEASH,
	CHASE_HUNTER_RAMP_TICKS,
	CHASE_MAX_HEIGHT,
	CHASE_PLATFORMS,
	CHASE_RACERS,
	COUNTDOWN_TICKS,
	DT,
	G,
	JUMP_APEX,
	MOVE_GRIP,
	TICK_RATE,
	WALK_SPEED
} from './constants';
import { step } from './step';
import type { InputFrame, World } from './types';
import { createWorld } from './world';

const SEEDS = [1, 7, 42, 99, 404, 5150, 7919, 20260817];

/** A chase, played out by bots, and what happened in it. */
function chase(seed: number): { world: World; ticks: number } {
	const ids = Array.from({ length: CHASE_RACERS }, (_, i) => `p${i}`);
	const world = createWorld(ids, seed, 'chase');
	const bots = ids.map((id) => createBot(id, 'normal', world.seed));
	const inputs = new Map<string, InputFrame>();

	let ticks = 0;
	while (world.round.phase !== 'over' && ticks < 60 * 240) {
		inputs.clear();
		for (const bot of bots) inputs.set(bot.id, bot.think(world));
		step(world, inputs);
		ticks++;
	}
	return { world, ticks };
}

describe('the course', () => {
	it('is a line of platforms with water between them', () => {
		for (const seed of SEEDS) {
			const course = chaseCourse(seed);
			expect(course).toHaveLength(CHASE_PLATFORMS);
			for (let i = 1; i < course.length; i++) {
				const here = course[i];
				const previous = course[i - 1];
				if (!here || !previous) continue;
				// Always forward, and always a REAL hole: platforms that overlapped would make a chase
				// a corridor you jog down, which is the mode with its one verb taken out.
				expect(here.along).toBeGreaterThan(previous.along);
				const apart = Math.hypot(
					here.center.x - previous.center.x,
					here.center.z - previous.center.z
				);
				expect(apart).toBeGreaterThan(here.radius + previous.radius);
			}
		}
	});

	it('never asks for a jump nobody can make', () => {
		// The same rule the sea in a Royal is held to, and for the same reason: every gap DERIVED from
		// the jump, so tuning the jump moves the course with it. A child who never finds the mid-air
		// flap must be able to finish, so the bound is the single jump — `AIR_JUMPS` is a rescue, not
		// a requirement.
		for (const seed of SEEDS) {
			const course = chaseCourse(seed);
			for (let i = 1; i < course.length; i++) {
				const here = course[i];
				const previous = course[i - 1];
				if (!here || !previous) continue;
				const gap =
					Math.hypot(here.center.x - previous.center.x, here.center.z - previous.center.z) -
					here.radius -
					previous.radius;
				expect(gap).toBeLessThan(JUMP_RANGE);
			}
		}
	});

	it('ends at a shore wide enough to land on', () => {
		const course = chaseCourse(3);
		const shore = course[course.length - 1];
		const before = course[course.length - 2];
		expect(shore).toBeDefined();
		expect(before).toBeDefined();
		if (!shore || !before) return;
		expect(shore.radius).toBeGreaterThan(before.radius);
		// And the run INTO it is straight. `x === 0` used to stand in for this, which was true of a
		// corridor and is meaningless now the route bends — what a racer actually needs is that the
		// finish arrives head-on rather than round a corner they cannot see past.
		const last = courseHeading(course, course.length - 1);
		const approach = courseHeading(course, course.length - 3);
		expect(last.x * approach.x + last.z * approach.z).toBeGreaterThan(0.999);
	});

	it('bends, and enough to be a course rather than a corridor', () => {
		// It ran dead straight until 2026-08-18 — "the race game is kina linear" — because the camera
		// did not turn and "away from the sea lion" had to stay the same direction on screen. The rig
		// turns with the run now, so the route can too. The bound is on the WIDEST the route wanders
		// from its own start line: a corridor with a little jitter in it cannot satisfy it.
		const widest = Math.max(
			...SEEDS.map((seed) => {
				const course = chaseCourse(seed);
				const xs = course.map((floe) => floe.center.x);
				return Math.max(...xs) - Math.min(...xs);
			})
		);
		expect(widest).toBeGreaterThan(40);

		// And the turning is gradual: two neighbouring platforms never point more than a bend apart,
		// or the camera's chase lags into a sideways view of a route the player is running down.
		for (const seed of SEEDS) {
			const course = chaseCourse(seed);
			for (let i = 1; i < course.length - 1; i++) {
				const a = courseHeading(course, i - 1);
				const b = courseHeading(course, i);
				expect(a.x * b.x + a.z * b.z).toBeGreaterThan(Math.cos(CHASE_BEND_RATE * 1.5));
			}
		}
	});

	it('rises and falls, and never below the water', () => {
		// The sea is a fixed plane and a platform is a slab whose top sits on it, so a route that
		// wandered downwards would put its ice — and the penguins standing on it — under the surface.
		for (const seed of SEEDS) {
			const course = chaseCourse(seed);
			for (const floe of course) {
				expect(floe.altitude).toBeGreaterThanOrEqual(0);
				expect(floe.altitude).toBeLessThanOrEqual(CHASE_MAX_HEIGHT);
			}
			// And it does climb, or "up and down" is a comment rather than a course.
			expect(Math.max(...course.map((f) => f.altitude))).toBeGreaterThan(0.5);
			// A step UP is bounded well under a jump: a rise you cannot get onto is a wall, and a wall
			// in the middle of a chase is the end of the round.
			for (let i = 1; i < course.length; i++) {
				const rise = (course[i]?.altitude ?? 0) - (course[i - 1]?.altitude ?? 0);
				expect(rise).toBeLessThan(JUMP_APEX);
			}
		}
	});

	it('carries blocks that must be jumped rather than walked over', () => {
		// A `Mound`, so the simulation needs nothing new. What makes it an OBSTACLE rather than one of
		// a Royal's hills is that its radius is chosen instead of derived from its height against
		// `MOUND_MAX_SLOPE`: the steepest gradient beats `MOVE_GRIP`, so gravity down it wins and it
		// cannot be climbed — and it is under `JUMP_APEX`, so it can always be cleared.
		const course = chaseCourse(5);
		const blocked = course.filter((floe) => floe.mounds.length > 0);
		expect(blocked.length).toBeGreaterThan(2);

		const block = blocked[0]?.mounds[0];
		expect(block).toBeDefined();
		if (!block || !blocked[0]) return;
		expect(block.height).toBeLessThan(JUMP_APEX);
		// The steepest point of a cosine bump is `h·π / 2r`, and gravity down that must beat the grip.
		const steepest = (block.height * Math.PI) / (2 * block.radius * blocked[0].radius);
		expect(G * steepest).toBeGreaterThan(MOVE_GRIP);

		// Never on the start line, never on the shore: an obstacle in the first seconds is a round
		// decided before it began, and one at the finish is a race decided by a coin.
		expect(course[0]?.mounds).toHaveLength(0);
		expect(course[course.length - 1]?.mounds).toHaveLength(0);
	});

	it('measures progress along the ROUTE, not down an axis', () => {
		// `-pos.z` was exact while the course was straight and became a lie the moment it bent: two
		// racers equally far along a corner have quite different z, and the hunter — which is a place
		// on this same scale — would eat the one on the outside of the bend for no reason they could
		// see. Every platform's own distance has to increase down the route.
		for (const seed of SEEDS) {
			const course = chaseCourse(seed);
			for (let i = 1; i < course.length; i++) {
				expect(course[i]?.along ?? 0).toBeGreaterThan(course[i - 1]?.along ?? 0);
			}
			// And a penguin standing on a platform is measured at that platform's distance.
			const at = course[7];
			if (at) expect(alongCourse(course, at.center)).toBeCloseTo(at.along, 6);
		}
	});

	it('is the same course from the same seed', () => {
		expect(chaseCourse(77)).toEqual(chaseCourse(77));
		expect(chaseCourse(77)).not.toEqual(chaseCourse(78));
	});
});

describe('the sea lion', () => {
	it('is never faster than a penguin who keeps running', () => {
		// The number the whole mode rests on. Above a walk, the hunter eats everybody eventually
		// however well they played and the round is a countdown with penguins in it; below it, what it
		// eats is hesitation.
		for (const ticks of [0, 60, 600, CHASE_HUNTER_RAMP_TICKS, CHASE_HUNTER_RAMP_TICKS * 3]) {
			expect(hunterSpeed(ticks)).toBeLessThan(WALK_SPEED);
		}
		// And it does speed up, or the ramp is decoration.
		expect(hunterSpeed(CHASE_HUNTER_RAMP_TICKS)).toBeGreaterThan(hunterSpeed(0));
	});

	it('starts behind the start line', () => {
		// Nobody may be eaten during the countdown, when nobody is allowed to move.
		const world = createWorld(['a', 'b'], 5, 'chase');
		expect(world.hunterAt).toBe(-CHASE_HUNTER_HEADSTART);
		for (const p of world.penguins) expect(isCaught(world, p)).toBe(false);
	});

	it('is pulled forward by the leash and never held back by it', () => {
		// The leash exists so a strong field cannot leave the mode's whole subject somewhere off the
		// bottom of the screen. It must only ever ADD speed: a hunter that slowed down to stay close
		// is a hunter nobody has to run from.
		const free = advanceHunter(0, 5, 0, DT);
		expect(free).toBeCloseTo(hunterSpeed(0) * DT, 9);

		// A field that has run away drags it forward instead.
		const dragged = advanceHunter(0, CHASE_HUNTER_LEASH * 3, 0, DT);
		expect(dragged).toBe(CHASE_HUNTER_LEASH * 3 - CHASE_HUNTER_LEASH);
		expect(dragged).toBeGreaterThan(free);

		// And a field standing right on top of it does not slow it down.
		expect(advanceHunter(10, 10, 0, DT)).toBeCloseTo(10 + hunterSpeed(0) * DT, 9);
	});

	it('eats a penguin that stands still, and does not eat one that runs', () => {
		// THREE penguins, not one: a world with a single player in it is a round that has already been
		// decided, `endRoundIfDecided` ends it on the first tick, and the sea lion — which only moves
		// while the round is playing — never takes a stroke. The first version of this test asserted
		// against that and read as "the hunter does not hunt".
		const ids = ['a', 'b', 'c'];
		const still = createWorld(ids, 11, 'chase');
		for (let i = 0; i < COUNTDOWN_TICKS + 25 * TICK_RATE; i++) {
			step(still, new Map());
			if (still.round.phase === 'over') break;
		}
		expect(still.penguins.some((p) => p.phase !== 'skating')).toBe(true);

		// And the other half: walking away from it, on the first platform, where there is nothing to
		// jump and the only question is arithmetic. Ten seconds is the whole start platform at
		// `WALK_SPEED`, and the sea lion may not have gained a metre on anybody in it.
		//
		// Deliberately NOT run for as long as the standing case. Held down for half a minute, the same
		// input walks straight into the first gap — twice, three times, however often it is fished out
		// — and being eaten while standing in the water waiting to be rescued is a test about jumping
		// wearing a hunter costume.
		const running = createWorld(ids, 11, 'chase');
		// Steered ALONG THE ROUTE, not down an axis. `move: (0, −1)` was the same thing while the
		// course ran in a straight line; now that it bends, holding one direction walks a penguin off
		// the side of it and the test would be measuring jumping rather than arithmetic.
		// And JUMPING when the ice runs out in front of them, because a course with holes in it is not
		// crossed by walking. Without this the test measured a penguin repeatedly falling in and being
		// fished out — which leaves it `skating` and looks like success right up until the sea lion is
		// quick enough to arrive during the stun.
		const forward = new Map<string, InputFrame>();
		for (let i = 0; i < COUNTDOWN_TICKS + 12 * TICK_RATE; i++) {
			forward.clear();
			for (const p of running.penguins) {
				const heading = courseHeading(running.floes, platformUnder(running.floes, p.pos));
				const ahead = { x: p.pos.x + heading.x * 0.5, z: p.pos.z + heading.z * 0.5 };
				const edge = p.height === 0 && !floeUnder(running.floes, ahead);
				forward.set(p.id, { move: heading, jump: edge, throw: false, dash: false });
			}
			step(running, i < COUNTDOWN_TICKS ? new Map() : forward);
			if (running.round.phase === 'over') break;
		}
		for (const p of running.penguins) {
			expect(p.phase).toBe('skating');
			expect(alongCourse(running.floes, p.pos)).toBeGreaterThan(running.hunterAt);
		}
	});

	it('is the only way out — the water costs time', () => {
		// A platformer whose every missed landing ends the round is a platformer a child plays for
		// fifteen seconds. Falling in puts a penguin back on the last platform, dizzy, while the thing
		// behind them keeps coming: the cost of a fall is exactly the ground the sea lion makes up,
		// and the player can watch it arrive.
		const world = createWorld(['a', 'b', 'c'], 13, 'chase');
		for (let i = 0; i < COUNTDOWN_TICKS; i++) step(world, new Map());
		const p = world.penguins[0];
		expect(p).toBeDefined();
		if (!p) return;

		// 'a' walks straight off the side; the other two run for their lives, because a round with one
		// penguin left in it ends, and an ended round stops the sea lion — which would make this test
		// pass for the wrong reason.
		const forward: InputFrame = { move: { x: 0, z: -1 }, jump: false, throw: false, dash: false };
		const off = new Map<string, InputFrame>([
			['a', { move: { x: 1, z: 0 }, jump: false, throw: false, dash: false }],
			['b', forward],
			['c', forward]
		]);
		// Three seconds: long enough to reach the rim of the start platform and be fished out, short
		// enough that the sea lion has not yet arrived — being EATEN is also `falling`, and a test that
		// could not tell the two apart would be measuring nothing.
		for (let i = 0; i < 3 * TICK_RATE; i++) step(world, off);
		expect(alongCourse(world.floes, p.pos)).toBeGreaterThan(world.hunterAt);

		// Still in the round, back on the ice, and dizzy for it.
		expect(p.phase).toBe('skating');
		expect(floeUnder(world.floes, p.pos)).not.toBeNull();
		expect(p.stunTicks).toBeGreaterThan(0);
	});

	it('does not move while the round is counting down', () => {
		const world = createWorld(['a', 'b'], 9, 'chase');
		for (let i = 0; i < COUNTDOWN_TICKS - 1; i++) step(world, new Map());
		expect(world.round.phase).toBe('countdown');
		expect(world.hunterAt).toBe(-CHASE_HUNTER_HEADSTART);
	});
});

describe('a chase', () => {
	it('starts everybody together, on the ice, at the near end', () => {
		const world = createWorld(
			Array.from({ length: CHASE_RACERS }, (_, i) => `p${i}`),
			5,
			'chase'
		);
		for (const p of world.penguins) {
			expect(floeUnder(world.floes, p.pos)?.id).toBe(0);
			expect(alongCourse(world.floes, p.pos)).toBeGreaterThan(world.hunterAt);
		}
	});

	it('is won by whoever reaches the shore, and ends when they do', () => {
		const { world, ticks } = chase(101);
		expect(world.round.phase).toBe('over');
		expect(world.round.winner).not.toBeNull();

		const escaped = world.penguins.find((p) => p.id === world.round.winner);
		expect(escaped).toBeDefined();
		if (escaped) expect(hasEscaped(world, escaped)).toBe(true);
		// Long enough to be a run, short enough to be a round.
		expect(ticks / TICK_RATE).toBeGreaterThan(20);
		expect(ticks / TICK_RATE).toBeLessThan(180);
	});

	/**
	 * The heaviest assertion in the suite, and its timeout is a statement about how much SIMULATION it
	 * needs rather than about how fast the game is.
	 *
	 * Five seeds of a round that runs to its own backstop, with six bots each scanning a fifty-seven
	 * platform course every tick — on the order of a hundred and eighty thousand decisions. Measured at
	 * 3.8 s alone and 6.4 s on a machine with ten agents on it, which is how it began timing out
	 * against Vitest's five-second default: a budget that was always marginal here rather than wrong.
	 * `vitest.config.ts` raises the default for the same reason; this one carries its own because it is
	 * the outlier and a reader should meet the cost where it is paid.
	 *
	 * **Do not pay for this by cutting seeds.** The whole point is that the result holds across SEVERAL
	 * courses — one seed that survives is an anecdote — and `backlog/stories/08-the-chase.md` records
	 * the leash being proved over eight of them.
	 */
	it('does not eat the entire field', () => {
		// A course that kills everybody is a course, not a game. Most of a field of bots — who are
		// deliberately worse at this than a child — has to still be running at the end.
		let survived = 0;
		let ran = 0;
		for (const seed of [1, 2, 3, 4, 5]) {
			const { world } = chase(seed);
			survived += world.penguins.filter((p) => p.phase === 'skating').length;
			ran += world.penguins.length;
		}
		expect(survived / ran).toBeGreaterThan(0.5);
	}, 60_000);

	it('ranks by how far down the course everybody is', () => {
		const { world } = chase(303);
		const order = fleeing(world);
		for (let i = 1; i < order.length; i++) {
			const ahead = order[i - 1];
			const behind = order[i];
			if (!ahead || !behind) continue;
			expect(alongCourse(world.floes, ahead.pos)).toBeGreaterThanOrEqual(
				alongCourse(world.floes, behind.pos)
			);
		}
	});

	it('replays exactly from the same seed', () => {
		const a = chase(404);
		const b = chase(404);
		expect(a.ticks).toBe(b.ticks);
		expect(a.world.round.winner).toBe(b.world.round.winner);
		expect(a.world.hunterAt).toBeCloseTo(b.world.hunterAt, 9);
	});

	it('puts the shore where the course ends', () => {
		const world = createWorld(['a'], 7, 'chase');
		const shore = shoreOf(world);
		expect(shore?.id).toBe(CHASE_PLATFORMS - 1);
	});
});
