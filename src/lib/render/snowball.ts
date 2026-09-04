/**
 * Snowballs on screen.
 *
 * A pool rather than a mesh per snowball. Creating and disposing geometry mid-round is the one
 * allocation pattern that reliably stutters on a mobile GPU, and the ceiling here is small and
 * knowable — see POOL_SIZE for the arithmetic. They are made once and hidden when unused.
 */
import { IcosahedronGeometry, Mesh, MeshLambertMaterial, Object3D } from 'three';
import type { Snowball } from '../sim/types';

/**
 * How many snowballs can be on screen at once.
 *
 * Eight, and the number is arithmetic rather than a guess. A ball is airborne for about 51 ticks
 * (0.85 s) and the throw cooldown is 36, so a single player can have at most two in flight; six
 * players is a ceiling of twelve in a scenario where everyone throws on cooldown forever, and eight
 * covers every realistic moment with room to spare.
 *
 * It was 16, from a comment reasoning "six players × 0.6 s cooldown × 1.5 s lifetime ≈ fifteen" —
 * which used a lifetime the ball could never reach, because at the time it fell out of the air in
 * 0.5 s. The cost is not memory: this root is parented to the tilting floe group, which rotates
 * every frame, so three.js walks and re-multiplies the matrix of every mesh in it whether or not it
 * is visible.
 */
// Sixteen, up from eight: the eliminated throw too now (`sim/combat.ts`), so a late Royal can have a
// dozen weak snowballs in the air at once on top of whatever the survivors are throwing at each
// other. A ball with no mesh left in the pool is a ball nobody can see coming, which is the one
// thing a projectile must never be.
const POOL_SIZE = 16;
/** Drawn slightly under the collision radius, so a hit always looks like contact. */
const DRAWN_RADIUS = 0.26;

export interface SnowballField {
	readonly root: Object3D;
	update(snowballs: readonly Snowball[]): void;
	dispose(): void;
}

export function createSnowballField(): SnowballField {
	// Detail 0 is a 20-face icosahedron: round enough at this size, and flat-shaded it catches the
	// light as it spins, which is what makes a small white ball visible against white ice.
	const geometry = new IcosahedronGeometry(DRAWN_RADIUS, 0);
	const material = new MeshLambertMaterial({ color: 0xffffff, flatShading: true });

	const root = new Object3D();
	const pool: Mesh[] = [];
	/** How many slots were visible last frame, so only those need clearing. */
	let shown = 0;
	for (let i = 0; i < POOL_SIZE; i++) {
		const mesh = new Mesh(geometry, material);
		mesh.visible = false;
		pool.push(mesh);
		root.add(mesh);
	}

	return {
		root,
		update(snowballs) {
			const live = Math.min(snowballs.length, POOL_SIZE);
			for (let i = 0; i < live; i++) {
				const mesh = pool[i];
				const ball = snowballs[i];
				if (!mesh || !ball) continue;
				mesh.visible = true;
				mesh.position.set(ball.pos.x, ball.height, ball.pos.z);
				// Tumble, driven by the ball's own age rather than a clock, so two devices watching
				// the same round see the same spin. Cosmetic, but free to get right.
				mesh.rotation.set(ball.ticks * 0.22, ball.ticks * 0.17, 0);
			}
			// Only the slots that were live last frame need clearing; the rest are already hidden.
			// Typically nothing is in flight at all, and this loop then does nothing.
			for (let i = live; i < shown; i++) {
				const mesh = pool[i];
				if (mesh) mesh.visible = false;
			}
			shown = live;
			// More snowballs in flight than the pool holds would mean the ceiling above was wrong.
			// They are simply not drawn — a missing snowball is a bad outcome, but a far better one
			// than a frame spent allocating geometry.
		},
		dispose() {
			geometry.dispose();
			material.dispose();
		}
	};
}
