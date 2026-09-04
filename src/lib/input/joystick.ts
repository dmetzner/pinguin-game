/**
 * Turning a thumb into an `InputFrame`.
 *
 * Pure maths, no DOM: the component owns the pointer events and the pixels, this file owns the
 * decision. That split is what makes the rules below testable, and every one of them is a rule
 * because of how eight-year-olds actually hold a phone.
 */
import type { Vec2 } from '../sim/types';

/** Radius in CSS pixels at which the stick reads as fully pushed. */
export const STICK_RADIUS = 56;

/**
 * Below this fraction of the radius, the stick reads as centred.
 *
 * A dead zone exists because a thumb resting on glass is never still, and without one the penguin
 * creeps while the player believes they are standing still — which on a tilting floe is a death
 * they did not cause and cannot explain.
 */
export const DEAD_ZONE = 0.16;

/**
 * Above this fraction, the stick reads as fully pushed.
 *
 * Small thumbs do not reach the rim of a 56 px circle without shifting their grip. Full speed has
 * to be available comfortably short of the edge, or the game feels sluggish to exactly the players
 * with the smallest hands.
 */
export const FULL_THROW = 0.82;

/**
 * Convert an offset from the stick's origin, in pixels, into a movement request.
 *
 * The magnitude is rescaled across the band between the dead zone and full throw rather than simply
 * clamped, so the first pixel of real input produces the smallest real movement. Clamping instead
 * leaves a visible step at the dead zone edge, and a penguin that jerks into motion is a penguin
 * that overshoots the rim.
 */
export function stickVector(dx: number, dy: number, radius = STICK_RADIUS): Vec2 {
	const dist = Math.hypot(dx, dy);
	if (dist < 1e-6) return { x: 0, z: 0 };

	const t = dist / radius;
	if (t < DEAD_ZONE) return { x: 0, z: 0 };

	const magnitude = Math.min(1, (t - DEAD_ZONE) / (FULL_THROW - DEAD_ZONE));
	// Screen y grows downward, and the camera stands on the +z side of the floe looking back along
	// −z (`render/camera.ts`). A point FURTHER from the camera therefore draws higher on screen, so
	// screen-up is −z and `dy` passes straight through with its own sign.
	//
	// It shipped inverted for the whole of phase 1, and the comment that stood here is how. It
	// reasoned about the axes twice, flipped and then unflipped, and concluded "the net effect is
	// that screen-up is +z"; `joystick.test.ts` then asserted exactly that, so the test defended
	// the bug rather than catching it. Pushing the stick up walked the penguin toward the player,
	// which is invisible in review and obvious within one second of holding the phone.
	//
	// The expectation is now DERIVED from `cameraPlacement()` in the test instead of argued here.
	return { x: (dx / dist) * magnitude, z: (dy / dist) * magnitude };
}

/**
 * Where the stick's knob should be drawn, given the raw offset.
 *
 * The knob follows the thumb up to the rim and then stops. It does NOT jump to the dead-zone edge
 * or snap to full throw: the visual is a mirror of the thumb, and the shaping above is a fact about
 * the penguin, not about the finger. Making the knob lie about where the thumb is makes the control
 * feel broken even when it is behaving perfectly.
 */
export function knobOffset(
	dx: number,
	dy: number,
	radius = STICK_RADIUS
): { x: number; y: number } {
	const dist = Math.hypot(dx, dy);
	if (dist <= radius) return { x: dx, y: dy };
	return { x: (dx / dist) * radius, y: (dy / dist) * radius };
}
