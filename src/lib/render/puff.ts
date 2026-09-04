/**
 * The dust a landing kicks up.
 *
 * The jump is the verb in two of the four modes and until now a landing was a number going to zero:
 * the body stopped rising and nothing else happened, which is why the jump read as a lift rather
 * than as a weight coming down. A puff is the cheapest thing that says "that hit the ice", and it
 * says it at the moment the player is looking at their own feet.
 *
 * Built like `snowball.ts`: nothing is created while a round is running. The crumbs are ONE merged
 * geometry, made once for the whole page and shared by every penguin, and one puff is one mesh — so
 * a landing costs a scale, an opacity and a visibility flag and never an allocation. What is NOT
 * copied from the snowballs is the pool of sixteen: a puff belongs to the penguin that made it (it
 * has to sit where THAT bird landed), so the pool is one slot per penguin, held by the actor, and a
 * second landing inside a third of a second restarts the one it has. Thirty penguins in a Royal is
 * thirty slots, which is the same arithmetic the chunk field already had to do (trap 13).
 */
import { type BufferGeometry, IcosahedronGeometry, Mesh, MeshLambertMaterial } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * The crumbs, in WORLD metres.
 *
 * Unlike everything in `penguin.ts` these are not modelled in the bird's local space and scaled: the
 * puff hangs off the actor's ROOT, which is unscaled, because it has to stay on the ice at the spot
 * where the landing happened while the penguin slides away from it.
 */
const CRUMB_COUNT = 7;
const CRUMB_RADIUS = 0.13;
/** How far out the crumbs start. They spread from here; a ring that starts wide reads as a splash. */
const RING_RADIUS = 0.26;
/**
 * How long a puff lasts, and how far it spreads.
 *
 * A third of a second, which is short enough that the dust cannot follow a sliding penguin far
 * enough to look attached to it, and long enough to be seen at 60 Hz on a phone. The spread is what
 * makes it read as dust rather than as a growing ball of snow — 2.6× on a 0.26 m ring is a 1.4 m
 * cloud around a 1.7 m penguin.
 */
const PUFF_SECONDS = 0.34;
const PUFF_SPREAD = 2.6;
/** How high the cloud drifts as it spreads. Dust rises; snow kicked off ice barely does. */
const PUFF_RISE = 0.2;
/**
 * How opaque a full-strength puff starts.
 *
 * Well under one, because this is ice dust over white ice: at full opacity the puff is a white disc
 * that hides the feet it exists to draw attention to.
 */
const PUFF_OPACITY = 0.55;
/** Flattened as it spreads, so the cloud hugs the ice instead of ballooning into a sphere. */
const PUFF_FLATTEN = 0.55;

/**
 * The crumbs, merged once for the page.
 *
 * `bake.ts` exists for exactly this and is not used here for one reason: it paints per-piece vertex
 * colours, and every crumb in a puff is the same white. Its two traps — a missing `uv` and a
 * disagreeing index — cannot bite a set built entirely from one primitive, which is the honest
 * reason this merge is safe by construction rather than by care.
 */
const CRUMBS: BufferGeometry = (() => {
	const parts: BufferGeometry[] = [];
	for (let i = 0; i < CRUMB_COUNT; i++) {
		// Deliberately not random: the layout is the same for every penguin and every landing, and a
		// ring of unequal lumps at unequal heights already looks scattered. `Math.random()` here would
		// also be the one call in the renderer that made two devices watching the same round draw
		// different frames.
		const angle = (i / CRUMB_COUNT) * Math.PI * 2;
		const size = 0.7 + (0.3 * ((i * 3) % CRUMB_COUNT)) / CRUMB_COUNT;
		const part = new IcosahedronGeometry(CRUMB_RADIUS * size, 0);
		part.translate(
			Math.sin(angle) * RING_RADIUS,
			CRUMB_RADIUS * (0.4 + 0.5 * size),
			Math.cos(angle) * RING_RADIUS
		);
		parts.push(part);
	}
	const merged = mergeGeometries(parts, false);
	for (const part of parts) part.dispose();
	// A merge of identical primitives cannot fail; the fallback is a worse puff rather than a page
	// that throws on the way to its first frame.
	return merged ?? new IcosahedronGeometry(CRUMB_RADIUS, 0);
})();

export interface Puff {
	/** Positioned by the owner: a puff has to stay where the landing was, not where the penguin is. */
	readonly mesh: Mesh<BufferGeometry, MeshLambertMaterial>;
	/**
	 * Kick one off. `strength` is 0..1 — a step off a bump is not a landing from an apex.
	 *
	 * Restarts a puff that is still playing rather than queueing: two landings that close together
	 * are one impact as far as the eye is concerned.
	 */
	play(seconds: number, strength: number): void;
	/** Advance, and return how far the cloud has drifted UP — which the owner adds to its position. */
	update(seconds: number): number;
	dispose(): void;
}

export function createPuff(): Puff {
	// Flat-shaded, and it is the one place in this file where the ice's style wins over the birds':
	// faceted crumbs read as broken ice, smooth ones as bubbles.
	const material = new MeshLambertMaterial({
		color: 0xf2f9ff,
		transparent: true,
		opacity: PUFF_OPACITY,
		// Crumbs overlap each other constantly and each one is translucent; writing depth would let
		// the nearest lump punch a hole in the cloud behind it.
		depthWrite: false,
		flatShading: true
	});
	const mesh = new Mesh(CRUMBS, material);
	mesh.visible = false;

	/** When the current puff started, in the same seconds the actor is drawn with. -1 is idle. */
	let started = -1;
	let strength = 0;

	return {
		mesh,
		play(seconds, force) {
			started = seconds;
			strength = Math.max(0, Math.min(1, force));
		},
		update(seconds) {
			if (started < 0) return 0;
			const t = (seconds - started) / PUFF_SECONDS;
			if (t < 0 || t >= 1) {
				// t below zero means the clock went backwards, which happens exactly once: a rematch
				// remounts `Game.svelte` and the elapsed seconds start again at nothing.
				started = -1;
				mesh.visible = false;
				return 0;
			}
			mesh.visible = true;
			// Fast out, slow settle. A linear spread reads as an expanding object; dust is thrown.
			const ease = 1 - (1 - t) * (1 - t);
			const spread = (0.55 + 0.45 * strength) * (1 + (PUFF_SPREAD - 1) * ease);
			mesh.scale.set(spread, spread * PUFF_FLATTEN, spread);
			material.opacity = PUFF_OPACITY * strength * (1 - ease);
			return PUFF_RISE * ease * strength;
		},
		dispose() {
			// The geometry is shared with every other puff on the page and is owned by this module.
			material.dispose();
		}
	};
}
