/**
 * The one thing the game asks of a network.
 *
 * Four methods, and deliberately no WebRTC anywhere near them. Trystero sits behind this interface
 * and so does the loopback in `loopback.ts`, which is what makes the whole of phase 3 testable: a
 * host and two clients can be run in one process, over a channel with whatever latency and loss the
 * test wants, and nothing in `session.ts` can tell the difference.
 *
 * `docs/DECISIONS/0005` warns that localhost proves nothing about NAT traversal, and it does not —
 * this seam is not a claim that the game works over a real network. It is what lets everything ABOVE
 * the network be proved before a real network is involved, so that when one is, a failure is known
 * to be the network's.
 */
export interface Transport {
	/** This peer's own id. Stable for the life of the connection. */
	readonly self: string;
	/** Send to one peer, or to every peer when `to` is null. */
	send(to: string | null, bytes: Uint8Array): void;
	/** Every message that arrives, with the peer it came from. Replaces any previous handler. */
	onMessage(handler: (from: string, bytes: Uint8Array) => void): void;
	/** A peer went away — deliberately or by dropping out. Replaces any previous handler. */
	onPeerLeave(handler: (id: string) => void): void;
	close(): void;
}
