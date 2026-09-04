/**
 * Where an eliminated penguin goes.
 *
 * `docs/DESIGN.md` asks for elimination not to be a fail screen, and the reason is specific to this
 * audience: an eight-year-old knocked out forty seconds into a ninety-second round is either still
 * part of it or has already put the phone down. So a penguin that goes in the water climbs out onto
 * a chunk of ice beside the arena and watches the rest — name tag and all — instead of vanishing.
 *
 * This is derived, never stored. `Penguin` gains no field, which matters twice: a snapshot in phase 3
 * stays the size it is, and there is no third piece of state that can disagree with `phase` and
 * `pos` about where somebody is.
 */

import { seaRadius } from './archipelago';
import { SPECTATOR_SLOTS, SURFACE_RADIUS } from './constants';
import type { Penguin, Vec2, World } from './types';
import { fromHeading, heading, scale } from './vec';

/** Slot numbers wrap, and `heading` returns negative angles, so the modulo has to be the safe one. */
const wrap = (slot: number, slots: number) => ((slot % slots) + slots) % slots;

/** The middle of slot `n`, as a position, on a ring of the given radius. */
export function slotSpot(slot: number, radius = SURFACE_RADIUS, slots = SPECTATOR_SLOTS): Vec2 {
	return scale(fromHeading(wrap(slot, slots) * ((Math.PI * 2) / slots)), radius);
}

/**
 * How far out the watching ring sits.
 *
 * `SURFACE_RADIUS` in the classic round, which is where it has always been — and outside the whole
 * ARCHIPELAGO in a Royal, where the sea is thirty metres across and a ring at eight would put the
 * eliminated standing in the middle of the fight they just lost.
 *
 * Measured against each floe's FULL radius rather than its current one, so the ring does not creep
 * inward as the ice shrinks: a chunk of ice that drifted toward the arena all round would read as
 * the sea moving, and it is the one thing on screen that should be still.
 */
export function watchingRing(world: World): number {
	return Math.max(SURFACE_RADIUS, seaRadius(world, true) * 1.05);
}

/**
 * How many places there are to watch from.
 *
 * Twelve around the classic floe, and proportionally more around a Royal's sea — that ring is four
 * times bigger, so it holds four times as many chunks at the same comfortable spacing.
 *
 * It has to be enough for EVERYBODY. A Royal puts twenty-nine penguins in the water and there were
 * twelve slots: the thirteenth doubled up on somebody else's chunk, and the renderer, which has one
 * chunk per slot, had nowhere to put them at all. Doubling up was a visual flaw when the biggest
 * game was six; at thirty it is most of the field.
 */
export function spectatorSlots(world: World): number {
	const scaled = Math.round((SPECTATOR_SLOTS * watchingRing(world)) / SURFACE_RADIUS);
	return Math.max(SPECTATOR_SLOTS, scaled);
}

/** The slot a penguin would most like: the one nearest to where it went into the water. */
function preferredSlot(p: Penguin, slots: number): number {
	return wrap(Math.round(heading(p.pos) / ((Math.PI * 2) / slots)), slots);
}

/**
 * Where every eliminated penguin is watching from, keyed by id.
 *
 * Each one surfaces at the slot nearest to where it fell, which is what lets the eye follow a
 * penguin out of the water rather than hunting for it — and takes the next slot round when that one
 * is already occupied, because two spectators sharing a chunk reads as a rendering bug.
 *
 * Resolved in `world.penguins` order, so the answer depends on nothing but the world: a penguin that
 * surfaced earlier keeps its slot when the next one goes in, and the host and a client computing
 * this independently in phase 3 agree without exchanging anything.
 */
export function spectatorSpots(world: World): Map<string, Vec2> {
	const spots = new Map<string, Vec2>();
	const taken = new Set<number>();
	const ring = watchingRing(world);
	const slots = spectatorSlots(world);

	for (const p of world.penguins) {
		if (p.phase !== 'out') continue;

		let slot = preferredSlot(p, slots);
		// Bounded by the slot count, so a game larger than the ring cannot spin here. There are more
		// slots than players in every game this has (`spectatorSlots`), so the scan always finds a
		// free one and nobody has to share a chunk with somebody else.
		for (let i = 0; i < slots && taken.has(slot); i++) {
			slot = (slot + 1) % slots;
		}
		taken.add(slot);
		spots.set(p.id, slotSpot(slot, ring, slots));
	}

	return spots;
}
