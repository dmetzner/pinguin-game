/**
 * A network made of nothing, for tests.
 *
 * Messages go into a queue stamped with the tick they should arrive on, and `deliver` hands over
 * everything due. Time is a TICK COUNT rather than a clock, for the same reason the simulation
 * measures it that way: a test that waits on real milliseconds is a test that fails on a loaded CI
 * runner, and this one wants to run six hundred ticks of a round in a few milliseconds.
 *
 * Latency and loss are the point. A loopback with neither would prove only that the code compiles:
 * every interesting bug in prediction — the correction that fights the player, the input hole, the
 * snapshot applied out of order — needs a message to be late, lost, or reordered before it appears.
 * Loss is drawn from the simulation's own seeded RNG, so a failure is reproducible.
 */
import { createRng } from '../sim/rng';
import type { Transport } from './transport';

export interface LoopbackOptions {
	/** One-way delay, in ticks. 5 is about 83 ms, which is a bad-but-real phone connection. */
	latencyTicks?: number;
	/** Extra delay, in ticks, drawn uniformly per message. Jitter reorders as well as delays. */
	jitterTicks?: number;
	/** Fraction of messages dropped outright, 0..1. */
	loss?: number;
	seed?: number;
}

export interface Loopback {
	/** A transport for one peer. Call once per peer, before any traffic. */
	peer(id: string): Transport;
	/** Advance one tick and hand over everything that has arrived. */
	deliver(): void;
	/** How many messages have been dropped so far, so a test can prove its loss was not vacuous. */
	readonly dropped: number;
	readonly sent: number;
}

interface Parcel {
	at: number;
	to: string;
	from: string;
	bytes: Uint8Array;
}

export function createLoopback(options: LoopbackOptions = {}): Loopback {
	const latency = options.latencyTicks ?? 0;
	const jitter = options.jitterTicks ?? 0;
	const loss = options.loss ?? 0;
	const rng = createRng(options.seed ?? 1);

	const peers = new Map<
		string,
		{ message?: (from: string, bytes: Uint8Array) => void; leave?: (id: string) => void }
	>();
	let queue: Parcel[] = [];
	let now = 0;
	let dropped = 0;
	let sent = 0;

	const post = (from: string, to: string, bytes: Uint8Array) => {
		sent++;
		if (loss > 0 && rng.next() < loss) {
			dropped++;
			return;
		}
		const delay = latency + (jitter > 0 ? Math.floor(rng.next() * (jitter + 1)) : 0);
		queue.push({ at: now + delay, to, from, bytes });
	};

	return {
		get dropped() {
			return dropped;
		},
		get sent() {
			return sent;
		},

		peer(id) {
			const entry = {};
			peers.set(id, entry);
			return {
				self: id,
				send(to, bytes) {
					if (to === null) {
						for (const other of peers.keys()) if (other !== id) post(id, other, bytes);
					} else if (peers.has(to)) {
						post(id, to, bytes);
					}
				},
				onMessage(handler) {
					Object.assign(entry, { message: handler });
				},
				onPeerLeave(handler) {
					Object.assign(entry, { leave: handler });
				},
				close() {
					peers.delete(id);
					for (const other of peers.values()) other.leave?.(id);
					// Messages ADDRESSED to a peer that has gone are dropped — there is nobody left to
					// hand them to. Messages already sent BY it are not: they are on the wire, and an
					// orderly goodbye is precisely a message sent immediately before closing. Dropping
					// those too made `close()` swallow the very frame it had just posted, which would
					// have hidden a bug rather than modelled one.
					queue = queue.filter((p) => p.to !== id);
				}
			};
		},

		deliver() {
			now++;
			const due = queue.filter((p) => p.at <= now);
			queue = queue.filter((p) => p.at > now);
			for (const parcel of due) peers.get(parcel.to)?.message?.(parcel.from, parcel.bytes);
		}
	};
}
