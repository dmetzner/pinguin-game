import { describe, expect, it } from 'vitest';
import { cameraPlacement } from '../render/camera';
import { length as len } from '../sim/vec';
import { DEAD_ZONE, FULL_THROW, knobOffset, STICK_RADIUS, stickVector } from './joystick';

describe('stickVector', () => {
	it('is centred inside the dead zone', () => {
		// A thumb resting on glass is never still. Without this the penguin creeps while the player
		// believes they are standing still, which on a tilting floe is a death they cannot explain.
		const inside = STICK_RADIUS * DEAD_ZONE * 0.9;
		expect(stickVector(inside, 0)).toEqual({ x: 0, z: 0 });
		expect(stickVector(0, -inside)).toEqual({ x: 0, z: 0 });
		expect(stickVector(0, 0)).toEqual({ x: 0, z: 0 });
	});

	it('reaches full magnitude short of the rim', () => {
		// Small hands do not reach the rim of a 56 px circle without shifting grip.
		const atFullThrow = STICK_RADIUS * FULL_THROW;
		expect(len(stickVector(atFullThrow, 0))).toBeCloseTo(1);
		expect(len(stickVector(atFullThrow * 0.95, 0))).toBeLessThan(1);
	});

	it('never exceeds magnitude 1, however far the thumb slides', () => {
		// The stick is captured on drag, so a thumb can end up well outside the circle. The
		// simulation clamps too, but a value that is only ever correct because something downstream
		// fixes it is a value that will be wrong the first time it is read somewhere else.
		expect(len(stickVector(STICK_RADIUS * 8, STICK_RADIUS * 8))).toBeCloseTo(1);
		expect(len(stickVector(-9999, 3))).toBeCloseTo(1);
	});

	it('ramps smoothly out of the dead zone instead of stepping', () => {
		// Rescaling across the band rather than clamping. With a clamp there is a visible jump at
		// the dead-zone edge, and a penguin that jerks into motion overshoots the rim.
		const justOutside = STICK_RADIUS * (DEAD_ZONE + 0.01);
		expect(len(stickVector(justOutside, 0))).toBeLessThan(0.1);
		expect(len(stickVector(justOutside, 0))).toBeGreaterThan(0);
	});

	it('grows monotonically with distance', () => {
		let previous = 0;
		for (let d = 0; d <= STICK_RADIUS * 1.5; d += 0.5) {
			const m = len(stickVector(d, 0));
			expect(m).toBeGreaterThanOrEqual(previous - 1e-9);
			previous = m;
		}
	});

	it('sends the penguin AWAY from the camera when the stick goes up', () => {
		// This assertion used to read `expect(up.z).toBeGreaterThan(0)`, and it was wrong — so the
		// suite defended an inverted stick for the whole of phase 1: pushing up walked the penguin
		// back toward the player. The mistake was arguing about axes in prose, in the source comment
		// and then again here, instead of asking where the camera actually stands.
		//
		// So now it asks. The camera sits on the +z side of the floe and looks back at it, so "away
		// from the camera" is the direction whose z has the OPPOSITE sign to the camera's own. Move
		// the camera to the other side of the arena and this test changes its mind on its own, which
		// is the only way a sign convention stays true.
		const camera = cameraPlacement(20);

		const up = stickVector(0, -STICK_RADIUS);
		expect(Math.sign(up.z)).toBe(-Math.sign(camera.z));
		expect(up.x).toBeCloseTo(0);

		// Down is the way back toward the player, i.e. the camera's own side.
		const down = stickVector(0, STICK_RADIUS);
		expect(Math.sign(down.z)).toBe(Math.sign(camera.z));

		const right = stickVector(STICK_RADIUS, 0);
		expect(right.x).toBeGreaterThan(0);
		expect(right.z).toBeCloseTo(0);
	});

	it('is asking a camera that stands somewhere', () => {
		// Non-vacuousness, the same way `purity.test.ts` proves its regexes: `Math.sign(0)` is 0 and
		// would let the pair above agree with anything at all.
		expect(cameraPlacement(20).z).toBeGreaterThan(1);
	});

	it('preserves the direction the thumb actually pointed', () => {
		// Diagonally up-and-right: equal magnitudes on both axes, and opposite signs, because screen
		// y grows downward while the world's screen-up is −z. (It read `x` ≈ `z` while the stick was
		// inverted, which is the same equality with the bug folded into it.)
		const v = stickVector(30, -30);
		expect(v.x).toBeCloseTo(-v.z, 6);
		expect(v.x).toBeGreaterThan(0);
	});
});

describe('knobOffset', () => {
	it('follows the thumb exactly inside the circle', () => {
		// The knob mirrors the finger; the shaping is a fact about the penguin, not the finger.
		// Snapping the knob to the dead zone makes a working control feel broken.
		expect(knobOffset(10, -4)).toEqual({ x: 10, y: -4 });
		const inDeadZone = STICK_RADIUS * DEAD_ZONE * 0.5;
		expect(knobOffset(inDeadZone, 0)).toEqual({ x: inDeadZone, y: 0 });
	});

	it('stops at the rim when the thumb slides past it', () => {
		const far = knobOffset(STICK_RADIUS * 5, 0);
		expect(Math.hypot(far.x, far.y)).toBeCloseTo(STICK_RADIUS);
	});
});
