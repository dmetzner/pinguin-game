<script lang="ts">
	/**
	 * The screen between the start button and the ice: a code, who is here, and "Los!".
	 *
	 * It owns the transport and the lobby, and it hands `Game.svelte` a roster plus a factory that
	 * turns the world into a host or a client session. Game never learns which one it got, which is
	 * the point — a round is a round.
	 *
	 * Everything a child reads here is in the tested part of the codebase rather than in this file:
	 * the code comes from `net/roomCode.ts`, the roster and the timeout from `net/lobby.ts`, and the
	 * words shown when a connection does not come up are the ones `docs/DECISIONS/0005` committed to.
	 */
	import Game from '$lib/components/Game.svelte';
	import { myLook, myName } from '$lib/identity';
	import { createBroadcastTransport } from '$lib/net/broadcast';
	import {
		createLobbyClient,
		createLobbyHost,
		type LobbyClient,
		type LobbyHost,
		MAX_PLAYERS,
		type Player
	} from '$lib/net/lobby';
	import { normaliseRoomCode, roomCodeFromSeed, seedFromCode } from '$lib/net/roomCode';
	import type { ClientSession, HostSession } from '$lib/net/session';
	import { createClient, createHost } from '$lib/net/session';
	import type { Transport } from '$lib/net/transport';
	import { TICK_RATE } from '$lib/sim/constants';
	import type { World } from '$lib/sim/types';
	import { onDestroy, untrack } from 'svelte';

	interface Props {
		/** 'host' opens a room and shows its code; 'join' asks for one. */
		intent: 'host' | 'join';
		/** Back to the start screen. Called on cancel and on a failed join. */
		onLeave: () => void;
	}

	let { intent, onLeave }: Props = $props();

	// The SAME two calls `Game.svelte` makes. There used to be two readings of this with two
	// different fallbacks, so a player who had never opened "Mein Pinguin" joined a room under one
	// name and played under another — and every such player joined under the same one.
	const me = { name: myName(), look: myLook() };

	let typed = $state('');
	let code = $state<string | null>(null);
	let players = $state<readonly Player[]>([]);
	let joining = $state(false);
	let failed = $state<string | null>(null);
	/** Set once the round is under way. Everything below is fixed from here on. */
	let playing = $state<{
		seed: number;
		players: readonly Player[];
		me: string;
		makeSession: (world: World) => HostSession | ClientSession;
	} | null>(null);

	let transport: Transport | null = null;
	let host: LobbyHost | null = null;
	let client: LobbyClient | null = null;
	let beat: ReturnType<typeof setInterval> | undefined;

	/**
	 * A code nobody else is likely to be using.
	 *
	 * Not seeded from anything replayable, deliberately: this is the one place in the app where two
	 * people getting the same value is the failure. `sim/` purity does not reach here — a room code
	 * is not part of the world.
	 */
	function freshCode(): string {
		return roomCodeFromSeed(Math.floor(Math.random() * 1_000_000));
	}

	function teardown() {
		clearInterval(beat);
		beat = undefined;
		host = null;
		client = null;
		// The transport is NOT closed when the round starts: the session it handed out is still using
		// it. It is closed only on the way out.
	}

	function leave() {
		teardown();
		transport?.close();
		transport = null;
		onLeave();
	}

	function openRoom() {
		code = freshCode();
		transport = createBroadcastTransport(code);
		host = createLobbyHost(transport, me, seedFromCode(code));
		// The lobby is a plain object, not reactive state, so the roster is polled onto `players` at
		// a rate a person reads rather than at 60 Hz.
		beat = setInterval(() => {
			players = host ? [...host.players] : [];
		}, 120);
	}

	function joinRoom() {
		const cleaned = normaliseRoomCode(typed);
		if (!cleaned) {
			failed = 'Der Code stimmt nicht. Schau nochmal!';
			return;
		}
		failed = null;
		joining = true;
		code = cleaned;
		transport = createBroadcastTransport(cleaned);
		const lobby = createLobbyClient(transport, me);
		client = lobby;
		beat = setInterval(
			() => {
				// The lobby's timeout is measured in ticks, so it is driven at the simulation's rate —
				// one definition of a second for the whole app.
				for (let i = 0; i < 4; i++) lobby.tick();
				players = [...lobby.players];
				if (lobby.state === 'joined' && lobby.hostPeer && lobby.me && transport) {
					const at = transport;
					const hostPeer = lobby.hostPeer;
					const mine = lobby.me.id;
					teardown();
					playing = {
						seed: lobby.seed,
						players: lobby.players,
						me: mine,
						makeSession: (world: World) => createClient(at, world, mine, hostPeer)
					};
				} else if (lobby.state === 'failed') {
					failed = lobby.reason;
					joining = false;
					teardown();
				}
			},
			(1000 / TICK_RATE) * 4
		);
	}

	function start() {
		if (!host || !transport) return;
		const at = transport;
		const { players: roster, seed } = host.start();
		const peerIds = new Map(
			roster.filter((p) => p.peer !== at.self).map((p) => [p.peer, p.id] as const)
		);
		const mine = roster[0];
		if (!mine) return;
		teardown();
		playing = {
			seed,
			players: roster,
			me: mine.id,
			makeSession: (world: World) => createHost(at, world, mine.id, peerIds)
		};
	}

	// Read once: the route mounts a fresh Room for every visit, so an `intent` that changed under a
	// live room would be a bug rather than a case to handle.
	if (untrack(() => intent) === 'host') openRoom();

	onDestroy(() => {
		clearInterval(beat);
		transport?.close();
	});
</script>

{#if playing}
	<Game
		seed={playing.seed}
		onAgain={leave}
		opposition={{
			kind: 'net',
			players: playing.players,
			me: playing.me,
			makeSession: playing.makeSession
		}}
	/>
{:else}
	<div class="absolute inset-0 grid place-items-center p-4" data-testid="room">
		<div class="panel w-full max-w-md p-5">
			{#if intent === 'host'}
				<p class="mb-1 text-sm opacity-80">Euer Code</p>
				<!-- Enormous, because it is read out loud across a table rather than copied. -->
				<p class="mb-4 text-5xl font-extrabold tracking-[0.2em]" data-testid="room-code">{code}</p>
			{:else if !joining}
				<p class="mb-1 text-sm opacity-80">Code eingeben</p>
				<input
					class="mb-3 w-full rounded-xl border-2 border-white/50 bg-white/15 p-3 text-3xl font-extrabold tracking-[0.2em] uppercase"
					maxlength="4"
					autocapitalize="characters"
					autocomplete="off"
					spellcheck="false"
					bind:value={typed}
					data-testid="code-input"
				/>
			{:else}
				<p class="mb-4 text-2xl font-extrabold" data-testid="joining">Suche das Spiel …</p>
			{/if}

			{#if failed}
				<p class="mb-3 text-lg font-bold" data-testid="room-failed">{failed}</p>
			{/if}

			{#if players.length > 0}
				<p class="mb-1 text-sm opacity-80">Mit dabei ({players.length}/{MAX_PLAYERS})</p>
				<ul class="mb-4" data-testid="roster">
					{#each players as player (player.id)}
						<li class="text-lg font-bold">{player.name}</li>
					{/each}
				</ul>
			{/if}

			<div class="flex gap-3">
				{#if intent === 'host'}
					<button
						class="action h-14 grow text-xl disabled:opacity-40"
						onclick={start}
						disabled={players.length < 2}
						data-testid="start-round"
					>
						Los!
					</button>
				{:else if !joining}
					<button class="action h-14 grow text-xl" onclick={joinRoom} data-testid="join-room">
						Mitspielen
					</button>
				{/if}
				<button class="action h-14 w-28 text-lg" onclick={leave} data-testid="leave-room">
					Zurück
				</button>
			</div>

			{#if intent === 'host' && players.length < 2}
				<p class="mt-3 text-sm opacity-80">
					Sag den Code laut — die anderen tippen ihn bei „Mitspielen“ ein.
				</p>
			{/if}
		</div>
	</div>
{/if}
