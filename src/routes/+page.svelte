<script lang="ts">
	/**
	 * The route: which world is mounted, and the loop that gets from one to the next.
	 *
	 * Everything that is the game lives in `Game.svelte` and everything that is a room lives in
	 * `Room.svelte`; this exists to choose between them and to destroy and rebuild the one it chose.
	 * The `{#key}` has to wrap a COMPONENT rather than markup — keying a block re-creates its DOM but
	 * not the component instance, so `onMount` never runs again and the rebuilt canvas is attached to
	 * nothing. That is trap 6, and it is also the mechanism this file's whole island loop is built on:
	 * island → game → island is three mounts of the same keyed component, not a world being reset in
	 * place.
	 *
	 * The one thing that survives a mount is the ISLAND's world, and that is deliberate — see
	 * `hubWorld`. A `World` is plain data; the scene, the actors, the bots and the loop are rebuilt
	 * every time, which is the half that has ever gone wrong.
	 *
	 * The solo seed comes from the round number rather than from a clock, because `sim/` must stay
	 * replayable: a recorded round number is all it takes to get the same match back.
	 */
	import { browser } from '$app/environment';
	import { APP } from '$lib/brand';
	import Game from '$lib/components/Game.svelte';
	import { CLASSIC, ISLAND, isModeId, nextMode } from '$lib/sim/modes/registry';
	import type { Mode, World } from '$lib/sim/types';
	import Room from '$lib/components/Room.svelte';
	import { readJson, writeJson } from '$lib/storage';
	import { storageKeys } from '$lib/storageKeys';

	const FIRST_SEED = 20260815;
	/** A large odd stride, so consecutive rounds are not neighbours in the generator's sequence. */
	const SEED_STRIDE = 7919;

	/**
	 * The hub: where "Zur Insel" goes from every result screen, and the place the games are reached
	 * FROM.
	 *
	 * Naming the island here is this file's actual job — a route is the thing that says which world is
	 * mounted — and it is a NAME rather than a decision: nothing here asks which mode it has.
	 * `DEFAULT_MODE` is deliberately not used for either constant: that is what an unknown id degrades
	 * TO on the wire, and a client meeting a minigame it has never heard of should land in a round it
	 * can play rather than in a hub it might also not have.
	 */
	const HUB: Mode = ISLAND.id;

	/**
	 * **Where the app opens. This is the one line: change it to `HUB` and nothing else.**
	 *
	 * It SHOULD be `HUB`, and the argument is for the record rather than for this file. The island keeps
	 * `docs/DESIGN.md` §6's two-second promise more completely than the round it would replace, not
	 * less: a cold classic round shows "Los geht's!" and HOLDS the world until somebody presses it,
	 * where a hub is not a round (`GameMode.isRound`) and so has nothing to hold — the stick is live on
	 * the first frame and walking around IS the activity. Time to interactive goes DOWN.
	 *
	 * And it is the only arrangement in which the four games are a place rather than a menu. Reached
	 * from a button labelled with the next game's name, a mode is item three of four in a list; reached
	 * by walking east to a jetty, it is somewhere a child went. A hub that has to be navigated TO is a
	 * fifth item on that list, which is what `registry.ts` says `MODE_CYCLE` exists to avoid.
	 *
	 * It is the ISLAND, and the gate that decision waited on was a picture rather than an argument. It
	 * stayed on the classic round while the hub had visible defects in it — a teal starburst at the
	 * island's origin and a bandstand the size of a house — because those are not the first thing a
	 * child should see, and that judgement belongs in front of a screenshot rather than in code. Both
	 * were fixed and the flip was made against `shots/phone-landscape-island.png` (art director,
	 * 2026-08-21).
	 *
	 * Eleven tests in `e2e/game.spec.ts` deep-link `/?mode=classic` because they need a ROUND, and
	 * `the front door is the island` in that file asserts this line directly. `e2e/shots.spec.ts` and
	 * `e2e/island.spec.ts` deep-link every mode and are unaffected either way. If this ever goes back
	 * to a round, those eleven stay as they are — a test that says which mode it wants is better than
	 * one that inherits it, whichever way this line points.
	 */
	const FRONT_DOOR: Mode = HUB;

	type Where = 'solo' | 'friends' | 'host' | 'join';

	/**
	 * Which game to open in, and with which arrangement.
	 *
	 * `?mode=` overrides the front door and `?seed=` overrides the round's seed — which exists for
	 * `e2e/shots.spec.ts` and for anybody who has to look at the mountain twenty times in a row. A link
	 * is the only way to reach a specific mode without walking to it, and a screenshot of the wrong
	 * mode is a screenshot nobody notices is wrong.
	 *
	 * Unrecognised values are IGNORED rather than rejected: this is a query string on a game a child
	 * might have bookmarked mid-experiment, and the front door is a better answer than an error.
	 */
	function query(): URLSearchParams {
		return new URLSearchParams(browser ? window.location.search : '');
	}

	function startingMode(): Mode {
		// Through the mode register, so a mode added to `sim/modes/` is reachable by link on the day it
		// exists rather than on the day somebody remembers to extend a list here.
		const asked = query().get('mode');
		return isModeId(asked) ? asked : FRONT_DOOR;
	}

	/**
	 * The seed the FIRST round uses. Later rounds stride on from it exactly as before, so a rematch
	 * from a pinned seed is still a new arrangement rather than the same round again.
	 */
	function startingSeed(): number {
		const asked = Number(query().get('seed'));
		return Number.isFinite(asked) && asked > 0 ? Math.floor(asked) : FIRST_SEED;
	}

	/**
	 * Whichever world the front door leads to, opened INTO rather than chosen from a menu.
	 *
	 * `docs/DESIGN.md` §6 asks for a child to be playing two seconds after opening the app, and a
	 * screen that has to be answered first spends all of them. That is true of both destinations and it
	 * is what `FRONT_DOOR` is about; nothing below this line cares which one it is.
	 */
	const firstSeed = startingSeed();
	let where = $state<Where>('solo');
	let roundNumber = $state(0);

	/**
	 * Has this visit already pressed through the landing screen — or does it not need to?
	 *
	 * **A `?mode=` or `?seed=` link counts as having pressed through.** Both exist for `e2e/`,
	 * `npm run shots`, and anybody who has to look at one mode twenty times in a row (see
	 * `startingMode`'s own comment) — a link is a deliberate, complete arrival, and asking it to also
	 * dismiss a screen it did not ask for would be the query string lying about what it does. Every
	 * deep-linked test in this codebase relies on landing exactly where the link points; gating that
	 * behind a second screen would not be a stricter landing gate, it would be breaking every one of
	 * them for a screen none of them are testing.
	 *
	 * Otherwise read from storage, written back the moment "Los geht's!" is pressed (`enterGame`) —
	 * so the two-second promise still holds for anyone who has already met this screen once.
	 */
	function alreadyPastTheGate(): boolean {
		if (query().has('mode') || query().has('seed')) return true;
		return readJson(storageKeys.landingSeen, false);
	}

	let entered = $state(alreadyPastTheGate());

	/** Los geht's! — dismiss the gate, and remember not to ask again. */
	function enterGame() {
		entered = true;
		writeJson(storageKeys.landingSeen, true);
	}

	/** Which world is mounted right now. */
	let mode = $state<Mode>(startingMode());

	/** A fresh mount for every visit to a room, so nothing from the last one survives into the next. */
	let visit = $state(0);

	/**
	 * Has this visit started a round yet?
	 *
	 * The first one waits for "Los geht's!" and every one after it does not — a rematch is a decision
	 * already made, and so is a mode switch by somebody who is already playing, and so is walking up
	 * to a door and pressing the green button. Tied to having ASKED FOR a round rather than to the
	 * round counter, because cycling modes bumps that counter and would otherwise start a round the
	 * moment somebody looked at Royal.
	 */
	let everStarted = $state(false);

	/**
	 * The island as it was left, or null when nobody has left it.
	 *
	 * **Not `$state`.** `$state` deep-proxies a plain object, and this one is a `World` that the
	 * simulation mutates sixty times a second: every read and write in `step.ts` would go through a
	 * proxy, and the penguin the renderer draws would not be the object identity the sim holds. It does
	 * not need to be reactive either — it is read once, while the keyed block below is being created,
	 * and that creation is driven by `roundNumber`.
	 *
	 * Why keep it at all: rebuilding the island on the way back would put the player on the square, so
	 * the walk to the mountain would be undone by the mountain. Standing where you left is what makes
	 * the island a place rather than a level that reloads.
	 */
	let hubWorld: World | null = null;

	/**
	 * The world the NEXT mount carries on with instead of building one, consumed by that mount.
	 *
	 * Cleared by every other transition, so a rematch, a mode switch and a room all get exactly what
	 * they got before this file learned about the island: a fresh world.
	 *
	 * `$state.raw`, not `$state`, and the difference is not a nicety: plain `$state` deep-proxies the
	 * object it holds, and this one is a `World` that `step.ts` mutates sixty times a second — every
	 * read and write in the simulation would go through a proxy, and the penguin the renderer holds
	 * would not be the identity the simulation does. Raw state is reactive on ASSIGNMENT, which is all
	 * this needs: the markup below reads it while the keyed block is being created.
	 */
	let carryOn = $state.raw<World | undefined>(undefined);

	/**
	 * Take a door: the game on the other side, and the world to come back to.
	 *
	 * `opens` came from the mode's own descriptor (`GameMode.doorUnder`), so this file never learns
	 * which door leads where. Bumping `roundNumber` is what remounts `Game.svelte` — the same mechanism
	 * a rematch and a mode switch already use, and the reason there is nothing bespoke here to get
	 * wrong.
	 */
	function enter(opens: Mode, leaving: World) {
		hubWorld = leaving;
		carryOn = undefined;
		mode = opens;
		// The green button at the door WAS the decision. Asking again with "Los geht's!" would be the
		// same question twice, which is how a confirm turns into a menu.
		everStarted = true;
		roundNumber++;
	}

	/**
	 * Go home, from anywhere.
	 *
	 * Offered on every solo result screen rather than only after a game entered through a door, and
	 * that is a dead-end fix rather than a flourish: a player who reached a game by `?mode=` link, or
	 * who came back from a room, would otherwise have no route to the island at all except reloading
	 * the page.
	 *
	 * With a remembered island it resumes it, standing the player at the door they left from. Without
	 * one it builds a fresh island, which is exactly what opening the app does.
	 */
	function goHome() {
		carryOn = hubWorld ?? undefined;
		hubWorld = null;
		mode = HUB;
		roundNumber++;
	}

	/**
	 * Another round — or, in a hub, the same place rebuilt around a penguin that has changed.
	 *
	 * `Game.svelte` passes a world only where carrying one is right (see its `onAgain`), so this does
	 * not have to know which case it is in.
	 */
	function again(carrying?: World) {
		carryOn = carrying;
		roundNumber++;
	}

	function go(next: Where) {
		visit++;
		where = next;
	}
</script>

{#if where === 'solo'}
	{#key roundNumber}
		<Game
			seed={firstSeed + roundNumber * SEED_STRIDE}
			{mode}
			resume={carryOn}
			autoStart={everStarted}
			onStart={() => (everStarted = true)}
			onAgain={again}
			onEnter={enter}
			onLeave={goHome}
			onFriends={() => go('friends')}
			onMode={() => {
				// Round and round, in the order `MODE_CYCLE` lists them — inside the games only; the
				// island hides this button, because its doors are the way in and two ways in is the menu
				// the island exists to replace. A cycle rather than four buttons, because the row beside
				// the game is already four wide on a 568 px screen.
				mode = nextMode(mode);
				// It is NOT remembered any more, and that is a consequence of the front door rather than a
				// feature removed: `floe.mode` used to be what the app opened in, and the app now opens
				// where a child arrives instead. A key that is written and never read is the smell
				// `storageKeys.ts` exists to prevent, so the write went with the reader.
				// A new round, because the world is built at mount: switching mode has to rebuild it,
				// and `{#key roundNumber}` is what does that.
				carryOn = undefined;
				roundNumber++;
			}}
		/>
	{/key}

	<!-- **The landing gate.** Placed AFTER `<Game>` in the document on purpose — the joystick's touch
	     zone is the whole left half of the screen and paint order follows DOM order for two
	     `position: absolute` siblings with no `z-index` fight between them, which is the same rule
	     `CLAUDE.md`'s traps 4/12/18 are all about. Coming later here is what makes this cover the
	     controls rather than the controls swallowing its own tap.

	     The scene renders and idles underneath the whole time — nothing here holds the world, unlike
	     `Game.svelte`'s own "Los geht's!", because the island has nothing to hold (`isRound` is
	     false, the stick would be live even if this panel were not here) and a rendered, moving island
	     behind frosted glass says "this is alive" in the two seconds before anybody presses anything.

	     `.overlay` on its own PASSES TAPS THROUGH outside its centred child — that is the whole point
	     of the class everywhere else it is used, so a result panel does not also disable the button
	     row in the corner behind it. This is the documented exception: a layer that is MEANT to
	     block sets `pointer-events: auto` back on itself, exactly like the customise sheet and the
	     rotate card do, and for the same reason — the stick underneath is live and must not be. -->
	{#if !entered}
		<div class="overlay landing-blocks" data-testid="landing">
			<div class="panel px-8 py-7 text-center">
				<p class="text-3xl font-extrabold">{APP.name}</p>
				<p class="mt-1 text-sm opacity-80">{APP.tagline}</p>
				<button
					class="action cta mt-5 h-16 w-56 text-xl"
					onclick={enterGame}
					data-testid="landing-play"
				>
					Los geht's!
				</button>
				<!-- Three small links rather than three paragraphs: this screen's one job is the button
				     above it, and `docs/DESIGN.md` §6 survives having a landing screen at all only
				     because it stays this light. -->
				<p class="mt-4 flex justify-center gap-3 text-xs opacity-70">
					<a href="/info">Für Eltern</a>
					<a href="/datenschutz">Datenschutz</a>
					<a href="/impressum">Impressum</a>
				</p>
			</div>
		</div>
	{/if}
{:else if where === 'host' || where === 'join'}
	{#key visit}
		<Room intent={where} onLeave={() => go('solo')} />
	{/key}
{:else}
	<!-- One question, asked only once somebody has asked for it: start a game or join one. -->
	<div class="absolute inset-0 grid place-items-center p-4" data-testid="friends-screen">
		<div class="panel w-full max-w-md p-6 text-center">
			<!-- Rendered from `brand.ts`, never spelled. That is invariant 5 and `brand.test.ts` scans
			     for it: the name is one file plus some copy, not a rename across the tree. -->
			<p class="mb-5 text-3xl font-extrabold">{APP.name}</p>
			<div class="mb-3 flex gap-3">
				<button class="action h-16 grow text-xl" onclick={() => go('host')} data-testid="play-host">
					Spiel starten
				</button>
				<button class="action h-16 grow text-xl" onclick={() => go('join')} data-testid="play-join">
					Mitspielen
				</button>
			</div>
			<button
				class="action h-12 w-full text-base"
				onclick={() => go('solo')}
				data-testid="play-solo"
			>
				Doch alleine
			</button>
		</div>
	</div>
{/if}

<style>
	/* See the markup comment beside `data-testid="landing"`: `.overlay` passes taps through by
	   design, and this is the documented exception that turns it back off, the same way the
	   customise sheet and the rotate card do. */
	.landing-blocks {
		pointer-events: auto;
	}

	/* The landing gate's three links only — everywhere else in the game a link would be out of
	   place, so this stays local rather than joining `app.css`. */
	.overlay a {
		color: var(--on-panel-dim);
		text-decoration-thickness: 1px;
		text-underline-offset: 2px;
	}
</style>
