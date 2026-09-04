/**
 * The three action buttons, and the rule that a tap counts exactly once.
 *
 * Same split as `joystick.ts`: the component owns the pointer events and the pixels, this file owns
 * the decision. The buttons had kept the pixels and taken the decision too — three module-scope
 * booleans in the route with a hand-written set-then-clear block, where a forgotten clear sticks an
 * input on permanently.
 *
 * **Each tick gets a FRESH `InputFrame`.** The route used to reuse one mutable object, saving sixty
 * small allocations a second, and that is a trap rather than an optimisation: story 04's client-side
 * prediction has to buffer the input history and replay it against an acknowledged host state, and
 * the network layer serialises each frame. Every retained reference to one shared object shows the
 * newest values, so a replay is fed the wrong inputs — and it surfaces only as "prediction disagrees
 * with the host", which sends the next person debugging it straight at `sim/` purity instead.
 */

import type { InputFrame, Vec2 } from '../sim/types';
import { NO_INPUT } from '../sim/types';

/** Everything a button can ask for. The stick is separate; it is held, not tapped. */
export type Action = 'jump' | 'throw' | 'dash';

export interface ActionLatch {
	/** Record a press. Repeated presses inside one tick still produce one action. */
	press(action: Action): void;
	/** Build this tick's frame and clear every latch. Called once per tick, by the game loop. */
	take(move: Vec2): InputFrame;
}

export function createActionLatch(): ActionLatch {
	// Latched rather than read as a held boolean, because a tap can be shorter than a tick at 60 Hz.
	// A quick jab on a fast phone would otherwise be dropped entirely, which reads as a dead button.
	const pending = new Set<Action>();

	return {
		press(action) {
			pending.add(action);
		},
		take(move) {
			// Spread from NO_INPUT so a new field costs nothing here. Adding `throw` and `dash` had
			// to edit every hand-written frame literal in the tree, which is how this became a rule.
			const frame: InputFrame = {
				...NO_INPUT,
				move: { x: move.x, z: move.z },
				jump: pending.has('jump'),
				throw: pending.has('throw'),
				dash: pending.has('dash')
			};
			// Cleared in the same expression that reads them: set and clear cannot be separated by a
			// later edit, which is the failure the three hand-written pairs invited.
			pending.clear();
			return frame;
		}
	};
}
