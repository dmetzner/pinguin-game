/**
 * The second thing under `render/` worth a unit test, and it guards the same class of fact as the
 * first.
 *
 * `CLAUDE.md` is explicit that the renderer is deliberately not unit-tested: nothing here is
 * meaningfully testable without a GPU, and the honest check is `npm run shots` plus a person looking
 * at the picture. This file is not an argument with that. What it guards is where one number is
 * relative to another — and on the island there are two of those, both of which the screen is
 * famously bad at reporting:
 *
 *  * **Trap 8**, the drawn ground disagreeing with the walkable ground. On a floe that was a rim
 *    that never shrank; here it would be a hillside a penguin walks through or hovers over, and the
 *    only defence is that `render/island.ts` plots `archipelago.groundHeight` rather than
 *    re-deriving it. A test can check that it actually did.
 *  * **Trap 11**, decoration buried inside the ground it stands on. The island's mountain is six
 *    metres high, so a prop placed at y = 0 by mistake is not slightly wrong — it is six metres
 *    underground, invisible, and indistinguishable from one that was never written.
 *  * **The starburst**, which is the same family with the origin being an ANGLE rather than a
 *    position. A colour function that asks for `atan2` on a ring whose inner radius is a millimetre
 *    is asking one point on the ground for one colour per segment, and it draws as a fan of spikes
 *    out of the player's feet. It shipped, it was the first thing the eye went to, and nothing in
 *    the source read as wrong.
 *
 * A person cannot tell a buried prop from a missing one, or a jetty that ends one metre past the
 * last place they can stand from one that ends on the sand. A bounding box can.
 *
 * All three were verified non-vacuous the way `purity.test.ts` insists on: fed the violations they
 * exist to catch. Scaling the plotted ground by 0.98 fails the first; placing a tree's crowns
 * against y = 0 instead of against the hill under it fails the third; and putting the original
 * angle-coloured millimetre-wide ring back on the square takes the middle of the plaza from exactly
 * one colour to four.
 */
import { Mesh } from 'three';
import { describe, expect, it } from 'vitest';
import { groundHeight } from '../sim/archipelago';
import { ISLAND_OBSTACLES, ISLAND_SHORE_MARGIN, ISLAND_ZONES, islandFloes } from '../sim/island';
import type { Floe } from '../sim/types';
import { CAMERA_PITCH_DEGREES } from './camera';
import { createIsland } from './island';

/** The island the simulation builds. Everything below is measured against this and nothing else. */
const ISLAND = theIsland();

function theIsland(): Floe {
	const floe = islandFloes()[0];
	// A function rather than a module-level guard, because narrowing at module scope does not reach
	// inside the test bodies that use it — the same reason `sim/island.theSquare` is a function.
	if (!floe) throw new Error('the simulation built an island with no floe in it');
	return floe;
}

/** Where `holdOnTheIsland` stops a penguin. Inside this the drawn ground has to be the real ground. */
const HOLD = ISLAND.radius - ISLAND_SHORE_MARGIN;

/**
 * How far under its own ground a piece is allowed to reach, in metres.
 *
 * Not zero, and the two things that set it are named here rather than left as a round number,
 * because a bound nobody can trace is a bound the next person tunes:
 *
 *  * **The Robbenhöhle's rock, 1.35 m.** A 4.6 m boulder with 28% of itself in the hillside. Sitting
 *    it on the surface would make it a ball resting on grass — rock EMERGES from ground, and the
 *    burial is the only thing saying so.
 *  * **Der Berg's station deck, 1.27 m.** A 4.6 m platform on a 0.25 gradient: its own footprint
 *    varies by more than a metre, and it is seated on the LOWEST ground under it. The alternative is
 *    seating it on the highest, which floats the downhill corner — that is trap 11 with the sign
 *    flipped and it is the worse failure, because a gap under a building is visible and a buried
 *    corner is not.
 *
 * So 1.6 is 1.35 plus a small margin, and the headroom is thin on purpose: what this catches is not
 * "a bit deep", it is a piece that missed its ground ENTIRELY. Anything sunk further than the
 * island's own biggest boulder is not seated, it is lost.
 */
const EMBED_LIMIT = 1.6;

/**
 * How far behind the player the hub camera stands, in metres — `ISLAND.view` in `sim/modes/island.ts`,
 * read by `setFollow`.
 *
 * The lens is the number this file cannot read: `BASE_FOV` is a local inside `createScene`, so the
 * 58° in `keepsTheBergInFrame` below is the one copied constant in either of my files. If the rig's
 * field of view moves, that comment moves with it — or better, ask for `BASE_FOV` to be exported and
 * delete the copy.
 */
const FOLLOW = 14;

/** How far the beach falls from the last dry step to the water. Kept in step with `render/island.ts`. */
const SHORE_DROP = 1.35;

/**
 * The island, built ONCE for the whole file.
 *
 * It was built per test, and one of those tests built it per zone — six islands and 800 k vertices
 * of book-keeping, which is how this file first went red: not on an assertion but on the five-second
 * timeout. Nothing here mutates the meshes, so one island answers every question below.
 */
const MESHES = meshesOf();

function meshesOf(): Mesh[] {
	const island = createIsland(ISLAND);
	// Ticked once, so the gondola cabin is on its cable rather than parked at the group's origin —
	// which is the middle of the Rathausplatz, and would otherwise make every question asked about
	// the square's centre answer about a cabin instead.
	island.update(0);
	const found: Mesh[] = [];
	island.root.traverse((object) => {
		if (object instanceof Mesh) found.push(object);
	});
	return found;
}

/**
 * Where a vertex actually is.
 *
 * Every mesh on the island is baked in world space and sits at the origin — except two: the foam
 * collar, which is dropped to the waterline, and the cabin, which is moved along its cable every
 * frame. Reading raw geometry would place both of them somewhere they are not, and the cabin's
 * somewhere-it-is-not is the exact spot three of these tests ask questions about.
 */
function vertexOf(mesh: Mesh, i: number): { x: number; y: number; z: number } {
	const pos = mesh.geometry.attributes.position;
	if (!pos) return { x: 0, y: 0, z: 0 };
	return {
		x: pos.getX(i) + mesh.position.x,
		y: pos.getY(i) + mesh.position.y,
		z: pos.getZ(i) + mesh.position.z
	};
}

describe('the island', () => {
	it('draws the ground the simulation says is there', () => {
		// The terrain is the first mesh added, and it carries the beach and the skirt with it — so
		// only the walkable top surface is compared. Everything below zero outside the hold is the
		// shore falling into the water, which `groundHeight` knows nothing about by design.
		const terrain = MESHES[0];
		const pos = terrain?.geometry.attributes.position;
		expect(pos).toBeDefined();
		if (!pos) return;

		let worst = 0;
		for (let i = 0; i < pos.count; i++) {
			const x = pos.getX(i);
			const y = pos.getY(i);
			const z = pos.getZ(i);
			if (y < -0.001 || Math.hypot(x, z) > HOLD) continue;
			worst = Math.max(worst, Math.abs(y - groundHeight(ISLAND, { x, z })));
		}
		// Float32 rounding on a 58 m disc, and nothing else. A hillside re-derived instead of plotted
		// would be out by centimetres at best and by metres where the two disagreed about a radius.
		expect(worst).toBeLessThan(1e-5);
	});

	it('never draws ground a penguin cannot stand on', () => {
		// The coast wobbles, and the wobble may only ever push it OUT. Ground drawn INSIDE the
		// simulation's circle is a child walking into an invisible wall a metre short of the sand
		// they are looking at, and ground drawn flat outside it is sand they can see and never reach
		// — trap 8 with the sign flipped, twice.
		const terrain = MESHES[0];
		const pos = terrain?.geometry.attributes.position;
		if (!pos) throw new Error('the island was built with no terrain in it');

		let furthest = 0;
		let risen = 0;
		for (let i = 0; i < pos.count; i++) {
			const x = pos.getX(i);
			const y = pos.getY(i);
			const z = pos.getZ(i);
			const r = Math.hypot(x, z);
			// The skirt and the floor hang below the beach; only the top surface is coastline.
			if (y < -SHORE_DROP + 1e-3) continue;
			furthest = Math.max(furthest, r);
			// Past the hold the ground only ever falls away. It may not rise back to the plane, which
			// is what a bulge applied to the HEIGHT rather than to the radius would do.
			if (r > HOLD) risen = Math.max(risen, y - groundHeight(ISLAND, { x, z }));
		}
		expect(risen).toBeLessThanOrEqual(1e-3);
		// And the coast reaches the simulation's own circle everywhere, or there is a bay of open
		// water where the last metre of walkable island should be.
		expect(furthest).toBeGreaterThanOrEqual(ISLAND.radius);
	});

	it('stands everything it builds on the ground rather than inside it', () => {
		// Trap 11, on the one piece of terrain in this game that is not flat. A prop placed against
		// the wrong y is not slightly sunk here — the mountain is six metres tall, so it is either
		// floating over the hill or buried under it, and both look like nothing at all.
		// The terrain itself is skipped: it carries the skirt and the floor, which hang three and a
		// half metres under the beach on purpose and are the only thing on the island allowed to.
		// It is checked by the two tests above instead.
		// One assertion at the end rather than one per vertex. There are 130 000 of them and `expect`
		// is not free — a per-vertex assertion is what put this file over the timeout, and a guard that
		// dies of its own weight protects nothing. The vertices checked and the bound are unchanged;
		// only the number of assertions is.
		let deepest = 0;
		let sunk = '';
		for (const mesh of MESHES.slice(1)) {
			const pos = mesh.geometry.attributes.position;
			if (!pos) continue;
			for (let i = 0; i < pos.count; i++) {
				const { x, y, z } = vertexOf(mesh, i);
				if (Math.hypot(x, z) > HOLD) continue;
				const under = groundHeight(ISLAND, { x, z }) - y;
				if (under > deepest) {
					deepest = under;
					sunk = `(${x.toFixed(1)}, ${y.toFixed(2)}, ${z.toFixed(1)})`;
				}
			}
		}
		expect(deepest, `${deepest.toFixed(2)} m of it underground at ${sunk}`).toBeLessThan(
			EMBED_LIMIT
		);
	});

	it('builds nothing a player cannot walk up to', () => {
		// The Eisarena's pier taught this one, and no guard caught it — it was found with a throwaway
		// probe while proving the test above was not the thing that was red.
		//
		// The pier's plank count was TYPED (twelve, and the mooring posts 18.4 m out) where every other
		// number on this island is read from the simulation. Twelve planks put the last one's far
		// corner at 58.1 m and both posts at 57.9 on a shore that holds the player at 56.8, so the end
		// of the jetty stood in the sea — and `standOn`, which honestly reports the ground including
		// the beach falling away, took it down the sand. Its own comment says a pier whose end nobody
		// can reach is an invisible wall with planks on it. It was one.
		//
		// The terrain and the foam are exempt BY DEFINITION: the beach, the skirt and the collar are
		// the shore, and drawing them short would leave the island floating on a ring of open water.
		// Everything a person could walk up to is inside the circle a person can reach.
		let furthest = 0;
		let overboard = '';
		for (const mesh of MESHES.slice(2)) {
			const pos = mesh.geometry.attributes.position;
			if (!pos) continue;
			for (let i = 0; i < pos.count; i++) {
				const at = vertexOf(mesh, i);
				const r = Math.hypot(at.x, at.z);
				if (r > furthest) {
					furthest = r;
					overboard = `(${at.x.toFixed(1)}, ${at.z.toFixed(1)})`;
				}
			}
		}
		expect(furthest, `something stands at ${overboard}, past the shore`).toBeLessThanOrEqual(HOLD);
	});

	it('puts a landmark at every zone the simulation has', () => {
		// The five places are read out of `ISLAND_ZONES` rather than typed here, so a zone that moves
		// takes its bunting with it. What this checks is that none of them is BARE: a door with
		// nothing built on it is a door a child walks past.
		// One pass over the meshes asking about every zone, rather than one pass PER zone: five passes
		// over 130 000 vertices is most of a second of nothing.
		const near = new Map(ISLAND_ZONES.map((zone) => [zone.id, 0]));
		for (const mesh of MESHES.slice(1)) {
			const pos = mesh.geometry.attributes.position;
			if (!pos) continue;
			for (let i = 0; i < pos.count; i++) {
				const at = vertexOf(mesh, i);
				for (const zone of ISLAND_ZONES) {
					// Within a zone's own radius plus a little, since a landmark is allowed to stand
					// just outside the circle it marks — the bandstand deliberately does.
					if (Math.hypot(at.x - zone.at.x, at.z - zone.at.z) < zone.radius + 4) {
						near.set(zone.id, (near.get(zone.id) ?? 0) + 1);
					}
				}
			}
		}
		for (const zone of ISLAND_ZONES) {
			expect(near.get(zone.id), `${zone.id} has nothing built on it`).toBeGreaterThan(100);
		}
	});

	it('gives the middle of a place one colour per layer', () => {
		// The starburst, guarded at the one statement that separates it from the art that replaced it.
		// Finding that statement was most of the work, and the two measures that do NOT work are worth
		// recording so nobody spends the afternoon again:
		//
		//  * *Count the vertices piled on the point.* `mergePieces` calls `toNonIndexed`, so a fan's
		//    apex is duplicated once per triangle — 264 copies sit on the middle of this square
		//    legitimately, and a degenerate ring produces the same shape of number.
		//  * *Count the distinct colours meeting at a point.* The star only ever had four, because its
		//    ramp clamped; the spikes were the triangles INTERPOLATING between them. And the compass
		//    rose that replaced it is made of hard colour edges on purpose, so it scores the same.
		//
		// What is true of the bug and false of the rose: **at r → 0 the colour has to be
		// single-valued.** The rose's spokes stop at a hub and never reach the middle; the star's ring
		// of vertices all sat ON the middle, each asked for its own `atan2`, at a radius where the
		// angle does not name anywhere. Layer by layer — the terrain, the paving and the medallion are
		// three discs stacked a few millimetres apart and are each allowed their own colour.
		const layers = new Map<string, Set<string>>();
		for (const mesh of MESHES) {
			const pos = mesh.geometry.attributes.position;
			const col = mesh.geometry.attributes.color;
			if (!pos || !col) continue;
			for (let i = 0; i < pos.count; i++) {
				const at = vertexOf(mesh, i);
				for (const zone of ISLAND_ZONES) {
					if (Math.hypot(at.x - zone.at.x, at.z - zone.at.z) > 0.1) continue;
					const key = `${zone.id} at y=${Math.round(at.y * 1000) / 1000}`;
					const tones = layers.get(key) ?? new Set<string>();
					tones.add(
						`${col.getX(i).toFixed(2)},${col.getY(i).toFixed(2)},${col.getZ(i).toFixed(2)}`
					);
					layers.set(key, tones);
				}
			}
		}
		let worst = 0;
		let where = '';
		for (const [key, tones] of layers) {
			if (tones.size > worst) {
				worst = tones.size;
				where = key;
			}
		}
		// Non-vacuous: there are layers stacked over the middle of a zone to have an opinion about.
		expect(worst).toBeGreaterThanOrEqual(1);
		expect(worst, `${worst} colours on one layer in the middle of ${where}`).toBe(1);
	});

	it('lights a door on the ground it is actually over', () => {
		// The door ring is the one piece of this island that is REBUILT after mount, and rebuilding is
		// where it can go wrong in two ways that both look like a rendering glitch:
		//
		//  * **Off the ring.** The unit circle the ring is re-fitted from was first cached before
		//    `mergePieces`, which calls `toNonIndexed` — 219 shared vertices become 864 unshared ones
		//    in a different order, so three quarters of the table was missing and every vertex past its
		//    end fell back to the zone's own centre. A spray of the ring collapsed onto one point: the
		//    starburst again, in a different file, found by measuring rather than by looking.
		//  * **Off the ground.** Der Berg's door is on a hillside that falls a third of a metre across
		//    the ring. A flat disc there is buried at one edge and airborne at the other, and a glow
		//    that floats reads as an interface element — which is the one thing this must not be.
		//
		// Both are the same assertion: every vertex on the band, and every vertex on the ground.
		const island = createIsland(ISLAND);
		const ring = island.root.children.at(-1);
		expect(ring).toBeInstanceOf(Mesh);
		if (!(ring instanceof Mesh)) return;

		for (const zone of ISLAND_ZONES) {
			island.showDoor(zone.at, zone.radius);
			const pos = ring.geometry.attributes.position;
			if (!pos) throw new Error('the door ring was built with no vertices in it');
			let inner = Infinity;
			let outer = 0;
			let adrift = 0;
			for (let i = 0; i < pos.count; i++) {
				const x = pos.getX(i);
				const y = pos.getY(i);
				const z = pos.getZ(i);
				const r = Math.hypot(x - zone.at.x, z - zone.at.z);
				inner = Math.min(inner, r);
				outer = Math.max(outer, r);
				adrift = Math.max(adrift, Math.abs(y - groundHeight(ISLAND, { x, z })));
			}
			// The OUTER edge is the zone's own radius — the line `zoneAt` opens the door inside. Drawn
			// wider or narrower it would be a visible lie about a rule.
			expect(outer, `${zone.id}'s ring is not the zone's own circle`).toBeCloseTo(zone.radius, 3);
			// And it is a band, not a disc: nothing collapsed toward the middle.
			expect(inner, `${zone.id}'s ring reaches the middle`).toBeGreaterThan(zone.radius * 0.8);
			// Two centimetres off the ground and no more, on the flat AND on the mountain's slope.
			expect(adrift, `${zone.id}'s ring floats`).toBeLessThan(0.03);
		}

		island.showDoor(null, 0);
		expect(ring.visible, 'a cleared door is still lit').toBe(false);
		island.dispose();
	});

	it('draws every solid thing on the footprint the simulation declares', () => {
		// **The failure this exists for was live.** `ISLAND_OBSTACLES` arrived and every building in
		// this file was somewhere else: the Rathaus and the boathouse were not drawn AT ALL, so the
		// square and the pier each had a hole in the air a child could not walk through, and the
		// bandstand stood ten metres away with nothing under it that a child walked straight through.
		// One ghost and one invisible wall, on the two places every player goes first.
		//
		// A building drawn off its footprint is worse than no collision at all, because a player
		// learns to trust what they can see and then stops being able to. So: mass on the circle, and
		// nothing wandering far from it.
		//
		// `iglu` is skipped — `render/igloo.ts` draws the player's home from the same list by the same
		// id, and it is not this file's to check.
		// What is checkable after merging is not "these vertices belong to that building" — once the
		// island is four meshes there is no such thing as a building any more. What IS checkable is
		// that every declared footprint has a BUILDING standing in it: mass inside the circle, and
		// mass high enough off the ground that it cannot be the plaza's paving or a patch of grass
		// that happens to lie there. An empty footprint is the hole in the air.
		//
		// `iglu` is skipped — `render/igloo.ts` draws the player's home from the same list by the same
		// id, and it is not this file's to check.
		for (const building of ISLAND_OBSTACLES) {
			if (building.id === 'iglu') continue;
			let standing = 0;
			for (const mesh of MESHES.slice(1)) {
				const pos = mesh.geometry.attributes.position;
				if (!pos) continue;
				for (let i = 0; i < pos.count; i++) {
					const at = vertexOf(mesh, i);
					if (Math.hypot(at.x - building.at.x, at.z - building.at.z) > building.radius) continue;
					if (at.y < groundHeight(ISLAND, { x: at.x, z: at.z }) + 1) continue;
					standing++;
				}
			}
			// A hundred, derived rather than picked: the SMALLEST building on the island is the
			// boathouse and it contributes 146 vertices above head height inside its own circle, so a
			// building that lost its roof or its walls falls under this bar and one that was never
			// drawn scores nothing at all.
			expect(standing, `nothing stands on ${building.id}'s footprint`).toBeGreaterThan(100);
		}
	});

	it('keeps the Berg inside the top of the frame', () => {
		// **The mountain vanished from the skyline and nothing was broken.** The gondola station moved
		// onto its declared footprint, its mast head landed at 9.00 m, and the top edge of the frame at
		// that distance is 8.50 — so the one vertical thing on the Berg was drawn half a metre above
		// the screen. Everything compiled, every other guard passed, and the most important landmark on
		// the island was simply not in the picture.
		//
		// The ceiling is arithmetic, so it can be a test. The rig pitches down `CAMERA_PITCH_DEGREES`
		// with a 58° lens and stands 14 m back, which puts the eye at 6.36 m and the frame's top edge
		// at `fov/2 - pitch` = 2.0° ABOVE level. Anything higher than `eye + distance·tan(2°)` is off
		// the top of the screen from the square, however tall it looks in the source.
		//
		// Scoped to the Berg deliberately: it is the landmark whose whole job is to be seen from the
		// square, and it is the only thing on the island tall enough to be at risk.
		const eye = Math.sin((CAMERA_PITCH_DEGREES * Math.PI) / 180) * FOLLOW;
		const stand = 5.4 + Math.cos((CAMERA_PITCH_DEGREES * Math.PI) / 180) * FOLLOW;
		const berg = ISLAND_ZONES.find((zone) => zone.id === 'mountain');
		if (!berg) throw new Error('the island has no Berg to frame');

		let worst = 0;
		let over = '';
		for (const mesh of MESHES.slice(1)) {
			const pos = mesh.geometry.attributes.position;
			if (!pos) continue;
			for (let i = 0; i < pos.count; i++) {
				const at = vertexOf(mesh, i);
				// The Berg and everything built on its flank, which is where the station is.
				if (at.z > berg.at.z + 12 || Math.abs(at.x - berg.at.x) > 22) continue;
				const ceiling = eye + Math.hypot(at.x, at.z - stand) * Math.tan((2 * Math.PI) / 180);
				if (at.y - ceiling > worst) {
					worst = at.y - ceiling;
					over = `(${at.x.toFixed(1)}, ${at.y.toFixed(2)}, ${at.z.toFixed(1)})`;
				}
			}
		}
		expect(
			worst,
			`${worst.toFixed(2)} m of the Berg is off the top of the screen, at ${over}`
		).toBeLessThanOrEqual(0);
	});

	it('costs the draw calls it says it costs', () => {
		// Object COUNT is the measured budget in this renderer (209 a frame in a Royal), and an island
		// dense with props is exactly the change that quietly spends it. Eight, and they are named so
		// that a ninth has to be argued for rather than noticed: the terrain, the foam collar, the
		// rounded props, the faceted props, the rink, the unlit holes, the gondola cabin and the door
		// ring. Everything else on this island is a `Piece` merged into one of those.
		expect(MESHES.length).toBeLessThanOrEqual(8);
	});

	it('moves the gondola and nothing else', () => {
		const island = createIsland(ISLAND);
		const before = island.root.children.map((child) => child.position.clone());
		island.update(13.5);
		const moved = island.root.children.filter((child, i) => {
			const was = before[i];
			return was !== undefined && !child.position.equals(was);
		});
		// One object with a matrix that changes, and it is the cabin. Anything else moving means the
		// island stopped being a thing built once at mount.
		expect(moved).toHaveLength(1);
		island.dispose();
	});
});
