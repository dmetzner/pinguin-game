/**
 * The chunks eliminated players watch from.
 *
 * A pool of them — one per slot on the watching ring — made once and hidden when unused, for the
 * same reason snowballs are pooled: allocating geometry mid-round is the one pattern that reliably
 * stutters a mobile GPU, and a chunk appears at exactly the moment somebody has just been knocked
 * into the sea, which is the worst possible moment for a hitch.
 *
 * Each chunk is a GROUP rather than a mesh, and the eliminated penguin is parented into it. That is
 * what makes the spectator ride its own piece of ice: the chunks are outside the tilting floe group
 * — they are separate ice on the same sea — so if the penguin were left where it was it would stand
 * still while the ice under it bobbed. The group's own origin is the chunk's TOP surface, which is
 * why the penguin the caller places at the origin is standing on it rather than over it.
 */
import { CylinderGeometry, Group, Mesh, MeshLambertMaterial, Object3D } from 'three';
import { ROYAL_PLAYERS } from '../sim/constants';
import type { Vec2 } from '../sim/types';
import { alongStops, mergePieces } from './bake';
import { SEA_LEVEL } from './floeField';
import type { Actor } from './penguin';

/**
 * One per penguin in the biggest game there is.
 *
 * It was six — one per player in the largest ROOM — and then twelve, and both were quietly wrong for
 * a Royal, where twenty-nine go in the water. What made it more than a visual flaw is what happens
 * to a spectator this field cannot place: its actor is never parented into a chunk, and the caller
 * positions a chunked spectator at the chunk's own origin, which for an UNparented actor is the
 * middle of the world. Seventeen dead penguins stood in the middle of the final arena, motionless,
 * for the rest of every Royal (Daniel, 2026-08-17).
 *
 * So: enough chunks for everybody, and `update` hides anybody it still cannot place rather than
 * leaving them where the maths happens to put them.
 */
const POOL_SIZE = ROYAL_PLAYERS;

/** Across, in metres. `SPECTATOR_SLOTS` is chosen against this number — see `sim/constants.ts`. */
const CHUNK_RADIUS = 0.95;

/**
 * How deep the slab is, in metres.
 *
 * Chosen so its underside is below `SEA_LEVEL` once `CHUNK_SINK` has been applied, which is what lets
 * it have a waterline at all. At 0.4 m it stopped a clear twenty centimetres short of the water and
 * the whole pool floated: twelve pieces of ice hanging in the air over a sea, in the calm half of the
 * screen where there is nothing else to look at.
 */
const CHUNK_THICKNESS = 0.8;

/**
 * How far the chunk's top sits below the floe's surface.
 *
 * Not decoration: eliminations early in a round happen while the floe is still at its full radius,
 * and `SURFACE_RADIUS` is only 5% outside it. A chunk at the same level as the ice reads as part of
 * it — measured on screen, not reasoned about — and a spectator apparently standing on the floe
 * looks like a bug rather than like somebody watching. Lower, it is unmistakably a separate slab.
 *
 * Applied to the GROUP rather than to the mesh inside it, so the penguin standing at the group's
 * origin comes down with the ice. Applied to the mesh, which is where it used to be, the spectator
 * hovered exactly this far above the thing it was supposed to be standing on.
 */
const CHUNK_SINK = 0.2;

/** Bob amplitude and rate. Slow and small — this is the calm half of the screen. */
const BOB_HEIGHT = 0.09;
const BOB_HZ = 0.21;

/**
 * The chunk from its top surface down, as (depth in metres, colour) stops — the floe's own ramp, on
 * a slab a seventh of the size.
 *
 * One vertex-coloured material rather than the three the floe used to use, and the saving is not
 * theoretical: a mesh costs a draw call PER material, and a Royal puts twenty-nine of these in the
 * water. Three materials was eighty-seven draw calls for the quiet edge of the screen, against a
 * measured budget of a little over two hundred for the whole frame.
 */
const CHUNK_STOPS: [number, number][] = [
	[0, 0xf7fcff],
	[0.12, 0xdcecf8],
	[0.3, 0x8fc4de],
	[-SEA_LEVEL - CHUNK_SINK, 0x2e6c91],
	[CHUNK_THICKNESS, 0x27536f]
];

export interface ChunkField {
	readonly root: Object3D;
	/**
	 * Show exactly these spectators and no others.
	 *
	 * Called every frame with the same map for as long as nobody else falls in, so it must be cheap
	 * and idempotent: the re-parenting is guarded, and positions are assignments rather than churn.
	 */
	update(spots: ReadonlyMap<string, Vec2>, actors: ReadonlyMap<string, Actor>): void;
	/** The bob. Wall-clock, like the ocean, because it is decoration and not simulation. */
	setTime(seconds: number): void;
	dispose(): void;
}

export function createChunkField(): ChunkField {
	// One geometry and one material for all of them. Narrower at the bottom and only seven radial
	// segments: at this size and distance a chunk is a few dozen pixels, and the faceting is what
	// says "broken ice" rather than "disc".
	const slab = new CylinderGeometry(CHUNK_RADIUS, CHUNK_RADIUS * 0.72, CHUNK_THICKNESS, 7, 3);
	const geometry = mergePieces([
		{
			geometry: slab,
			colour: (_x, y) => alongStops(CHUNK_STOPS, CHUNK_THICKNESS / 2 - y)
		}
	]);
	if (!geometry) throw new Error('the chunk pool was built with no ice in it');
	const material = new MeshLambertMaterial({ vertexColors: true, flatShading: true });

	const root = new Object3D();
	const chunks: Group[] = [];
	for (let i = 0; i < POOL_SIZE; i++) {
		const group = new Group();
		const mesh = new Mesh(geometry, material);
		// The group's origin is the chunk's top: see CHUNK_SINK.
		mesh.position.y = -CHUNK_THICKNESS / 2;
		// A different rotation each, from the index rather than from a random draw, so they read as
		// that many different pieces and read the SAME way every round.
		mesh.rotation.y = i * 1.31;
		mesh.matrixAutoUpdate = false;
		mesh.updateMatrix();
		group.add(mesh);
		group.visible = false;
		chunks.push(group);
		root.add(group);
	}

	let phase = 0;

	return {
		root,

		update(spots, actors) {
			let used = 0;
			for (const [id, spot] of spots) {
				const group = chunks[used];
				const actor = actors.get(id);
				if (!group) {
					// Out of chunks. Hidden rather than drawn, because an actor that is not parented
					// into a chunk is drawn at the world origin — see POOL_SIZE. A missing spectator is
					// a disappointment; one standing in the middle of the arena is a bug everybody can
					// see.
					if (actor) actor.root.visible = false;
					continue;
				}
				group.visible = true;
				group.position.set(spot.x, Math.sin(phase + used * 1.7) * BOB_HEIGHT - CHUNK_SINK, spot.z);

				// Guarded: `add` is a splice and a push, and this runs every frame for as long as
				// somebody is out. Only the tick they surface should actually move anything.
				if (actor) {
					actor.root.visible = true;
					if (actor.root.parent !== group) group.add(actor.root);
				}
				used++;
			}
			for (let i = used; i < chunks.length; i++) {
				const group = chunks[i];
				if (group) group.visible = false;
			}
		},

		setTime(seconds) {
			phase = seconds * BOB_HZ * Math.PI * 2;
		},

		dispose() {
			geometry.dispose();
			material.dispose();
		}
	};
}
