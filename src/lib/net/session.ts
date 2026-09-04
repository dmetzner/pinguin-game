/**
 * Who steps the world, and who is told about it.
 *
 * Host-authoritative, per `docs/DECISIONS/0005`: exactly one peer owns the simulation. Everyone else
 * sends inputs and predicts their own penguin. The asymmetry is not hidden behind a shared
 * abstraction — a host and a client do genuinely different things, and pretending otherwise is how a
 * client ends up with a code path that can write to the world.
 *
 * **The host never trusts a position, only an input.** Nothing a client sends can move a penguin
 * except by being handed to `step` as an `InputFrame` — the same shape a thumb produces and the same
 * one a bot produces. There is no message that says where somebody is.
 */
import { step } from '../sim/step';
import type { InputFrame, World } from '../sim/types';
import { NO_INPUT } from '../sim/types';
import { createPredictor, type Predictor } from './predict';
import { decode, encode, INPUT_BACKLOG, SNAPSHOT_EVERY_TICKS } from './protocol';
import { capture } from './snapshot';
import type { Transport } from './transport';

/**
 * How far ahead of the host's tick a client's input is still useful.
 *
 * An input for a tick the host has already stepped cannot be applied — the host does not rewind, and
 * rewinding it would mean every other player's already-drawn frame was a lie. It is dropped, and the
 * client's next reconcile corrects for it. Holding a window at all is what lets a client run a few
 * ticks AHEAD of the host, which is how its own input arrives just in time rather than just late.
 */
const INPUT_WINDOW = 30;

/**
 * How long a client keeps playing an unconfirmed round before it calls the host gone.
 *
 * Three seconds, against a snapshot every three ticks. Long enough that no ordinary hiccup reaches
 * it — the worst link in `session.test.ts` loses nearly half of everything and never comes close —
 * and short enough that a child is not still steering a game that stopped existing.
 *
 * `backlog/stories/04-peer-to-peer.md` asks for exactly this and says why: the round has to END when
 * the host walks out, not hang. A client with nothing to correct it does not notice on its own — it
 * predicts happily forever, and the penguins around it slide on into a round nobody is running.
 */
export const HOST_GONE_TICKS = 180;

export interface HostSession {
	/** Advance one tick, with the host's own input. Broadcasts on the snapshot cadence. */
	tick(mine: InputFrame): void;
	/**
	 * Peers that have gone.
	 *
	 * Their penguins are left where they are and handed `NO_INPUT` for ever, which is not neglect: a
	 * penguin that stops steering slides downhill and the floe is shrinking under it, so the round
	 * resolves them by itself within seconds and by exactly the rule that resolves everybody else.
	 * Removing them from the roster instead would renumber every slot in every message in flight.
	 */
	readonly departed: readonly string[];
	close(): void;
}

/**
 * The peer that owns the world.
 *
 * @param world the one real world. Nothing else in the room has an authoritative copy.
 * @param id which penguin in `world` belongs to the host itself.
 * @param peerIds which penguin belongs to which peer, so an input can be attributed. Fixed when the
 *   room closes: a message cannot introduce a player, only speak for one already in the roster.
 */
export function createHost(
	transport: Transport,
	world: World,
	id: string,
	peerIds: ReadonlyMap<string, string>
): HostSession {
	/** Inputs waiting to be stepped, per penguin, keyed by the tick they were produced for. */
	const queued = new Map<string, Map<number, InputFrame>>();
	const departed: string[] = [];
	const inputs = new Map<string, InputFrame>();

	transport.onMessage((from, bytes) => {
		const penguin = peerIds.get(from);
		if (!penguin) return;
		const message = decode(bytes);
		if (message?.kind !== 'input') return;

		let slots = queued.get(penguin);
		if (!slots) {
			slots = new Map();
			queued.set(penguin, slots);
		}
		for (const [i, frame] of message.frames.entries()) {
			const at = message.fromTick + i;
			// Already stepped, or so far ahead it is nonsense. Both are dropped rather than clamped
			// into a tick they were not meant for: a stale input applied late is a penguin walking
			// somewhere its player has already stopped asking for.
			if (at <= world.tick || at > world.tick + INPUT_WINDOW) continue;
			// Re-sends of the same tick are the norm — see INPUT_BACKLOG — and the first copy wins,
			// so a duplicate can never overwrite what was already accepted.
			if (!slots.has(at)) slots.set(at, frame);
		}
	});

	transport.onPeerLeave((peer) => {
		const penguin = peerIds.get(peer);
		if (!penguin) return;
		if (!departed.includes(penguin)) departed.push(penguin);
		// Drop what they had queued. Stepping a departed player's stored inputs would walk their
		// penguin around for a second after they left, which reads as a ghost.
		queued.delete(penguin);
	});

	return {
		get departed() {
			return departed;
		},

		tick(mine) {
			const at = world.tick + 1;
			inputs.clear();
			inputs.set(id, mine);
			for (const [penguin, slots] of queued) {
				// A missing input is NO_INPUT, never the previous frame repeated. Repeating it means a
				// player whose connection drops keeps walking in the direction they were last going —
				// off the edge — and the game they come back to has already ended without them.
				inputs.set(penguin, slots.get(at) ?? NO_INPUT);
				slots.delete(at);
			}
			step(world, inputs);

			if (world.tick % SNAPSHOT_EVERY_TICKS === 0) {
				transport.send(null, encode({ kind: 'snapshot', snapshot: capture(world) }));
			}
		},

		close() {
			transport.send(null, encode({ kind: 'bye' }));
			transport.close();
		}
	};
}

export interface ClientSession {
	/** Advance one tick with the local input, predicting immediately and sending it up. */
	tick(mine: InputFrame): void;
	/** Ticks the last host correction had to replay. A steady number means a steady connection. */
	readonly replayDepth: number;
	/** Metres the local penguin jumped at the last correction — the rubber-band, as felt. */
	readonly lastCorrection: number;
	/** Ticks since the last snapshot arrived. Climbing means the host has gone quiet. */
	readonly sinceSnapshot: number;
	/** The host has stopped answering for long enough that this round is over. */
	readonly lost: boolean;
	close(): void;
}

/**
 * A peer that plays and is corrected.
 *
 * @param id which penguin belongs to this client — the only one it may predict.
 * @param hostId the transport id of the host, so an input goes to one peer rather than to the room.
 */
export function createClient(
	transport: Transport,
	world: World,
	id: string,
	hostId: string
): ClientSession {
	const predictor: Predictor = createPredictor(id);
	let sinceSnapshot = 0;

	transport.onMessage((from, bytes) => {
		// Only the host may correct the world. Without this line any peer in the room could send a
		// snapshot and rearrange everybody else's game, which is the whole attack surface of a
		// host-authoritative design collapsed into one missing comparison.
		if (from !== hostId) return;
		const message = decode(bytes);
		// A host that says goodbye is gone NOW; there is no reason to sit out the timeout for a
		// departure it has already announced.
		if (message?.kind === 'bye') {
			sinceSnapshot = HOST_GONE_TICKS + 1;
			return;
		}
		if (message?.kind !== 'snapshot') return;
		sinceSnapshot = 0;
		predictor.reconcile(world, message.snapshot);
	});

	return {
		get replayDepth() {
			return predictor.lastReplay;
		},
		get lastCorrection() {
			return predictor.lastCorrection;
		},
		get sinceSnapshot() {
			return sinceSnapshot;
		},
		get lost() {
			return sinceSnapshot > HOST_GONE_TICKS;
		},

		tick(mine) {
			sinceSnapshot++;
			predictor.predict(world, mine);
			const { fromTick, frames } = predictor.pending();
			// Only the tail is sent. Everything older is either already confirmed or so late that the
			// host's window has closed on it, and a message that grows with the length of a bad
			// connection is the last thing a bad connection needs.
			const tail = Math.max(0, frames.length - INPUT_BACKLOG);
			transport.send(
				hostId,
				encode({ kind: 'input', fromTick: fromTick + tail, frames: frames.slice(tail) })
			);
		},

		close() {
			transport.send(hostId, encode({ kind: 'bye' }));
			transport.close();
		}
	};
}
