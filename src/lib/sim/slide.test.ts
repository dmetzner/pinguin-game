import { describe, expect, it } from 'vitest';
import { floeUnder, groundHeight } from './archipelago';
import { createBot } from './bot';
import {
	COUNTDOWN_TICKS,
	G,
	ICE_DRAG,
	MOVE_GRIP,
	SLIDE_BANK_HEIGHT,
	SLIDE_BEND_RATE,
	SLIDE_BUMP_EVERY,
	SLIDE_BUMP_HEIGHT,
	SLIDE_DRAG,
	SLIDE_GRADE,
	SLIDE_GRIP,
	SLIDE_OPEN_WALL,
	SLIDE_RACERS,
	SLIDE_SEGMENT_STEP,
	SLIDE_SEGMENTS,
	SLIDE_WIDTH,
	TICK_RATE,
	WALK_SPEED
} from './constants';
import {
	bankAt,
	finishOf,
	hasFinished,
	progressOf,
	segmentHeading,
	slideCourse,
	standings
} from './slide';
import { step } from './step';
import type { InputFrame, World } from './types';
import { ZERO } from './vec';
import { createWorld } from './world';

const SEEDS = [1, 7, 42, 99, 404, 5150, 7919, 20260817];

/** A race, played out by bots, and what happened in it. */
function race(seed: number): { world: World; ticks: number } {
	const ids = Array.from({ length: SLIDE_RACERS }, (_, i) => `p${i}`);
	const world = createWorld(ids, seed, 'slide');
	const bots = ids.map((id) => createBot(id, 'normal', world.seed));
	const inputs = new Map<string, InputFrame>();

	let ticks = 0;
	while (world.round.phase !== 'over' && ticks < 60 * 180) {
		inputs.clear();
		for (const bot of bots) inputs.set(bot.id, bot.think(world));
		step(world, inputs);
		ticks++;
	}
	return { world, ticks };
}

describe('the mountain', () => {
	it('is continuous except where it deliberately is not', () => {
		// `floeUnder` decides whether a penguin is standing on anything, and it answers per DISC. Two
		// consecutive segments have to overlap or the run has holes in it that nothing on screen
		// explains — but a GAP is a hole the course meant, and those show up as a missing id.
		for (const seed of SEEDS) {
			const course = slideCourse(seed);
			for (let i = 0; i < course.length - 1; i++) {
				const here = course[i];
				const next = course[i + 1];
				if (!here || !next || next.id !== here.id + 1) continue;
				const apart = Math.hypot(next.center.x - here.center.x, next.center.z - here.center.z);
				expect(apart).toBeLessThan(here.radius + next.radius);
			}
		}
	});

	it('offers an open edge and never a gap, and no open edge at the ends', () => {
		// `SLIDE_GAP_EVERY` is 0, deliberately: `step.ts` never gives a penguin over open air any
		// height at all (`groundBefore !== null && groundAfter !== null`), so a "gap" was never a jump
		// — it was a dead stop at every one of three fixed segments, every run, at any speed. See the
		// constant for the measurement. This asserts the course has NO missing ids, so a gap cannot
		// come back by a seed changing what `i % SLIDE_GAP_EVERY` happens to be without this test
		// noticing — the guard `slideCourse` carries (`SLIDE_GAP_EVERY > 0 && ...`) is what makes 0 mean
		// off rather than "everything is a multiple of nothing" by accident.
		for (const seed of SEEDS) {
			const course = slideCourse(seed);
			const ids = course.map((floe) => floe.id);
			for (let i = 1; i < ids.length; i++) expect(ids[i]).toBe((ids[i - 1] ?? 0) + 1);
			for (const floe of course.slice(0, 4)) expect(floe.openSide).toBe(0);
			for (const floe of course.slice(-4)) expect(floe.openSide).toBe(0);
		}
		// And at least one open edge somewhere across the seeds, or the walls make the mode a corridor
		// you cannot leave — the danger has to come from somewhere, and with the gap off this is the
		// only place left it does.
		expect(SEEDS.some((seed) => slideCourse(seed).some((floe) => floe.openSide !== 0))).toBe(true);
	});

	it('always goes downhill, whatever direction it wanders in', () => {
		// The course is free to turn now — the camera follows it (`render/scene.ts`) and the stick is
		// rotated to match, where the first version had to be clamped into a thirty-degree cone
		// because a fixed camera turns a curving course into one you steer backwards. What must still
		// hold is that every segment is LOWER than the one before it: a slide that climbed would be a
		// slide a penguin stops on.
		for (const seed of SEEDS) {
			const course = slideCourse(seed);
			for (let i = 0; i < course.length - 1; i++) {
				const here = course[i];
				const next = course[i + 1];
				if (!here || !next) continue;
				expect(next.altitude).toBeLessThan(here.altitude);
			}
		}
	});

	it('bends enough to be a course rather than a corridor', () => {
		// Non-vacuousness for the bound above: a perfectly straight chute would satisfy it and would
		// be a game about holding one direction. Across eight seeds, at least one has a real corner.
		const widest = Math.max(
			...SEEDS.map((seed) => {
				const course = slideCourse(seed);
				const xs = course.map((floe) => floe.center.x);
				return Math.max(...xs) - Math.min(...xs);
			})
		);
		expect(widest).toBeGreaterThan(SLIDE_WIDTH * 2);
	});

	it('tilts down the way it runs', () => {
		// The tilt IS the slide: gravity comes from a floe's gradient and nothing in `step.ts` knows
		// what a mountain is. A slope points UPHILL here, so it points back the way the racer came —
		// which is why `segmentHeading` can derive the course direction from it and everything else
		// (the camera, the bots, the banks) can read that one answer.
		const course = slideCourse(3);
		for (let i = 0; i < course.length - 1; i++) {
			const here = course[i];
			const next = course[i + 1];
			if (!here || !next || next.id !== here.id + 1) continue;
			const along = segmentHeading(here);
			const toNext = { x: next.center.x - here.center.x, z: next.center.z - here.center.z };
			const size = Math.hypot(toNext.x, toNext.z);
			expect((along.x * toNext.x + along.z * toNext.z) / size).toBeGreaterThan(0.98);
			expect(Math.hypot(here.tilt.x, here.tilt.z)).toBeCloseTo(SLIDE_GRADE, 6);
		}
	});

	it('has walls that push a racer back into the middle, and a hole where it does not', () => {
		// The banks are GROUND — a height that rises toward the rim — so the same gravity term that
		// pulls a penguin off an iceberg holds one in a chute. That is the whole reason the mode needed
		// no new physics, and the reason the first version was a ledge you balanced on.
		const course = slideCourse(1);
		const walled = course.find((floe) => floe.openSide === 0);
		expect(walled).toBeDefined();
		if (!walled) return;

		const along = segmentHeading(walled);
		const across = { x: -along.z, z: along.x };
		const at = (fraction: number) => ({
			x: walled.center.x + across.x * walled.radius * fraction,
			z: walled.center.z + across.z * walled.radius * fraction
		});

		// Three quarters out is ON the wall, where it is still rising — the cross-section's rise now
		// starts at 0.5 of the radius rather than 0.45 (see `bankAt`), which moved this sample inside
		// the flat middle at the old fraction. 0.85 is past the start of the rise at every fraction
		// `bankAt` has used, so this stays true of the next retune too rather than of this one.
		const wall = bankAt(walled, at(0.85));
		expect(wall.height).toBeGreaterThan(0);
		expect(wall.height).toBeLessThan(SLIDE_BANK_HEIGHT);
		// Uphill is outward, so gravity (which runs along −slope) sends a penguin back inward.
		expect(wall.slope.x * across.x + wall.slope.z * across.z).toBeGreaterThan(0);

		// And at the rim it is a SHELF: full height, and flat. Without it a racer who climbed the bank
		// carried straight over the top of it — five of six, every seed — because the ice ended exactly
		// where the wall stopped. Being thrown up a wall has to put you ON the wall, still sliding.
		const rim = bankAt(walled, at(0.95));
		expect(rim.height).toBeCloseTo(SLIDE_BANK_HEIGHT, 6);
		expect(rim.slope).toEqual(ZERO);
		// Flat down the middle: a chute that steered itself would leave the player nothing to do.
		expect(bankAt(walled, walled.center).height).toBe(0);

		const open = course.find((floe) => floe.openSide !== 0);
		if (open) {
			const side = open.openSide;
			const openAlong = segmentHeading(open);
			const openAcross = { x: -openAlong.z * side, z: openAlong.x * side };
			const overTheEdge = {
				x: open.center.x + openAcross.x * open.radius * 0.9,
				z: open.center.z + openAcross.z * open.radius * 0.9
			};
			// A LIP rather than nothing. A missing wall is a cliff a racer is over before they saw it;
			// `SLIDE_OPEN_WALL` of one is enough to feel the edge arrive and not enough to hold anybody
			// carrying real speed, which is the difference between a hazard and an ambush.
			const lip = bankAt(open, overTheEdge).height;
			expect(lip).toBeCloseTo(SLIDE_BANK_HEIGHT * SLIDE_OPEN_WALL, 6);
			expect(lip).toBeLessThan(rim.height * 0.5);
		}
	});

	it('slides rather than skates', () => {
		// The three numbers that decide whether this is a slide at all. A run settles at
		// `G · gradient / drag`, and the drag on a chute is its own: with the sea's `ICE_DRAG` the
		// first version topped out at 8 m/s and got there in half a second, which is walking downhill.
		const terminal = (G * SLIDE_GRADE) / SLIDE_DRAG;
		expect(terminal).toBeGreaterThan(WALK_SPEED * 3);
		expect(SLIDE_DRAG).toBeLessThan(ICE_DRAG * 0.7);
		// And you lean on a slide rather than pushing off it, but not so little that a line cannot be
		// taken: two thirds of the grip crosses the run in about a second at speed.
		expect(MOVE_GRIP * SLIDE_GRIP).toBeGreaterThan(G * SLIDE_GRADE);
	});

	it('is one continuous surface, not a staircase of discs', () => {
		// The bug this exists for: the descent lived in `Floe.altitude`, which only the RENDERER read,
		// while `groundHeight` answered with the banked cross-section alone. The simulation stood every
		// penguin on a flat disc, the drawn ribbon sloped away underneath them, and the result was a
		// penguin hovering over the ice and dropping a storey each time `floeUnder` picked the next
		// disc — reported as "floating in the air and drops random".
		//
		// Where two discs overlap they both have an opinion about where the ice is. They have to agree,
		// or a racer steps off a lip at every boundary for the whole run.
		for (const seed of SEEDS) {
			const course = slideCourse(seed);
			for (let i = 0; i < course.length - 1; i++) {
				const here = course[i];
				const next = course[i + 1];
				if (!here || !next || next.id !== here.id + 1) continue;
				// HALF WAY, and only half way. `floeUnder` gives a point to the NEAREST disc, so the
				// two segments swap ownership on the perpendicular bisector between their centres and
				// nowhere else. Away from that line only one of them is ever consulted, and demanding
				// that they agree there would forbid a segment from having any shape of its own — a
				// bump, for instance, which must be gone by the handoff and is free to exist before it.
				//
				// Down the MIDDLE of the run, which is a real limit of this surface and worth stating.
				// Out on the banks the two segments do disagree at a bend — each measures its wall from
				// its own centre, and on a corner those centres are offset across the run as well as
				// along it, so near the rim the handoff can step by half a metre. Racers spend the
				// round in the middle third and the banks are a rescue rather than a line, so it has
				// never been felt; a chute whose cross-section was defined against a continuous course
				// frame instead of per disc would not have it at all.
				const at = {
					x: (here.center.x + next.center.x) / 2,
					z: (here.center.z + next.center.z) / 2
				};
				const fromHere = here.altitude + groundHeight(here, at);
				const fromNext = next.altitude + groundHeight(next, at);
				// A few centimetres. Not zero: a bend turns the two segments' fall lines against each
				// other, and that residue is what the bend rate costs.
				expect(Math.abs(fromHere - fromNext)).toBeLessThan(0.06);
			}
		}
	});

	it('carries bumps that actually launch a racer, and never past the walls', () => {
		// The mode had a jump button and nothing to jump: at the old 0.5 m height a bump's steepest
		// slope (`h·π / 2·reach`) was 0.224 against a `SLIDE_GRADE` of 0.5, so the ice never fell away
		// faster than the fall line and `step.ts` never gave anyone air — measured over a full run at
		// 1-2% airborne, all of it the banks. `SLIDE_BUMP_HEIGHT` is derived from the grade now, so a
		// bump is guaranteed to clear it rather than merely hoped to.
		//
		// That break-even (1.11 m here) is already above `JUMP_APEX`: a bump built to beat this
		// course's fall line at this spacing cannot also be "under the height of a jump", so the two
		// things this test used to assert are incompatible at this geometry. What still has to hold is
		// the ceiling that matters on a mountain with banks either side of the run: a bump may never
		// read as taller than the wall that is holding the racer in.
		const course = slideCourse(5);
		const bumpy = course.find((floe) => floe.id % SLIDE_BUMP_EVERY === 0 && floe.id > 3);
		expect(bumpy).toBeDefined();
		if (!bumpy) return;

		// A crest at the segment's own centre, steep enough to beat the fall line, capped at the bank.
		const crest = bankAt(bumpy, bumpy.center).height;
		expect(crest).toBeCloseTo(SLIDE_BUMP_HEIGHT, 6);
		const breakEven = (SLIDE_GRADE * 2 * (SLIDE_SEGMENT_STEP / 2)) / Math.PI;
		expect(crest).toBeGreaterThan(breakEven);
		expect(crest).toBeLessThanOrEqual(SLIDE_BANK_HEIGHT);

		// And gone by the handoff, or it is a step in the ice at every segment boundary — see the
		// continuity test above, which is the rule this one has to live inside.
		const along = segmentHeading(bumpy);
		const edge = {
			x: bumpy.center.x + along.x * (SLIDE_SEGMENT_STEP / 2),
			z: bumpy.center.z + along.z * (SLIDE_SEGMENT_STEP / 2)
		};
		expect(bankAt(bumpy, edge).height).toBeCloseTo(0, 6);

		// The slope on the way up points BACK up the hill, so gravity takes a racer off the far side
		// rather than holding them on the crest.
		const rising = {
			x: bumpy.center.x - along.x * 1.5,
			z: bumpy.center.z - along.z * 1.5
		};
		const lean = bankAt(bumpy, rising).slope;
		expect(lean.x * along.x + lean.z * along.z).toBeGreaterThan(0);
	});

	it('is ground a penguin STAYS on, however steep it is', () => {
		// A penguin on a constant slope is not falling: its velocity runs along the surface. Treating
		// every descent as air gave a grounded racer 0.1 m of lift per tick at 12 m/s, the fall gravity
		// chased it down, and the mountain became a trampoline. `step.ts` asks whether the surface fell
		// further than its own gradient predicted — on a chute, never.
		const world = createWorld(['a'], 21, 'slide');
		const p = world.penguins[0];
		expect(p).toBeDefined();
		if (!p) return;
		for (let i = 0; i < COUNTDOWN_TICKS; i++) step(world, new Map());

		let highest = 0;
		let travelled = 0;
		const from = { ...p.pos };
		for (let i = 0; i < 6 * TICK_RATE; i++) {
			step(world, new Map());
			highest = Math.max(highest, p.height);
			travelled = Math.hypot(p.pos.x - from.x, p.pos.z - from.z);
		}
		// Nobody touched the stick, so it went down the hill on gravity alone — and stayed on the ice
		// the whole way.
		expect(travelled).toBeGreaterThan(SLIDE_SEGMENT_STEP * 3);
		// A couple of millimetres, not zero: the fall line turns a little at every bend, so the ice
		// under a racer is never quite the plane the last tick predicted — and since `groundHeight`
		// now blends this segment's answer with its neighbour's near a boundary
		// (`archipelago.blendedChuteGround`), the surface a racer rides is a smooth curve rather than
		// a perfectly flat plane there either, which is the same kind of residual for the same
		// reason. What must not happen is AIR — the bug this replaces lifted a penguin a metre off
		// the run and held it there, and two millimetres is not that.
		expect(highest).toBeLessThan(0.002);
	});

	it('descends', () => {
		const course = slideCourse(11);
		expect(finishOf({ floes: course } as never)?.altitude).toBeLessThan(course[0]?.altitude ?? 0);
	});

	it('is the same mountain from the same seed', () => {
		expect(slideCourse(77)).toEqual(slideCourse(77));
		expect(slideCourse(77)).not.toEqual(slideCourse(78));
	});

	it('agrees with its neighbour off the centreline, on a real bend', () => {
		// "es ruckelt runter, wird man teleportiert" (Daniel, 2026-08-22): two adjacent segments,
		// asked for the ground height at the SAME point near their shared boundary, used to answer
		// with numbers up to 1.8 m apart wherever that point was not dead centre — which on a bend is
		// most of it, since the bank is what puts a racer there. `groundHeight`'s optional `course`
		// parameter is what fixes this (`archipelago.blendedChuteGround`); this seed and segment pair
		// are the ones the bug was originally measured on.
		const course = slideCourse(20260821);
		const a = course[5];
		const b = course[6];
		expect(a).toBeDefined();
		expect(b).toBeDefined();
		if (!a || !b) return;

		const ha = segmentHeading(a);
		const across = { x: -ha.z, z: ha.x };
		const mid = { x: (a.center.x + b.center.x) / 2, z: (a.center.z + b.center.z) / 2 };
		const at = (offset: number) => ({ x: mid.x + across.x * offset, z: mid.z + across.z * offset });

		// Every offset a racer can actually stand at, not just the centreline — the disagreement this
		// guards against was invisible on the centreline and close to a metre at the rim. 0.2 m
		// rather than a tighter bound because the blend is not claimed to be perfect, only far
		// smaller than the bug: measured across the whole course after the fix, the worst point
		// anywhere was 0.3 m, against up to 1.8 m before it.
		for (const offset of [0, 2, 3.5, 4.5]) {
			for (const side of [1, -1]) {
				const p = at(offset * side);
				const worldA = a.altitude + groundHeight(a, p, course);
				const worldB = b.altitude + groundHeight(b, p, course);
				expect(Math.abs(worldA - worldB)).toBeLessThan(0.2);
			}
		}

		// And the guard is non-vacuous: the SAME two segments, asked WITHOUT the course context
		// `step.ts` now always supplies, disagree by a real amount at the same offset — proving this
		// test would have caught the bug it exists to catch, the same way `purity.test.ts` feeds its
		// own regexes the violations they exist to catch.
		const farOut = at(4.5);
		const worldAAlone = a.altitude + groundHeight(a, farOut);
		const worldBAlone = b.altitude + groundHeight(b, farOut);
		expect(Math.abs(worldAAlone - worldBAlone)).toBeGreaterThan(0.5);
	});
});

describe('a race', () => {
	it('starts everybody abreast, on the ice, at the top', () => {
		const world = createWorld(
			Array.from({ length: SLIDE_RACERS }, (_, i) => `p${i}`),
			5,
			'slide'
		);
		for (const p of world.penguins) {
			expect(floeUnder(world.floes, p.pos)?.id).toBe(0);
			// Nobody starts in front: everyone is on the first segment, which is what makes it a race
			// rather than a handicap.
			expect(progressOf(world, p)).toBe(0);
		}
	});

	it('is won by whoever arrives, and ends when they do', () => {
		// Every other mode in this game ends when one penguin is left standing. A race that waited for
		// that would keep going after the winner had crossed, with the winner standing at the bottom
		// watching — the least satisfying way to win anything.
		const { world, ticks } = race(101);
		expect(world.round.phase).toBe('over');
		expect(world.round.winner).not.toBeNull();

		const champion = world.penguins.find((p) => p.id === world.round.winner);
		expect(champion).toBeDefined();
		if (champion) expect(hasFinished(world, champion)).toBe(true);
		// And the others are still on the mountain rather than eliminated: the round ended because
		// somebody won it.
		expect(world.penguins.filter((p) => p.phase === 'skating').length).toBeGreaterThan(1);
		// A run is tens of seconds, not minutes.
		expect(ticks / TICK_RATE).toBeLessThan(120);
	});

	it('takes about as long as the course is long', () => {
		// Sanity against the numbers that decide the pace, DERIVED from them rather than typed in: the
		// length of the mountain over the speed a run settles at, which is `G · gradient / drag` and
		// uses the chute's own drag. Asking `ICE_DRAG` instead — the sea's — put the floor above the
		// actual time, because the mode is deliberately faster than the sea is.
		const { ticks } = race(202);
		const seconds = ticks / TICK_RATE;
		const straight = (SLIDE_SEGMENTS * SLIDE_SEGMENT_STEP) / ((G * SLIDE_GRADE) / SLIDE_DRAG);
		expect(seconds).toBeGreaterThan(straight * 0.6);
		expect(seconds).toBeLessThan(straight * 4);
	});

	it('cannot be ridden faster than the mountain is steep', () => {
		// **The bug this exists for was the whole of "unplayable".** The chute's steering asked for
		// `length(vel) + WALK_SPEED`, which is self-referential: holding the stick forward asked for
		// 3.6 m/s more than the racer already had, every tick, with no ceiling in it. Equilibrium was
		// drag against gravity PLUS the whole grip budget, and it measured 22.0 m/s in a mode designed
		// for 12.3.
		//
		// What that did to the player is the second assertion, and it is the one worth reading: the
		// tightest circle a racer can drive is `v² / grip`, and at 22 m/s that is 77 m while the course
		// turns at `SLIDE_SEGMENT_STEP / SLIDE_BEND_RATE` = 44 m. The run was physically tighter than
		// the racer — unfollowable at any skill, by anybody, for ever.
		//
		// Both are asserted against the constants that decide them rather than against measured numbers,
		// so tuning the mountain moves the test with it and only REMOVING the ceiling fails it.
		const terminal = (G * SLIDE_GRADE) / SLIDE_DRAG;
		const ids = Array.from({ length: SLIDE_RACERS }, (_, i) => `p${i}`);
		const world = createWorld(ids, 606, 'slide');
		// A field, not a lone racer: with one penguin `policy.lastStanding` sees a single survivor and
		// ends the round on the first tick, after which input is frozen and any measurement of steering
		// is a measurement of gravity. That cost two wrong diagnoses before it was noticed.
		const bots = ids.slice(1).map((id) => createBot(id, 'normal', world.seed));

		let top = 0;
		for (let i = 0; i < TICK_RATE * 150 && world.round.phase !== 'over'; i++) {
			const me = world.penguins[0];
			if (!me) break;
			const under = floeUnder(world.floes, me.pos);
			// Flat out down the hill for the whole race — the one input an eight-year-old always gives,
			// and the input that used to break the mode.
			const inputs = new Map<string, InputFrame>([
				[
					me.id,
					{
						move: under ? segmentHeading(under) : { x: 0, z: -1 },
						jump: false,
						throw: false,
						dash: false
					}
				]
			]);
			for (const bot of bots) inputs.set(bot.id, bot.think(world));
			step(world, inputs);
			top = Math.max(top, Math.hypot(me.vel.x, me.vel.z));
		}

		// A ceiling set by the mountain, not by the stick. The 15% is the overshoot a bump and a steep
		// stretch are allowed to add on the way down.
		expect(top, 'the chute has no speed ceiling again').toBeLessThan(terminal * 1.15);
		// And the course stays followable at that speed, with room to spare.
		const turnRadius = (top * top) / (MOVE_GRIP * SLIDE_GRIP);
		expect(turnRadius, 'the course now turns tighter than a racer can').toBeLessThan(
			SLIDE_SEGMENT_STEP / SLIDE_BEND_RATE
		);
	});

	it('ranks by how far down the mountain everybody is', () => {
		const { world } = race(303);
		const order = standings(world);
		for (let i = 1; i < order.length; i++) {
			const ahead = order[i - 1];
			const behind = order[i];
			if (!ahead || !behind) continue;
			expect(progressOf(world, ahead)).toBeGreaterThanOrEqual(progressOf(world, behind));
		}
	});

	it('replays exactly from the same seed', () => {
		const a = race(404);
		const b = race(404);
		expect(a.ticks).toBe(b.ticks);
		expect(a.world.round.winner).toBe(b.world.round.winner);
	});

	it('does not throw everybody off the mountain', () => {
		// The course is bent by a seeded random walk, and a bend that is too sharp for the speed is a
		// course that kills rather than one that tests. Most of the field has to still be on it.
		let survived = 0;
		let raced = 0;
		for (const seed of [1, 2, 3, 4, 5]) {
			const { world } = race(seed);
			survived += world.penguins.filter((p) => p.phase === 'skating').length;
			raced += world.penguins.length;
		}
		expect(survived / raced).toBeGreaterThan(0.5);
	});

	it('does not let a racer win before the round has started', () => {
		// The countdown freezes everybody, and `endRoundIfDecided` is asked every tick from the first.
		const world = createWorld(['a', 'b'], 9, 'slide');
		for (let i = 0; i < COUNTDOWN_TICKS - 1; i++) step(world, new Map());
		expect(world.round.phase).toBe('countdown');
		expect(world.round.winner).toBeNull();
	});
});
