import { describe, expect, it } from 'vitest';
import { DEFAULT_LOOK, lookFromSeed } from '../look';
import { nameFromSeed } from '../names';
import { TICK_RATE } from '../sim/constants';
import {
	createLobbyClient,
	createLobbyHost,
	JOIN_TIMEOUT_TICKS,
	type LobbyClient,
	MAX_PLAYERS
} from './lobby';
import { createLoopback, type Loopback } from './loopback';
import { seedFromCode } from './roomCode';

const SEED = seedFromCode('DUKE');

/** A host and `count` clients, all announcing themselves, run until everybody has settled. */
function joinRoom(count: number, options: Parameters<typeof createLoopback>[0] = {}) {
	const loop: Loopback = createLoopback(options);
	const host = createLobbyHost(loop.peer('H'), { name: nameFromSeed(1), look: DEFAULT_LOOK }, SEED);
	const clients: LobbyClient[] = [];
	for (let i = 0; i < count; i++) {
		clients.push(
			createLobbyClient(loop.peer(`C${i}`), {
				name: nameFromSeed(i + 2),
				look: lookFromSeed(i + 2)
			})
		);
	}

	const run = (ticks: number) => {
		for (let t = 0; t < ticks; t++) {
			for (const c of clients) c.tick();
			loop.deliver();
		}
	};

	return { loop, host, clients, run };
}

describe('filling a room', () => {
	it('lets everybody in and gives each of them a slot', () => {
		const { host, clients, run } = joinRoom(3, { latencyTicks: 2 });
		run(20);
		expect(host.players).toHaveLength(4);

		host.start();
		run(10);

		for (const [i, c] of clients.entries()) {
			expect(c.state).toBe('joined');
			expect(c.hostPeer).toBe('H');
			// The slot is what every later message indexes by, so agreeing on it is the whole point of
			// the handshake. Client i is slot i + 1, behind the host.
			expect(c.me?.id).toBe(`p${i + 1}`);
			expect(c.players).toHaveLength(4);
		}
	});

	it('agrees on the roster, in the same order, on every device', () => {
		// A snapshot names penguins BY INDEX. If two devices disagree about the order, every position
		// in every snapshot lands on the wrong penguin — and it would look like a physics bug.
		const { host, clients, run } = joinRoom(3, { latencyTicks: 2, jitterTicks: 2 });
		run(30);
		host.start();
		run(20);

		const asHostSeesIt = host.players.map((p) => `${p.id}:${p.name}`);
		for (const c of clients) {
			expect(c.players.map((p) => `${p.id}:${p.name}`)).toEqual(asHostSeesIt);
		}
	});

	it('agrees on the seed without anybody having to compute it twice', () => {
		const { host, clients, run } = joinRoom(2, { latencyTicks: 1 });
		run(15);
		host.start();
		run(10);
		for (const c of clients) expect(c.seed).toBe(SEED);
		expect(SEED).toBe(seedFromCode('DUKE'));
	});

	it('turns a seventh player away rather than overfilling the floe', () => {
		const { host, clients, run } = joinRoom(MAX_PLAYERS, { latencyTicks: 1 });
		run(20);
		expect(host.players).toHaveLength(MAX_PLAYERS);
		expect(host.full).toBe(true);

		host.start();
		run(JOIN_TIMEOUT_TICKS + 10);

		// The one who did not get in is told, in the same words as any other failure — from where a
		// child is standing, "full" and "would not connect" are the same problem with the same fix.
		const turnedAway = clients.filter((c) => c.state === 'failed');
		expect(turnedAway).toHaveLength(MAX_PLAYERS - (MAX_PLAYERS - 1));
		expect(turnedAway[0]?.reason).toMatch(/WLAN|anderen/);
	});

	it('retries rather than hanging on one lost message', () => {
		// The commonest way a join fails for real, and it has two halves. The hello can leave before
		// the data channel to the host has finished opening, so it goes nowhere; and the welcome
		// answering it can be the message that is lost instead. Either one, sent once, hangs the join
		// until the timeout. A third of everything is dropped here, so both happen.
		const { loop, host, clients, run } = joinRoom(1, { latencyTicks: 1, loss: 0.35, seed: 3 });
		run(TICK_RATE * 2);
		expect(loop.dropped).toBeGreaterThan(0);
		expect(host.players).toHaveLength(2);

		host.start();
		run(TICK_RATE * 3);
		expect(clients[0]?.state).toBe('joined');
	});
});

describe('a room nobody answers', () => {
	it('gives up after the timeout and says something a child can act on', () => {
		// `docs/DECISIONS/0005` costs the whole feature on failing honestly: roughly one connection in
		// five to ten over mobile data will never establish, and there is no free TURN server to fix
		// it. So the message names something to DO, and does not say "Verbindungsfehler".
		const loop = createLoopback({ latencyTicks: 1 });
		const client = createLobbyClient(loop.peer('C'), {
			name: nameFromSeed(9),
			look: DEFAULT_LOOK
		});

		for (let t = 0; t < JOIN_TIMEOUT_TICKS - 1; t++) {
			client.tick();
			loop.deliver();
		}
		// Still trying right up to the edge. Giving up early is the same failure as never giving up.
		expect(client.state).toBe('connecting');

		client.tick();
		expect(client.state).toBe('failed');
		expect(client.reason).toContain('WLAN');
		// The offer that makes the failure actionable: it is a property of the PAIR of devices, so a
		// different host very often works where this one did not.
		expect(client.reason).toContain('anderen');
		expect(client.reason).not.toMatch(/error|Fehler/i);
	});

	it('waits about eight seconds — long enough for ICE, short enough for an eight-year-old', () => {
		expect(JOIN_TIMEOUT_TICKS / TICK_RATE).toBe(8);
	});
});

describe('what the lobby will not do', () => {
	it('ignores a hello that arrives after the round has started', () => {
		// Admitting one would renumber the slots that every message already in flight is using.
		const { host, run, loop } = joinRoom(1, { latencyTicks: 1 });
		run(10);
		host.start();

		const late = createLobbyClient(loop.peer('LATE'), {
			name: nameFromSeed(77),
			look: DEFAULT_LOOK
		});
		for (let t = 0; t < JOIN_TIMEOUT_TICKS + 5; t++) {
			late.tick();
			loop.deliver();
		}

		expect(host.players).toHaveLength(2);
		expect(late.state).toBe('failed');
	});

	it('counts one peer once, however many times it says hello', () => {
		const { host, run } = joinRoom(1, { latencyTicks: 1, loss: 0 });
		// Long enough that the client's own re-announcement has fired several times.
		run(TICK_RATE * 3);
		expect(host.players).toHaveLength(2);
	});

	it('never lets two penguins carry the same name', () => {
		// 1156 names against six players collides about once in seventy-seven rooms. Two identical
		// tags over two heads in one round is the one failure the whole generator exists to prevent,
		// and it is unexplainable to the child it happens to.
		const loop = createLoopback({ latencyTicks: 1 });
		const host = createLobbyHost(
			loop.peer('H'),
			{ name: 'Kringel Fips', look: DEFAULT_LOOK },
			SEED
		);
		for (let i = 0; i < 3; i++) {
			// Everybody arrives insisting on exactly the same name.
			createLobbyClient(loop.peer(`C${i}`), { name: 'Kringel Fips', look: DEFAULT_LOOK });
		}
		for (let t = 0; t < 20; t++) loop.deliver();

		const names = host.players.map((p) => p.name);
		expect(names).toHaveLength(4);
		expect(new Set(names).size).toBe(4);
		// The one who asked first keeps it; nobody is renamed who did not have to be.
		expect(names[0]).toBe('Kringel Fips');
		// And every replacement is still a real generated name rather than a decorated one.
		for (const name of names) expect(name).toMatch(/^[\p{L}’]+ [\p{L}’]+$/u);
	});

	it('closes the gap when somebody leaves before the start', () => {
		// Slots have to stay contiguous and in order, because they are array indices from `start`
		// onwards. A hole would put every penguin behind it one place out.
		const loop = createLoopback({ latencyTicks: 1 });
		const host = createLobbyHost(loop.peer('H'), { name: 'Käpt’n Fips', look: DEFAULT_LOOK }, SEED);
		const first = loop.peer('C0');
		const second = loop.peer('C1');
		createLobbyClient(first, { name: nameFromSeed(3), look: DEFAULT_LOOK });
		createLobbyClient(second, { name: nameFromSeed(4), look: DEFAULT_LOOK });
		for (let t = 0; t < 10; t++) loop.deliver();
		expect(host.players.map((p) => p.id)).toEqual(['p0', 'p1', 'p2']);

		first.close();
		for (let t = 0; t < 5; t++) loop.deliver();
		expect(host.players.map((p) => p.id)).toEqual(['p0', 'p1']);
		expect(host.players[1]?.peer).toBe('C1');
	});
});
