/**
 * The one thing under `render/` that is worth a unit test.
 *
 * `CLAUDE.md` is explicit that the renderer is deliberately not unit-tested: nothing here is
 * meaningfully testable without a GPU, and the honest check is `e2e/` plus a person looking at the
 * screen. This file is not an argument with that. What it guards is a fact about GEOMETRY — where one
 * number is relative to another — and it exists because that particular fact is the one the screen is
 * worst at reporting.
 *
 * **Trap 11.** A `CylinderGeometry`'s origin is its MIDDLE, so the first pass at dressing the floes
 * placed every snow drift, meltwater pool and rock at y ≈ 0 in the slab's local space — half a metre
 * inside the ice. They rendered perfectly, cost their triangles, and were invisible; the floes looked
 * exactly as blank as before the work. It survived review because the code placing them reads as
 * correct, and it survived the screen because a buried drift and a drift that was never written look
 * the same from outside.
 *
 * A person cannot tell those two apart. A bounding box can.
 */
import { Mesh, SphereGeometry, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { ISLAND_VARIANTS, singleFloe } from '../sim/archipelago';
import { FLOE_RADIUS } from '../sim/constants';
import type { Piece } from './bake';
import { createFloeField, islandDressing, SEA_LEVEL } from './floeField';

/**
 * How far a piece has to stand out of the snow to count as visible, in metres.
 *
 * Half a centimetre, and it is deliberately not a comfortable margin: the thinnest thing on the ice
 * is a meltwater pool, which lies 1.2 cm proud of the snow it is in because a pool is a puddle and
 * not an object. Everything else clears by ten centimetres or more. What this is set against is not
 * "how visible" — it is ZERO. A piece whose highest vertex is under the snow cannot be seen at all,
 * whatever else is true about it.
 */
const PROUD = 0.005;

/** Any colour at all — `clearance` and `furthest` read geometry, and a `Piece` needs one. */
const DRIFT_WHITE = 0xfdffff;

/**
 * How far the highest point of `piece` stands above the snow beneath it, in metres.
 *
 * Measured against the SNOW and not against the slab's flat top, because the snow is not flat: it
 * dips below the plane the simulation works on, so a pool lying correctly in a hollow is genuinely
 * below `surface` and is not buried at all. A guard written against `surface` would fire on the
 * correct case and stay quiet on a drift a metre too deep, which is worse than no guard.
 */
function clearance(
	piece: Piece,
	surface: number,
	snowAt: (x: number, z: number) => number
): number {
	piece.geometry.computeBoundingBox();
	const box = piece.geometry.boundingBox;
	if (!box) return Number.NEGATIVE_INFINITY;
	const middle = new Vector3();
	box.getCenter(middle);
	return box.max.y - (surface + snowAt(middle.x, middle.z));
}

describe('trap 11: nothing on a floe is drawn inside it', () => {
	it('every piece of every island stands out of the snow it sits in', () => {
		let scanned = 0;

		for (let variant = 0; variant < ISLAND_VARIANTS; variant++) {
			const { surface, snowAt, pieces, hills } = islandDressing(variant);
			// The scan itself must not be empty. Two of the six variants deliberately have no hills
			// (`moundsFor`), and an island with nothing on it at all would pass every assertion below
			// forever — which is exactly the shape of the bug this guards.
			expect(pieces.length).toBeGreaterThan(2);

			// Hills included here: being visible above the snow is true of them too, and a hill sunk
			// into the ice is the same bug on the largest object on the floe.
			for (const piece of [...pieces, ...hills]) {
				expect(clearance(piece, surface, snowAt)).toBeGreaterThan(PROUD);
				scanned++;
				piece.geometry.dispose();
			}
		}

		expect(scanned).toBeGreaterThan(ISLAND_VARIANTS * 2);
	});

	it('and the guard rejects the mistake that was actually made', () => {
		// The bug itself, hand-built: a snow drift's proportions, placed at y = 0 in the slab's own
		// space — which is the MIDDLE of the ice, not the top of it. Every island, not one, for the same
		// reason `purity.test.ts` feeds each of its regexes the violation it exists to catch.
		//
		// Hand-built rather than a real piece pushed down, because a real piece is not always sinkable:
		// a hill is taller than the ice is thick, so burying one by half the slab still leaves its peak
		// in the air. The trap only ever hid the small dressing, and this is the small dressing.
		for (let variant = 0; variant < ISLAND_VARIANTS; variant++) {
			const { surface, snowAt, pieces, hills } = islandDressing(variant);
			for (const piece of [...pieces, ...hills]) piece.geometry.dispose();

			const drift = new SphereGeometry(1.2, 9, 6);
			drift.scale(1, 0.16, 1);
			drift.translate(3, 0, 1);
			expect(clearance({ geometry: drift, colour: DRIFT_WHITE }, surface, snowAt)).toBeLessThan(
				PROUD
			);

			// And the same drift, placed the way the fix places it, passes — so what the guard is
			// reading is the height and not the shape.
			drift.translate(0, surface + snowAt(3, 1), 0);
			expect(clearance({ geometry: drift, colour: DRIFT_WHITE }, surface, snowAt)).toBeGreaterThan(
				PROUD
			);
			drift.dispose();
		}
	});
});

describe("trap 11's mirror image: nothing on a floe hangs off it", () => {
	/**
	 * How far the furthest vertex of `piece` sticks out past the ice beneath it, in metres.
	 *
	 * Compared per VERTEX against the brim in that vertex's own direction, because the rim is not a
	 * circle: the harmonics move it in and out by up to a sixth, so a single fraction of the radius is
	 * simultaneously too tight on a bulge and far too loose in a dip. The first version of this test
	 * used 0.98 R flat and failed on a drift that was correctly inside the ice.
	 */
	function pastTheEdge(piece: Piece, brimAt: (x: number, z: number) => number): number {
		const position = piece.geometry.getAttribute('position');
		let worst = Number.NEGATIVE_INFINITY;
		for (let i = 0; i < position.count; i++) {
			const x = position.getX(i);
			const z = position.getZ(i);
			worst = Math.max(worst, Math.hypot(x, z) - brimAt(x, z));
		}
		return worst;
	}

	it('keeps every piece inside the rim, not just its middle', () => {
		// The same failure to ask where the EDGES of a thing end up that trap 11 is, pointing outward
		// instead of downward. A snow drift is up to 2.8 m across and was placed by its centre at up to
		// 0.87 R, so the far side of it hung 11% past the ice: a lens of white snow in mid-air over the
		// water, which from a camera at 27° reads as the floe having a ragged edge rather than as a bug.
		//
		// The HILLS are exempt, and that is a statement about ownership rather than a tolerance. Their
		// footprint comes from `sim/archipelago.moundsFor`, which the simulation reads for
		// `groundHeight` — a hill whose cosine bump reaches the rim reaches the rim, and a renderer
		// that trimmed its skirt to look tidier would be drawing a hill you can climb further than you
		// can see. That is trap 8, and it is worse than a centimetre of ice over the water.
		let scanned = 0;
		for (let variant = 0; variant < ISLAND_VARIANTS; variant++) {
			const { brimAt, pieces, hills } = islandDressing(variant);
			expect(pieces.length).toBeGreaterThan(2);
			for (const piece of pieces) {
				expect(pastTheEdge(piece, brimAt)).toBeLessThan(0);
				scanned++;
				piece.geometry.dispose();
			}
			for (const hill of hills) hill.geometry.dispose();
		}
		expect(scanned).toBeGreaterThan(ISLAND_VARIANTS * 2);
	});

	it('and the guard rejects a drift placed by its middle', () => {
		// The mistake itself: a drift's full radius, positioned at the fraction of R the old code used,
		// with no account taken of how wide the thing is.
		const { brimAt, pieces, hills } = islandDressing(0);
		for (const piece of [...pieces, ...hills]) piece.geometry.dispose();
		const drift = new SphereGeometry(2.6, 9, 6);
		drift.translate(FLOE_RADIUS * 0.87, 0, 0);
		expect(pastTheEdge({ geometry: drift, colour: DRIFT_WHITE }, brimAt)).toBeGreaterThan(0);
		drift.dispose();
	});
});

describe('the drawn ice is the ice the simulation is running', () => {
	it('puts its top surface on the plane a penguin stands on, and its underside under the sea', () => {
		const field = createFloeField();
		const floes = singleFloe();
		field.update(floes, 0, 0);

		let checked = 0;
		for (const floe of floes) {
			const group = field.groupOf(floe.id);
			expect(group).not.toBeNull();
			const ice = group?.getObjectByName('ice');
			expect(ice).toBeInstanceOf(Mesh);
			if (!(ice instanceof Mesh)) continue;

			ice.geometry.computeBoundingBox();
			const box = ice.geometry.boundingBox;
			expect(box).not.toBeNull();
			if (!box) continue;

			// The highest ice on the floe is level with the plane, never above it. `SNOW_RELIEF` only
			// ever digs DOWN for this reason: a penguin is drawn at y = 0 on ground the simulation says
			// is flat, so snow standing proud of that would be snow the bird's feet are inside — and
			// the blob shadow and the "you" ring are decals at 2 cm and 4 cm (`render/penguin.ts`) that
			// a raised drift would swallow whole.
			expect(box.max.y + ice.position.y).toBeCloseTo(0, 5);

			// And it reaches past the waterline, or there is nothing for the foam and the wet band to
			// be the edge of — a slab that stops above the sea is the paper cut-out this stopped being.
			expect(box.min.y + ice.position.y).toBeLessThan(SEA_LEVEL);
			checked++;
		}

		expect(checked).toBe(floes.length);
		field.dispose();
	});
});
