/**
 * Getting into a room, and failing to.
 *
 * Everything before the first tick: who is here, what they are called, which slot each of them holds
 * in the roster every later message indexes by, and — the half that matters most — what happens when
 * the connection simply does not come up.
 *
 * `docs/DECISIONS/0005` is blunt about that last part: roughly one connection in five to ten over
 * mobile data will never establish, because WebRTC needs a TURN server when both ends are behind
 * carrier-grade NAT and there is no free, reliable one. The decision was to FAIL HONESTLY. That is
 * a design commitment, so the timeout and the reason live here in the tested part rather than in a
 * component, and `reason` is written for a nine-year-old to act on rather than to report.
 *
 * Time is a tick count, like everywhere else in this codebase. The caller drives `tick()` at 60 Hz
 * from the same loop that drives the game, so the lobby cannot disagree with the round about how
 * long a second is, and a test can run a two-second timeout in microseconds.
 */
import type { PenguinLook } from '../look';
import { NAME_COMBINATIONS, nameFromSeed } from '../names';
import { TICK_RATE } from '../sim/constants';
import { decode, encode } from './protocol';
import type { Transport } from './transport';

/**
 * How long a client waits for a host to answer before saying so.
 *
 * Eight seconds. Long enough for ICE to finish on a connection that is going to work at all —
 * gathering candidates and checking pairs is usually under three — and short enough that a child
 * does not sit looking at a spinner wondering whether they typed the code wrong. Both halves of that
 * matter: the failure message offers to let somebody else host, and an offer nobody waits for is
 * not an offer.
 */
export const JOIN_TIMEOUT_TICKS = TICK_RATE * 8;

/** The largest room the design allows, host included. `docs/DESIGN.md` §2. */
export const MAX_PLAYERS = 6;

export interface Player {
	/** The transport's id for this peer. The host's own entry uses its own transport id. */
	peer: string;
	/** The penguin id in the world. Slot order, so it is stable and index-addressable. */
	id: string;
	name: string;
	look: PenguinLook;
}

export type JoinState = 'connecting' | 'joined' | 'failed';

export interface LobbyHost {
	/** Everyone in the room, host first. The order every snapshot indexes by once `start` is called. */
	readonly players: readonly Player[];
	readonly full: boolean;
	/**
	 * Close the room and tell everybody who is in it.
	 *
	 * After this the roster is fixed: a peer arriving later is not admitted, because admitting one
	 * would renumber the slots every message in flight is already using.
	 */
	start(): { players: readonly Player[]; seed: number };
	readonly started: boolean;
}

/**
 * @param seed derived from the room code by `seedFromCode`, so every peer already agrees on it.
 *   It is sent anyway: a client that guessed the code differently should find out here rather than
 *   by playing a round on a different arrangement of the ice.
 */
export function createLobbyHost(
	transport: Transport,
	me: { name: string; look: PenguinLook },
	seed: number
): LobbyHost {
	const players: Player[] = [{ peer: transport.self, id: 'p0', name: me.name, look: me.look }];
	let started = false;

	/**
	 * A name nobody in this room is already using.
	 *
	 * 1156 names against six players is a collision about once in seventy-seven rooms — small, and
	 * not small enough: two identical tags over two heads in one round is the single failure the
	 * whole generator exists to prevent, and it is unexplainable to the child it happens to. The
	 * replacement is drawn from the slot number, so it is the same on every device that recomputes
	 * it and it never collides with the one already taken.
	 */
	const distinctName = (wanted: string, slot: number): string => {
		if (!players.some((p) => p.name === wanted)) return wanted;
		for (let attempt = 0; attempt < NAME_COMBINATIONS; attempt++) {
			const candidate = nameFromSeed(seed + slot * 7919 + attempt * 104_729);
			if (!players.some((p) => p.name === candidate)) return candidate;
		}
		return wanted;
	};

	const sendWelcome = (peer: string) => {
		const player = players.find((p) => p.peer === peer);
		if (!player || peer === transport.self) return;
		transport.send(
			peer,
			encode({
				kind: 'welcome',
				seed,
				you: players.indexOf(player),
				roster: players.map((q) => ({ id: q.id, name: q.name, look: q.look }))
			})
		);
	};

	transport.onMessage((from, bytes) => {
		const message = decode(bytes);
		if (message?.kind !== 'hello') return;

		// A hello from somebody already in the room is a re-send, and after the start it is the
		// client saying it never got its welcome. Answering it again is what stops a single lost
		// packet from hanging a join for ever: the client re-announces twice a second, so the pair
		// keeps retrying until one round trip gets through. The first version sent the welcome
		// exactly once, and a client whose copy was dropped sat in 'connecting' until it timed out —
		// which reads to a child as "the code did not work" when in fact they were already in.
		if (players.some((p) => p.peer === from)) {
			if (started) sendWelcome(from);
			return;
		}

		// A stranger arriving after the start is not admitted: renumbering the slots would move every
		// penguin in every message already in flight. Silence rather than a refusal — the peer is
		// about to time out and show its own message, which says something a child can act on.
		if (started || players.length >= MAX_PLAYERS) return;
		players.push({
			peer: from,
			id: `p${players.length}`,
			// Names and looks come from the generator and the picker, and a peer can only ever set its
			// OWN. There is no free text anywhere in this — see `docs/DECISIONS/0004`.
			name: distinctName(message.name, players.length),
			look: message.look
		});
	});

	transport.onPeerLeave((peer) => {
		// Only before the start. Afterwards a departure is the round's business, not the lobby's:
		// removing a player would renumber every slot behind them.
		if (started) return;
		const at = players.findIndex((p) => p.peer === peer);
		if (at > 0) players.splice(at, 1);
		for (const [i, p] of players.entries()) p.id = `p${i}`;
	});

	return {
		get players() {
			return players;
		},
		get full() {
			return players.length >= MAX_PLAYERS;
		},
		get started() {
			return started;
		},
		start() {
			started = true;
			for (const p of players) sendWelcome(p.peer);
			return { players, seed };
		}
	};
}

export interface LobbyClient {
	readonly state: JoinState;
	/** German, and written to be acted on rather than reported. Empty until `state` is 'failed'. */
	readonly reason: string;
	/** The transport id of whoever sent the welcome. Null until joined. */
	readonly hostPeer: string | null;
	readonly players: readonly Player[];
	/** Which slot this client holds, and therefore which penguin it may predict. */
	readonly me: Player | null;
	readonly seed: number;
	/** Advance by one tick. Drive this at 60 Hz; the timeout is measured in ticks. */
	tick(): void;
}

/**
 * Announce yourself and wait to be let in.
 *
 * The hello goes to the whole room rather than to a named host, because a client does not know which
 * peer is hosting until one answers — and the peer that answers with a welcome IS the host, for the
 * rest of the session.
 */
export function createLobbyClient(
	transport: Transport,
	me: { name: string; look: PenguinLook },
	timeoutTicks = JOIN_TIMEOUT_TICKS
): LobbyClient {
	let state: JoinState = 'connecting';
	let reason = '';
	let hostPeer: string | null = null;
	let players: Player[] = [];
	let mine: Player | null = null;
	let seed = 0;
	let waited = 0;

	const hello = encode({ kind: 'hello', name: me.name, look: me.look });
	transport.send(null, hello);

	transport.onMessage((from, bytes) => {
		const message = decode(bytes);
		if (message?.kind !== 'welcome' || state === 'joined') return;
		hostPeer = from;
		seed = message.seed;
		players = message.roster.map((entry, i) => ({
			peer: i === message.you ? transport.self : from,
			id: entry.id,
			name: entry.name,
			look: entry.look
		}));
		mine = players[message.you] ?? null;
		// A welcome that does not say which penguin is mine is not a welcome I can play in.
		state = mine ? 'joined' : 'failed';
		if (!mine) reason = 'Da ist etwas schiefgegangen. Probiert es nochmal!';
	});

	return {
		get state() {
			return state;
		},
		get reason() {
			return reason;
		},
		get hostPeer() {
			return hostPeer;
		},
		get players() {
			return players;
		},
		get me() {
			return mine;
		},
		get seed() {
			return seed;
		},
		tick() {
			if (state !== 'connecting') return;
			waited++;
			// Re-announce twice a second. The hello can be sent before the data channel to the host
			// has finished opening, in which case it goes nowhere and nothing ever asks again — a
			// join that hangs on a message lost in the first half-second is the commonest way this
			// fails, and it is entirely avoidable.
			if (waited % (TICK_RATE / 2) === 0) transport.send(null, hello);
			if (waited < timeoutTicks) return;
			state = 'failed';
			// The words the design asks for. It names something to DO — the failure is a property of
			// the pair of devices, not of either one, so a different host very often works — and it
			// does not blame the child or use a word like "Verbindungsfehler".
			reason = 'Klappt nicht — probiert’s im WLAN, oder lasst jemand anderen das Spiel starten!';
		}
	};
}
