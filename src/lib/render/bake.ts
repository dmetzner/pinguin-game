/**
 * Baking a set of coloured shapes into one mesh.
 *
 * Object COUNT is what a frame costs in this renderer — three updates a matrix and runs a frustum
 * test per object, per frame, and a Royal has thirty penguins on ten islands. The simulation, by
 * contrast, is 3% of a frame with all thirty of them on it (measured, 2026-08-17). So anything that
 * never moves relative to its parent is merged here instead of being its own mesh.
 *
 * Written once and used five times: the dressing on a floe, the floe's own slab, the rigid half of a
 * penguin, a chase's blocks and an iceberg on the horizon. It began as two copies that were the same
 * twenty-five lines with different variable names.
 */
import { BufferAttribute, type BufferGeometry, Color, type Material, Mesh } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** One shape on its way into a merged mesh. The geometry is consumed — clone before passing it in. */
export interface Piece {
	geometry: BufferGeometry;
	/**
	 * What to paint it with.
	 *
	 * A number is the whole piece. A FUNCTION is asked once per vertex, with that vertex's own
	 * position in the geometry's own space, for anything that is not one colour: a floe's slab has to
	 * go from snow at the top through blue ice to a wet dark waterline, and cutting it into five
	 * pieces to say that would be five times the draw calls of saying it per vertex.
	 */
	colour: number | ((x: number, y: number, z: number) => number);
	/**
	 * Where the ground this piece stands on is, in the geometry's own space — the y that `contact`
	 * measures its seam from.
	 *
	 * Optional because the opposite of grounded is not "on the ground at y = 0", it is "has no
	 * ground": a meltwater pool LIES on the ice, so every one of its vertices is at the contact and a
	 * seam would darken the whole pool evenly, which is not a shadow, it is a repaint.
	 */
	groundY?: number;
}

/**
 * The seam where a thing meets the ground it stands on.
 *
 * This is the cheapest grounding there is, and the only kind that certainly survives on the oldest
 * phone in the audience: no shadow map, no second pass, nothing per frame at all — the lowest
 * vertices of a rock are simply painted darker once, at bake time. A dark seam where a rock meets
 * the snow is most of what "grounded" reads as; without it every prop on the floe floats, which is
 * exactly what the first screenshots of this game showed.
 *
 * Asked for rather than applied silently, because a caller has to have said where its ground IS.
 */
export interface Contact {
	/**
	 * How far up from the ground the darkening reaches, in metres.
	 *
	 * 10–20 cm on a floe: it wants to read as contact shadow, and a metre of gradient up the side of
	 * a snow drift reads as the drift being a different colour from the ice.
	 */
	reach: number;
	/**
	 * What a vertex sitting ON the ground goes toward.
	 *
	 * The ground's own colour taken DOWN, never black: black under white snow reads as a hole in the
	 * ice rather than as a shadow on it, and the audience is eight.
	 */
	colour: number;
	/** How far toward `colour` a vertex right at the ground gets, 0–1. */
	strength: number;
}

/**
 * Two colours, reused by every ramp built on `alongStops`.
 *
 * A ramp is asked once per VERTEX at mount — a few thousand times per island, six islands, seven
 * icebergs — and a `new Color` per vertex hands the collector a few thousand objects at the one
 * moment in this app's life when a hitch is most visible: the frame the game opens on.
 */
const FROM = new Color();
const TO = new Color();

/**
 * Where a table of (position, colour) stops lands at `at`, linearly between the two either side.
 *
 * Lives here rather than in one of the callers because it is what a `Piece`'s colour FUNCTION is
 * almost always made of: a slab whose wall goes snow → ice → wet dark at the waterline, a berg that
 * pales with height, a collar of foam that fades outward into the sea. The stops carry their own
 * units — metres of depth, fractions of a height, multiples of a radius — so the table reads as the
 * thing it describes.
 */
export function alongStops(stops: readonly (readonly [number, number])[], at: number): number {
	const first = stops[0];
	const last = stops[stops.length - 1];
	if (!first || !last) return 0xffffff;
	if (at <= first[0]) return first[1];
	if (at >= last[0]) return last[1];
	for (let i = 1; i < stops.length; i++) {
		const lower = stops[i - 1];
		const upper = stops[i];
		if (!lower || !upper || at > upper[0]) continue;
		const span = upper[0] - lower[0];
		const t = span > 0 ? (at - lower[0]) / span : 0;
		return FROM.setHex(lower[1]).lerp(TO.setHex(upper[1]), t).getHex();
	}
	return last[1];
}

/**
 * Merge every piece into one geometry, painting each with its own colour, and dispose the parts.
 *
 * Returns the geometry rather than a mesh because a caller sometimes needs to keep hold of the
 * mesh's transform — a floe's slab is SCALED every frame as the ice shrinks, which is the one thing
 * `bake` below gives up.
 *
 * Whatever material ends up on it must have `vertexColors: true`: a merged geometry carries ONE
 * material, and the pieces are never one colour — white drifts, blue meltwater, grey rock, and a
 * penguin's body, belly, beak and eyes all end up in the same mesh.
 *
 * Two attribute traps, both of which fail loudly in the console and silently on screen:
 *
 *  * `uv` — some primitives have it and some do not, and nothing here is textured.
 *  * the INDEX — an icosahedron is non-indexed where a cylinder is indexed, so the rocks were the
 *    exact pieces that vanished the first time this ran.
 *
 * And one that fails quietly: `toNonIndexed` is why NORMALS have to be right before a piece gets
 * here. `computeVertexNormals` on a non-indexed geometry gives every triangle its own face normal —
 * flat shading, whatever the material says — so a piece that wants to look round has to have been
 * smoothed while it still had an index.
 */
export function mergePieces(pieces: Piece[], contact?: Contact): BufferGeometry | null {
	if (pieces.length === 0) return null;

	const colour = new Color();
	const shade = contact ? new Color(contact.colour) : null;

	for (const piece of pieces) {
		const position = piece.geometry.attributes.position;
		const count = position?.count ?? 0;
		const colours = new Float32Array(count * 3);
		const paint = piece.colour;
		const ground = piece.groundY;
		const seam = shade && contact && ground !== undefined;

		for (let i = 0; i < count; i++) {
			if (typeof paint === 'number') colour.setHex(paint);
			else if (position) colour.setHex(paint(position.getX(i), position.getY(i), position.getZ(i)));

			if (seam && position) {
				// One minus "how far up", clamped: a vertex buried BELOW the ground gets the full seam
				// rather than an extrapolated one, which is what a half-buried snow drift is made of.
				const up = (position.getY(i) - ground) / contact.reach;
				const near = 1 - Math.min(1, Math.max(0, up));
				if (near > 0) colour.lerp(shade, near * contact.strength);
			}

			colours[i * 3] = colour.r;
			colours[i * 3 + 1] = colour.g;
			colours[i * 3 + 2] = colour.b;
		}

		piece.geometry.setAttribute('color', new BufferAttribute(colours, 3));
		piece.geometry.deleteAttribute('uv');
	}

	// Only the ones that HAVE an index. `toNonIndexed` on a geometry that is already non-indexed
	// returns a copy and warns, and an icosahedron is non-indexed — so an island with three rocks on
	// it printed three lines of console noise at mount, six islands' worth of it every page load.
	// The console is a debugging instrument in this project (trap 5 was found in a build, not a
	// screen), and noise in it at startup is noise on top of whatever is actually wrong.
	const merged = mergeGeometries(
		pieces.map((piece) => (piece.geometry.index ? piece.geometry.toNonIndexed() : piece.geometry)),
		false
	);
	for (const piece of pieces) piece.geometry.dispose();
	return merged;
}

/**
 * `mergePieces`, plus the mesh — for the common case where nothing about the result ever moves.
 */
export function bake(pieces: Piece[], material: Material, contact?: Contact): Mesh | null {
	const merged = mergePieces(pieces, contact);
	if (!merged) return null;

	const mesh = new Mesh(merged, material);
	// Nothing baked into a mesh ever moves relative to it, so three never needs to recompute its
	// local matrix again.
	mesh.matrixAutoUpdate = false;
	mesh.updateMatrix();
	return mesh;
}
