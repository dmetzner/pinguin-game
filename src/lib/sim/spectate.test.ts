import { describe, expect, it } from 'vitest';
import {
	FLOE_RADIUS,
	PENGUIN_RADIUS,
	ROYAL_PLAYERS,
	SPECTATOR_SLOTS,
	SURFACE_RADIUS
} from './constants';
import { slotSpot, spectatorSlots, spectatorSpots } from './spectate';
import type { World } from './types';
import { distanceSq, fromHeading, heading, length, scale } from './vec';
import { createWorld } from './world';

/** A world whose named penguins have been put in the water at a given bearing. */
function withOut(entries: { id: string; angle: number }[]): World {
	const world = createWorld(
		entries.map((e) => e.id),
		7
	);
	for (const { id, angle } of entries) {
		const p = world.penguins.find((q) => q.id === id);
		if (!p) throw new Error(`no penguin ${id}`);
		p.phase = 'out';
		// Where a fallen penguin actually is: past the rim, having drifted on while it sank.
		p.pos = scale(fromHeading(angle), FLOE_RADIUS + 1.4);
		p.height = -5;
	}
	return world;
}

describe('surfacing after going in', () => {
	it('leaves everyone still on the ice out of it', () => {
		const world = createWorld(['a', 'b'], 3);
		expect(spectatorSpots(world).size).toBe(0);
	});

	it('puts a spectator on the ring the camera is guaranteed to contain', () => {
		// The camera is fitted once, to `FLOE_RADIUS * 1.08`. A chunk beyond that is off screen, and a
		// spectator nobody can see is the fail screen this whole mechanic exists to avoid.
		const world = withOut([{ id: 'a', angle: 1.1 }]);
		const spot = spectatorSpots(world).get('a');
		if (!spot) throw new Error('no spot');
		expect(length(spot)).toBeCloseTo(SURFACE_RADIUS, 6);
		expect(length(spot)).toBeLessThan(FLOE_RADIUS * 1.08);
	});

	it('surfaces near where the penguin went in, so the eye can follow it', () => {
		// The alternative — a fixed slot per player — is simpler and worse: a child watches their
		// penguin sink on one side of the floe and reappear on the other, which reads as a different
		// penguin. Half a slot is the most the snapping can ever move somebody.
		const halfSlot = Math.PI / SPECTATOR_SLOTS;
		for (let i = 0; i < 24; i++) {
			const angle = -Math.PI + (i / 24) * Math.PI * 2;
			const world = withOut([{ id: 'a', angle }]);
			const spot = spectatorSpots(world).get('a');
			if (!spot) throw new Error('no spot');
			const off = Math.abs(
				Math.atan2(Math.sin(heading(spot) - angle), Math.cos(heading(spot) - angle))
			);
			expect(
				off,
				`went in at ${angle.toFixed(2)} and surfaced at ${heading(spot).toFixed(2)}`
			).toBeLessThanOrEqual(halfSlot + 1e-9);
		}
	});

	it('never puts two spectators on the same chunk', () => {
		// Six players all knocked off the same side is not a corner case, it is what a scrum at one
		// rim looks like — and two penguins in the same place reads as a rendering bug, not as ice.
		const world = withOut(
			['a', 'b', 'c', 'd', 'e', 'f'].map((id, i) => ({ id, angle: 0.8 + i * 0.01 }))
		);
		const spots = [...spectatorSpots(world).values()];
		expect(spots).toHaveLength(6);
		for (let i = 0; i < spots.length; i++) {
			for (let j = i + 1; j < spots.length; j++) {
				const a = spots[i];
				const b = spots[j];
				if (!a || !b) throw new Error('missing spot');
				expect(distanceSq(a, b), 'two spectators are standing in each other').toBeGreaterThan(
					(PENGUIN_RADIUS * 2) ** 2
				);
			}
		}
	});

	it('does not move a spectator when somebody else goes in later', () => {
		// A chunk that slides sideways because a fourth player fell off is a distraction during the
		// exact seconds an eliminated child is deciding whether to keep watching.
		const world = createWorld(['a', 'b'], 5);
		const early = world.penguins.find((p) => p.id === 'a');
		if (!early) throw new Error('no a');
		early.phase = 'out';
		early.pos = scale(fromHeading(0.4), FLOE_RADIUS + 1.2);
		const first = spectatorSpots(world).get('a');

		const later = world.penguins.find((p) => p.id === 'b');
		if (!later) throw new Error('no b');
		later.phase = 'out';
		later.pos = scale(fromHeading(0.45), FLOE_RADIUS + 1);

		expect(spectatorSpots(world).get('a')).toEqual(first);
	});

	it('is a pure function of the world', () => {
		// The property phase 3 needs: a host and a client both holding this world agree on where the
		// spectators are without sending anything, which is what keeps it off the snapshot.
		const world = withOut([
			{ id: 'a', angle: 0.4 },
			{ id: 'b', angle: 0.45 }
		]);
		expect(spectatorSpots(world)).toEqual(spectatorSpots(world));
	});
});

describe('the ring itself', () => {
	it('wraps rather than running off the end', () => {
		expect(slotSpot(SPECTATOR_SLOTS)).toEqual(slotSpot(0));
		expect(slotSpot(-1)).toEqual(slotSpot(SPECTATOR_SLOTS - 1));
	});

	it('spaces chunks far enough apart to look like separate pieces of ice', () => {
		// The number `SPECTATOR_SLOTS` is chosen against a 1.9 m chunk; this is that claim, checked.
		const gap = Math.hypot(slotSpot(0).x - slotSpot(1).x, slotSpot(0).z - slotSpot(1).z);
		expect(gap).toBeGreaterThan(1.9);
	});
});

describe('a whole Royal in the water', () => {
	/** Everyone but one, eliminated, in a Royal-sized game. */
	function afterTheFlood(): World {
		const ids = Array.from({ length: ROYAL_PLAYERS }, (_, i) => `p${i}`);
		const world = createWorld(ids, 11, 'royal');
		for (const p of world.penguins.slice(1)) {
			p.phase = 'out';
			p.height = -5;
		}
		return world;
	}

	it('has a place for every single one of them', () => {
		// The failure this replaces was not a crowded ring, it was a pile of penguins standing in the
		// middle of the arena: a spectator the RENDERER cannot place is never parented into a chunk,
		// and the position it is then given — the chunk's own origin — is the middle of the world.
		// Twelve slots against twenty-nine eliminated meant seventeen of them stood in the finale.
		const world = afterTheFlood();
		const spots = spectatorSpots(world);
		expect(spots.size).toBe(ROYAL_PLAYERS - 1);
		expect(spectatorSlots(world)).toBeGreaterThanOrEqual(spots.size);
	});

	it('gives every one of them their own chunk', () => {
		const spots = [...spectatorSpots(afterTheFlood()).values()];
		const places = new Set(spots.map((spot) => `${spot.x.toFixed(3)}:${spot.z.toFixed(3)}`));
		expect(places.size).toBe(spots.length);
	});

	it('keeps every one of them out of the arena', () => {
		// The ring is outside the whole archipelago, so nobody who is out is standing anywhere a
		// round is still being played — least of all on the middle floe, where it ends.
		const world = afterTheFlood();
		for (const spot of spectatorSpots(world).values()) {
			for (const floe of world.floes) {
				const from = Math.hypot(spot.x - floe.center.x, spot.z - floe.center.z);
				expect(from).toBeGreaterThan(floe.fullRadius + PENGUIN_RADIUS);
			}
		}
	});

	it('still gives the classic round exactly the ring it always had', () => {
		// Non-regression for the small game: the slot count only grows with the sea.
		expect(spectatorSlots(createWorld(['a', 'b'], 1))).toBe(SPECTATOR_SLOTS);
	});
});
