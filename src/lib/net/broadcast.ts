/**
 * A `Transport` between two tabs of the same browser.
 *
 * Not the multiplayer the design is for — that is WebRTC between phones, and it goes behind this
 * same interface. This is the transport that makes the rest of phase 3 BUILDABLE and, more
 * importantly, TESTABLE: `backlog/stories/04-peer-to-peer.md` asks for two real browser contexts
 * end to end rather than a fake, and until a signalling project exists there is no other way to get
 * two real browsers talking. `loopback.ts` proves the netcode; this proves the wiring, the lobby and
 * the screens, with real serialisation and a real second document.
 *
 * It is also honest about what it is not. There is no NAT, no packet loss and no latency here, so a
 * green run says nothing whatsoever about whether a connection between two phones establishes —
 * `docs/DECISIONS/0005` is explicit that localhost proves nothing about that. What it does say is
 * that everything ABOVE the network is right, so that when a real one is attached, a failure is
 * known to be the network's.
 */
import type { Transport } from './transport';

/** Presence, as a heartbeat. A tab that closes without a bye is still detected within a beat. */
const PING_MS = 400;
const GONE_MS = 1400;

/**
 * Frames the transport sends about itself, as distinct from the game's own bytes.
 *
 * Kept apart from `protocol.ts` deliberately: presence is a property of THIS transport and no other
 * one has it — Trystero reports peers itself. Folding these into the game protocol would put a
 * message on the wire that only one implementation will ever send.
 */
type Frame =
	| { kind: 'ping'; from: string }
	| { kind: 'bye'; from: string }
	| { kind: 'msg'; from: string; to: string | null; bytes: number[] };

export interface BroadcastOptions {
	/** Override the peer id. Only for tests; the default is unique per tab. */
	self?: string;
}

/**
 * @param room the room code. Two tabs in the same room see each other and nobody else.
 */
export function createBroadcastTransport(room: string, options: BroadcastOptions = {}): Transport {
	const self = options.self ?? `t${Math.random().toString(36).slice(2, 10)}`;
	const channel = new BroadcastChannel(`floe.room.${room}`);

	let onMessage: ((from: string, bytes: Uint8Array) => void) | undefined;
	let onPeerLeave: ((id: string) => void) | undefined;
	/**
	 * Closed already.
	 *
	 * A transport is closed by whoever finishes with it, and on the way out of a room that is BOTH
	 * the session — which says goodbye first — and the component that created it. Posting to a closed
	 * BroadcastChannel throws, so the second closer used to take an exception on every exit from a
	 * room. Being closed twice is not an error; it is two owners agreeing.
	 */
	let closed = false;
	/** When each peer was last heard from. */
	const seen = new Map<string, number>();

	const post = (frame: Frame) => {
		if (closed) return;
		channel.postMessage(frame);
	};

	const announce = () => post({ kind: 'ping', from: self });

	const sweep = () => {
		const now = Date.now();
		for (const [peer, at] of seen) {
			if (now - at <= GONE_MS) continue;
			seen.delete(peer);
			onPeerLeave?.(peer);
		}
	};

	channel.onmessage = (event: MessageEvent<Frame>) => {
		const frame = event.data;
		if (!frame || frame.from === self) return;

		if (frame.kind === 'bye') {
			if (seen.delete(frame.from)) onPeerLeave?.(frame.from);
			return;
		}

		// Anything heard from a peer is presence, so a busy peer never needs a separate heartbeat.
		const known = seen.has(frame.from);
		seen.set(frame.from, Date.now());
		// Answer a stranger's first ping immediately rather than waiting for the next beat, so two
		// tabs find each other in one round trip instead of in up to `PING_MS`.
		if (!known) announce();

		if (frame.kind === 'msg' && (frame.to === null || frame.to === self)) {
			onMessage?.(frame.from, new Uint8Array(frame.bytes));
		}
	};

	announce();
	const beat = setInterval(() => {
		announce();
		sweep();
	}, PING_MS);

	return {
		self,
		send(to, bytes) {
			// A plain array rather than the Uint8Array itself: structured clone would carry the whole
			// underlying ArrayBuffer, and every message here is a view into a larger one.
			post({ kind: 'msg', from: self, to, bytes: [...bytes] });
		},
		onMessage(handler) {
			onMessage = handler;
		},
		onPeerLeave(handler) {
			onPeerLeave = handler;
		},
		close() {
			if (closed) return;
			clearInterval(beat);
			// The goodbye goes out BEFORE the flag, so it is the last thing this peer says rather
			// than the first thing it swallows.
			post({ kind: 'bye', from: self });
			closed = true;
			channel.close();
		}
	};
}
