import { describe, expect, it } from 'vitest';
import { cameraPlacement } from '../render/camera';
import { length as len } from '../sim/vec';
import { actionFromKey, KEY_BINDINGS, keyRole, moveFromKeys } from './keyboard';

describe('moveFromKeys', () => {
	it('is centred when nothing is held', () => {
		expect(moveFromKeys([])).toEqual({ x: 0, z: 0 });
		// A key nobody bound is not a direction. Typing into a page that also runs a game must not
		// walk the penguin sideways.
		expect(moveFromKeys(['KeyQ', 'ShiftLeft'])).toEqual({ x: 0, z: 0 });
	});

	it('sends the penguin AWAY from the camera when up is held', () => {
		// Derived from where the camera stands, not from a sentence about axes — the stick shipped
		// inverted for the whole of phase 1 because its test asserted the prose instead. Move the
		// camera to the other side of the arena and this test changes its mind on its own.
		const camera = cameraPlacement(20);

		for (const up of ['KeyW', 'ArrowUp']) {
			const v = moveFromKeys([up]);
			expect(Math.sign(v.z)).toBe(-Math.sign(camera.z));
			expect(v.x).toBeCloseTo(0);
		}
		for (const down of ['KeyS', 'ArrowDown']) {
			expect(Math.sign(moveFromKeys([down]).z)).toBe(Math.sign(camera.z));
		}
		expect(moveFromKeys(['KeyD']).x).toBeGreaterThan(0);
		expect(moveFromKeys(['ArrowRight']).x).toBeGreaterThan(0);
		expect(moveFromKeys(['KeyA']).x).toBeLessThan(0);
		expect(moveFromKeys(['ArrowLeft']).x).toBeLessThan(0);
	});

	it('is asking a camera that stands somewhere', () => {
		// Non-vacuousness, the way `purity.test.ts` proves its regexes: `Math.sign(0)` is 0 and would
		// let the pair above agree with anything at all.
		expect(cameraPlacement(20).z).toBeGreaterThan(1);
	});

	it('walks the same speed diagonally as it does straight', () => {
		// Without the normalisation, up-and-right is 1.41× the speed of up — which on ice is the
		// difference between arriving at the rim and going over it, and it would apply only to the
		// keyboard, so a desk player and a phone player would be playing different games.
		expect(len(moveFromKeys(['KeyW']))).toBeCloseTo(1);
		expect(len(moveFromKeys(['KeyW', 'KeyD']))).toBeCloseTo(1);
		expect(len(moveFromKeys(['ArrowUp', 'ArrowLeft']))).toBeCloseTo(1);

		const diagonal = moveFromKeys(['KeyW', 'KeyD']);
		expect(diagonal.x).toBeCloseTo(-diagonal.z, 6);
		expect(diagonal.x).toBeGreaterThan(0);
	});

	it('cancels opposite keys instead of picking a winner', () => {
		// Holding both is a fumble, and last-pressed-wins keeps the penguin sliding after the player
		// believes they have stopped asking for it.
		expect(moveFromKeys(['KeyW', 'KeyS'])).toEqual({ x: 0, z: 0 });
		expect(moveFromKeys(['KeyA', 'ArrowRight'])).toEqual({ x: 0, z: 0 });
		// One axis cancelling leaves the other one whole rather than shortened.
		expect(len(moveFromKeys(['KeyW', 'KeyS', 'KeyD']))).toBeCloseTo(1);
	});

	it('treats a key on the other side of the board as the same key', () => {
		// WASD and the arrows are one control, not two: a second key held on the same axis must not
		// double it, and the vector never exceeds magnitude 1 whatever is leaning on the keyboard.
		expect(moveFromKeys(['KeyD', 'ArrowRight'])).toEqual(moveFromKeys(['KeyD']));
		expect(len(moveFromKeys(Object.keys(KEY_BINDINGS)))).toBeLessThanOrEqual(1);
	});
});

describe('actionFromKey', () => {
	it('latches the three buttons and nothing else', () => {
		expect(actionFromKey('Space')).toBe('jump');
		expect(actionFromKey('KeyJ')).toBe('throw');
		expect(actionFromKey('KeyF')).toBe('throw');
		expect(actionFromKey('KeyK')).toBe('dash');
		expect(actionFromKey('KeyG')).toBe('dash');
	});

	it('does not turn a direction into an action', () => {
		// Directions are HELD; actions are latched once per press. A direction leaking into the latch
		// would fire a jump every tick the key is down.
		for (const code of ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown']) {
			expect(actionFromKey(code)).toBeNull();
		}
		expect(actionFromKey('Enter')).toBeNull();
		expect(actionFromKey('Tab')).toBeNull();
	});
});

describe('keyRole', () => {
	it('claims exactly the keys the game acts on', () => {
		// This is what decides whether `preventDefault` is called, so an over-broad answer is a page
		// that has swallowed Tab, Enter and the browser's own shortcuts.
		expect(keyRole('Space')).toBe('jump');
		expect(keyRole('ArrowUp')).toBe('up');
		expect(keyRole('Tab')).toBeNull();
		expect(keyRole('Enter')).toBeNull();
		expect(keyRole('Escape')).toBeNull();
		expect(keyRole('KeyR')).toBeNull();
	});

	it('answers for every binding in the table', () => {
		for (const code of Object.keys(KEY_BINDINGS)) expect(keyRole(code)).not.toBeNull();
	});
});
