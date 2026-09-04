import { describe, expect, it } from 'vitest';
import { groundHeight, groundSlope } from './archipelago';
import { type Bot, createBot } from './bot';
import { DT, MOUND_MAX_SLOPE, TICK_RATE, WALK_SPEED } from './constants';
import {
	ISLAND_BUILDING_MARGIN,
	ISLAND_MOUNDS,
	ISLAND_OBSTACLES,
	ISLAND_RADIUS,
	ISLAND_SHORE_MARGIN,
	ISLAND_WALK_MAX_SECONDS,
	ISLAND_WALK_MIN_SECONDS,
	ISLAND_ZONE_RING,
	ISLAND_ZONES,
	type IslandZone,
	theSquare,
	walkSeconds,
	zoneAt,
	zoneUnder
} from './island';
import { ISLAND } from './modes/registry';
import { step } from './step';
import type { InputFrame, Vec2 } from './types';
import { distance, length, normalize, scale, sub, vec, ZERO } from './vec';
import { createWorld, findPenguin } from './world';

/**
 * The island, which is the first thing in this game that is a PLACE rather than a round.
 *
 * Most of what is asserted here is geometry, and it is asserted against `WALK_SPEED` and the layout
 * rather than against numbers copied out of a docblock — the same reason `JUMP_APEX` is exported and
 * the jump test asserts against it. A hand-typed "nine seconds" in this file would still say nine
 * seconds on the afternoon somebody halves the walk speed.
 */

const PUSH = (move: Vec2): InputFrame => ({ move, jump: false, throw: false, dash: false });

/** Every unordered pair, for the checks that are about a RELATION between two places. */
function pairs<T>(items: readonly T[]): [T, T][] {
	const out: [T, T][] = [];
	for (const [i, a] of items.entries()) {
		for (const b of items.slice(i + 1)) out.push([a, b]);
	}
	return out;
}

/** Every ordered pair, because walking UP to the mountain and DOWN from it are different journeys. */
function journeys(): [IslandZone, IslandZone][] {
	const out: [IslandZone, IslandZone][] = [];
	for (const from of ISLAND_ZONES) {
		for (const to of ISLAND_ZONES) if (from !== to) out.push([from, to]);
	}
	return out;
}

/** The zones you go to a GAME from. The shop is deliberately closer than any of them. */
const gameZones = ISLAND_ZONES.filter((zone) => zone.leads.kind === 'mode');

describe('the five places', () => {
	it('are all there, and the square is the first of them', () => {
		// Without this every loop below passes vacuously the day the table is emptied.
		// Six PLACES, four of which are a game. The other two — the shop and the igloo — are the reason
		// `leads.kind` exists rather than everything being a mode with a null.
		expect(ISLAND_ZONES.length).toBe(6);
		expect(gameZones.length).toBe(4);
		expect(theSquare()).toBe(ISLAND_ZONES[0]);
		expect(new Set(ISLAND_ZONES.map((z) => z.id)).size).toBe(ISLAND_ZONES.length);
		expect(new Set(ISLAND_ZONES.map((z) => z.name)).size).toBe(ISLAND_ZONES.length);
	});

	it('are where they say they are', () => {
		for (const zone of ISLAND_ZONES) {
			expect(zoneAt(zone.at), zone.id).toBe(zone);
			// And they END. A zone whose radius did not bound it would be a door that opens from
			// anywhere on the island, which is every door at once.
			const justOutside = { x: zone.at.x, z: zone.at.z + zone.radius * 1.001 };
			expect(zoneAt(justOutside)?.id, zone.id).not.toBe(zone.id);
		}
	});

	it('cannot be two places at once', () => {
		// `zoneAt` returns the first match rather than the nearest, deliberately — a tie-break would
		// hide a layout in which two doors overlap, and standing in two doors is a state the UI would
		// have to invent a rule for. So the LAYOUT is what has to be exclusive.
		for (const [a, b] of pairs(ISLAND_ZONES)) {
			expect(distance(a.at, b.at), `${a.id} overlaps ${b.id}`).toBeGreaterThan(a.radius + b.radius);
		}
	});

	it('are on the island, with beach to spare', () => {
		// A zone reaching the shore would be a door you can only half stand in, on the one line the
		// island holds you at.
		for (const zone of ISLAND_ZONES) {
			expect(length(zone.at) + zone.radius, zone.id).toBeLessThan(
				ISLAND_RADIUS - ISLAND_SHORE_MARGIN
			);
		}
	});

	it('are a walk a child will actually make', () => {
		// DERIVED from `WALK_SPEED` and the layout: halve the walk speed and this fails rather than
		// quietly doubling every journey on the island. The ceiling is attention span — twenty seconds
		// of holding a stick with nothing happening is when the phone goes down.
		for (const [from, to] of pairs(ISLAND_ZONES)) {
			expect(walkSeconds(from.at, to.at), `${from.id} → ${to.id}`).toBeLessThanOrEqual(
				ISLAND_WALK_MAX_SECONDS
			);
		}
		// And the floor, over the GAME zones only: a "somewhere else" you arrive at in three seconds is
		// not somewhere else. The shop is exempt on purpose — it is off the square, and a child who
		// wants a different hat should not have to cross the island for it.
		for (const [from, to] of pairs(gameZones)) {
			expect(walkSeconds(from.at, to.at), `${from.id} → ${to.id}`).toBeGreaterThanOrEqual(
				ISLAND_WALK_MIN_SECONDS
			);
		}
		expect(walkSeconds(theSquare().at, ISLAND_ZONES[4]?.at ?? ZERO)).toBeLessThan(
			ISLAND_WALK_MIN_SECONDS
		);
	});

	it('puts the mountain as far from the square as the island allows', () => {
		// Story 10: the mountain is the one thing that tells a child there is somewhere else to go, so
		// it must not be ON the square — and the seal cave is put opposite it, which is what makes the
		// two longest walks the two that lead to the two hardest modes.
		const mountain = ISLAND_ZONES.find((z) => z.id === 'mountain');
		const cave = ISLAND_ZONES.find((z) => z.id === 'cave');
		if (!mountain || !cave) throw new Error('the island lost its mountain');
		expect(walkSeconds(mountain.at, cave.at)).toBeGreaterThan(walkSeconds(theSquare().at, cave.at));
	});

	it('puts the gondola on the peak rather than beside it', () => {
		// The slide is the one game you have to CLIMB to, and that only works if the door is on top of
		// the hill. The mountain is the tallest mound, and its middle IS the zone.
		const mountain = ISLAND_ZONES.find((z) => z.id === 'mountain');
		const tallest = [...ISLAND_MOUNDS].sort((a, b) => b.height - a.height)[0];
		if (!mountain || !tallest) throw new Error('the island lost its mountain');
		expect(scale(tallest.at, ISLAND_RADIUS)).toEqual(mountain.at);
	});
});

describe('the ground', () => {
	it('has no wall on it anywhere', () => {
		// `MOUND_MAX_SLOPE` is the constraint every hill in this game is derived from: gravity down a
		// slope is `G · gradient` against `MOVE_GRIP` of push, so a hill whose footprint was chosen
		// freely is a wall that looks like a ramp. Sampled over the whole island rather than at the
		// mounds' own steepest points, because hills SUM — two ramps crossing make a wall neither of
		// them is.
		const island = createWorld(['a'], 1, ISLAND.id).floes[0];
		if (!island) throw new Error('the island was built with no ground');
		let steepest = 0;
		for (let x = -ISLAND_RADIUS; x <= ISLAND_RADIUS; x += 1) {
			for (let z = -ISLAND_RADIUS; z <= ISLAND_RADIUS; z += 1) {
				steepest = Math.max(steepest, length(groundSlope(island, vec(x, z))));
			}
		}
		expect(steepest).toBeGreaterThan(0.1);
		expect(steepest).toBeLessThanOrEqual(MOUND_MAX_SLOPE);
	});

	it('keeps its hills apart', () => {
		for (const [a, b] of pairs(ISLAND_MOUNDS)) {
			expect(distance(a.at, b.at)).toBeGreaterThan(a.radius + b.radius);
		}
	});

	it('does not bob, and does not tilt under a crowd', () => {
		// The island is `anchored`: land, not a raft. Story 10 asks for "the swell amplitude at zero"
		// and this is that, with no new field — but `anchored` is also what a chute is, so the check
		// that matters is that none of the MOUNTAIN's physics came with it.
		const world = createWorld(['a', 'b', 'c', 'd'], 5, ISLAND.id);
		const island = world.floes[0];
		if (!island) throw new Error('the island was built with no ground');
		for (let i = 0; i < TICK_RATE * 10; i++) {
			step(world, new Map(world.penguins.map((p) => [p.id, PUSH(vec(1, 0))])));
			expect(island.slope).toEqual(ZERO);
		}
	});
});

describe('walking around it', () => {
	it.each(journeys().map(([from, to]) => [`${from.id} → ${to.id}`, from, to] as const))(
		'%s',
		(_what, from, to) => {
			// Simulated rather than measured off the map: a hill that is secretly a wall, a shore clamp
			// that catches somebody walking past it, or a door placed on top of a slope you slide off
			// all show up here and nowhere else.
			//
			// The tick budget is DERIVED — the flat-ground walk at `WALK_SPEED`, times three. The slack
			// is for the climb: the mountain door is on a peak, and gravity down a 0.52 gradient takes
			// most of a walk's speed away from you.
			const world = createWorld(['me'], 77, ISLAND.id);
			const me = findPenguin(world, 'me');
			if (!me) throw new Error('nobody arrived on the island');
			me.pos = from.at;
			me.vel = ZERO;

			const budget = Math.ceil(walkSeconds(from.at, to.at) * TICK_RATE * 3);
			let arrived = false;
			for (let i = 0; i < budget && !arrived; i++) {
				const now = findPenguin(world, 'me');
				if (!now) throw new Error('the walker vanished');
				step(world, new Map([['me', PUSH(normalize(sub(to.at, now.pos)))]]));
				arrived = zoneUnder(now)?.id === to.id;
			}
			expect(arrived).toBe(true);
		}
	);

	it('is nowhere while in the air', () => {
		// A door that opens because you were shoved over it is a door that opens by accident. Standing
		// in a place means standing.
		const world = createWorld(['me'], 3, ISLAND.id);
		const me = findPenguin(world, 'me');
		if (!me) throw new Error('nobody arrived on the island');
		me.pos = theSquare().at;
		expect(zoneUnder(me)?.id).toBe('square');
		me.height = 1;
		expect(zoneUnder(me)).toBeNull();
		me.height = 0;
		me.phase = 'out';
		expect(zoneUnder(me)).toBeNull();
	});
});

describe('the doors', () => {
	/** The hub's own hook, narrowed once: it is optional on `GameMode` because a round has no doors. */
	const doorUnder = ISLAND.doorUnder;
	if (!doorUnder) throw new Error('the island was registered without any doors');

	/** A penguin standing at a point on the island, on its feet. */
	function standingAt(at: Vec2) {
		const world = createWorld(['me'], 4, ISLAND.id);
		const me = findPenguin(world, 'me');
		if (!me) throw new Error('nobody arrived on the island');
		me.pos = at;
		return { world, me };
	}

	it("gives every zone a door, with the zone's own name on it", () => {
		for (const zone of ISLAND_ZONES) {
			const { world, me } = standingAt(zone.at);
			const door = doorUnder(world, me);
			expect(door?.id, zone.id).toBe(zone.id);
			// The sign says what the place is called. A door named something else would be a sign that
			// disagrees with the map, which is the one thing a child navigates by.
			expect(door?.name, zone.id).toBe(zone.name);
		}
	});

	it('hands back the same door object every time', () => {
		// Built once at module load, so "am I still in the door I was in last frame" has an answer. A
		// fresh object per call makes that question always answer no, and the prompt flickers.
		const { world, me } = standingAt(theSquare().at);
		expect(doorUnder(world, me)).toBe(doorUnder(world, me));
	});

	it('opens nothing at Der Laden', () => {
		// Not an oversight: it is what lets the shop be a PLACE on the island — a building with a sign
		// you can stand in front of — before it is a screen (story 10d). A door naming a mode this
		// build cannot play would be a button that is visible, pressable and dead, which is trap 4 and
		// has been paid for four times in this repo.
		const shop = ISLAND_ZONES.find((zone) => zone.leads.kind === 'shop');
		if (!shop) throw new Error('the island lost its shop');
		const { world, me } = standingAt(shop.at);
		expect(doorUnder(world, me)?.id).toBe(shop.id);
		expect(doorUnder(world, me)?.opens).toBeNull();
	});

	it('only ever opens a game that can actually be started', () => {
		// The other half of the same rule. A door is a promise, and this is the test that the promise
		// can be kept: whatever it names, a world of it builds and ticks.
		for (const zone of ISLAND_ZONES) {
			const { world, me } = standingAt(zone.at);
			const opens = doorUnder(world, me)?.opens ?? null;
			if (!opens) continue;
			const started = createWorld(['a'], 5, opens);
			expect(started.mode, zone.id).toBe(opens);
			expect(started.floes.length, zone.id).toBeGreaterThanOrEqual(1);
		}
	});

	it('is null on open ground, and null for a penguin who is not on its feet', () => {
		// A door that opened because somebody was shoved over it is a door that opens by accident.
		const beach = { x: 0, z: ISLAND_RADIUS - ISLAND_SHORE_MARGIN - 1 };
		const { world, me } = standingAt(beach);
		expect(zoneAt(beach)).toBeNull();
		expect(doorUnder(world, me)).toBeNull();

		const inside = standingAt(theSquare().at);
		expect(doorUnder(inside.world, inside.me)).not.toBeNull();
		inside.me.height = 1;
		expect(doorUnder(inside.world, inside.me)).toBeNull();
	});
});

describe('the buildings', () => {
	// Daniel, playing it: "collision is fully missing .. i can run through building". The footprints
	// live in the simulation and the renderer draws on them, so the wall a child bumps into cannot be
	// somewhere other than the wall they can see — the `moundsFor` arrangement, applied to solid things.

	it('has buildings at all, and every one belongs to a zone', () => {
		// Without this, every assertion below — and the twenty walking routes above — passes vacuously
		// the day the list empties.
		expect(ISLAND_OBSTACLES.length).toBe(6);
		expect(new Set(ISLAND_OBSTACLES.map((b) => b.id)).size).toBe(ISLAND_OBSTACLES.length);
		for (const building of ISLAND_OBSTACLES) {
			expect(
				ISLAND_ZONES.some((zone) => zone.id === building.of),
				building.id
			).toBe(true);
			expect(building.radius, building.id).toBeGreaterThan(0.5);
		}
	});

	it('stands outside its zone, and inside the shore', () => {
		// Outside, so the ground that opens a door and the ground a wanderer walks to stay walkable —
		// and so `zoneAt` never has to know a wall exists.
		for (const building of ISLAND_OBSTACLES) {
			const zone = ISLAND_ZONES.find((z) => z.id === building.of);
			if (!zone) throw new Error(`${building.id} has no zone`);
			expect(distance(building.at, zone.at), building.id).toBeGreaterThan(
				zone.radius + building.radius + ISLAND_BUILDING_MARGIN
			);
			expect(length(building.at) + building.radius, building.id).toBeLessThan(
				ISLAND_RADIUS - ISLAND_SHORE_MARGIN
			);
		}
	});

	it('leaves the igloo somewhere a dome can actually stand', () => {
		// Three things a plot needs that no other building does, because a dome is not a box: FLAT ground
		// (a dome on a slope needs skirting nobody has built), room from every hill, and walkable beach
		// behind it so the finished igloo is not a pocket against the water.
		const plot = ISLAND_ZONES.find((zone) => zone.leads.kind === 'home');
		const iglu = ISLAND_OBSTACLES.find((building) => building.of === 'igloo');
		if (!plot || !iglu) throw new Error('the island lost its igloo');

		const island = createWorld(['a'], 1, ISLAND.id).floes[0];
		if (!island) throw new Error('the island was built with no ground');
		// Flat, measured off the same function a penguin's feet use.
		expect(groundHeight(island, plot.at)).toBeCloseTo(0, 9);
		expect(groundHeight(island, iglu.at)).toBeCloseTo(0, 9);
		expect(length(groundSlope(island, iglu.at))).toBeCloseTo(0, 9);

		// Eight metres clear of every hill, for both the doorstep and the dome.
		for (const mound of ISLAND_MOUNDS) {
			const middle = scale(mound.at, ISLAND_RADIUS);
			const reach = mound.radius * ISLAND_RADIUS;
			expect(distance(plot.at, middle) - reach).toBeGreaterThanOrEqual(8);
			expect(distance(iglu.at, middle) - reach).toBeGreaterThanOrEqual(8);
		}

		// And you can walk round the back of it.
		expect(ISLAND_RADIUS - ISLAND_SHORE_MARGIN - (length(iglu.at) + iglu.radius)).toBeGreaterThan(
			3
		);

		// The dome is NORTH of its doorstep, so the door faces the camera's side. Trap 17, applied
		// forwards: asserted rather than commented, because a sign flip here turns the front of the
		// igloo into the back of it and nothing else would fail.
		expect(iglu.at.z).toBeLessThan(plot.at.z);
		expect(iglu.at.x).toBeCloseTo(plot.at.x, 6);
	});

	it('never sits on the line between two zones', () => {
		// The geometric half of "no obstacle may sit across a path". The walking half is the twenty
		// routes above, which now run with the buildings in place — this one says WHY they pass, and
		// fails with a name and a number instead of a bot pushing at a wall for three seconds.
		for (const [from, to] of pairs(ISLAND_ZONES)) {
			const span = sub(to.at, from.at);
			const len = length(span);
			const dir = scale(span, 1 / len);
			for (const building of ISLAND_OBSTACLES) {
				const rel = sub(building.at, from.at);
				const along = rel.x * dir.x + rel.z * dir.z;
				// Only the part of the line that is actually between them.
				if (along <= 0 || along >= len) continue;
				const sideways = Math.abs(rel.x * dir.z - rel.z * dir.x);
				expect(sideways, `${building.id} blocks ${from.id} → ${to.id}`).toBeGreaterThan(
					building.radius + ISLAND_BUILDING_MARGIN
				);
			}
		}
	});

	it('cannot be entered from any bearing', () => {
		// Walked into rather than computed: sixteen bearings per building, at everything a child can
		// press. A wall you can get inside from one angle is a wall a child WILL find.
		for (const building of ISLAND_OBSTACLES) {
			const clear = building.radius + ISLAND_BUILDING_MARGIN;
			for (let b = 0; b < 16; b++) {
				const angle = (b / 16) * Math.PI * 2;
				const inward = vec(-Math.sin(angle), -Math.cos(angle));
				const world = createWorld(['me'], 900 + b, ISLAND.id);
				const me = findPenguin(world, 'me');
				if (!me) throw new Error('nobody arrived on the island');
				me.pos = { x: building.at.x - inward.x * 9, z: building.at.z - inward.z * 9 };

				let deepest = Infinity;
				for (let i = 0; i < TICK_RATE * 8; i++) {
					step(
						world,
						new Map([
							['me', { move: inward, jump: i % 29 === 0, throw: false, dash: i % 17 === 0 }]
						])
					);
					const now = findPenguin(world, 'me');
					if (!now) throw new Error('the walker vanished');
					deepest = Math.min(deepest, distance(now.pos, building.at));
				}
				expect(deepest, `${building.id} was entered from bearing ${b}`).toBeGreaterThanOrEqual(
					clear - 1e-6
				);
			}
		}
	});

	it('is walked AROUND rather than stuck to, and flings nobody', () => {
		// A dead stop reads as the game having frozen, and a fling reads as a bug — so a glancing blow
		// has to become a slide along the wall. Aimed off-centre on purpose: head-on, stopping IS the
		// right answer.
		const building = ISLAND_OBSTACLES[0];
		if (!building) throw new Error('the island lost its buildings');
		const world = createWorld(['me'], 4141, ISLAND.id);
		const me = findPenguin(world, 'me');
		if (!me) throw new Error('nobody arrived on the island');
		// Approaching from outside the square, aimed at the near edge of the Rathaus rather than at its
		// middle.
		const graze = {
			x: building.at.x + building.radius * 0.6,
			z: building.at.z - building.radius * 0.6
		};
		me.pos = { x: building.at.x - 10, z: building.at.z - 10 };
		const aim = normalize(sub(graze, me.pos));

		let travelled = 0;
		let jolt = 0;
		const seconds = 8;
		for (let i = 0; i < TICK_RATE * seconds; i++) {
			const before = findPenguin(world, 'me')?.pos ?? me.pos;
			step(world, new Map([['me', { move: aim, jump: false, throw: false, dash: false }]]));
			const after = findPenguin(world, 'me')?.pos ?? me.pos;
			const moved = distance(before, after);
			travelled += moved;
			jolt = Math.max(jolt, moved);
		}

		// Still going: more than half of what an unobstructed walk covers. Stuck to the wall it would be
		// a fraction of this.
		expect(travelled).toBeGreaterThan(WALK_SPEED * seconds * 0.5);
		// And never displaced further in one tick than a walk can be. `flung` here would mean the
		// push-out is fighting the mover.
		expect(jolt).toBeLessThanOrEqual(WALK_SPEED * DT * 1.6);
	});
});

describe('the shore', () => {
	it('holds a penguin sprinting straight at it', () => {
		const world = createWorld(['me'], 21, ISLAND.id);
		const island = world.floes[0];
		if (!island) throw new Error('the island was built with no ground');

		for (let i = 0; i < TICK_RATE * 30; i++) {
			step(world, new Map([['me', PUSH(vec(0.6, 0.8))]]));
			const me = findPenguin(world, 'me');
			if (!me) throw new Error('the sprinter vanished');
			// The line it is held at, plus one tick of its own speed — which is what the clamp costs,
			// because it is applied before the step rather than after it. Six centimetres at a walk.
			// If this grows, the clamp has stopped running every tick and the next thing to go is the
			// penguin.
			expect(length(me.pos)).toBeLessThanOrEqual(
				island.radius - ISLAND_SHORE_MARGIN + length(me.vel) * DT + 1e-9
			);
			expect(me.phase).toBe('skating');
		}
	});

	it('never sends anybody back to the middle, from any bearing', () => {
		// Daniel, playing it: "sometime i just end up being teleported back to the middle." That has a
		// very strong prior here — trap 13 is seventeen dead penguins standing in the middle of a Royal,
		// because an actor that could not be placed kept the `(0, 0)` that for it was the middle of the
		// world. A shore that RESET rather than clamped would be exactly that bug again, so this walks
		// into it from every direction and watches for the one thing that must never happen.
		const bearings = 32;
		for (let b = 0; b < bearings; b++) {
			const angle = (b / bearings) * Math.PI * 2;
			const out = vec(Math.sin(angle), Math.cos(angle));
			const world = createWorld(['me'], 500 + b, ISLAND.id);
			const start = findPenguin(world, 'me');
			if (!start) throw new Error('nobody arrived on the island');
			// Out past the zones, already walking, so the run at the shore is a real one.
			start.pos = scale(out, ISLAND_RADIUS * 0.75);

			let nearest = Infinity;
			for (let i = 0; i < TICK_RATE * 20; i++) {
				// Everything a child can press at once, pointed at the water.
				step(
					world,
					new Map([['me', { move: out, jump: i % 37 === 0, throw: false, dash: i % 23 === 0 }]])
				);
				const me = findPenguin(world, 'me');
				if (!me) throw new Error('the sprinter vanished');
				nearest = Math.min(nearest, length(me.pos));
			}

			const me = findPenguin(world, 'me');
			if (!me) throw new Error('the sprinter vanished');

			// It never went back to the middle, whatever else happened. Asserted against the ZONE RING
			// rather than against a small number: anything that put a sprinting penguin back inside the
			// ring of landmarks it had already left is the teleport, whatever its cause. This is the
			// clause the bug hunt is about, and it holds on every bearing without exception.
			expect(nearest, `bearing ${b} was sent back toward the middle`).toBeGreaterThan(
				ISLAND_ZONE_RING
			);

			// And it finished AT the shore — unless a BUILDING was in the way, in which case stopping
			// against the wall is the right answer and `the buildings` above is what proves it. Which
			// bearings those are is read off the obstacle list rather than listed here, so a building
			// that moves does not silently turn this assertion off.
			const blocked = ISLAND_OBSTACLES.some((building) => {
				const rel = sub(building.at, start.pos);
				const along = rel.x * out.x + rel.z * out.z;
				const sideways = Math.abs(rel.x * out.z - rel.z * out.x);
				return along > -building.radius && sideways < building.radius + ISLAND_BUILDING_MARGIN;
			});
			if (blocked) continue;
			expect(length(me.pos), `bearing ${b} did not finish at the shore`).toBeGreaterThan(
				ISLAND_RADIUS - ISLAND_SHORE_MARGIN - 0.5
			);
		}
	});

	it('holds one that dashes and jumps at it as well', () => {
		// A dash SETS the velocity to about 10 m/s and a jump takes the rim check out of play entirely
		// (a penguin in the air is not over anything yet), so this is the combination that would find a
		// clamp that only fires on landing.
		const world = createWorld(['me'], 22, ISLAND.id);
		const island = world.floes[0];
		if (!island) throw new Error('the island was built with no ground');

		for (let i = 0; i < TICK_RATE * 30; i++) {
			step(
				world,
				new Map([
					['me', { move: vec(-1, 0), jump: i % 40 === 0, throw: false, dash: i % 25 === 0 }]
				])
			);
			const me = findPenguin(world, 'me');
			if (!me) throw new Error('the sprinter vanished');
			expect(length(me.pos)).toBeLessThanOrEqual(
				island.radius - ISLAND_SHORE_MARGIN + length(me.vel) * DT + 1e-9
			);
			expect(me.phase).toBe('skating');
		}
	});
});

describe('the penguins who live there', () => {
	/** A full island: the player, who does nothing, and the eight wanderers the mode asks for. */
	function inhabited(seed: number) {
		const ids = Array.from({ length: ISLAND.players.solo }, (_, i) => `p${i}`);
		const world = createWorld(ids, seed, ISLAND.id);
		// The bots are everybody but `p0`, exactly as `Game.svelte` builds them: the roster is
		// `[me, ...bots]`, so the local penguin is the one nobody is driving here.
		const bots = ids.slice(1).map((id) => createBot(id, 'easy', world.seed));
		return { world, bots, ids };
	}

	function live(world: ReturnType<typeof inhabited>['world'], bots: Bot[], ticks: number): void {
		for (let i = 0; i < ticks; i++) {
			step(world, new Map(bots.map((bot) => [bot.id, bot.think(world)])));
		}
	}

	it('walks to a landmark, stands about, and then goes somewhere else', () => {
		// The whole design constraint in one assertion: intent, not a random walk. A wanderer that only
		// ever reached ONE place is a decoration, and one that reached none is broken — so every one of
		// them has to have been in at least two different zones over two minutes. Two minutes is a
		// generous budget against the island's own geometry: the longest walk on it is mountain to cave
		// and `ISLAND_WALK_MAX_SECONDS` caps that at twenty.
		const { world, bots, ids } = inhabited(101);
		const seen = new Map<string, Set<string>>(ids.map((id) => [id, new Set<string>()]));

		for (let i = 0; i < TICK_RATE * 120; i++) {
			step(world, new Map(bots.map((bot) => [bot.id, bot.think(world)])));
			for (const p of world.penguins) {
				const zone = zoneUnder(p);
				if (zone) seen.get(p.id)?.add(zone.id);
			}
		}

		for (const bot of bots) {
			expect(
				seen.get(bot.id)?.size ?? 0,
				`${bot.id} never went anywhere new`
			).toBeGreaterThanOrEqual(2);
		}
		// And the player, who was handed no input at all, is still standing where they spawned. A
		// wanderer that dragged the local penguin around would be a wanderer that shoves.
		expect(seen.get('p0')?.size).toBe(1);
	});

	it('never walks into the sea — the shore holds a bot exactly as it holds the player', () => {
		// The bug a child WILL notice. `holdOnTheIsland` iterates `world.penguins`, so it cannot treat a
		// bot differently from the player by construction — this is the test that says so out loud, and
		// it is also what covers the idle hop: `ROAM_HOP_CHANCE` is only safe because the clamp applies
		// to an airborne penguin too.
		const { world, bots } = inhabited(202);
		const keep = ISLAND_RADIUS - ISLAND_SHORE_MARGIN;
		let worst = -Infinity;
		let offender = '';

		for (let i = 0; i < TICK_RATE * 120; i++) {
			step(world, new Map(bots.map((bot) => [bot.id, bot.think(world)])));
			for (const p of world.penguins) {
				// The line it is held at, plus one tick of its own speed — the clamp runs before the step,
				// so that is exactly what it costs. Anything beyond it means the clamp stopped running.
				const over = length(p.pos) - (keep + length(p.vel) * DT);
				if (over > worst) {
					worst = over;
					offender = p.id;
				}
			}
		}

		expect(worst, `${offender} got past the shore`).toBeLessThanOrEqual(1e-9);
	});

	it('cannot be eliminated, however long it wanders', () => {
		// Nobody drowns, nobody is eaten, nothing ends. In the classic round nine penguins left to
		// themselves for two minutes is a finished game with a winner; here it has to still be a town.
		const { world, bots } = inhabited(303);
		live(world, bots, TICK_RATE * 120);

		for (const p of world.penguins) expect(p.phase, p.id).toBe('skating');
		expect(world.round.phase).toBe('playing');
		expect(world.round.winner).toBeNull();
		expect(ISLAND.attackStrength(world)).toBe(0);
	});

	it('does not take a door from the player by standing in it', () => {
		// A door is asked of a PENGUIN (`zoneUnder`), not of the ground, so a crowded square cannot make
		// the prompt disappear. Set up the worst case there is: a wanderer standing exactly on top of the
		// player, which `combat.resolveCollisions` will then push apart — separation happens whether or
		// not a mode allows an attack.
		const doorUnder = ISLAND.doorUnder;
		if (!doorUnder) throw new Error('the island was registered without any doors');
		const { world, bots } = inhabited(404);
		const me = findPenguin(world, 'p0');
		const neighbour = findPenguin(world, 'p1');
		if (!me || !neighbour) throw new Error('the island lost an inhabitant');
		me.pos = theSquare().at;
		neighbour.pos = theSquare().at;

		const mine = doorUnder(world, me);
		expect(mine?.id).toBe('square');
		expect(doorUnder(world, neighbour)?.id).toBe('square');

		live(world, bots, TICK_RATE * 2);
		// Still the same door, and the SAME door object: nothing about the neighbour leaked into it.
		expect(doorUnder(world, me)).toBe(mine);
	});
});

describe('roaming is not a round', () => {
	it('opens without a countdown', () => {
		// There is nothing to count down to. A hub that made a child watch "3, 2, 1" before they could
		// walk to the shop would be a menu with a timer on it.
		const world = createWorld(['a'], 8, ISLAND.id);
		expect(world.round.phase).toBe('playing');
		step(world, new Map());
		expect(world.round.phase).toBe('playing');
	});

	it('eliminates nobody, ends never, and lets nobody hit anybody', () => {
		// Four penguins pushing outward in four directions for a minute: in the classic round every one
		// of them is in the water inside ten seconds, which is the whole game there and exactly the
		// wrong thing here.
		const world = createWorld(['a', 'b', 'c', 'd'], 33, ISLAND.id);
		const island = world.floes[0];
		if (!island) throw new Error('the island was built with no ground');
		const away = [vec(1, 0), vec(-1, 0), vec(0, 1), vec(0, -1)];

		for (let i = 0; i < TICK_RATE * 60; i++) {
			step(world, new Map(world.penguins.map((p, at) => [p.id, PUSH(away[at] ?? vec(1, 0))])));
		}

		for (const p of world.penguins) expect(p.phase, p.id).toBe('skating');
		expect(world.round.phase).toBe('playing');
		expect(world.round.winner).toBeNull();
		expect(ISLAND.attackStrength(world)).toBe(0);
		// And the ground did not shrink, sink, break or drift under them. This is the measured half of
		// what `Scenery`'s `island` member claims: the descriptor says this ground is permanent, and
		// permanence is the whole reason it is a kind of scenery rather than a very large arena. Asserted
		// together so the claim and the behaviour cannot drift apart.
		expect(world.floes).toHaveLength(1);
		expect(island.radius).toBe(ISLAND_RADIUS);
		expect(ISLAND.scenery).toBe('hub');
	});
});
