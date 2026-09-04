/**
 * A keyboard as a thing that returns the same `InputFrame` a thumb does.
 *
 * Same split as `joystick.ts` and `actions.ts`: the component owns the events and the key repeat,
 * this file owns the decision. Nothing here touches the DOM, so the whole mapping — including the
 * sign convention that took a session to find on the stick — is unit-testable.
 *
 * The game is designed for a phone and stays designed for one. This exists because the game is a
 * WEB page as well: it is opened on a laptop by whoever is building it, by a parent before handing
 * the phone over, and by a child at a school computer with no touch screen at all. On that machine
 * the floating stick still works with a held mouse button, which is playable exactly once — a game
 * whose steering needs the mouse held down cannot also throw a snowball.
 *
 * **Two directions never make a faster penguin.** Up-and-right is normalised back to magnitude 1,
 * because a keyboard has no analogue magnitude to shape: without it, diagonal movement is 1.41×
 * the speed of the cardinal directions, and on ice that is the difference between a controlled
 * approach to the rim and going over it.
 */
import type { Vec2 } from '../sim/types';
import type { Action } from './actions';

/** What a key asks for: a direction to hold, or an action to latch. */
export type KeyRole = 'up' | 'down' | 'left' | 'right' | Action;

/**
 * Every bound key, by `KeyboardEvent.code`.
 *
 * `code` rather than `key`, and that is the whole reason this is a table of physical positions:
 * `code` is where the key SITS, so WASD stays the same square of four keys on the German keyboards
 * this game's audience actually has — where `key` would report `w` for the physical Z on QWERTZ and
 * hand a child a steering key on the wrong side of the board.
 *
 * Two bindings per action because the two hands end up in different places: someone steering with
 * WASD reaches J and K, someone steering with the arrow keys does not, and F and G sit under the
 * left hand that is then free. Space is jump on every machine anybody has ever used.
 */
export const KEY_BINDINGS: Readonly<Record<string, KeyRole>> = {
	KeyW: 'up',
	ArrowUp: 'up',
	KeyS: 'down',
	ArrowDown: 'down',
	KeyA: 'left',
	ArrowLeft: 'left',
	KeyD: 'right',
	ArrowRight: 'right',

	Space: 'jump',
	KeyJ: 'throw',
	KeyF: 'throw',
	KeyK: 'dash',
	KeyG: 'dash'
};

/**
 * What this key asks for, or `null` when the game has no business touching it.
 *
 * Also what decides whether `preventDefault` is called, so a null here is a key that still belongs
 * to the browser: Tab, Enter, Escape and every shortcut the page must not swallow.
 */
export function keyRole(code: string): KeyRole | null {
	return KEY_BINDINGS[code] ?? null;
}

/**
 * The movement request for a set of keys currently held down.
 *
 * Opposite keys cancel rather than fighting over a last-pressed-wins rule: holding both is a
 * two-handed fumble, and a penguin that keeps sliding because the loser of the argument is still
 * down is a death nobody can explain.
 */
export function moveFromKeys(held: Iterable<string>): Vec2 {
	let x = 0;
	let z = 0;
	for (const code of held) {
		switch (keyRole(code)) {
			case 'left':
				x -= 1;
				break;
			case 'right':
				x += 1;
				break;
			// Screen-up is −z: the camera stands on the +z side of the floe and looks back along −z
			// (`render/camera.ts`), so a point further from the camera draws higher on the screen. The
			// same fact `joystick.ts` depends on, and the same one the stick shipped inverted for the
			// whole of phase 1 — so `keyboard.test.ts` derives this sign from `cameraPlacement()`
			// rather than trusting this sentence.
			case 'up':
				z -= 1;
				break;
			case 'down':
				z += 1;
				break;
		}
	}

	const dist = Math.hypot(x, z);
	if (dist < 1e-6) return { x: 0, z: 0 };
	return { x: x / dist, z: z / dist };
}

/** The action this key latches, if it latches one. Directions are held, never latched. */
export function actionFromKey(code: string): Action | null {
	const role = keyRole(code);
	return role === 'jump' || role === 'throw' || role === 'dash' ? role : null;
}
