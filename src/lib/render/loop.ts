/**
 * The bridge between a clock that stutters and a simulation that must not.
 *
 * The simulation advances in fixed 1/60 s ticks and nothing else; the display refreshes whenever it
 * feels like it — 60 Hz, 120 Hz, 48 Hz on a phone saving battery, or once after four seconds in a
 * backgrounded tab. An accumulator absorbs the difference, and the renderer draws BETWEEN the two
 * most recent ticks so a 120 Hz screen shows smooth motion rather than each tick twice.
 *
 * This is also the only file that reads a clock, which is what lets `sim/` be free of one.
 */
import { DT, TICK_RATE } from '../sim/constants';
import type { InputMap } from '../sim/step';
import { step } from '../sim/step';
import type { Penguin, World } from '../sim/types';

/** What a penguin looked like at the previous tick, so the renderer can draw the moment between. */
interface Sample {
	x: number;
	z: number;
	height: number;
	facing: number;
}

export interface Interpolated {
	x: number;
	z: number;
	height: number;
	facing: number;
	/** The live penguin, for anything that should not be smoothed — phase, for instance. */
	penguin: Penguin;
}

export interface LoopHandles {
	stop(): void;
}

export interface LoopOptions {
	world: World;
	/** Collect this frame's input. Called once per TICK, not once per frame. */
	inputs(): InputMap;
	/** Draw. `alpha` is how far between the previous and current tick this frame sits, 0..1. */
	draw(interpolated: Map<string, Interpolated>, alpha: number, elapsedSeconds: number): void;
	/** Called after each tick, for anything that reacts to simulation state. */
	afterTick?(world: World): void;
	/**
	 * Advance the world by one tick. Defaults to the simulation's own `step`.
	 *
	 * Multiplayer replaces it, and that is the whole of what this seam is for: a client does not
	 * step the world, it predicts and is corrected, and a host steps it with everybody's inputs
	 * rather than its own. What must NOT differ is the clock — one fixed 1/60 s accumulator for
	 * every mode, because two of them would be two definitions of a second.
	 */
	advance?(inputs: InputMap): void;
}

/**
 * A hard ceiling on how much simulated time one frame may catch up on.
 *
 * Without it, a tab restored after two minutes in the background tries to run seven thousand ticks
 * inside one frame, locks the main thread for several seconds and then presents a world that has
 * moved on without the player — the classic "spiral of death". Dropping the excess is the honest
 * behaviour: the game simply did not happen while nobody was looking.
 */
const MAX_CATCHUP_SECONDS = 0.25;

export function startLoop(options: LoopOptions): LoopHandles {
	const { world, inputs, draw, afterTick } = options;

	const previous = new Map<string, Sample>();
	const interpolated = new Map<string, Interpolated>();
	let accumulator = 0;
	let lastFrame = performance.now();
	let frame = 0;

	const capture = () => {
		for (const p of world.penguins) previous.set(p.id, sample(p));
	};
	capture();

	const advance = options.advance ?? ((frames: InputMap) => step(world, frames));

	const tickOnce = () => {
		capture();
		advance(inputs());
		afterTick?.(world);
	};

	const onFrame = (now: number) => {
		frame = requestAnimationFrame(onFrame);

		const elapsed = Math.min((now - lastFrame) / 1000, MAX_CATCHUP_SECONDS);
		lastFrame = now;
		accumulator += elapsed;

		while (accumulator >= DT) {
			tickOnce();
			accumulator -= DT;
		}

		const alpha = accumulator / DT;
		interpolated.clear();
		for (const p of world.penguins) {
			// A penguin that joined during this frame has no previous sample; interpolating it
			// against itself simply draws it where it is.
			const from = previous.get(p.id) ?? sample(p);
			interpolated.set(p.id, {
				x: from.x + (p.pos.x - from.x) * alpha,
				z: from.z + (p.pos.z - from.z) * alpha,
				height: from.height + (p.height - from.height) * alpha,
				facing: from.facing + shortestTurn(from.facing, p.facing) * alpha,
				penguin: p
			});
		}

		draw(interpolated, alpha, (world.tick + alpha) / TICK_RATE);
	};

	frame = requestAnimationFrame(onFrame);

	return {
		stop() {
			cancelAnimationFrame(frame);
		}
	};
}

/** The four values worth smoothing between ticks. One definition, two readers. */
function sample(p: Penguin): Sample {
	return { x: p.pos.x, z: p.pos.z, height: p.height, facing: p.facing };
}

/**
 * The signed turn from `a` to `b`, taking the short way round.
 *
 * A penguin whose facing crosses ±π would otherwise spin the whole way back through zero — a
 * full, very visible pirouette every time someone skates past due south.
 */
function shortestTurn(a: number, b: number): number {
	let delta = (b - a) % (Math.PI * 2);
	if (delta > Math.PI) delta -= Math.PI * 2;
	if (delta < -Math.PI) delta += Math.PI * 2;
	return delta;
}

export { shortestTurn };
