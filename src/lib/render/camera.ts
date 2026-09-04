/**
 * Where the camera stands, as arithmetic.
 *
 * Split out of `scene.ts` for one reason: this is the fact that decides which way is UP ON SCREEN,
 * and something outside `render/` has to be able to ask. `input/joystick.ts` converts a thumb into
 * a world direction, and it got the sign wrong for the whole of phase 1 — the comment beside it
 * reasoned about the axes twice, cancelled its own flip, and locked the result in with a unit test
 * that asserted the code rather than the screen. Pushing the stick up walked the penguin toward
 * the player.
 *
 * So the mapping is no longer written down twice in prose. It is derived from this placement, in
 * `joystick.test.ts`, and the only way it can be wrong now is if the camera itself moves.
 *
 * No `three` import on purpose: this file is plain numbers, so a unit test can ask it without
 * pulling in a renderer.
 */

/**
 * How high above the water the camera sits, in degrees. Paired with the 58° field of view in
 * `scene.ts`.
 *
 * Between them these two numbers decide whether there is a HORIZON on screen at all, which is not a
 * detail: the design asks for a floe that visibly wobbles in the sea, and a wobble needs a level
 * line to wobble against. The top edge of the frame points `pitch − fov/2` below level, so the sea
 * only ends somewhere if that is close to zero or negative.
 *
 *  * 42° pitch / 46° fov (the first build) → top ray 19° DOWN, meeting water 59 m out. Every pixel
 *    was sea. The floe read as a disc on a blue background and nothing conveyed motion at all.
 *  * 33° / 54° → 6° down, 59 m out, still barely fogged. Better sea, still no horizon.
 *  * 27° / 58° → 2° ABOVE level. The frame contains sky, the sea ends in a haze band, and the floe
 *    rocks against it.
 *
 * Shallower still would hide the far rim behind the near one and flatten the jump arc to nothing.
 */
export const CAMERA_PITCH_DEGREES = 27;

/**
 * Where the camera sits for a given distance from the arena's centre, which it always looks at.
 *
 * `z` is POSITIVE: the camera stands on the +z side of the floe and looks back along −z. Everything
 * about screen direction follows from that one sign — a point further from the camera (−z) draws
 * HIGHER on screen, a point toward it (+z) draws lower.
 */
export function cameraPlacement(distance: number): { x: number; y: number; z: number } {
	const pitch = (CAMERA_PITCH_DEGREES * Math.PI) / 180;
	return { x: 0, y: Math.sin(pitch) * distance, z: Math.cos(pitch) * distance };
}
