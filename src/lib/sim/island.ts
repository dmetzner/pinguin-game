/**
 * The island: the place the games are reached FROM.
 *
 * Story 10 asks for an open world and the luckiest fact about it is that **an island is a floe**.
 * `archipelago.ts` already lays out discs and answers "what am I standing on", `floe.ts` gives the
 * gradient, and `moundsFor` established that a hill the simulation lets you climb and a hill the
 * renderer draws are one object described twice. So an island is one big disc with hand-placed
 * hills, and nothing about walking, steering, gait, the stick, the keyboard or the camera rig had to
 * learn a new word.
 *
 * Three things ARE new, and each one is here rather than in `step.ts` or `round.ts`:
 *
 *  * **It does not float.** `anchored` is the existing word for that: `floe.stepFloe` gives an
 *    anchored floe its own constant tilt and neither the swell nor the crowd's weight moves it. The
 *    island's tilt is zero, so the ground is flat except where a hill is — which is the "swell
 *    amplitude at zero" story 10 asks for, with no new field and no new branch. (A chute is also
 *    anchored; `slide.isChute` is what tells the two apart, and it asks whether the ice has a fall
 *    line rather than carrying a second flag that could disagree.)
 *  * **The zones are PLACES.** `chase.ts` established the pattern: the hunter is a position
 *    (`World.hunterAt`), not a pursuit, and that is what makes it readable, replayable and
 *    impossible to cheese. A door into a minigame is the same shape — a point, a radius, and what is
 *    on the other side. No triggers, no enter/leave events, no state to get stuck in.
 *  * **You cannot walk into the sea.** See `holdOnTheIsland`.
 *
 * Pure and seeded like everything else in `sim/`. Nothing here reads a wallet, a save file or a
 * clock: a World is replayable and a wallet is not (`backlog/stories/12-ice-and-igloos.md`).
 */
import { MOUND_MAX_SLOPE, ROYAL_SINK_TICKS, WALK_SPEED } from './constants';
import { type Arrangement, spawnPenguin } from './spawn';
import type { Floe, Mode, Mound, Penguin, Vec2, World } from './types';
import { add, distance, length, normalize, scale, sub, ZERO } from './vec';

/**
 * How big the island is, in metres of radius.
 *
 * Story 10 asks for 50–70 m and the number inside that range is chosen by the WALK: the outer zones
 * sit on a ring at `ISLAND_ZONE_RING` and the shore has to be far enough beyond them that a child
 * walking to the Eisarena is walking across an island rather than along its edge. 58 m leaves 18 m
 * of beach outside the furthest zone.
 */
export const ISLAND_RADIUS = 58;

/**
 * How far the outer zones sit from the square, in metres.
 *
 * This single number sets every walk on the island, and it was chosen from the walk rather than from
 * the map: at `WALK_SPEED` the square is 9.4 s from any of the three game zones, two neighbours are
 * 13.4 s apart, and the two furthest — the mountain and the seal cave, deliberately opposite — are
 * 18.9 s. All of it inside the ten-to-twenty seconds an eight-year-old will walk without asking what
 * the point is. `island.test.ts` asserts those times against `WALK_SPEED` and the geometry rather
 * than against numbers copied out of this comment.
 */
export const ISLAND_ZONE_RING = 34;

/**
 * How far inside the water's edge a penguin is held, in metres.
 *
 * Not a wall you can see — one metre of beach. See `holdOnTheIsland`.
 */
export const ISLAND_SHORE_MARGIN = 1.2;

/**
 * The walk this layout is designed for, in seconds, at `WALK_SPEED` on flat ground.
 *
 * The ceiling is attention span: twenty seconds of holding a stick with nothing happening is the
 * point at which a child puts the phone down. The floor is that a "somewhere else" you arrive at in
 * three seconds is not somewhere else — except for the shop, which is deliberately just off the
 * square, and which is why the floor is asserted over the GAME zones only.
 */
export const ISLAND_WALK_MIN_SECONDS = 8;
export const ISLAND_WALK_MAX_SECONDS = 20;

/** The mountain, in metres. High enough to be the thing you can see from the square. */
const MOUNTAIN_HEIGHT = 6;
/**
 * And its footprint, DERIVED from its height exactly as `archipelago.moundsFor` derives a Royal
 * hill's: a cosine bump is steepest half way up at `h·π / 2r`, so this is the narrowest a hill this
 * high may be and still be a ramp rather than a wall. The 1.15 is headroom — chosen the other way
 * round, the first Royal hills came out at a 0.97 gradient, which is grip exactly cancelled by
 * gravity and a "hill" nobody could walk up.
 */
const MOUNTAIN_RADIUS = ((MOUNTAIN_HEIGHT * Math.PI) / (2 * MOUND_MAX_SLOPE)) * 1.15;

/**
 * How big the igloo's plot is when it is FINISHED, in metres.
 *
 * **Reserved from day one, at its final size, and that is the load-bearing decision here.** The
 * obvious arrangement — a footprint that grows as a child buys rooms — would make the obstacle list a
 * function of a WALLET, and a wallet is not part of a world. Two devices replaying one seed would
 * disagree about where the walls are, and so would one device replaying its own round after a
 * purchase. `backlog/stories/12-ice-and-igloos.md` states the rule for Eis; this is the same rule one
 * step further out, where it bites hardest because a wall is a thing a player can lose to.
 *
 * So the plot is the size of the last upgrade from the first minute, and what a purchase changes is
 * what the RENDERER draws inside it. The cost is a slightly generous clearing behind an igloo with one
 * room in it, which reads as a garden.
 */
export const ISLAND_IGLOO_RADIUS = 5;

/**
 * Where a zone leads: a minigame, the shop, or home.
 *
 * One list, so none of the three is a special case — and so nothing outside `sim/` ever has to ask
 * `zone.id === 'igloo'`, which is the shape `modes/guard.test.ts` exists to keep out of components.
 */
export type ZoneDestination =
	| { readonly kind: 'mode'; readonly mode: Mode }
	| { readonly kind: 'shop' }
	| { readonly kind: 'home' };

/**
 * A place on the island.
 *
 * A position and a radius, and standing inside it is being there. Deliberately NOT a trigger: there
 * is no "entered" event to miss, no "left" event to leak, and a client and a host that disagree
 * about a tick still agree about where the square is.
 */
export interface IslandZone {
	/** Stable, and never player-visible. Persisted state may key on it, so treat it as a wire value. */
	readonly id: string;
	/** Player-visible, German, from the same curated discipline as `names.ts`. */
	readonly name: string;
	/** The middle, in world metres. The island's centre is the origin. */
	readonly at: Vec2;
	/** How big the place is, in metres. Standing within this of `at` is standing in it. */
	readonly radius: number;
	readonly leads: ZoneDestination;
}

/**
 * The five places, from story 10.
 *
 * North is −z, which is the direction every course in this game runs. The mountain is due north and
 * the seal cave due south, so the two are as far apart as the island allows and neither is anywhere
 * near the square: "somewhere else to go" only means anything if it is somewhere else.
 *
 * The mode ids below are DATA — which door leads where — not a decision about behaviour. Nothing
 * here asks *which* mode this is; `sim/modes/registry.ts` is the only thing allowed to do that.
 *
 * **Two things outside this file break when a zone is added, and both are meant to.** The narrative
 * cast and its dialogue are keyed per zone with total coverage asserted, so a new place with no
 * islander and no lines fails immediately rather than shipping silent — the cheap kind of coordination
 * cost, and far better than a hand-typed list of five that stays green. And `e2e/island.spec.ts` walks
 * two STRAIGHT LINES across the island, east from the square to the Eisarena and west to Der Laden: a
 * zone placed near either line would catch that walk and report "never reached Eisarena" from what
 * looks like a pathfinding failure. The igloo clears the eastern line by 18 m. **Check both before
 * moving a zone or adding one.**
 */
export const ISLAND_ZONES: readonly IslandZone[] = [
	{
		// The middle of everything, and the biggest: thirty penguins muster here, and a square you can
		// miss by walking past it is a square nobody finds.
		id: 'square',
		name: 'Rathausplatz',
		at: { x: 0, z: 0 },
		radius: 9,
		leads: { kind: 'mode', mode: 'royal' }
	},
	{
		// A jetty east. The classic four-penguin round is the smallest game there is, so it gets the
		// smallest, most ordinary place.
		id: 'arena',
		name: 'Eisarena',
		at: { x: ISLAND_ZONE_RING, z: 0 },
		radius: 6,
		leads: { kind: 'mode', mode: 'classic' }
	},
	{
		// The top of the mountain, and that is the whole point of it: the slide is the one game you
		// have to CLIMB to. `ISLAND_MOUNDS` puts the hill at exactly this position, so the gondola
		// station is on the peak rather than beside it.
		id: 'mountain',
		name: 'Der Berg',
		at: { x: 0, z: -ISLAND_ZONE_RING },
		radius: 6,
		leads: { kind: 'mode', mode: 'slide' }
	},
	{
		// Due south, as far from the mountain as the island goes.
		id: 'cave',
		name: 'Robbenhöhle',
		at: { x: 0, z: ISLAND_ZONE_RING },
		radius: 5,
		leads: { kind: 'mode', mode: 'chase' }
	},
	{
		// "Off the square" (story 10): five seconds' walk, deliberately shorter than any other trip.
		// The shop is where "Mein Pinguin" moves to, and a child who wants a different hat should not
		// have to cross the island for it.
		id: 'shop',
		name: 'Der Laden',
		at: { x: -16, z: 8 },
		radius: 4,
		leads: { kind: 'shop' }
	},
	{
		// HOME, and the plot is chosen rather than picked: eleven seconds east-north-east of the square,
		// on flat ground, fifteen metres clear of the nearest hill, with six metres of beach behind it.
		//
		// The quadrant is forced by the BEARING of its own building, which is the part worth reading
		// before moving it. `BUILDINGS` puts the igloo NORTH of this doorstep so the door faces +z — the
		// side the camera stands on, which is trap 17 applied forwards for once instead of paid for. But
		// a building eleven metres north of its zone stands on every route that arrives from the north,
		// and every other place on this island is at or south of the mountain with the square as the hub
		// of all of it. So a plot in the south or the west has its own front door in the way of its own
		// approach: the first two candidates measured 0.21 m and 0.18 m of clearance on their own paths.
		// The north-east is the one quadrant whose visitors arrive from behind the building.
		id: 'igloo',
		name: 'Mein Iglu',
		at: { x: 36, z: -18 },
		radius: 4.5,
		leads: { kind: 'home' }
	}
];

/** The square, which is where everybody arrives. Never undefined — see `island.test.ts`. */
export function theSquare(): IslandZone {
	const square = ISLAND_ZONES[0];
	if (!square) throw new Error('the island was laid out with no square in it');
	return square;
}

/**
 * How much clear ground there is between a zone's edge and the building behind it, in metres.
 *
 * The buildings stand OUTSIDE their zones on purpose. A town hall in the middle of the square would
 * sit on the circle that opens the Royal and on the spot a wanderer walks to, so the door and the
 * building would be fighting over the same ground. Outside, the zone stays entirely walkable, the
 * plaza is ringed rather than blocked, and `zoneAt` needs to know nothing about walls.
 */
const BUILDING_GAP = 1.5;

/**
 * How much room a penguin's body needs beyond a wall, in metres.
 *
 * A collision that stopped a penguin's CENTRE at the wall would bury half a penguin in it. This is
 * roughly half a body, which is what makes a building look solid rather than absorbent.
 */
export const ISLAND_BUILDING_MARGIN = 0.45;

/**
 * A solid thing you cannot walk through: where it is and how much room it takes.
 *
 * A CIRCLE, because a circle is the one collision primitive this game already has — `Mound` is a
 * circle, `floeUnder` is a circle, the contact test in `combat.ts` is a circle — and because pushing a
 * point out of a circle gives sliding along the wall for free rather than as a special case. A boxy
 * building drawn on a round footprint loses its corners to the player's benefit, which is the right
 * direction for an audience of eight-year-olds.
 *
 * **This list is the simulation's, and the renderer draws its buildings on it.** That is the
 * `moundsFor` precedent, which `CLAUDE.md` states as "an iceberg you can see is exactly the one you
 * can climb": one list, two readers, and no way for the wall a child bumps into to be somewhere other
 * than the wall they can see. The alternative — collision inside `render/` — would put a rule the
 * player can lose to in the layer that is forbidden to write to the world (invariant 2).
 */
export interface Obstacle {
	/** Stable, never player-visible, and the key the renderer picks a model by. A wire value. */
	readonly id: string;
	/** The zone it belongs to, so a zone that moves takes its building with it. */
	readonly of: string;
	readonly at: Vec2;
	readonly radius: number;
}

/**
 * Which building stands behind which zone, and on which side.
 *
 * The bearing is the decision, and it is a navigation decision rather than an art one: **no building
 * may sit on the line between two zones.** Four of the five are simply pushed straight out from the
 * island's middle, which puts them behind their zone where no route passes. The square has no
 * "outward" — it IS the middle — so its bearing is given, and it is SOUTH-EAST because every other
 * route out of the square is taken: the Eisarena is due east, the mountain due north, the seal cave
 * due south and the shop west-south-west. South-east is the one direction from the square that leads
 * nowhere, which is exactly where a building belongs.
 *
 * `island.test.ts` checks it rather than trusting it, and checks it twice: once geometrically against
 * every pair of zones, and once by WALKING all twenty routes with the buildings in place.
 */
const BUILDINGS: readonly { id: string; of: string; bearing: number; radius: number }[] = [
	// The Rathaus. The biggest thing on the island after the mountain.
	{ id: 'rathaus', of: 'square', bearing: Math.PI / 4, radius: 3.5 },
	// A boathouse beside the rink, outward so the jetty stays walkable.
	{ id: 'bootshaus', of: 'arena', bearing: Math.PI / 2, radius: 2.2 },
	// The gondola's lower station, on the hillside below the peak.
	{ id: 'gondel', of: 'mountain', bearing: Math.PI, radius: 2.0 },
	// The rock the cave is a hole in. Solid; the hole is a hole in the DRAWING.
	{ id: 'hoehle', of: 'cave', bearing: 0, radius: 3.0 },
	// The shop itself, behind its own doorway.
	{ id: 'laden', of: 'shop', bearing: -1.107, radius: 2.4 },
	// The igloo, NORTH of its doorstep — `bearing: Math.PI` — so its door faces +z, which is the side
	// the camera stands on. Trap 17 is the cave mouth and the shop counter both having to be turned to
	// face the way they are approached; this is the first thing on the island built that way from the
	// start. The footprint is the FINISHED one: see `ISLAND_IGLOO_RADIUS`.
	{ id: 'iglu', of: 'igloo', bearing: Math.PI, radius: ISLAND_IGLOO_RADIUS }
];

/**
 * Every solid thing on the island, DERIVED from the zones rather than typed out beside them.
 *
 * Derived so a zone that moves takes its building with it — which is the same reason
 * `render/island.ts` reads `ISLAND_ZONES` by id instead of holding its own copy of the layout. A hand
 * placed pair of coordinates here would be a second copy of the map, and the two would part company
 * the first time a zone shifted by a metre.
 */
export const ISLAND_OBSTACLES: readonly Obstacle[] = BUILDINGS.map((plan) => {
	const zone = ISLAND_ZONES.find((z) => z.id === plan.of);
	if (!zone) throw new Error(`the island has a building for a zone it does not have: ${plan.of}`);
	const away = zone.radius + plan.radius + BUILDING_GAP;
	return {
		id: plan.id,
		of: plan.of,
		at: {
			x: zone.at.x + Math.sin(plan.bearing) * away,
			z: zone.at.z + Math.cos(plan.bearing) * away
		},
		radius: plan.radius
	};
});

/**
 * The hills, in normalised island coordinates — `at` and `radius` as fractions of the radius, height
 * in metres, exactly as `types.Mound` requires and `archipelago.moundsFor` produces.
 *
 * Hand-placed rather than seeded, because a hub is a place a child learns by heart and a seeded one
 * is a different place every time they open the app.
 *
 * The two small rises exist so the island is not a billiard table with five circles painted on it.
 * They are away from every zone and they do not overlap each other or the mountain — overlapping
 * mounds SUM their heights (`archipelago.groundHeight`), so two ramps crossing make a wall neither
 * of them is. `island.test.ts` asserts both.
 */
export const ISLAND_MOUNDS: readonly Mound[] = [
	{
		at: { x: 0, z: -ISLAND_ZONE_RING / ISLAND_RADIUS },
		radius: MOUNTAIN_RADIUS / ISLAND_RADIUS,
		height: MOUNTAIN_HEIGHT
	},
	{
		at: { x: 17 / ISLAND_RADIUS, z: -6 / ISLAND_RADIUS },
		radius: 7.5 / ISLAND_RADIUS,
		height: 2.2
	},
	{
		at: { x: -24 / ISLAND_RADIUS, z: -14 / ISLAND_RADIUS },
		radius: 9 / ISLAND_RADIUS,
		height: 2.6
	}
];

/**
 * The island, as the one floe a roaming world is made of.
 *
 * `anchored` and a zero `tilt`: land, not a raft. See the note at the top of this file.
 */
export function islandFloes(): Floe[] {
	return [
		{
			id: 0,
			center: ZERO,
			radius: ISLAND_RADIUS,
			fullRadius: ISLAND_RADIUS,
			// Anchored with no fall line. `slide.isChute` is false here, so none of the mountain's
			// physics — the sliding drag, the lean instead of a push, the banked cross-section —
			// applies: this is ordinary ice that happens not to bob.
			tilt: ZERO,
			slope: ZERO,
			weightSlope: ZERO,
			anchored: true,
			// Nothing sinks, nothing breaks, nothing shrinks. A hub with a clock is not a hub.
			sinkAtTick: Infinity,
			piece: false,
			sinkTicks: ROYAL_SINK_TICKS,
			breakAngle: 0,
			drift: ZERO,
			mounds: ISLAND_MOUNDS,
			// Not one of the six seeded island variants: the renderer needs its own drawing for this
			// one (grass, sand, a red roof, a gondola cable — story 09's colour, and story 10f's job).
			shape: 0,
			openSide: 0,
			altitude: 0,
			along: 0
		}
	];
}

/**
 * Dealt round the zones, one at a time, starting with the square.
 *
 * Index 0 is the square, which is where the local penguin is in every game this has (`Game.svelte`
 * builds its roster as `[me, ...bots]`), so a child opens the app standing on the town square — and
 * the eight wanderers open it standing at the other four places rather than in a huddle around the
 * player. That is the difference between the first frame of a TOWN and the first frame of a lobby: the
 * island is inhabited before anybody has moved, which is the one thing a screenshot can show and a
 * roaming rule cannot.
 *
 * The same rule as every other spawn in this game — nobody arrives within shoving distance of
 * anybody — even though nobody may shove here: two penguins spawned inside each other are pushed
 * apart at eight metres a second (`combat.resolveCollisions` separates bodies whether or not the mode
 * allows an attack), which reads as the game throwing you across the square before you have touched
 * the screen. Hence its own bearing per penguin, and well inside the zone's radius.
 */
export const spawnOnTheIsland: Arrangement = (ids) => {
	return ids.map((id, i) => {
		const zone = ISLAND_ZONES[i % ISLAND_ZONES.length] ?? theSquare();
		// Its own bearing, from its own index, spread by the GOLDEN angle so that consecutive arrivals
		// at the same zone — index 0 and index 5 — are on opposite sides of it rather than adjacent.
		const angle = i * 2.399963;
		const out = zone.radius * 0.55;
		const pos = { x: zone.at.x + Math.sin(angle) * out, z: zone.at.z + Math.cos(angle) * out };
		// Facing the middle of its own place, so nobody opens the game looking out to sea.
		return spawnPenguin(id, pos, zone.at);
	});
};

/**
 * Which place this position is in, or null for the open island.
 *
 * EXCLUSIVE: the zones do not overlap, so this cannot be two answers. That is a property of the
 * layout rather than of this function, and `island.test.ts` checks every pair of zones for it —
 * a "nearest match wins" tie-break here would hide a layout that had gone wrong.
 */
export function zoneAt(pos: Vec2): IslandZone | null {
	for (const zone of ISLAND_ZONES) {
		if (distance(zone.at, pos) <= zone.radius) return zone;
	}
	return null;
}

/**
 * The zone this penguin is standing in, or null.
 *
 * The one thing the UI has to ask, so it is here rather than assembled at three call sites. A
 * penguin that is not on its feet is nowhere: falling into a door would be a door that opens because
 * you were pushed.
 */
export function zoneUnder(p: Penguin): IslandZone | null {
	return p.phase === 'skating' && p.height <= 0 ? zoneAt(p.pos) : null;
}

/**
 * **You cannot walk into the sea on the island.**
 *
 * In every other mode the rim is fatal and that IS the game: the whole design is a shrinking arena
 * you can be pushed off. A hub is the opposite — a child hunting for the shop who drowns while
 * looking for it is a child who stops exploring — so the shore holds you instead of taking you.
 *
 * It does not weaken the rim rule anywhere else, and that is structural rather than a promise. The
 * rule is not "drowning is off"; it is that each mode owns what happens to a penguin who has run out
 * of ice (`GameMode.overboard` in `sim/modes/`). Four of the five modes answer with the water — two
 * of them by drowning you and two by costing you the time to climb back on — and this one answers
 * with the beach. `step.ts` has one rim check and asks the mode; there is no flag anywhere that
 * could be left set.
 *
 * Held HERE — in the mode's own slice of the tick, before anybody moves — rather than only at the
 * rim, because a clamp that fires at the water's edge is a clamp that yanks a running penguin
 * backwards by a metre. Corrected before each step, the error is one tick of its own speed: six
 * centimetres at a walk, and nothing a player can see. The outward half of the velocity is removed
 * and the sideways half is kept, so walking into the shore slides you ALONG it instead of stopping
 * dead — which is what a beach does.
 */
export function holdOnTheIsland(world: World): void {
	// Buildings FIRST, then the shore, and the order is deliberate: the shore has to have the last
	// word. A building near the water pushing somebody outward must never be able to push them past
	// the one line in this mode that is not allowed to be crossed.
	keepOutOfTheBuildings(world);
	holdAtTheShore(world);
	// Called from `GameMode.settle`, so both of these run on the positions this tick actually produced
	// rather than on last tick's. Before the move, a dash got seventeen centimetres inside a wall.
}

/**
 * You cannot walk through a building.
 *
 * Pushed out to the wall and STRIPPED of the velocity that was going into it, which is what makes a
 * diagonal walk slide along a wall instead of sticking to it — the same arithmetic as the shore, and
 * the same reason. A child who walks into the town hall at an angle should keep going round it; a dead
 * stop reads as the game having frozen.
 *
 * Height is deliberately not consulted: a building has a ROOF. Being able to hop over the shop would
 * be a funnier bug than running through it and a worse one, because it is the kind a child repeats on
 * purpose until it breaks something.
 */
export function keepOutOfTheBuildings(world: World): void {
	for (const p of world.penguins) {
		if (p.phase !== 'skating') continue;
		for (const building of ISLAND_OBSTACLES) {
			const out = sub(p.pos, building.at);
			const from = length(out);
			const clear = building.radius + ISLAND_BUILDING_MARGIN;
			if (from >= clear) continue;
			// Dead centre of a building — which nothing in the game can produce, but a spawn or a future
			// obstacle added under somebody's feet could. Outward from the island's middle is a direction
			// that exists for every building on it.
			const push = from > 1e-6 ? scale(out, 1 / from) : normalize(building.at);
			p.pos = add(building.at, scale(push, clear));
			const into = p.vel.x * push.x + p.vel.z * push.z;
			if (into < 0) p.vel = sub(p.vel, scale(push, into));
		}
	}
}

/** The shore itself. See `holdOnTheIsland`, which is what calls this and what argues for it. */
function holdAtTheShore(world: World): void {
	const island = world.floes[0];
	if (!island) return;
	const keep = island.radius - ISLAND_SHORE_MARGIN;

	for (const p of world.penguins) {
		if (p.phase !== 'skating') continue;
		const out = sub(p.pos, island.center);
		const from = length(out);
		if (from <= keep || from === 0) continue;

		const outward = scale(out, 1 / from);
		p.pos = add(island.center, scale(outward, keep));
		const leaving = p.vel.x * outward.x + p.vel.z * outward.z;
		if (leaving > 0) p.vel = sub(p.vel, scale(outward, leaving));
	}
}

/**
 * The backstop, for a penguin the clamp above somehow did not catch.
 *
 * The mode's `overboard` hook: whatever put it over water — a shove, a landing, a tick it spent
 * airborne — it comes back to the beach rather than into the sea. Deliberately the same arithmetic,
 * so there is one definition of where the shore is.
 */
export function washAshore(world: World, p: Penguin): void {
	const island = world.floes[0];
	if (!island) return;
	const out = sub(p.pos, island.center);
	const from = length(out) || 1;
	p.pos = add(island.center, scale(out, (island.radius - ISLAND_SHORE_MARGIN) / from));
	p.vel = ZERO;
}

/** How long a walk between two points takes, in seconds, at `WALK_SPEED`. The scale the map is drawn to. */
export function walkSeconds(from: Vec2, to: Vec2): number {
	return distance(from, to) / WALK_SPEED;
}
