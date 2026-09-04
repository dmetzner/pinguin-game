/**
 * The blocks of ice you have to jump, in a chase.
 *
 * They exist in the simulation as `Mound`s on a platform — `archipelago.groundHeight` and
 * `groundSlope` read a floe's own mounds, so `step.ts` turns them into ground that can be stood on,
 * climbed and fallen off without being told what a block is. What it cannot do is draw them:
 * `render/floeField.ts` builds its hills from `moundsFor(variant)` and clones one mesh per island
 * variant, which is what keeps a Royal's thirty floes affordable, and a per-floe shape has no place
 * in that. So the chase's obstacles are drawn here instead, from the same course the simulation is
 * using.
 *
 * One merged mesh for the whole course, built once at mount: they never move.
 */
import { BoxGeometry, Group, MeshLambertMaterial } from 'three';
import type { Floe } from '../sim/types';
import { bake, type Contact, type Piece } from './bake';

/**
 * Blue ice with a white cap, and the blue is not decoration.
 *
 * The first pair was a shade off the platform's own white, on the theory that a block sitting on ice
 * should look like ice. It rendered perfectly and was invisible: a pale block on a pale floe seen
 * from above is a slightly different pale, and a child running at it has no idea it is there. This
 * is the same white-on-white that made the snow drifts vanish when the floes were first dressed —
 * the answer then was to tint the ice blue so things ON it had a shape, and the answer here is to
 * tint the thing.
 */
const BLOCK = 0x7fb3d5;
const BLOCK_TOP = 0xffffff;

/**
 * The seam where a block meets the platform.
 *
 * A block is the one thing in a chase a player has to judge the distance to at a run, and a shape
 * with no shadow under it sits at an ambiguous depth — the eye cannot tell a low block near from a
 * tall block far. Deeper than a floe's drifts get (18 cm against 16) because the ground here is
 * flat white and the block is the only thing casting anything.
 */
const CONTACT: Contact = { reach: 0.18, colour: 0x4d7fa0, strength: 0.75 };

export interface Blocks {
	root: Group;
	dispose(): void;
}

/**
 * @param course the floes the simulation is running, so a block that is drawn is a block that is
 *   there — the trap that had the floe drawn at full size while the arena shrank under it.
 */
export function createBlocks(course: readonly Floe[]): Blocks {
	const root = new Group();
	const pieces: Piece[] = [];

	for (const floe of course) {
		for (const mound of floe.mounds) {
			// `Mound` is stored in NORMALISED floe coordinates — `at` and `radius` are fractions of the
			// floe's radius — because a floe's mesh is scaled as it shrinks and its decoration with it.
			const reach = mound.radius * floe.radius;
			const x = floe.center.x + mound.at.x * floe.radius;
			const z = floe.center.z + mound.at.z * floe.radius;

			// A slab and a cap rather than one box: the pale top is what makes it read as ice with snow
			// on it from above, which is the angle this game is played from. The ground each of them
			// stands on is its own platform's altitude — the route rises and falls, so one number for
			// the whole course would put the seam in mid-air on half of it.
			const body = new BoxGeometry(reach * 1.7, mound.height, reach * 1.7);
			body.translate(x, floe.altitude + mound.height / 2, z);
			pieces.push({ geometry: body, colour: BLOCK, groundY: floe.altitude });

			const cap = new BoxGeometry(reach * 1.85, mound.height * 0.16, reach * 1.85);
			cap.translate(x, floe.altitude + mound.height, z);
			pieces.push({ geometry: cap, colour: BLOCK_TOP, groundY: floe.altitude });
		}
	}

	// Faceted, and here it is the point: a block is a cube of fractured ice, and smooth shading on a
	// box averages the normals across its corners and turns it into a pillow.
	const material = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
	const baked = bake(pieces, material, CONTACT);
	if (baked) root.add(baked);

	return {
		root,
		dispose() {
			material.dispose();
			if (baked) baked.geometry.dispose();
		}
	};
}
