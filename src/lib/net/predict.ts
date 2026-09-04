/**
 * Client-side prediction, and the correction that follows it.
 *
 * A client cannot wait for the host to agree that its thumb moved — at 40 ms each way, that is a
 * penguin that starts walking five frames after you push, which on ice reads as the controls being
 * broken. So the client steps its own world immediately, keeps every input it has sent, and when a
 * snapshot arrives it winds back to what the host actually said and replays those inputs forward.
 *
 * This is the whole reason `sim/` is pure and seeded. Replaying the same inputs from the same state
 * has to produce the same result, or the correction is a fight rather than a confirmation: the
 * penguin lands somewhere the host did not put it, the next snapshot yanks it back, and the player
 * sees rubber-banding they cannot do anything about. `purity.test.ts` is the safety net for this
 * whole file — see the trap list in `backlog/stories/04-peer-to-peer.md`.
 *
 * Remote penguins are NOT re-predicted. They are replayed with `NO_INPUT`, which on ice means their
 * momentum carries and nothing else: they keep sliding the way the host last saw them going. Giving
 * them a guessed stick would look smoother for a fraction of a second and be wrong in exchanges,
 * which is where it is least forgivable.
 */
import { step } from '../sim/step';
import type { InputFrame, World } from '../sim/types';
import { NO_INPUT } from '../sim/types';
import { apply, type Snapshot } from './snapshot';

/**
 * How far AHEAD of the host a client runs, in ticks.
 *
 * The one number that makes any of this work, and it is easy to leave out because a client that
 * runs at the host's tick number looks correct in every diagram. It is not: an input produced for
 * tick T leaves at T and reaches the host a round trip later, by which time the host has stepped
 * past T and can only throw it away. The player then pushes the stick and nothing at all happens,
 * which is the exact failure prediction was added to prevent.
 *
 * Eight ticks is 133 ms, which covers a 130 ms round trip — bad home wifi, or a phone one room too
 * far from the router. Longer costs nothing a player can perceive on their OWN penguin, because
 * that one is predicted; what it costs is a larger correction when the prediction was wrong.
 *
 * A measured, adapting lead is better than a fixed one and is the next thing to build here. Until
 * then this is deliberately generous, and `INPUT_WINDOW` on the host is set well above it.
 */
export const LEAD_TICKS = 8;

/**
 * How far a single correction will replay before it gives up and simply accepts the host's tick.
 *
 * Three seconds. Beyond that the connection has not hiccuped, it has stopped, and replaying a
 * thousand ticks inside one frame would lock the phone exactly the way `MAX_CATCHUP_SECONDS` in
 * `render/loop.ts` exists to prevent. The honest presentation of a dead connection is a game that
 * visibly stops, not a device that does.
 */
export const MAX_REPLAY_TICKS = 180;

export interface Predictor {
	/** Record and apply one tick of local input. Returns the tick it was produced for. */
	predict(world: World, mine: InputFrame): number;
	/** Wind back to what the host said and replay everything since. */
	reconcile(world: World, snap: Snapshot): void;
	/** The inputs the host has not confirmed yet, oldest first, for the message going up. */
	pending(): { fromTick: number; frames: InputFrame[] };
	/** How many ticks the last correction had to replay. A steady number is a steady connection. */
	readonly lastReplay: number;
	/**
	 * How far the local penguin JUMPED at the last correction, in metres.
	 *
	 * The number a player actually experiences, and the reason it is measured rather than the
	 * distance between client and host: a client deliberately runs `LEAD_TICKS` ahead, so its penguin
	 * is legitimately half a metre from where the host currently has it and comparing those two
	 * positions measures the lead, not the error. What rubber-bands is the difference between where
	 * this client had ALREADY DRAWN its penguin for a tick and where the replay puts it for the same
	 * tick. Zero means the prediction was exactly right, which is the normal case.
	 */
	readonly lastCorrection: number;
}

/**
 * @param id the local penguin's id — the ONLY one this client is allowed to have opinions about.
 */
export function createPredictor(id: string, lead = LEAD_TICKS): Predictor {
	/**
	 * Every input this client has produced and the host has not yet confirmed, BY TICK.
	 *
	 * A map rather than an array with a base index, and the difference is not style. The client's
	 * tick can JUMP — that is what re-establishing the lead after a stall means — and an array whose
	 * first element is implicitly "tick `base`" silently mis-attributes every frame in it the first
	 * time that happens. Which input belonged to which tick is the one fact this file cannot get
	 * wrong.
	 */
	const history = new Map<number, InputFrame>();
	let lastReplay = 0;
	let lastCorrection = 0;
	/** The newest host tick already applied, so a late duplicate cannot rewind the world. */
	let applied = -1;

	const oneTick = (world: World, frame: InputFrame) => {
		// A one-entry map, rebuilt per tick. A shared mutable one would be state that survives a
		// replay, which is precisely the class of bug a replay exists to be free of.
		step(world, new Map([[id, frame]]));
	};

	return {
		get lastReplay() {
			return lastReplay;
		},
		get lastCorrection() {
			return lastCorrection;
		},

		predict(world, mine) {
			const at = world.tick + 1;
			history.set(at, mine);
			oneTick(world, mine);
			return at;
		},

		reconcile(world, snap) {
			// Out of order, or a duplicate. Both happen on a channel that retries, and applying an
			// older snapshot on top of a newer one teleports the whole world backwards for a frame —
			// which looks exactly like the lag it was meant to hide.
			if (snap.tick <= applied) return;
			applied = snap.tick;

			// Where to end up: wherever the client already was, but never less than a lead ahead of
			// the host. The `max` is what re-establishes the lead by itself after a stall, without
			// anything having to notice that a stall happened.
			const target = Math.min(Math.max(world.tick, snap.tick + lead), snap.tick + MAX_REPLAY_TICKS);

			// Where this client had already drawn its own penguin for the tick it is about to land on
			// again. Compared after the replay, that difference IS the rubber-band.
			const drawn =
				world.tick === target ? world.penguins.find((p) => p.id === id)?.pos : undefined;

			apply(world, snap);

			// Everything up to the host's tick is history in both senses: the host has already
			// stepped those inputs and its answer is the one in hand.
			for (const at of history.keys()) if (at <= snap.tick) history.delete(at);

			lastReplay = Math.max(0, target - world.tick);
			for (let at = snap.tick + 1; at <= target; at++) {
				// A tick with no recorded input is one the client is fast-forwarding INTO — the lead
				// being re-established. `NO_INPUT` is the honest fill: the player has not asked for
				// anything yet, and the host will step that tick the same way.
				oneTick(world, history.get(at) ?? NO_INPUT);
			}

			// Only comparable when the replay landed on the same tick it started from. When the lead
			// is being re-established the world deliberately jumps forward, and calling that a
			// correction would report the lead as if it were error.
			const now = world.penguins.find((p) => p.id === id)?.pos;
			lastCorrection =
				drawn && now && world.tick === target ? Math.hypot(now.x - drawn.x, now.z - drawn.z) : 0;
		},

		pending() {
			// Contiguous by tick, gaps filled with `NO_INPUT`, because the message on the wire is a
			// START TICK and a run of frames: a sparse list would silently shift every frame after a
			// gap onto the wrong tick, and the host would apply a stick that was pushed later.
			const ticks = [...history.keys()];
			if (ticks.length === 0) return { fromTick: 0, frames: [] };
			const fromTick = Math.min(...ticks);
			const last = Math.max(...ticks);
			const frames: InputFrame[] = [];
			for (let at = fromTick; at <= last; at++) frames.push(history.get(at) ?? NO_INPUT);
			return { fromTick, frames };
		}
	};
}
