import { describe, expect, it } from 'vitest';
import { createActionLatch } from './actions';

const STILL = { x: 0, z: 0 };

describe('the action latch', () => {
	it('delivers a press exactly once', () => {
		// A tap can be shorter than a tick at 60 Hz, so a press is latched rather than read as a
		// held boolean — but it must not then repeat on the following tick.
		const latch = createActionLatch();
		latch.press('jump');
		expect(latch.take(STILL).jump).toBe(true);
		expect(latch.take(STILL).jump).toBe(false);
	});

	it('collapses repeated presses inside one tick', () => {
		const latch = createActionLatch();
		latch.press('dash');
		latch.press('dash');
		expect(latch.take(STILL).dash).toBe(true);
		expect(latch.take(STILL).dash).toBe(false);
	});

	it('keeps the three actions independent', () => {
		const latch = createActionLatch();
		latch.press('throw');
		const frame = latch.take(STILL);
		expect(frame.throw).toBe(true);
		expect(frame.jump).toBe(false);
		expect(frame.dash).toBe(false);
	});

	it('returns a fresh frame every tick', () => {
		// The one that matters for phase 3. A reused mutable frame saves sixty allocations a second
		// and breaks client-side prediction, which buffers the input history and replays it: every
		// retained reference would show the newest values, so the replay is fed the wrong inputs.
		// The failure surfaces as "prediction disagrees with the host", which points the next
		// debugger at `sim/` purity rather than here.
		const latch = createActionLatch();
		latch.press('jump');
		const first = latch.take({ x: 1, z: 0 });
		const second = latch.take({ x: 0, z: 1 });

		expect(second).not.toBe(first);
		expect(first.jump).toBe(true);
		expect(first.move).toEqual({ x: 1, z: 0 });
	});

	it('copies the stick rather than aliasing the vector it was handed', () => {
		// The route hands in a reactive object it keeps mutating. Aliasing it would make every
		// buffered frame show the newest thumb position, for the same reason as above.
		const latch = createActionLatch();
		const move = { x: 1, z: 0 };
		const frame = latch.take(move);
		move.x = -1;
		expect(frame.move.x).toBe(1);
	});
});
