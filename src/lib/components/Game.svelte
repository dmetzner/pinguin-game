<script lang="ts">
	/**
	 * One round: the simulation, the renderer, the controls and the result.
	 *
	 * A COMPONENT rather than part of the route, and that is the whole mechanism behind "Nochmal".
	 * A rematch destroys this and mounts a fresh one, so every object from the last round — world,
	 * scene, actors, bots, latched inputs — is disposed and rebuilt. Cruder than resetting a world
	 * in place and far harder to get wrong: there is no chance of a stale snowball, a leftover stun
	 * or a penguin still mid-fall bleeding into the next round.
	 *
	 * The first attempt put `{#key}` around the markup inside the route instead. That re-creates the
	 * DOM but NOT the component instance, so `onMount` never ran a second time: "Nochmal" swapped the
	 * canvas for an identical one attached to nothing, and the game simply froze. An end-to-end test
	 * caught it rather than a person.
	 *
	 * It owns no Three.js object, no presentation constant and no maths: the round lives in
	 * `sim/round.ts`, the opposition in `sim/bot.ts`, everything visible in `render/`.
	 */

	/**
	 * Who else is on the ice, and who decides what happens.
	 *
	 * `solo` builds bots. `net` is handed a roster the lobby already agreed on and a factory that
	 * wraps the world in a host or a client session — Game never learns which, because from here the
	 * difference is one function that advances a tick.
	 */
	type Opposition =
		| { kind: 'solo' }
		| {
				kind: 'net';
				players: readonly { id: string; name: string; look: PenguinLook }[];
				/** The local penguin's id. It is a slot from the roster, not the literal 'me'. */
				me: string;
				/**
				 * Wrap the world in a host or a client session.
				 *
				 * `lost` is a client's only way to know the host has gone — no snapshot is not an
				 * event — and a host never sets it, which is why it is optional rather than a branch.
				 */
				makeSession: (world: World) => {
					tick: (mine: InputFrame) => void;
					close: () => void;
					readonly lost?: boolean;
				};
		  };

	interface Props {
		/** Seeds the whole round. A different one makes a rematch a new arrangement, not a rerun. */
		seed: number;
		/**
		 * Called when the player asks for another round.
		 *
		 * `carrying` is a world the new mount should carry on with rather than build, and it is only ever
		 * passed for a HUB: a look changed on the island has to remount to be visible, and a remount
		 * that rebuilt the island would put the player back on the square — moved across the island by
		 * changing a hat. In a round the opposite is true and the argument is absent: a fresh round is
		 * the whole point of "Nochmal".
		 *
		 * Which is why the buttons below call it as `() => onAgain()` rather than handing it straight to
		 * `onclick`: a handler passed by name receives the MouseEvent as its first argument, and this one
		 * would have taken that for a world. TypeScript caught it; nothing at runtime would have.
		 */
		onAgain: (carrying?: World) => void;
		/** Bots, or a room. Defaults to bots, so the solo game is what you get by asking for nothing. */
		opposition?: Opposition;
		/** Shown as "Mit Freunden" between rounds. Left out inside a room, where it makes no sense. */
		onFriends?: () => void;
		/**
		 * Which game this round is: the classic floe, a Royal, or the slide.
		 *
		 * Royal and slide are solo for now — the netcode sends one floe (`net/snapshot.ts`), and a
		 * whole sea over the wire is its own slice of `backlog/stories/06-pingu-royal.md`.
		 */
		mode?: Mode;
		/** Move to the next game. The route restarts the round, because the world is built at mount. */
		onMode?: () => void;
		/**
		 * A world to carry on with, rather than one built fresh at mount.
		 *
		 * The hub, and only the hub. Entering a game from the island destroys this component and mounts
		 * a new one for the minigame — trap 6 is why that is the mechanism and not a reset in place —
		 * and coming back mounts a third. Rebuilding the island each time would put the player back on
		 * the square, so the walk to the mountain would be undone by the mountain.
		 *
		 * A `World` is plain data: no Three.js object, no listener, no clock. The scene, the actors, the
		 * bots, the latched input and the loop are all still built and disposed per mount, which is the
		 * part that has ever gone wrong. What survives is where the penguin was standing.
		 *
		 * The route holds it (`onEnter` hands it over) and never touches it — invariant 2's spirit, one
		 * level up: whoever is not simulating does not write.
		 */
		resume?: World;
		/**
		 * The player confirmed a door, and what is on the other side of it.
		 *
		 * `opens` is a mode id from the descriptor's own `Door`, so this component never learns which
		 * mode has doors or which door leads where. The second argument is the world being left, for
		 * `resume` above.
		 */
		onEnter?: (opens: Mode, leaving: World) => void;
		/**
		 * The way back to wherever this round was started from, or absent when there is nowhere to go.
		 *
		 * Passed only by a route that is holding a hub world, which is how the result screen offers
		 * "Zur Insel" after a game entered from the island and does not after one started cold. The
		 * component asks no questions about it: somebody gave it a way back, so it offers one.
		 */
		onLeave?: () => void;
		/**
		 * Start the round without asking.
		 *
		 * False on the FIRST visit only. `docs/DESIGN.md` §6 asks for a child to be playing within two
		 * seconds of opening the app, and this looks like it breaks that — it does not: the ice, the
		 * penguins and the sea are all on screen while the button waits, so opening the game still
		 * shows the game. What it stops is a round that has already started counting down at somebody
		 * who has not looked at the screen yet, which is how a first visit was losing before it began
		 * (Daniel, 2026-08-17).
		 *
		 * A rematch passes true: "Nochmal" is a decision that has already been made.
		 */
		autoStart?: boolean;
		/** Called the moment this round actually starts, so the route can stop asking. */
		onStart?: () => void;
	}

	/**
	 * The look and name are read once at mount and baked into the actors, so a change has to restart
	 * the round to be visible. That is why "Fertig" calls `onAgain` when anything actually changed —
	 * cheaper and far more honest than rebuilding a live actor's materials mid-round, and the only
	 * places the sheet can be opened from are the countdown and the result screen, where restarting
	 * costs nothing.
	 */
	let lookChanged = false;

	let {
		seed,
		onAgain,
		opposition = { kind: 'solo' },
		onFriends,
		mode = DEFAULT_MODE,
		onMode,
		resume,
		onEnter,
		onLeave,
		autoStart = true,
		onStart
	}: Props = $props();

	/**
	 * Whether the world is allowed to advance yet.
	 *
	 * The loop runs from the first frame either way — the sea moves, the camera is where it will be,
	 * the penguins are standing on the ice — and this decides whether TIME does. Holding the world
	 * rather than delaying the loop is what makes pressing Play instant: there is nothing left to
	 * build when it is pressed.
	 *
	 * A mode that is not a ROUND is never held: there is no countdown to run at somebody who has not
	 * looked at the screen yet, and the hub's whole promise is that walking around IS playing — a
	 * button in front of the island would spend exactly the two seconds `docs/DESIGN.md` §6 is about.
	 * `spec` below is the same lookup; this one is inline because a `$state` initialiser cannot read a
	 * `const` declared after it.
	 */
	let running = $state(untrack(() => autoStart || !modeFor(mode).isRound));

	/**
	 * **The way out of a round that is still going.**
	 *
	 * The exits this screen had were both conditional on the round being over FOR YOU: the result
	 * panel's pair, and the sideline pair behind `iAmOut`. On the mountain neither can ever appear —
	 * `SLIDE.overboard` is `recoverOnTheCourse`, so a racer is never `out`, and `phase` stays
	 * `playing` for the full fifty seconds. Daniel was stuck inside a broken slide twice with no
	 * button anywhere on the screen (2026-08-22), which is trap 4's family for the sixth time and the
	 * only version of it where the button was never written rather than covered.
	 *
	 * It is a PAUSE rather than a bare "leave", for two reasons that pull the same way. A mis-tap on a
	 * bare exit throws away a race that was going well, and this row lives in the corner a thumb
	 * reaches for the fullscreen button; and a child who wants to stop looking at the screen for a
	 * moment has, until now, had no way to do that either.
	 *
	 * It does not halt a NET round — see `advance`. A client that stops stepping while the host does
	 * not is a client that has to be corrected by every snapshot for as long as it is paused, and the
	 * correction is exactly the 0.69 m of disagreement `session.test.ts` refused. There the panel is
	 * a door and nothing else, which is also the honest thing to show: the game genuinely is still
	 * going without you.
	 */
	let paused = $state(false);

	/**
	 * How close the sea lion has to be before the HUD says so, in metres.
	 *
	 * Wider than the growl's threshold in `audio/cues.ts` on purpose: the sound is an EVENT and this
	 * is a STATE, so the number appears a moment before the noise and stays for as long as the danger
	 * does.
	 */
	const HUNTER_WARN = 12;

	/**
	 * Everything this round's mode decides, in one object.
	 *
	 * It used to be three `Record<Mode, …>` tables in this file plus a dozen `mode === 'slide'`
	 * comparisons scattered through the draw loop and the markup. `sim/modes/registry.ts` owns all of
	 * it now, and `sim/modes/guard.test.ts` scans `src/` to keep it that way: whatever a comparison was
	 * asking, the descriptor answers. A sixth minigame does not touch this component at all.
	 *
	 * Read ONCE, like `ME` and `running`: this component is one round, and a mode that changed under a
	 * live game would be a bug rather than a case to handle — the route remounts it instead.
	 */
	const spec = untrack(() => modeFor(mode));

	/**
	 * Is this mode a RACE along a course, rather than a fight in an arena?
	 *
	 * Four things follow from it: the camera turns with the route, the lens widens with speed, the HUD
	 * counts places instead of survivors, and an eliminated penguin is hidden rather than parked on a
	 * chunk of ice. Named here because it is asked four times in the draw loop — but it is DERIVED from
	 * the camera policy the registry declares rather than from a list of modes.
	 */
	const racing = untrack(() => spec.framing === 'bearing');

	/**
	 * Is this mode a HUB — a place with doors in it — rather than a game?
	 *
	 * `spec.doorUnder` is a capability, so asking whether the mode has one is the whole question. Three
	 * things follow, and each of them is the hub being a place rather than a round: the buttons in the
	 * top corner stay up while it is being played (there is no round for them to cover, and they are
	 * the only way to the sound, the penguin sheet and a room), the mode-switch button goes away (the
	 * doors are the way in now, and two ways in is the menu the island exists to replace), and the
	 * readout says where you are instead of how many are left.
	 */
	const hub = untrack(() => spec.doorUnder !== null);

	/**
	 * Does the camera sit behind the PLAYER rather than over the ice they are standing on?
	 *
	 * The classic rig frames the floe (`docs/DESIGN.md` §4 — following the player hides the rival about
	 * to shove them). An island is one 58 m disc, so framing the ice would frame the whole island and
	 * draw its penguin at two percent of the screen, and the player would walk off the edge of a frame
	 * that never moved. `framing: 'follow'` is the registry saying so; this is the one place that acts
	 * on it, and the same shape as `racing` above.
	 */
	const follows = untrack(() => spec.framing === 'follow');

	/** The mode the switch button offers, which is always the next one round the registry's cycle. */
	const offered = untrack(() => modeFor(nextMode(mode)));

	import { onMount, untrack } from 'svelte';
	import Joystick from '$lib/components/Joystick.svelte';
	import NpcSpeech from '$lib/components/Speech.svelte';
	import { indexOfIslander } from '$lib/npc/cast';
	import { createConversation, type Speech } from '$lib/npc/talk';
	import { type Action, createActionLatch } from '$lib/input/actions';
	import { actionFromKey, keyRole, moveFromKeys } from '$lib/input/keyboard';
	import { startLoop } from '$lib/render/loop';
	import Customise from '$lib/components/Customise.svelte';
	import Profile from '$lib/components/Profile.svelte';
	import { createCueWatcher } from '$lib/audio/cues';
	import { APP } from '$lib/brand';
	import { getSound, type Sound } from '$lib/audio/sound';
	import { earn, eisFor, myEis } from '$lib/eis';
	import { hasLeftTheIgloo, iglooStage, nextStep, priceOf } from '$lib/igloo';
	import Igloo from '$lib/components/Igloo.svelte';
	import { IGLOO_VIEW, iglooPlot, iglooSpec } from '$lib/render/igloo';
	import {
		enterFullscreen,
		exitFullscreen,
		fullscreenSupported,
		isFullscreen
	} from '$lib/fullscreen';
	import {
		myLook as identityLook,
		myName as identityName,
		setMyLook,
		setMyName
	} from '$lib/identity';
	import { lookFromSeed, type PenguinLook, resolveLook } from '$lib/look';
	import { nameFromSeed, namesFromSeed } from '$lib/names';
	import { createActor } from '$lib/render/penguin';
	import type { Preview } from '$lib/render/preview';
	import { floeOffsetY } from '$lib/render/floeField';
	import { createScene, type SceneHandles } from '$lib/render/scene';
	import { createBot, type Difficulty } from '$lib/sim/bot';
	import { dashReadiness } from '$lib/sim/combat';
	import { COUNTDOWN_TICKS, G, SLIDE_DRAG, SLIDE_GRADE, TICK_RATE } from '$lib/sim/constants';
	import { type Door, DEFAULT_MODE, modeFor, nextMode } from '$lib/sim/modes/registry';
	import { alive, canRestart } from '$lib/sim/round';
	import { spectatorSpots } from '$lib/sim/spectate';
	import { step } from '$lib/sim/step';
	import type { InputFrame, Mode, RoundPhase, Vec2, World } from '$lib/sim/types';
	import { NO_INPUT } from '$lib/sim/types';
	import { heading, length, scale, sub } from '$lib/sim/vec';
	import { breakWarning, floeUnder, groundHeight, mainFloe, seaRadius } from '$lib/sim/archipelago';
	import { alongCourse, pointAlong, shoreOf } from '$lib/sim/chase';
	import { finishOf } from '$lib/sim/slide';
	import { createWorld, findPenguin } from '$lib/sim/world';

	/**
	 * The local penguin. In a room it is whichever slot the lobby handed out.
	 *
	 * Read once and never again, and `untrack` says so rather than leaving a warning to be ignored:
	 * this component IS one round. A different room or a different seed remounts it, so an
	 * `opposition` that changed underneath a live game would be a bug, not a case to handle.
	 */
	const ME = untrack(() => (opposition.kind === 'net' ? opposition.me : 'me'));

	/**
	 * The opposition. Bots now, where story 01 had motionless dummies.
	 *
	 * Easy by default and not configurable yet — a difficulty picker is a menu, and the game does not
	 * have one. `createBot` already takes the level, so that is a UI task rather than a design one.
	 */
	const RIVAL_IDS = untrack(() => {
		// The count IS the mode, and the mode says so: `players.solo` is how many penguins a
		// single-player round of it is played with. In a Royal that decides the size of the SEA as well
		// as the size of the crowd — `sim/archipelago.ts` deals one floe per three penguins — and on the
		// mountain it is who else is on the start line.
		const others = Math.max(0, spec.players.solo - 1);
		return Array.from({ length: others }, (_, i) => `bot${i + 1}`);
	});
	const DIFFICULTY: Difficulty = 'easy';

	/**
	 * Penguin id → the name on its tag. Filled at mount, read only by the result screen.
	 *
	 * Not `$state`: it is written once while the actors are built and never changes within a round,
	 * and a reactive Map here would invalidate the HUD on every insert for no reader.
	 */
	const nameOf = new Map<string, string>();

	/**
	 * The player's look and name, loaded once and written back on every change.
	 *
	 * Read through `coerceLook`, so a look stored by an older build degrades to something wearable
	 * rather than throwing on the way to the first frame — and through the guarded `storage`, so a
	 * locked-down school tablet with `localStorage` disabled plays with the defaults instead of
	 * failing to start.
	 */
	let myLook = $state<PenguinLook>(identityLook());
	let myName = $state<string>(identityName());
	let customising = $state(false);
	/**
	 * Is the profile sheet open?
	 *
	 * Separate from `customising` rather than one "which sheet" enum, because the two are reached from
	 * different places and one opens the other: the profile is who you are, the look editor is what you
	 * look like, and "Aussehen ändern" hands over from the first to the second.
	 */
	let profiling = $state(false);

	function setLook(next: PenguinLook) {
		myLook = next;
		lookChanged = true;
		setMyLook(next);
	}

	function rerollName() {
		// Seeded from the current name so consecutive rolls differ; `sim/` purity does not apply
		// here — this is a UI affordance, not part of the world.
		myName = nameFromSeed((myName.length * 7919 + Math.floor(Math.random() * 65535)) | 0);
		lookChanged = true;
		setMyName(myName);
	}

	let canvas = $state<HTMLCanvasElement | null>(null);

	/**
	 * The renderer, once it exists, and the sheet's portrait once there is one to paint.
	 *
	 * The customise sheet borrows the GAME's renderer for its turntable rather than opening a second
	 * WebGL context — see `render/preview.ts` for what the second one cost. So the scene has to leave
	 * `onMount`'s closure, and the round's draw loop has to know about a preview that may appear at
	 * any moment and vanish again.
	 */
	let sceneHandles = $state<SceneHandles | null>(null);
	let portrait: Preview | null = null;
	let failure = $state<string | null>(null);

	/** Written by the joystick, read once per tick. Not reactive state the loop depends on. */
	let move: Vec2 = $state({ x: 0, z: 0 });
	/** Presses land here and are drained once per tick — see `input/actions.ts`. */
	const actions = createActionLatch();

	/**
	 * The keyboard: the same three buttons and the same steering, for a machine with no thumb on it.
	 *
	 * The mapping is in `input/keyboard.ts` and is pure; this is the events and nothing else. `held`
	 * is a plain Set rather than `$state` for the same reason `move` is not derived: it is read once
	 * per tick by the loop, and making it reactive would invalidate the HUD on every keystroke for a
	 * value no piece of markup reads.
	 */
	const held = new Set<string>();
	let keyMove: Vec2 = { x: 0, z: 0 };
	/** Set by the first bound key, so the hint can name keys to somebody who is using them. */
	let usingKeys = $state(false);
	/** A pointer that can be precise — a mouse or a trackpad. A fact about the machine, read once. */
	let hasMouse = $state(false);
	/**
	 * Is the phone being held upright?
	 *
	 * Watched rather than read once, because a child turns a phone mid-game and this decides what the
	 * door says. Named `tall` because `portrait` in this file is already the customise sheet's turntable
	 * — a collision worth avoiding rather than disambiguating.
	 *
	 * The same instrument the rotate card uses (`app.css` drives it from `@media (orientation:
	 * portrait)`) and the same one `hasMouse` uses, so the interface and the CSS cannot disagree about
	 * which way up the phone is. NOT the Screen Orientation API, which iOS Safari does not implement.
	 */
	let tall = $state(false);

	onMount(() => {
		hasMouse = window.matchMedia('(pointer: fine)').matches;

		const upright = window.matchMedia('(orientation: portrait)');
		tall = upright.matches;
		const turned = () => (tall = upright.matches);
		upright.addEventListener('change', turned);

		// The same rule the controls block in the markup follows, and for the same reason: once the
		// round is over the simulation ignores input, so a live control is a lie — and while the
		// customise sheet is open the keys belong to ITS buttons, where Space is "press the thing you
		// tabbed to" and must not be a jump the player cannot see.
		const live = () => phase !== 'over' && !hostGone && !customising && !profiling && !building;

		const down = (event: KeyboardEvent) => {
			// A combination belongs to the browser and to the operating system — Cmd-W closes the tab,
			// Alt-F4 closes the window. Swallowing those to jump would be a game that cannot be left.
			if (event.ctrlKey || event.metaKey || event.altKey) return;
			if (!keyRole(event.code)) return;
			// Noted BEFORE the round is consulted: whether this player has a keyboard is a fact about
			// the machine, not about whether the game is currently listening. It decides which
			// instructions the hint shows, and a key pressed on the result screen answers the question
			// just as well as one pressed mid-round.
			usingKeys = true;
			if (!live()) return;
			// Space scrolls the page, and the arrows scroll it further; a game whose jump button also
			// scrolls the screen out from under the canvas is the oldest bug on the web. Only ever for
			// keys the game acts on, which is what a null `keyRole` rules out above.
			event.preventDefault();
			// Auto-repeat is the operating system typing. Held Space would latch thirty jumps a second
			// where a held button latches one per press, so the desk player would get a different game
			// from the phone player — `input/actions.ts` is about exactly this.
			if (event.repeat) return;
			held.add(event.code);
			keyMove = moveFromKeys(held);
			const action = actionFromKey(event.code);
			// The third button, on a keyboard, in front of a door: the same slot that takes the confirm
			// on screen. On the island there are no snowballs (`spec.throwing` is false), so the key that
			// throws one has nothing to do — and a key that does nothing in the one place a child is
			// being asked a question is the keyboard half of trap 4. Consumed rather than latched, so
			// the simulation is never asked for a throw that would be an entry.
			if (action === 'throw' && doorHere?.opens) {
				enterDoor();
				return;
			}
			if (action) actions.press(action);
		};

		// Deliberately NOT gated on `live()`: a key pressed during the round and released on the
		// result screen still has to come back up, or the next thing that reads `held` finds a key
		// nobody is touching.
		const up = (event: KeyboardEvent) => {
			if (!held.delete(event.code)) return;
			keyMove = moveFromKeys(held);
		};

		// Alt-tab away mid-slide and the keyup lands in another window; without this the penguin keeps
		// walking in the direction it was last asked for and goes over the rim on its own. The desk
		// version of the `pointercancel` rule in `Joystick.svelte`, and the same failure.
		const release = () => {
			if (held.size === 0) return;
			held.clear();
			keyMove = { x: 0, z: 0 };
		};

		window.addEventListener('keydown', down);
		window.addEventListener('keyup', up);
		window.addEventListener('blur', release);
		return () => {
			window.removeEventListener('keydown', down);
			window.removeEventListener('keyup', up);
			window.removeEventListener('blur', release);
			upright.removeEventListener('change', turned);
		};
	});

	// Readouts. Updated once every few frames rather than every frame — see the throttle below.
	// The phase a fresh world of THIS mode opens in, not a guess at one. The readout below is polled
	// every sixth frame, so a hard-coded 'countdown' is a hundred milliseconds of a giant "3" painted
	// over an island that has nothing to count down to.
	let phase = $state<RoundPhase>(untrack(() => spec.opening));
	/** Seconds left on the countdown, rounded up, so it reads 3 · 2 · 1 rather than 2 · 1 · 0. */
	let countdown = $state(3);
	/**
	 * Who won, as the NAME over the penguin's head — never the id.
	 *
	 * `world.round.winner` is a penguin id, and solo those ids are `bot1`, `bot2`, `bot3`. The
	 * result screen printed one verbatim, so the game announced "bot2 gewinnt" about a penguin
	 * wearing "Flauschi Flosse" on its name tag for the whole round. A child has no way to connect
	 * the two, and the id is an implementation detail that should never have been on screen.
	 * `nameOf` (built at mount from the same source the tags use) is the one translation.
	 */
	/**
	 * The name the round is calling the local player, as it appears on the tag over their own head.
	 *
	 * Written once while the actors are built, and NOT the same thing as `myName`: in a room the
	 * roster is the authority and the lobby renames a duplicate. The countdown names the player with
	 * this so the line and the tag agree.
	 */
	let myShownName = $state('');
	let winner = $state<string | null>(null);
	let iWon = $state(false);
	let restartable = $state(false);
	let standing = $state(0);
	/** On the slide: which place the local penguin is in, and how many are still racing. */
	let place = $state(1);

	/**
	 * The door the local penguin is standing in, or null for the open island.
	 *
	 * A LOOKUP, polled with the rest of the readout, not an event: `sim/modes/mode.ts` argues why, and
	 * the practical half is that there is no "entered" to miss and no "left" to leak, so a door cannot
	 * get stuck open because a tick was dropped. Standing in one is the only way to be offered a game
	 * and pressing the button is the only way to take it — crossing the square on the way to the
	 * mountain must never launch a thirty-penguin Royal.
	 *
	 * Null for every mode that has no doors, because `spec.doorUnder` is null there and this is never
	 * assigned anything else.
	 */
	let doorHere = $state<Door | null>(null);

	/**
	 * Who is talking to the player right now, or null.
	 *
	 * `npc/talk.ts` owns the whole conversation; this is only where the answer lands so the bubble
	 * can read it. Assigned once a tick, in `inputs()`, which is where the rest of this component
	 * already reads world state before stepping it — never in `draw()`, which runs once a FRAME and
	 * would otherwise call `poll` far more often than a line can change.
	 */
	let speech = $state<Speech | null>(null);

	/**
	 * The game on the other side of that door, or null when there is nothing behind it yet.
	 *
	 * Der Laden is a place before it is a screen (story 10d), and `Door.opens` is null for it — so the
	 * sign appears and the button does not. A button that is visible, pressable and dead is trap 4, and
	 * this repo has paid for it four times.
	 */
	const doorGame = $derived(doorHere?.opens ? modeFor(doorHere.opens) : null);

	/**
	 * Eis in hand, and what THIS round paid.
	 *
	 * Read once at mount, which is all it takes for the number to be right: every trip out of the hub
	 * and back is a fresh mount (trap 6 is why), so the island always draws the total as it stands.
	 *
	 * `justEarned` is the moment rather than the balance — a child needs to see the number they won,
	 * not only a bigger total than the one they had stopped looking at.
	 */
	let eis = $state(untrack(() => myEis()));
	let justEarned = $state(0);

	/**
	 * How many rungs of the igloo are paid for, and therefore whether there is anything to spend on.
	 *
	 * Read once at mount like the total, for the same reason: every trip out of the hub and back is a
	 * fresh mount. It becomes `$state` rather than a constant because a purchase happens inside the
	 * build sheet while this component is alive — the sheet hands back what it changed, and this is what
	 * it changes.
	 */
	let stage = $state(untrack(() => iglooStage()));

	/**
	 * Can this child afford the next thing, and is there a next thing?
	 *
	 * The price comes from `lib/igloo.ts` and is never typed here: `priceOf` is `(n + 2)²` WINS, derived
	 * from `eis.ts`'s two payout constants, so re-tuning either one moves the ladder and this hint
	 * together. A 40 copied into this file would still say 40 on the afternoon somebody doubles the win
	 * bonus, and the hint would appear at half an afternoon's work.
	 */
	const canBuild = $derived(nextStep(stage) !== null && eis >= priceOf(stage));

	/** The build sheet, which is the only place a purchase happens. */
	let building = $state(false);
	/**
	 * Looking INSIDE the igloo.
	 *
	 * A framing and not a screen: the same follow camera, closer, with the shells on the camera's side
	 * left out (`render/igloo.ts`). So this is one boolean rather than a mode — and it has to end when
	 * the player walks away, which is what `hasLeftTheIgloo` answers. A peek that only a button could
	 * end would be a room a child gets stuck in.
	 */
	let inside = $state(false);
	/** Where the plot is, for the walking-away test. A fact about the island, read once. */
	const plot = untrack(() => iglooPlot());

	/**
	 * Has this round been paid for yet?
	 *
	 * A plain latch, not `$state`: the readout below is polled about ten times a second and the round is
	 * over for all of them, so without this a thirty-second result screen would pay three hundred times.
	 * One mount is one round, which is what makes a boolean enough.
	 */
	let credited = false;

	/**
	 * The world this mount is simulating, for the two handlers that live outside `onMount`'s closure.
	 *
	 * Not `$state`: nothing in the markup reads it, and a reactive world would invalidate the HUD
	 * sixty times a second for every field of it.
	 */
	let liveWorld: World | null = null;

	/**
	 * Take the door. The one deliberate act that leaves the island.
	 *
	 * The world goes with it, so coming back stands the player where they left rather than back on the
	 * square — see `resume`. Both guards are real: `opens` is null in front of an unbuilt door, and
	 * `onEnter` is absent for a route that has nowhere to send anybody.
	 */
	function enterDoor() {
		const opens = doorHere?.opens;
		if (!opens || !liveWorld) return;
		onEnter?.(opens, liveWorld);
	}

	/**
	 * How far ahead of the sea lion the local penguin is, in metres, or null when it does not matter.
	 *
	 * The danger in a chase is BEHIND the player and the camera looks forward, which is the one
	 * arrangement where a child can be a second from losing with nothing on screen saying so. The
	 * growl (`audio/cues.ts`) says it once; this says it continuously, in the same place and the same
	 * colour as "Scholle bricht!", because it is the same kind of fact.
	 */
	let hunterLead = $state<number | null>(null);

	/**
	 * How far the shore still is, in metres, in a chase. Null in every other mode.
	 *
	 * A chase runs two hundred metres in a straight line and the far end is over the horizon for most
	 * of it, so without this the mode is "run away from something forever" — which is a nightmare
	 * rather than a game. A number that goes down is the difference between fleeing and arriving.
	 */
	let shoreLeft = $state<number | null>(null);
	let swimming = $state(false);
	let stunned = $state(false);
	/**
	 * The local penguin is out of the round, and the round is still going.
	 *
	 * Distinct from `swimming`, which is the second and a half of falling in. Being OUT lasts until
	 * the round ends and is the state that was invisible: the camera stays on the arena, the
	 * eliminated penguin reappears on its own chunk of ice at the side, and nothing said in words
	 * that this was no longer a penguin the stick could move. "Platsch!" is a splash, not a verdict.
	 */
	let iAmOut = $state(false);
	/** 0..1, for the ring that drains on the dash button. */
	let dashReady = $state(1);
	/**
	 * Seconds until the ice under the local player breaks, or null when it is not going to.
	 *
	 * The crack, the shudder and the sound all say this too, and it is still worth saying in words:
	 * they are all things happening at the player's feet while they are looking at somebody about to
	 * shove them. A number counting down is the one form of it that survives not being looked at.
	 */
	let breakIn = $state<number | null>(null);
	/**
	 * The host has stopped answering.
	 *
	 * Only ever true in a room, and it takes precedence over the round's own result: a client with
	 * nothing correcting it goes on predicting a game nobody is running, and "Nochmal" on that screen
	 * would restart nothing at all.
	 */
	let hostGone = $state(false);
	/**
	 * The page's sound, and a mirror of its mute for the button's label.
	 *
	 * `audio/sound.ts` owns whether the sound is off and persists it; this is a copy that exists so
	 * Svelte has something to re-render on. Three copies of the fact used to be kept in step by hand
	 * — one here, one in storage, one inside the device — and `toggleMute` had to write all of them.
	 */
	const sound: Sound = getSound();
	let muted = $state(sound.muted);

	/**
	 * One handler for all three buttons.
	 *
	 * The haptic is the only thing that differs, and it differs on purpose: a shove should feel
	 * heavier in the hand than a snowball. `navigator.vibrate` is guarded because iOS has never
	 * implemented it and a missing API should not be an exception in the input path.
	 */
	const press = (action: Action, buzz: number) => () => {
		actions.press(action);
		navigator.vibrate?.(buzz);
	};

	function toggleMute() {
		sound.toggle();
		muted = sound.muted;
	}

	/**
	 * The fullscreen control, and why it exists when the first tap already asks.
	 *
	 * Three cases the automatic path cannot serve, and each of them is somebody's whole experience
	 * of the game: a player who left fullscreen with the system gesture and wants it back, a desktop
	 * browser (where auto-entering on a click would be a liberty — `lib/fullscreen.ts`), and an
	 * installed app, where there is nothing to ask for and the button correctly disappears.
	 *
	 * `canFullscreen` is read once at mount rather than on every render: it is a fact about the
	 * browser, and reading `document` during SSR would throw — except SSR is off here, which is
	 * exactly the kind of coupling worth not relying on.
	 */
	let canFullscreen = $state(false);
	let full = $state(false);

	function toggleFullscreen() {
		if (isFullscreen()) void exitFullscreen();
		else void enterFullscreen();
	}

	onMount(() => {
		// Whether the button is offered at all, and whether it currently says "enter" or "leave".
		// `fullscreenchange` covers every way out that is not this button — Escape, the Android back
		// gesture, the system swipe — without which the icon would go on claiming the screen was
		// full while the address bar was plainly back.
		canFullscreen = fullscreenSupported() && !isFullscreen();
		full = isFullscreen();
		const onFullscreenChange = () => {
			full = isFullscreen();
		};
		document.addEventListener('fullscreenchange', onFullscreenChange);

		if (!canvas) {
			return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
		}

		let scene: SceneHandles;
		try {
			scene = createScene(canvas);
			sceneHandles = scene;
		} catch (error) {
			// A device with no WebGL gets a sentence it can act on rather than a blank blue screen.
			// School tablets and locked-down browsers are exactly the audience this game has.
			failure =
				error instanceof Error ? error.message : 'WebGL ist auf diesem Gerät nicht verfügbar.';
			return;
		}

		const roster =
			opposition.kind === 'net' ? opposition.players.map((p) => p.id) : [ME, ...RIVAL_IDS];
		// The hub carried back in, or a fresh world. `resume` is only ever the world THIS route handed
		// out at the same mode, so the descriptor read at the top of this file still describes it.
		const world = resume ?? createWorld(roster, seed, mode);
		liveWorld = world;
		// Bots only in the solo game. In a room every penguin has a person behind it, and a bot would
		// be a second way into `step` — which is exactly what `docs/DECISIONS/0001` keeps out.
		const bots =
			opposition.kind === 'solo'
				? RIVAL_IDS.map((id) => createBot(id, DIFFICULTY, world.seed))
				: [];
		// Walking up to somebody on the island, and them saying something — `null` everywhere else,
		// which is the whole gate: there is no cast off the island (`hub` is false) and no bots to be
		// one in a room (`bots` is empty above), so `conversation` staying null there is a fact about
		// the world rather than a special case written here.
		const conversation = hub && opposition.kind === 'solo' ? createConversation(world.seed) : null;
		// Solo, the opposition gets its names and looks from the round seed, so a rematch brings a
		// different crowd and a shared seed brings the same one on every device. In a room the names
		// came from the people, through the lobby.
		const rivalNames = namesFromSeed(seed, RIVAL_IDS.length);
		// Resolved once, by id rather than by index. In phase 0 the local player IS penguins[0]; the
		// moment bots join, index 0 is whichever spawn slot the array built first and the failure is
		// silent — the HUD reports a bot's speed and the respawn revives a bot.
		const me = findPenguin(world, ME);
		if (!me) throw new Error('the world was built without the local penguin');

		// One actor per penguin — the loop story 02 needs, arriving one story early because combat
		// needs someone to hit. A plain array rather than a Map: it is only ever iterated in order,
		// and destructuring Map entries allocates a pair per actor per frame.
		const actors: { id: string; actor: ReturnType<typeof createActor> }[] = [];
		for (const [i, p] of world.penguins.entries()) {
			const mine = p.id === ME;
			// In a room the ROSTER is the authority, for the local penguin as much as for anybody
			// else. That is not a detail: the lobby renames a player whose name is already taken, and
			// a client that kept reading its own name out of storage would be the only device in the
			// room that called it something different — including in the tag over its own head.
			// Solo, the rivals are drawn from the round seed, so the same seed brings the same crowd.
			const listed =
				opposition.kind === 'net' ? opposition.players.find((q) => q.id === p.id) : undefined;
			const shown = listed?.name ?? (mine ? myName : (rivalNames[i - 1] ?? p.id));
			// The SAME string the tag over the head carries, kept so the result screen can name the
			// winner the way the round did. Anything that reads `round.winner` and puts it on screen
			// goes through here: those ids are `bot1`..`bot3` solo, and a child cannot connect
			// "bot2 gewinnt" to the penguin labelled "Flauschi Flosse" they were just chasing.
			nameOf.set(p.id, shown);
			// `mine` is what puts the arrow over the head and the ring on the ice. It is the same flag
			// the look is chosen with, so the marked penguin and the customised one cannot drift apart.
			const actor = createActor(
				resolveLook(listed?.look ?? (mine ? myLook : lookFromSeed(seed + i * 6151))),
				shown,
				mine,
				// On the mountain a penguin travels on its belly. Everywhere else it walks.
				spec.onTheBelly
			);
			// The name the round is going to call the local player, for the line under the countdown:
			// in a room the lobby may have renamed them, and telling a child they are "Flauschi Flosse"
			// while every tag says "Flauschi Flosse 2" is worse than saying nothing.
			if (mine) myShownName = shown;
			actors.push({ id: p.id, actor });
			scene.addActor(p.id, actor);
		}

		// Derived from the world rather than emitted by it — see `audio/cues.ts` for why a client's
		// replay makes an event list the wrong shape entirely.
		// The horizon, sized to this round's sea. Scenery, and the only scenery there is: it exists so
		// the eye can judge how far away the next floe is. Not on the slide — a chute two hundred
		// metres long would drag its own ring of icebergs down the mountain with it.
		// No island, unless this mode's ground IS one. Unconditional and FIRST, which is what makes the
		// teardown safe to state out loud: `setIsland(null)` restores the sea's own haze, so the same
		// call at the end of the chute arm would undo the mountain fade `setCourse` had just set — the
		// slide reading washed out was a whole session once. Before the chain it is a no-op on a fresh
		// scene (this component mounts one per mode, so there has never been an island to remove) and
		// still correct for the scene that outlives a mode change one day, which is exactly what the
		// verb is for.
		scene.setIsland(null);
		if (spec.scenery === 'route') {
			// A line two hundred metres long, so the horizon is placed around the MIDDLE of it rather
			// than around a start line the player leaves in the first seconds.
			const route = shoreOf(world)?.along ?? 0;
			scene.setSea(route * 0.5, seed, route);
			// The blocks, from the course the simulation is running.
			scene.setBlocks(world.floes);
		} else if (spec.scenery === 'chute') {
			scene.setCourse(world.floes);
			// The water goes to the bottom of the mountain, so the whole chute is above it and the
			// finish is the shoreline. Left at zero it swallows the course from the second segment on.
			scene.setSeaLevel(finishOf(world)?.altitude ?? 0);
		} else if (spec.scenery === 'hub') {
			// The island itself: 116 m of terrain, built once from the floe the simulation is standing on
			// — the square, the jetty, the mountain and its gondola, the cave and the shop. It draws its
			// own ground and hides the floe field, because a hub that drew both would be an ice disc
			// inside an island, z-fighting along every hill (`SceneHandles.setIsland`).
			//
			// The floe the simulation is standing on rather than one built here: the terrain IS a plot of
			// `groundHeight` for that floe, so the hill a child climbs and the hill they can see are one
			// object described twice — the same rule `moundsFor` established for a Royal's icebergs.
			scene.setIsland(world.floes[0] ?? null);
			// The horizon still belongs to the hub: the island sits IN a sea, and without a ring of bergs
			// beyond the shore it reads as a diorama on a table.
			scene.setSea(seaRadius(world), seed);
		} else {
			scene.setSea(seaRadius(world), seed);
		}

		const cues = createCueWatcher();

		/** The floe the camera is framing. Kept across a jump, so open water never re-frames. */
		let framed = mainFloe(world);

		/** The penguin still in the round nearest to this one — who a spectator's snowball goes at. */
		const nearestAlive = (from: { pos: Vec2 }): Vec2 => {
			let best = from.pos;
			let bestSq = Infinity;
			for (const p of world.penguins) {
				if (p.phase !== 'skating') continue;
				const d = (p.pos.x - from.pos.x) ** 2 + (p.pos.z - from.pos.z) ** 2;
				if (d < bestSq) {
					bestSq = d;
					best = p.pos;
				}
			}
			return best;
		};

		// In a room the session owns the tick: a client predicts and is corrected, a host steps the
		// world with everybody's inputs. Game never learns which it is holding.
		const session = opposition.kind === 'net' ? opposition.makeSession(world) : null;

		let resizeAgain: ReturnType<typeof setTimeout> | undefined;
		const resize = () => scene.setSize(window.innerWidth, window.innerHeight);
		// iOS fires `resize` before the URL bar has finished collapsing, so the canvas ends up sized
		// to a viewport that no longer exists. A second pass after the animation catches it.
		const reorient = () => {
			resize();
			clearTimeout(resizeAgain);
			resizeAgain = setTimeout(resize, 350);
		};
		resize();
		window.addEventListener('resize', resize);
		window.addEventListener('orientationchange', reorient);

		// The map is reused; the FRAME inside it is not — `actions.take()` builds a fresh one every
		// tick, deliberately. See `input/actions.ts` for why that allocation is worth keeping.
		const inputMap = new Map<string, InputFrame>();

		let hudFrame = 0;

		/**
		 * Where the eliminated are watching from, and which way they are facing.
		 *
		 * Recomputed only when somebody new goes in the water: `spectatorSpots` is a pure function of
		 * the world and its answer does not change again once a penguin has surfaced, so running it
		 * sixty times a second would allocate two maps a frame for a result that is already known.
		 */
		let spots = new Map<string, Vec2>();
		let facings = new Map<string, number>();
		let watched = -1;

		// One reused frame for every spectator. The actor is parented to its own chunk of ice, so the
		// position it wants is the chunk's origin rather than anything the interpolator produced —
		// which is also why the penguin bobs with the ice instead of hanging in the air above it.
		const onTheChunk = { x: 0, z: 0, height: 0, facing: 0, penguin: me };
		/** No tilt and no offset: what a spectator's own chunk of ice is, as a surface. */
		const LEVEL = { x: 0, z: 0 };

		/**
		 * Where a following camera is aimed, reused rather than allocated.
		 *
		 * One object per frame is sixty a second and thirty-six hundred a minute, for a value that is
		 * read by `setFocus` and thrown away — the same reason the spectator frame above is reused.
		 */
		const followAt = { x: 0, z: 0 };

		/**
		 * How far from the framed floe a penguin still gets the full treatment, in metres.
		 *
		 * Sixteen is a little beyond the neighbouring floes, so everyone the player could interact
		 * with — including the ones about to jump across — is animated properly, and the two thirds of
		 * a Royal that are somewhere else in the sea cost a position and a heading. It is the
		 * difference between thirty penguins' worth of gait maths a frame and about eight.
		 */
		const DETAIL_RANGE = 16;

		/**
		 * Which way the camera is facing, radians, and how fast it turns to follow the run.
		 *
		 * Zero except on the slide. The STICK is rotated by the same number (`inputs()` below), so a
		 * player pushing up is always asking to go down the mountain however far round the course has
		 * turned — which is the only arrangement that works with a rig that moves.
		 */
		let bearing = 0;
		const BEARING_CHASE = 0.05;

		const loop = startLoop({
			world,
			inputs() {
				// Keys beat the stick, and only while they are actually asking for something. Either
				// order works when one device is idle; this one is right when both are not, because a
				// stick is a thing a player can leave pushed against the edge of the screen with a
				// mouse button while reaching for the keyboard, and a key is a thing they are holding.
				const asked = keyMove.x !== 0 || keyMove.z !== 0 ? keyMove : move;
				// Turned to match the camera — by ASKING the camera, rather than by keeping a second copy of
				// its angle here.
				//
				// This was a hand-written 2×2 against a local `bearing`, and that is the whole reason two
				// approved camera changes sat unshipped for a day. The rig's rotation and the thumb's
				// rotation were two numbers that happened to agree, so any NEW rotation had to remember to
				// update both — and forgetting made every control in that mode wrong by the difference,
				// which is trap 15 exactly. `scene.steer` answers from the rotation the renderer actually
				// applied, so the two cannot disagree; and the renderer refuses to apply any rotation of
				// its own until this call has been made once, which is what made the switch safe in one
				// step. That guard is not theoretical: this edit was reverted by a concurrent save and the
				// tree's worst state in between was "the hub does not turn yet", not "the controls are
				// thirty degrees out".
				const steering = scene.steer(asked);
				inputMap.set(ME, actions.take(steering));
				// Bots go through exactly the same map as the thumb does. There is no second path into
				// the simulation and no way for a bot to ask for something a player could not.
				for (const bot of bots) inputMap.set(bot.id, bot.think(world));
				// Walked close enough, and them saying something. `poll` is where `talk.ts` decides who
				// is talking and what they say; this is the one place in the frame that world state is
				// read before it moves, which is where every other readout in this file already looks.
				if (conversation) {
					speech = conversation.poll(world, ME);
					// **The talking one stops.** `bot.think` still ran for it above — it is still a
					// wanderer as far as `sim/bot.ts` knows, and that is deliberate: a conversation is
					// not simulation state (see `talk.ts`'s own note on why it may read `World` without
					// being in `sim/`), so overriding its INPUT here, the same way a key press overrides
					// the stick, is the only place this can happen without teaching the pure roam
					// behaviour that talking exists. `NO_INPUT` rather than a slow creep toward
					// standing still: an islander mid-sentence has decided to stop, not to be coasting
					// to a halt, and the render-side look-at below is what makes the stop read as a
					// choice instead of a bug.
					if (speech) {
						const partner = world.penguins[indexOfIslander(speech.by)];
						if (partner) inputMap.set(partner.id, NO_INPUT);
					}
				}
				return inputMap;
			},
			// Solo this would be left out and the loop would step the world itself; it is spelled out
			// here because of `running` — before Play is pressed the world is held exactly as it was
			// built, while everything around it (the swell, the camera, the frame loop) carries on.
			advance: (frames) => {
				if (!running) return;
				// Held by the pause door, and only in a game this device is the only clock for. See `paused`.
				if (paused && opposition.kind !== 'net') return;
				if (session) session.tick(frames.get(ME) ?? NO_INPUT);
				else step(world, frames);
			},
			draw(interpolated, _alpha, seconds) {
				scene.setTime(seconds);
				// Every floe, at the size and tilt the simulation says. One call rather than the old
				// pair, because the drawn ice not following the simulation's radius was trap 8 and it
				// was a MISSING call rather than a wrong number.
				scene.setFloes(world.floes, seconds, world.round.ticks);

				// The camera frames the ice the local penguin is standing on — one floe in the classic
				// round, whichever one they last jumped to in a Royal. It keeps the last floe while
				// they are over open water, so a jump pans once, on landing, rather than twice.
				//
				// Once they are OUT it frames the fight they can still reach instead: the ball a
				// spectator throws goes at the nearest penguin still on the ice (`sim/combat.ts`), and
				// watching the empty floe you drowned next to while your snowballs land somewhere
				// off-screen is the sidelines failing at the one thing they are for.
				const watching = me.phase === 'out' ? floeUnder(world.floes, nearestAlive(me)) : null;
				const under = watching ?? floeUnder(world.floes, me.pos);
				if (under && under.radius > 0) framed = under;

				// On the slide the camera stays over the racer's own segment and simply pulls BACK: a
				// chute is 3.6 m across, and a camera fitted to that shows the ice underfoot and none of
				// the corner ahead. Focusing further down the mountain instead was worse — it put the
				// camera below the racers, looking up at the run they were still standing on.
				// And it TURNS with the run. `place()` rotates the rig about the focus, so the angle is
				// the one that makes the camera's view direction the segment's heading: the rig looks
				// along −z at rest, so the bearing that turns −z into `along` is `atan2(x, −z)`.
				//
				// Derived from `cameraPlacement()` rather than described in prose, for the reason trap 7
				// exists: the first version here was `atan2(x, z) − π`, which agrees with this one at the
				// starting heading and is a MIRROR of it everywhere else. It read as correct, matched the
				// only case anybody checks by hand, and pointed the camera across the course on the first
				// bend.
				if (spec.courseHeading) {
					// The rig turns with the run. Which way that IS comes from the mode: a chute segment
					// has a fall line to read and a chase platform is flat and has only its neighbours.
					const along = spec.courseHeading(world, framed);
					const want = Math.atan2(along.x, -along.z);
					// Chased rather than snapped: a bend is a segment every 7 m at 12 m/s, so setting the
					// bearing directly steps the whole world sideways once a second.
					bearing += Math.atan2(Math.sin(want - bearing), Math.cos(want - bearing)) * BEARING_CHASE;
				}

				// The sea lion, at the point `hunterAt` metres down the route — `pointAlong` is the
				// inverse of the scale the simulation eats people on, so the drawn animal and the line
				// it is eating cannot disagree. Whether it is over ice is asked of the same function
				// that decides whether a PENGUIN is: it hauls out and galumphs across a platform
				// rather than swimming underneath one.
				if (spec.hunted) {
					const { at, heading } = pointAlong(world.floes, world.hunterAt);
					const on = floeUnder(world.floes, at);
					scene.setHunter(at, heading, on?.altitude ?? 0, seconds, !!on);
				} else {
					scene.setHunter(null, { x: 0, z: -1 }, 0, seconds, false);
				}

				// WHERE the camera stands, and the two verbs take two different quantities — which is why
				// the registry's framing policy is read here rather than a radius being handed to both.
				//
				// `follow` stands a fixed number of METRES behind the player. Fed to the arena fit, the
				// island's 14 becomes a 26.8 m camera and a penguin 5.2% of the frame high — the
				// satellite view in the first island screenshot — where the same 14 taken as the distance
				// it means is 10.3%, next to the 11.0% a Royal gives. Same number, two readings, a factor
				// of two in the picture (`SceneHandles.setFollow`).
				//
				// Aimed at the INTERPOLATED position rather than at `me.pos`: this runs per frame and the
				// tick position steps, and a camera chasing a stepping target judders on a 120 Hz screen.
				// The hill under the penguin counts too — the island has a six-metre mountain on it, and a
				// focus left at sea level puts the climber off the top of the frame.
				const eye = follows ? interpolated.get(ME) : undefined;
				if (eye) {
					followAt.x = eye.x;
					followAt.z = eye.z;
					scene.setFollow(
						followAt,
						// METRES BEHIND the player. `spec.view` is 14 and this reads it as 14 — or 6.5 while
						// looking inside the igloo, which is the whole of what "inside" costs: the interior is
						// this camera standing closer, with the near shells left out by the renderer.
						inside ? IGLOO_VIEW : (spec.view ?? framed.radius),
						framed.altitude + groundHeight(framed, followAt, world.floes),
						{
							// And it TURNS to look where the player is running, which Daniel asked for by name and
							// which only a hub may have: `docs/DESIGN.md` §4 refuses a player-following camera in an
							// arena because it hides the rival about to shove you, and there is no rival and no rim
							// here. The smoothing, the rate cap and the dead zone live in `followBearing`; the
							// renderer keeps the angle because `scene.steer` above has to answer with the same one.
							//
							// The penguin's own FACING rather than the direction of its velocity: the two differ
							// exactly while it is sliding on ice and looking where it means to go, which is the
							// moment a camera chasing the velocity would swing off the thing the player is walking
							// toward. Speed is still the velocity's, because the dead zone is about whether the
							// player is actually going anywhere.
							heading: { facing: eye.penguin.facing, speed: Math.hypot(me.vel.x, me.vel.z) }
						}
					);
				} else {
					scene.setFocus(
						framed.center,
						// METRES OF RADIUS to fit, which a 28-step search turns into a distance — the same
						// 14 would put the camera 26.8 m back. `null` means fit the ice the player is
						// standing on, which is the classic round's answer and the reason the shrinking
						// floe reads as the arena closing in.
						spec.view ?? framed.radius,
						framed.altitude,
						bearing,
						spec.lift
					);
				}

				// How fast it should FEEL. Only where speed is the point: on a floe the top speed is a
				// knockback nobody asked for, and a lens that opened every time somebody was shoved
				// would be reporting an accident as an achievement.
				scene.setRush(
					racing ? Math.hypot(me.vel.x, me.vel.z) / ((G * SLIDE_GRADE) / SLIDE_DRAG) : 0
				);

				scene.setSnowballs(world.snowballs);
				// Once per FRAME, not once per tick: a frame that catches up on three ticks has three
				// ticks' worth of noise to make, and the watcher reports it in one list that the
				// retrigger guard then thins. Playing per tick would stack three thuds inside 50 ms.
				sound.play(cues.poll(world, ME));

				let out = 0;
				for (const p of world.penguins) if (p.phase === 'out') out++;
				if (out !== watched) {
					watched = out;
					// No chunks on the mountain: the watching ring is a circle around the arena, and a
					// slide has no arena — it is two hundred metres of course, so the ring would be a
					// vast circle of ice with nothing in the middle of it. A racer who falls off is
					// simply gone until the race ends.
					spots = spec.sidelines ? spectatorSpots(world) : new Map();
					// Turned to face the middle, because the whole point of the chunk is that they are
					// watching the round rather than staring off into the sea.
					facings = new Map([...spots].map(([id, at]) => [id, heading(scale(at, -1))]));
				}
				scene.setSpectators(spots);

				// **"Look you in the eyes."** The simulation's `facing` follows velocity
				// (`step.ts`), which is right for walking and wrong for standing still talking to
				// somebody — two penguins with nothing to say about direction otherwise face wherever
				// they last happened to be walking. This is drawn only, on the INTERPOLATED copy
				// (`Interpolated.facing` is display-only — see `loop.ts`), never on `world`: invariant
				// 2 is about the renderer never writing to the simulation, and a `Penguin.facing` it
				// then has to agree with in a future networked hub is exactly the write this avoids.
				// `render/penguin.ts` already chases whatever `at.facing` says at `TURN_RATE`, so
				// handing it a different target here is the entire feature — the smooth turn is code
				// that already existed for a different reason.
				const talkPartnerId = speech ? world.penguins[indexOfIslander(speech.by)]?.id : null;
				const myAt = talkPartnerId ? interpolated.get(ME) : null;
				// Only while the player is themselves near enough to standing still that "walking
				// toward the mountain" and "turning to face the neighbour" cannot be mistaken for one
				// another — a player who is still moving is not paused for a conversation yet, however
				// close `TALK_RANGE` says they are, and forcing their body sideways mid-stride is the
				// one case this would look like a bug rather than a courtesy.
				const iAmLookingUp = talkPartnerId && myAt ? length(me.vel) < 0.6 : false;

				for (const { id, actor } of actors) {
					const at = interpolated.get(id);
					if (!at) continue;
					if (talkPartnerId && myAt && id === talkPartnerId) {
						at.facing = heading(sub(myAt, at));
					} else if (iAmLookingUp && id === ME && talkPartnerId) {
						const partnerAt = interpolated.get(talkPartnerId);
						if (partnerAt) at.facing = heading(sub(partnerAt, at));
					}
					// Near enough for the gait, the lean and the name tag, or a dot on another island?
					// Measured from what the camera is framing rather than from the local penguin: the
					// camera is what decides how big something is on screen, and once the round is over
					// for you it is not looking at you at all.
					const near =
						(at.x - framed.center.x) ** 2 + (at.z - framed.center.z) ** 2 < DETAIL_RANGE ** 2;
					const spot = spots.get(id);
					// Fallen off the mountain and nowhere to put them: hidden rather than left floating
					// in the sea where they went in.
					actor.root.visible = !(!spec.sidelines && at.penguin.phase === 'out');
					if (!spot) {
						// The ice this one is standing on, so it tilts with that floe and not with
						// somebody else's. Over open water it keeps whatever it had, which is what a
						// penguin in mid-jump should look like.
						const ice = floeUnder(world.floes, at);
						// The lift is the floe's own bob and sink PLUS whatever hill is under this
						// penguin: `height` in the simulation is measured from the ground it is standing
						// on, so an actor drawn without the hill would walk through an iceberg it is in
						// fact standing on top of.
						if (ice) {
							actor.setSurface(
								ice.center,
								ice.slope,
								floeOffsetY(ice, seconds) + groundHeight(ice, at, world.floes)
							);
						}
						actor.update(at, seconds, near);
						continue;
					}
					// A spectator is parented into its own chunk of ice, which does not tilt with any
					// floe: level, so the penguin watching is upright.
					actor.setSurface(LEVEL, LEVEL);
					onTheChunk.facing = facings.get(id) ?? 0;
					onTheChunk.penguin = at.penguin;
					// A spectator is always drawn in full: there are never many of them on screen at once
					// (the ring holds twelve chunks) and finding yourself after going in is the entire
					// point of the mechanic.
					actor.update(onTheChunk, seconds, true);
				}

				// The HUD is throttled to ~10 Hz. At 60 Hz these three assignments are three Svelte
				// effect invalidations per frame for numbers a human reads at walking pace, and on a
				// mid-range Android that measurably competes with the frame budget.
				if (++hudFrame % 6 === 0) {
					phase = world.round.phase;
					countdown = Math.ceil((COUNTDOWN_TICKS - world.round.ticks) / TICK_RATE);
					// The NAME, never the id — see `nameOf`. A winner the map has never heard of falls
					// back to the raw id rather than to nothing: an unnamed winner is still better
					// than a result screen that cannot say who won.
					winner = world.round.winner ? (nameOf.get(world.round.winner) ?? null) : null;
					iWon = world.round.winner === ME;
					// Paid the moment the round ENDS, and paid for finishing it — the bonus for winning is
					// on top rather than instead (`lib/eis.ts` argues the ratio). A penguin that went in the
					// water ten seconds in and watched the rest from a chunk of ice has finished the round;
					// a host who walked out means it never ended, and `phase` never reaches 'over' there.
					//
					// Credited HERE rather than in the route because this is where the round's end is
					// observed, and nothing in `sim/` knows the number exists: a price is not a fact about a
					// world, and a wallet inside a replay is a replay that stops replaying.
					if (!credited && world.round.phase === 'over') {
						credited = true;
						justEarned = eisFor({ finished: true, won: iWon });
						eis = earn(justEarned);
					}
					restartable = canRestart(world);
					standing = alive(world).length;
					// A race has places, not survivors, and the mode says which order that is —
					// `GameMode.standings` is `sim/slide.standings` on the mountain and
					// `sim/chase.fleeing` on a route, which is the same question asked of two different
					// arrangements of the same floes. Null where a mode counts survivors instead.
					if (spec.standings) {
						const order = spec.standings(world);
						const mine = order.findIndex((p) => p.id === ME);
						place = mine < 0 ? order.length : mine + 1;
					}
					// Where the player is standing, if standing there leads somewhere. Polled with the rest
					// of the readout at ~10 Hz: at `WALK_SPEED` that is 6 cm of walking between answers,
					// and a door is metres across. `spec.doorUnder` is null in every mode but the hub, so
					// this costs those modes one optional call per six frames.
					doorHere = spec.doorUnder?.(world, me) ?? null;
					// The house, once per readout rather than once per frame. `setIgloo` is keyed by
					// `iglooKey` and documented as safe to call every frame, but `iglooSpec` reads the SAVE
					// to get the plan — a `localStorage` hit and a JSON parse, which is a thing to do ten
					// times a second and not sixty. Null in every other mode, which tears it down; unlike
					// `setIsland(null)` this one touches no fog, so it is safe from anywhere.
					scene.setIgloo(hub ? iglooSpec(world.floes[0] ?? null, inside) : null);
					// And a peek ends by WALKING OFF, not only by a button. `hasLeftTheIgloo` is the
					// simulation's own answer to "is this penguin still on its doorstep", so the camera
					// cannot stay inside a house the player has left.
					if (inside && plot && hasLeftTheIgloo(me.pos, plot)) inside = false;
					swimming = me.phase !== 'skating';
					iAmOut = me.phase === 'out';
					stunned = me.stunTicks > 0;
					dashReady = dashReadiness(me);
					// And how close the thing behind you is. Only when it is worth saying: a number that
					// is on screen for the whole round is a number nobody reads by the end of it.
					hunterLead =
						spec.hunted && me.phase === 'skating'
							? alongCourse(world.floes, me.pos) - world.hunterAt
							: null;
					shoreLeft =
						spec.hunted && me.phase === 'skating'
							? Math.max(0, (shoreOf(world)?.along ?? 0) - alongCourse(world.floes, me.pos))
							: null;
					// The ice under the local penguin, and how long it has left. `breakWarning` is the
					// same function the renderer draws the crack from, so the words and the picture
					// cannot disagree about which floe is going or when.
					const myIce = me.phase === 'skating' ? floeUnder(world.floes, me.pos) : null;
					const warning = myIce ? breakWarning(myIce, world.round.ticks) : 0;
					breakIn =
						warning > 0
							? Math.max(0, (myIce?.sinkAtTick ?? 0) - world.round.ticks) / TICK_RATE
							: null;
					// Solo this is always false, and Svelte can see it: when the assignment was
					// missing, the compiler proved the whole "Das Spiel ist weg" branch unreachable
					// and left it out of the bundle entirely. The panel was in the source, passed
					// typecheck, and simply did not exist on the page.
					hostGone = session?.lost ?? false;
				}

				// The sheet's penguin, painted into a corner of this buffer and copied out of it BEFORE
				// the game clears the buffer and draws itself over the top. One renderer, one context,
				// one clock — and a turntable that stops the moment the round's loop does.
				portrait?.paint(seconds);

				scene.render();
			}
		});

		return () => {
			document.removeEventListener('fullscreenchange', onFullscreenChange);
			loop.stop();
			session?.close();
			clearTimeout(resizeAgain);
			window.removeEventListener('resize', resize);
			window.removeEventListener('orientationchange', reorient);
			// Disposes every actor it was given as well as its own geometry and materials.
			scene.dispose();
			// Nothing may hold the renderer past its own teardown: the sheet's portrait draws through
			// it, and a `Customise` still mounted while the round is being replaced would paint into a
			// context that has been given back.
			sceneHandles = null;
			portrait = null;
		};
	});
</script>

<div class="stage relative h-full w-full overflow-hidden">
	<canvas bind:this={canvas} class="block h-full w-full"></canvas>

	{#if failure}
		<div class="overlay p-6" data-testid="webgl-failure">
			<p class="panel max-w-sm p-5 text-center text-base">
				Dieses Spiel braucht 3D-Grafik im Browser, und die ist hier nicht verfügbar.
				<span class="mt-2 block text-sm opacity-80">{failure}</span>
			</p>
		</div>
	{:else}
		<!-- How many are left, and what is happening to you. No numbers a player would have to
	     interpret: "noch 3" is the only score this game has. -->
		<div class="hud-stack safe-t safe-l pointer-events-none absolute top-0 left-0">
			<div class="panel hud px-3 py-2 text-sm tabular-nums" data-testid="hud">
				<!-- The score, and it is a different question in a race: not how many are left but
				     where you are in the field. "Noch 3 auf dem Eis" on a mountain would be telling a
				     child how many rivals have fallen off, which is not what they are trying to do. -->
				<!-- And it is not a score at all in a hub. "Noch 1 auf dem Eis" on the island is a body
				     count of a place where nobody is eliminated: a number that can never move, in the
				     corner reserved for the only number this game has. What a child needs there instead
				     is WHERE THEY ARE — the island has five places on it and, until story 10f draws
				     them, this line is the only thing that says which one you are standing in. -->
				{#if hub}
					<div><b>{spec.name}</b></div>
					<div class="text-xs opacity-90">{doorHere ? doorHere.name : 'Geh zu einem Platz'}</div>
				{:else if racing}
					<div>Platz <b>{place}</b> von <b>{standing}</b></div>
				{:else}
					<div>Noch <b>{standing}</b> auf dem Eis</div>
				{/if}
				<!-- Out beats the other two: once the round is over for you, "Schwindelig!" is a
				     status for a penguin that no longer takes input, and reading it while nothing
				     answers the stick is the confusion this line exists to end. -->
				<!-- The ice is going, and it says so in words as well as in the crack under the feet.
				     Above the other three lines because it is the only one that is about to happen
				     rather than about what already did. -->
				{#if breakIn !== null}
					<div class="mt-1 font-bold" style="color: var(--danger)">
						Scholle bricht! <span class="tabular-nums">{breakIn.toFixed(1)}s</span>
					</div>
				{/if}
				<!-- And how far there is left to run. Not a warning, so it sits in the ordinary weight:
				     the danger line below is the one that should catch the eye. -->
				{#if shoreLeft !== null}
					<div class="text-xs opacity-90">
						Ufer <b class="tabular-nums">{shoreLeft.toFixed(0)}</b> m
					</div>
				{/if}
				<!-- The sea lion, in metres, once it is close enough to be the thing you should be
				     thinking about. Same place and same colour as the breaking ice: both are "this is
				     about to happen to you", and a child should not have to learn two languages. -->
				{#if hunterLead !== null && hunterLead < HUNTER_WARN}
					<div class="mt-1 font-bold" style="color: var(--danger)">
						Seelöwe! <span class="tabular-nums">{Math.max(0, hunterLead).toFixed(0)} m</span>
					</div>
				{/if}
				{#if iAmOut}
					<!-- Out of the round, not out of the game — except on the mountain, where there is
					     nothing to throw and nowhere to throw it from. The second line is the whole point
					     of the sidelines everywhere else: a child who has just gone in the water has to
					     be told, in the second it happens, that the Ball button still does something. -->
					<div class="mt-1 font-bold" style="color: var(--danger)">
						{spec.copy.outOfIt.headline}
					</div>
					<div class="text-xs opacity-90">{spec.copy.outOfIt.hint}</div>
				{:else if swimming}
					<div class="mt-1 font-bold" style="color: var(--accent-ink)">Platsch!</div>
				{:else if stunned}
					<div class="mt-1 font-bold" style="color: var(--accent-ink)">Schwindelig!</div>
				{/if}
			</div>
			<!-- **The way out of a round that is over for you.**
			     A child knocked out of a Royal in the first ten seconds used to watch from a chunk of ice
			     with no exit until the round decided to end — up to a hundred seconds of a game that had
			     stopped answering them (Daniel, 2026-08-21). That is trap 4's family with the button
			     missing rather than covered, and it is the worst version of it: the earlier a child
			     loses, the longer the trap holds them.

			     Everything the sidelines already do is untouched. The stick, Hüpf and Schubs stay gone
			     because a control that answers nothing is worse than a missing one, and Ball stays and
			     grows because throwing is the one thing a spectator can still do. These are DOORS, not
			     controls: they do not touch the round.

			     Placed directly under the sentence that says you are out, which is the thing the eye is
			     already on, and audited against the four ways this box has bitten before:
			      * The joystick is UNMOUNTED for an eliminated player, so the left half of the screen is
			        not a touch zone at all here — the trap that cost trap 4, 12 and two others cannot
			        fire in this state.
			      * Two 48 px buttons from x=16 reach x≈244 on a 568 px screen, short of the middle at
			        284 and nowhere near the top-right row.
			      * They stop existing when the round ends, because the result panel offers the same two
			        doors and a screen with four buttons doing two things is worse than either.
			      * `.action` carries its own `pointer-events: auto`, which is what makes them pressable
			        inside this deliberately `pointer-events-none` column.

			     In a room the labels change and there is only one: `onAgain` there means LEAVE THE ROOM
			     (`Room.svelte` wires it to its own exit), so calling it "Neue Runde" would be a button
			     that lies about what it does to the other people still playing. -->
			{#if iAmOut && phase !== 'over' && !hostGone && running}
				<div class="mt-2 flex gap-2">
					{#if onLeave}
						<button class="action h-12 px-4 text-sm" onclick={onLeave} data-testid="out-to-island">
							Zur Insel
						</button>
					{/if}
					<button
						class="action cta h-12 px-4 text-sm"
						onclick={() => onAgain()}
						data-testid="out-again"
					>
						{opposition.kind === 'net' ? 'Spiel verlassen' : 'Neue Runde'}
					</button>
				</div>
			{/if}
			<!-- What the games have paid for, and it belongs to the ISLAND rather than to a round: in a
			     game the corner of the screen is about who is left and how long the ice lasts, and a
			     total that cannot change while you are playing is one more thing to read at the moment
			     there is least time to read anything.

			     Its own plaque UNDER the readout rather than a third line inside it. That readout is
			     capped at 9.5 rem on a 568 px screen — the budget between it and the button row is
			     152 px — and it already carries two lines here; a third would push "Geh zu einem Platz"
			     into a wrap and then into the row. This sits below, in the same `pointer-events-none`
			     column, where there is nothing but ice.

			     The WORD stays next to the glyph. Nothing in this game is carried by an icon alone, for
			     the same reason nothing is carried by colour alone. -->
			{#if hub}
				<div class="pill mt-2 inline-block px-3 py-1 text-sm" data-testid="eis">
					<span aria-hidden="true">❄</span> <b>{eis}</b> Eis
					<!-- **The total has to be a way IN, not just a readout.** Story 12's loop is play → earn
					     → spend → walk inside, and until this line existed nothing anywhere told a child
					     that the third step was possible: the doorstep says "Mein Iglu" when you are
					     standing on it, and you had to already know to walk there. A whole feature nobody
					     can find is trap 5 and trap 15's shape, and it has cost this project two sessions.

					     SMALL AND PERMANENT rather than loud and once. A toast a child dismisses is a
					     feature they have lost for ever; this is one clause in a plaque that is already on
					     screen, and it comes back every time they can afford the next rung.

					     Not a button, and that is deliberate rather than timid: spending happens at the
					     doorstep, so a pressable pill here would either open a sheet in the wrong place or
					     be a control that navigates nothing. It also sits in the joystick's half of the
					     screen — this whole column is `pointer-events-none` so the stick still gets every
					     touch on it, and making it pressable would mean a `z-10` patch that eats steering
					     taps at the top left. A sentence is the right instrument for "there is somewhere to
					     go".

					     Hidden while standing in a door, because the door's own sign is already saying
					     something more specific — and because "geh zum Iglu" is the wrong thing to read
					     while standing on the igloo. -->
					{#if canBuild && !doorHere}
						<span class="font-extrabold">· geh zum Iglu!</span>
					{/if}
				</div>
			{/if}
		</div>

		<!-- One tap to the side of the game, never in front of it. Shown only while nothing is being
		     played, so it can never cover a round in progress.

		     Except in a hub, where it stays up: there is no round for it to cover, and it is the only
		     way to the sound, to "Mein Pinguin" and to a room. Hidden on the island the way it is
		     hidden mid-round, the island would be a place with no way out of it — and the row is one
		     button NARROWER there, because the mode switch is gone (see below). -->
		{#if (phase !== 'playing' || hub) && !customising && !profiling && !building}
			<!-- `z-10`, and it is load-bearing rather than tidiness: the joystick's zone is the whole
			     left HALF of the screen and it comes later in the DOM, so anything in this row that
			     reaches past the middle is covered by an invisible control that eats the tap. On a
			     568 px screen this row does reach past the middle — it grew a mode switch — and the
			     symptom was "Mein Pinguin" being visible, pressable and dead. That is trap 4 in
			     `CLAUDE.md` for the fourth time, and this is the fix that survives the next button. -->
			<!-- `flex-wrap` and `justify-end`, for the fifth geometry: PORTRAIT. Five items come to about
			     431 px and a 390 px phone held upright has 374 to give, so without wrapping the row runs
			     off the LEFT edge — it is anchored right and sized by its content, so the fullscreen and
			     mute buttons are the ones that leave the screen. Wrapped, it takes a second 48 px line in
			     a frame that has hundreds to spare, and stays right-aligned. In landscape it has never
			     wrapped and still does not: the same five items fit 568 px with the glyphs. -->
			<div
				class="top-row safe-t safe-r absolute top-0 right-0 z-10 flex flex-wrap justify-end gap-2"
			>
				<!-- Offered only where it can do something: hidden in an installed app, which is
				     already fullscreen through the manifest, and on iPhone Safari, which has no
				     Fullscreen API at all. A button that silently does nothing is worse than none. -->
				{#if canFullscreen}
					<button
						class="action action-glyph h-12 w-12 text-lg"
						onclick={toggleFullscreen}
						aria-pressed={full}
						aria-label={full ? 'Vollbild verlassen' : 'Vollbild'}
						data-testid="fullscreen"
					>
						{full ? '⤡' : '⤢'}
					</button>
				{/if}

				<!-- The mute is here in a room too: "turn that off" is a request a child gets from
				     somebody else in the room, not a preference they go looking for. -->
				<button
					class="action action-glyph h-12 w-12 text-lg"
					onclick={toggleMute}
					aria-pressed={muted}
					aria-label={muted ? 'Ton einschalten' : 'Ton ausschalten'}
					data-testid="mute"
				>
					{muted ? '🔇' : '🔊'}
				</button>

				<!-- ONE button, where there used to be three ("Daniel, 2026-08-22: too many topbar
				     buttons"). "Mein Pinguin", "Mit Freunden" and the profile sheet itself all lived
				     here separately, each earning its OWN spot by the same argument: everything in this
				     row pushes the left edge further into the joystick's half of the screen, and the
				     row also COVERS what it reaches over. Three spots by that argument is three times
				     the cost for one child who came here to change a hat. They are all still exactly
				     one tap away — inside `Profile.svelte`, which this opens — so nothing that used to
				     be reachable stopped being reachable; only the row got shorter.

				     A GLYPH rather than a word for the same reason the old profile button was one: at
				     48 px this costs 56 px on the row, where a worded "Einstellungen" would have cost
				     over twice that. ⚙ reads as "more lives here" the way 🐧 read as "this is you" —
				     the settings sheet still opens straight onto the profile, so nothing about what is
				     UNDER the button changed, only what it promises before it is pressed.

				     Not in a room: the roster is fixed when the round starts, so a name rolled or a
				     look changed here would be invisible to everybody else, and "Mit Freunden" would be
				     a way to walk out of a game other people are waiting in. -->
				{#if opposition.kind === 'solo'}
					<button
						class="action action-glyph h-12 w-12 text-lg"
						onclick={() => (profiling = true)}
						aria-label="Einstellungen"
						data-testid="profile-open"
					>
						⚙️
					</button>
				{/if}
				<!-- The mode, as a switch that says what it will DO rather than what it is called: the
				     name of the NEXT game and who is in it, because that is the difference a child
				     actually notices. Pressing it restarts the round, so a button that only said
				     "Royal" charged them a round to find out what the word meant.
				     Beside the game rather than in front of it, like everything else here: a mode
				     picker that has to be answered before the first round costs exactly the two
				     seconds `docs/DESIGN.md` §6 is about.

				     NOT in a hub. The island's doors are the way into a game, and a button that also
				     starts one is a second way in — which is the menu the island exists to replace. It
				     stays inside the games themselves, because a child who wants another game without
				     walking back should not have to, and because the walk is only worth anything once
				     the island is drawn (story 10f). -->
				{#if onMode && !hub}
					<button
						class="action mode-switch h-12 px-4"
						onclick={onMode}
						aria-label="{offered.name} spielen: {offered.copy.who}"
						data-testid="royal"
					>
						<span class="mode-switch-name">{offered.name}</span>
						<span class="mode-switch-count">{offered.copy.who}</span>
					</button>
				{/if}
			</div>
		{/if}

		<!-- The build sheet: the ONLY place a purchase happens, so this component does no economy
		     arithmetic at all. It hands back what it changed — the new stage and the new total — and both
		     go straight into the two numbers this page already draws. -->
		{#if building}
			<Igloo
				{eis}
				onBought={(bought) => {
					// One assignment each, from the sheet's own answer. Reading the save again here would be
					// a second reader of a number the sheet has just written, which is how a corner of the
					// screen ends up disagreeing with a button.
					stage = bought.stage;
					eis = bought.eis;
				}}
				onInside={() => {
					building = false;
					inside = true;
				}}
				onClose={() => (building = false)}
			/>
		{/if}

		{#if profiling}
			<Profile
				name={myName}
				{eis}
				onReroll={rerollName}
				onCustomise={() => {
					// Handed over rather than stacked: two sheets open at once is two things taking the
					// same taps, and the look editor is the one that needs the renderer.
					profiling = false;
					customising = true;
				}}
				onFriends={onFriends
					? () => {
							// Same handover as `onCustomise` above: closed here rather than left for
							// `onClose` to notice, so navigating away is a decision this sheet made and
							// not a side effect of tidying up after itself.
							profiling = false;
							onFriends();
						}
					: undefined}
				onClose={() => {
					profiling = false;
					// A rolled name is baked into the tag over the penguin's head at mount, so it takes a
					// remount to be visible — carrying the world in a hub, so a new name does not also
					// move the penguin wearing it back to the square. Exactly what "Fertig" does in the
					// look editor, and for the same reason.
					if (lookChanged) onAgain(hub ? (liveWorld ?? undefined) : undefined);
				}}
			/>
		{/if}

		{#if customising}
			<Customise
				look={myLook}
				name={myName}
				host={sceneHandles}
				onPreview={(p) => (portrait = p)}
				onChange={setLook}
				onReroll={rerollName}
				onClose={() => {
					customising = false;
					// Restart only if something actually changed, so closing the sheet untouched leaves
					// the round exactly where it was.
					// Carrying the world in a hub, so a new hat does not also move the penguin wearing it
					// back to the square. See `onAgain`.
					if (lookChanged) onAgain(hub ? (liveWorld ?? undefined) : undefined);
				}}
			/>
		{/if}

		<!-- The one screen this game has, and it is one button. The world behind it is already built
		     and already drawn — the sea moves, the penguins are on the ice — so pressing this costs
		     nothing but the decision. -->
		{#snippet rules()}
			<!-- What this game is, said once. A child who pressed "Royal" without knowing what it meant
	     finds out here rather than by drowning. One definition, rendered in two places: the start
	     screen has the time to read it, and a rematch only ever sees the countdown. -->
			{#if spec.copy.rules}
				<p class="pill mt-2 px-3.5 py-1 text-center text-xs opacity-90" data-testid="mode-line">
					{spec.copy.rules}
				</p>
			{/if}
		{/snippet}

		<!-- What this round just paid, beside the glyph on the result screen.
		     INSIDE the glyph's line rather than on a line of its own, and that is arithmetic rather than
		     taste: `app.css` records that the result panel clears the mute button by sixteen pixels on a
		     568×320 landscape, and another line of text is twenty-four. A span in a line whose height is
		     set by a 5xl emoji costs nothing at all, on both screen sizes — and it puts the number where
		     the eye already is, at the top of the panel, rather than under two lines of verdict that a
		     short screen hides anyway.

		     Only when something was earned, so it can never read "+0 Eis" — a reward of nothing is worse
		     than no reward shown. -->
		{#snippet reward()}
			{#if justEarned > 0}
				<span class="ml-2 align-middle text-base font-extrabold" data-testid="earned">
					+{justEarned} <span aria-hidden="true">❄</span> Eis
				</span>
			{/if}
		{/snippet}

		<!-- **The pause door.** One 48 px button, and it is the only thing on screen during a round that
		     is not the game.

		     Only while `phase === 'playing'`, which is what keeps it out of the top-right row's way: that
		     row is hidden for exactly that phase (see it above), so the corner is never shared. During
		     the countdown there is nothing to be stuck in — it lasts two seconds — and once the round is
		     `over` the result panel offers the same doors with room to label them.

		     `spec.isRound`, not `!hub`: a hub is a place, and a place you can walk out of does not need
		     a button that stops it.

		     Audited against the three ways this corner has bitten:
		      * The position is on the DIV. `app.css` gives `.action` an unlayered `position: relative`,
		        which beats Tailwind's layered `absolute` wherever it is written on the button itself —
		        that is trap 18, and it silently killed every inset in the app once already.
		      * `z-10` for the same reason the top row carries it. A 48 px button at the right edge of a
		        568 px screen sits at x≈504, nowhere near the middle the joystick's zone reaches, but the
		        zone comes later in the DOM and the next thing added to this corner may be wider.
		      * It is a glyph AND an `aria-label`. Nothing here is carried by the picture alone. -->
		{#if spec.isRound && phase === 'playing' && running && !paused && !hostGone}
			<div class="safe-t safe-r absolute top-0 right-0 z-10">
				<button
					class="action action-glyph h-12 w-12 text-lg"
					onclick={() => (paused = true)}
					aria-label="Pause"
					data-testid="pause"
				>
					⏸
				</button>
			</div>
		{/if}

		<!-- And what the button opens. Three doors, in the order a child wants them: back into the
		     game, the same game again, and out.

		     "Weiter" is the CTA because it is what an accidental tap wants, and it is first so that the
		     thumb that opened this by mistake closes it by reflex.

		     In a room the middle door is missing rather than relabelled. `onAgain` means LEAVE THE ROOM
		     there (`Room.svelte` wires it to its own exit), and a button between "Weiter" and an exit,
		     saying "Neue Runde", that actually ends the game for everybody else, is the worst button in
		     the app. The line above the doors says the round is still running, because in a net game it
		     genuinely is — see `paused`. -->
		{#if paused}
			<div class="overlay p-6" data-testid="paused">
				<div class="panel px-8 py-6 text-center">
					<p class="text-2xl font-extrabold">Pause</p>
					<p class="mt-1 text-sm opacity-80">
						{opposition.kind === 'net'
							? 'Die anderen spielen weiter.'
							: `${spec.name} · ${spec.copy.who}`}
					</p>
					<div class="mt-5 flex flex-wrap justify-center gap-2">
						<button
							class="action cta h-14 px-5 text-lg"
							onclick={() => (paused = false)}
							data-testid="pause-resume"
						>
							Weiter
						</button>
						{#if opposition.kind !== 'net'}
							<button
								class="action h-14 px-5 text-base"
								onclick={() => onAgain()}
								data-testid="pause-again"
							>
								Neue Runde
							</button>
						{/if}
						{#if onLeave}
							<button
								class="action h-14 px-5 text-base"
								onclick={onLeave}
								data-testid="pause-leave"
							>
								{opposition.kind === 'net' ? 'Spiel verlassen' : 'Zur Insel'}
							</button>
						{/if}
					</div>
				</div>
			</div>
		{/if}

		<!-- Walking up to somebody, and them saying something. `hub` rather than `speech`, so the slot
		     stays reserved for the island specifically — see `Speech.svelte` for why the middle of the
		     screen is free there and nowhere else. -->
		{#if hub}
			<NpcSpeech {speech} />
		{/if}

		{#if !running}
			<div class="overlay p-6" data-testid="start">
				<div class="panel px-8 py-6 text-center">
					<p class="text-2xl font-extrabold">{APP.name}</p>
					<p class="mt-1 text-sm opacity-80">{spec.name} · {spec.copy.who}</p>
					<!-- The rules, in the one moment there is time to read them: nothing is moving and
					     nobody is losing yet. They are repeated on the countdown for a rematch, which
					     never sees this screen. -->
					{@render rules()}
					<button
						class="action cta mt-5 h-16 w-48 text-xl"
						onclick={() => {
							running = true;
							onStart?.();
						}}
						data-testid="play"
					>
						Los geht's!
					</button>
				</div>
			</div>
		{/if}

		{#if phase === 'countdown' && running}
			<!-- Big, central, and gone in two seconds. It is the only thing on screen that is
			     allowed to cover the arena, because during the countdown there is nothing behind
			     it to see.

			     **This is also where the gondola ride goes, and two decisions about it are recorded here
			     rather than in a backlog file, because this is the code somebody will be tempted to
			     change.** (Approved 2026-08-21; waiting on `GameMode.opensAfter`, the station's position
			     and `SceneHandles.setGondola`.)

			     The ride is a PHASE, not a state. `opening: 'countdown'` already means "the world exists,
			     the controls are dead, something is about to happen", which is exactly a gondola climbing
			     — so the car is a place along a cable at `t`, drawn from the clock `render/loop.ts`
			     already owns, and the simulation has nothing to disagree about. That is this codebase's
			     own lesson pointing forwards: `chase.ts` made the hunter a DISTANCE (`hunterAt`) rather
			     than a pursuit, and that is what makes it replayable and impossible to cheese. A gondola
			     as a state of the island — a penguin that ignores input while its position changes — is
			     the state machine we already learned not to build, and it would need a fourth
			     `RoundPhase` that every future mode has to answer.

			     And it ends at `max(loadFinished, ~4 s)`, never at a fixed animation length.
			     **Anticipation the first time is delight; the tenth time it is a tax on a child who wants
			     another race.** That is also the only honest form of a loading screen: it lasts as long as
			     there is something to wait for. If you are here to pad it because it feels insubstantial,
			     that is the thing this paragraph exists to stop. -->
			<div class="overlay" data-testid="countdown">
				<div class="grid place-items-center">
					<div class="countdown-number">{countdown}</div>
					<!-- Which of the four penguins answers the stick, said in words, at the one moment
					     there is nothing else to read. The arrow here is the SAME shape as the one
					     bobbing over the penguin's head (`render/penguin.ts`) — the line's whole job is
					     to connect a marker on the ice to a name on a tag, and it can only do that if
					     both ends look alike. Colour is never the carrier: the name is the other half. -->
					{#if myShownName}
						<p class="pill mt-2 px-3.5 py-1.5 text-center text-sm" data-testid="thats-you">
							<span aria-hidden="true" class="you-arrow">▼</span> Du bist
							<b>{myShownName}</b>
						</p>
					{/if}
					<!-- What this game is, said once, in the two seconds before it starts. A child who
					     pressed "Royal" without knowing what it meant finds out here rather than by
					     drowning — and it is the one place in the round where nothing is happening
					     behind the words. -->
					{@render rules()}
				</div>
			</div>
		{/if}

		<!-- **Portrait, per MODE.** `GameMode.portrait` has existed, typed and documented, since the
		     registry landed — and nothing read it, so the island declared itself playable on a tall screen
		     and was then covered by a card telling the child to turn the phone. That is trap 5 and trap
		     15's shape and the most expensive instance of it, because a policy field that nothing consumes
		     reads exactly like a feature that exists. This `{#if}` is the consumer.

		     For an ARENA the card stays and stays honest: `docs/DESIGN.md` §4 frames the whole floe, so a
		     tall screen pushes the camera back until a penguin is ~4% of the frame against ~13% in
		     landscape. Shipping that framing would be worse than asking for a rotation.

		     For the hub there is no arena to fit — the camera stands a fixed 14 m behind the player
		     (`setFollow`), which is 10.3% of the frame in both orientations — so there is nothing to ask
		     for. The card is not rendered at all rather than hidden, and that matters beyond tidiness:
		     `app.css` makes the controls inert with `.rotate-hint ~ *`, so the element's ABSENCE is what
		     gives the stick and the buttons back. A hidden card would leave them dead. -->
		{#if !spec.portrait}
			<!-- The game keeps running underneath, so rotating picks it straight back up. -->
			<div class="rotate-hint" data-testid="rotate-hint">
				<!-- Three words and a big picture, in that order of importance. The second line used to
				     explain WHY ("Dann siehst du die ganze Scholle") and an explanation is the one thing
				     a child holding the phone the wrong way does not need: the phone in `app.css` turns
				     itself over on a loop, and that is the whole message. On iOS this card is all there
				     is — no browser there implements the Screen Orientation API — so it has to work
				     without being read. -->
				<div class="max-w-xs text-center text-white">
					<div class="rotate-glyph mx-auto mb-6 h-24 w-14"></div>
					<p class="text-2xl font-extrabold">Handy quer halten</p>
				</div>
			</div>
		{/if}

		<!-- The controls exist only while they do something. Once the round is over the simulation
		     ignores input anyway, so a live joystick would be a lie — and, found by an end-to-end
		     test rather than by reading this: the stick covers the left half of the screen and
		     comes after the result panel in the DOM, so it intercepted every tap on "Nochmal".
		     The button was unreachable on exactly the screen whose whole job is that one button.
		     `hostGone` is the same screen and therefore the same trap, which is why it is here and
		     not only in the panel below. -->
		<!-- `!paused` for the same reason the controls go when a round ends: a live stick behind a panel
		     is both a lie and an obstacle (trap 4), and the simulation is not reading it anyway. -->
		{#if phase !== 'over' && !hostGone && running && !paused}
			<div class="pointer-events-none absolute inset-0">
				<!-- A spectator cannot steer, so the stick goes with the other two: a control that
				     answers nothing is worse than a missing one, and this one covers half the screen. -->
				{#if !iAmOut}
					<Joystick bind:move label="Steuerkreuz — Daumen aufsetzen und ziehen" />
				{/if}

				<!-- Three buttons in a triangle so one thumb reaches all of them without travelling.
				     Jump sits lowest and outermost because it is the one pressed most often, and the
				     other two fan inward from the resting position rather than away from it.

				     Once the player is OUT, only "Ball" survives: the simulation gives a spectator
				     exactly one action, and a jump button that silently does nothing is trap 4 all
				     over again — visible, pressable, dead.

				     One colour each (`.action-jump`, `.action-ball`, `.action-dash` in `app.css`), so
				     a thumb finds the right one without reading it — which is the whole point of the
				     triangle. The WORD stays on every one of them: nothing here is carried by colour.
				     Every size below is unchanged from before the restyle on purpose; this box has
				     been audited against the joystick's touch zone and a restyle may not move a hit
				     box. -->
				<div class="safe-b safe-r pointer-events-none absolute right-0 bottom-0">
					<div class="relative h-44 w-44">
						<!-- **Every position in this box is on a DIV, never on the button itself, and that is
						     a bug fix rather than a style.** `app.css` sets `position: relative` on `.action`,
						     unlayered; Tailwind 4 emits `absolute` inside `@layer utilities`; and unlayered
						     declarations beat layered ones whatever their order in the file. So every
						     `absolute` written on an `.action` was DEAD — the buttons laid out in normal
						     flow, wrapped (a 96 px circle and a 176 px bar do not fit on one 176 px line),
						     stacked vertically, and pushed "Zack!" clean off the bottom of a 568×320 screen.

						     It is trap 4's family for the fifth time and the first one no arithmetic could
						     catch: the numbers said the door bar fitted an empty slot, and it did — in a
						     layout that was not running. Two things found it. The stack in
						     `shots/small-landscape-island.png` is in DOM order, top to bottom, which is
						     flow rather than the triangle; and the cascade rule says exactly that.

						     A plain `<div>` carries no `.action`, so its `absolute` is uncontested and the
						     button fills it. It also survives the real fix — dropping `position: relative`
						     from `.action`, or wrapping it in `@layer components`, which is `app.css`'s
						     call and not this file's. -->
						{#if !iAmOut}
							<div class="absolute right-0 bottom-0 h-24 w-24">
								<button
									class="action action-jump h-full w-full text-lg"
									onpointerdown={press('jump', 12)}
									aria-label="Springen"
								>
									Hüpf
								</button>
							</div>
						{/if}
						<!-- No fighting on the mountain: `round.attackStrength` is zero for the whole run,
						     so a Ball button there would be visible, pressable and dead — trap 4 again.
						     The jump stays, because jumping a bump is half of how you take a corner.

						     And nothing to throw once the sea lion has you either: the sidelines in this
						     game are a ring of chunks around an ARENA, and a chase is a line two hundred
						     metres long with no middle to watch from. Eaten is eaten. -->
						{#if spec.throwing && !(iAmOut && !spec.sidelines)}
							<!-- The spectator's ball MOVES as well as growing, and that move has to happen on
							     the wrapper now. `.sideline-ball` says `inset: auto 0 0 auto` plus a 6 rem
							     square — written for an absolutely positioned button, to re-anchor it to the
							     bottom-right corner the jump button has just vacated and grow it to the jump's
							     size. On a `position: relative` button those insets are zero offsets and do
							     nothing, so that half of the rule has never run: the ball has been growing
							     teal in the wrong corner. The size and the colour still come from the class;
							     the corner comes from here. -->
							<div
								class={iAmOut
									? 'absolute right-0 bottom-0 h-24 w-24'
									: 'absolute top-2 right-2 h-20 w-20'}
							>
								<button
									class="action action-ball h-full w-full text-base"
									class:sideline-ball={iAmOut}
									onpointerdown={press('throw', 8)}
									aria-label="Schneeball werfen"
								>
									Ball
								</button>
							</div>
						{/if}
						<!-- **The way IN, and it is the biggest thing in this corner of the screen.**
						     It was a Los! disc the size of the Ball button, in the third button's slot, with
						     the sign in the corner above it — and a child walking into the square did not
						     notice it was a door (Daniel, 2026-08-21). It is now a BAR the full width of the
						     button box: 176×64, the largest single control in the game, green because green
						     is this palette's only unambiguous yes, directly under the sign that names what
						     is on the other side and with that sign's arrow pointing down at it.

						     Still not a fourth control. The hub has no snowballs (`spec.throwing` is false),
						     so the slot this occupies is empty here, and the triangle below it is untouched:
						     Hüpf where it always is, the dash where it always is. It spans the TOP of the box
						     — 112..176 px up from the safe area — where the jump reaches 96 and the dash 96,
						     so nothing overlaps and no hit box moved.

						     Still not a trip-wire either, which is the half that matters: it exists only
						     while a door with something behind it is under the player's feet, and pressing
						     it is the only way in. Walking across the square cannot start a Royal.

						     `onclick`, not `onpointerdown` like the latched three: those are actions where
						     twenty milliseconds is felt, this one leaves the island, and a click is also
						     what makes Enter work for a keyboard player who has tabbed to it. -->
						<!-- The way into your own house, in the SAME slot as the way into a game, because it is
						     the same job: the one deliberate press that this place offers. Asked of
						     `doorHere.kind` rather than of an id — a kind is a decision and an id is a name,
						     which is `Door.kind`'s whole reason for existing.

						     Two lines like the game bar: the verb big, and under it what the next rung is
						     called and what it costs, both from `lib/igloo.ts` so a re-tuned payout moves
						     them. When the ladder is finished there is nothing to buy and the small line says
						     what the button is still good for. -->
						{#if doorHere?.kind === 'home'}
							<div class="absolute top-0 right-0 h-16 w-44">
								<button
									class="action cta mode-switch h-full w-full"
									onclick={() => (building = true)}
									aria-label="Iglu bauen"
									data-testid="igloo-open"
								>
									<span class="mode-switch-name">Bauen</span>
									<span class="mode-switch-count">
										{#if nextStep(stage)}
											{nextStep(stage)?.label} · {priceOf(stage)} ❄
										{:else}
											Reingehen
										{/if}
									</span>
								</button>
							</div>
						{/if}
						{#if doorGame}
							<div class="absolute top-0 right-0 h-16 w-44">
								<!-- **The bar names the game itself, and that is the fix for the second
								     regression rather than a flourish.** The name used to be the title of the
								     card above this button, and on a 568×320 screen the top-right row painted
								     straight over it: the card said "30 Pinguine · die Schollen brechen" and
								     never said *Royal*, which is half of what the card is for. The row wins
								     hit-testing by `z-10` and winning hit-testing means winning paint.
								     Anything that must be READ cannot live in the sixty pixels that row
								     occupies — so the name moved down here, where nothing is ever drawn over
								     it, and the card above kept only the rules, which fit in one short plaque
								     that clears the row by fourteen pixels.

								     Two lines in one button, in the `.mode-switch` classes written for
								     exactly that ("two lines to say in the space of one button"). The VERB is
								     the big line and the game is the small one, which is the opposite
								     emphasis to the mode switch on purpose: that button says which game it
								     will change to, and this one says what pressing it does.

								     The ▼ that used to sit on the card is gone with the title it pointed at.
								     Its job was to connect a name in one place to a button in another; a
								     button that carries the name does that job without it, and the eighteen
								     pixels it cost are what let the card clear the row. -->
								<button
									class="action cta mode-switch h-full w-full"
									onclick={enterDoor}
									aria-label="{doorGame.name} starten: {doorGame.copy.who}"
									data-testid="door-enter"
								>
									<span class="mode-switch-name">Los!</span>
									<span class="mode-switch-count">{doorGame.name} · {doorGame.copy.who}</span>
								</button>
							</div>
						{/if}
						{#if spec.dashing && !iAmOut}
							<!-- On the slide the dash shoves nobody, but it still SETS the velocity — so it
							     is a boost down the hill rather than an attack, and it is labelled as one.
							     Absent on the island (`spec.dashing` is false there): `npc/talk.ts` is what
							     walking up to somebody now does, and it needs no button at all. -->
							<div class="absolute bottom-4 left-0 h-20 w-20">
								<button
									class="action action-dash h-full w-full text-base"
									onpointerdown={press('dash', 18)}
									aria-label={spec.copy.dash.aria}
									style="opacity: {0.45 + dashReady * 0.55}"
								>
									{spec.copy.dash.label}
								</button>
							</div>
						{/if}
					</div>
				</div>
			</div>
		{/if}

		<!-- The rules of the game on the other side, in the one moment they are still free.
		     A child who pressed "Royal" without knowing what it meant used to find out by drowning.

		     RULES ONLY. The name is on the button below (see there for why), and this plaque is sized to
		     clear the top-right button row on the narrowest screen the game supports: two lines of 12 px
		     plus padding and rim is about 54 px, sitting 176 px up from the safe area, so its top edge is
		     at y≈74 on a 568×320 screen where that row ends at y=60. Fourteen pixels, measured against
		     the same face `app.css` measures the result panel's sixteen against. Anything taller than
		     this gets painted over by a row that wins the stacking order — which is what happened to the
		     word "Royal", and is why the name is not up here any more.

		     `pointer-events-none`, so it can overlap the button box by a pixel without ever eating a tap
		     meant for it: this is a sign, and the button underneath is the control.

		     Hidden while somebody is talking (Daniel, 2026-08-22: "too much text boxed re
		     overlapping"). The speech bubble moved to screen-centre specifically to sit OVER a door
		     sign rather than dodge it, and in practice that reads as two competing text blocks rather
		     than one layered scene — a passive "Öffnet bald" is not worth fighting an actual
		     conversation for the eye. The conversation wins: it is the thing the player asked for by
		     walking up to somebody, where this plaque is read on the way past. -->
		{#if doorHere && !speech}
			<div class="safe-b safe-r pointer-events-none absolute right-0 bottom-0">
				<div class="panel mb-44 max-w-52 px-3 py-2 text-right" data-testid="door">
					{#if doorGame}
						<p class="text-xs opacity-80">{doorGame.copy.rules ?? doorGame.copy.who}</p>
						<!-- **Said BEFORE the child commits, which is the whole job of this plaque.** The hub
						     is playable upright and three of the four games are not — so a child walking the
						     island in portrait would press a green button and be met by a card telling them
						     to turn the phone, with no warning that the door was the moment it mattered.
						     Asked of the mode's own `portrait` policy rather than of a list, so a game that
						     becomes playable upright stops warning on the day it does.

						     Only in portrait, so it costs nothing in landscape — and only ever in portrait,
						     where this plaque has a whole tall screen above it and the sixteen pixels it adds
						     cannot reach the button row. -->
						{#if tall && !doorGame.portrait}
							<p class="mt-1 text-xs font-bold" style="color: var(--danger)">
								Dafür Handy quer halten
							</p>
						{/if}
					{:else if doorHere.kind === 'home'}
						<!-- Your own doorstep. It keeps its name, because unlike a game's card there is no
						     second thing to say — and the button below says what pressing it does. -->
						<p class="text-base leading-tight font-extrabold">{doorHere.name}</p>
						<p class="text-xs opacity-80">
							{canBuild ? 'Du kannst was bauen!' : 'Dein Zuhause'}
						</p>
					{:else}
						<!-- A place with nothing behind it yet: Der Laden is a building before it is a
						     screen (story 10d). It gets a sign and no button, because a button that does
						     nothing is worse than no button — and here the sign is the only thing there is,
						     so it keeps its name. -->
						<p class="text-base leading-tight font-extrabold">{doorHere.name}</p>
						<p class="text-xs opacity-80">Öffnet bald</p>
					{/if}
				</div>
			</div>
		{/if}

		<!-- The instructions belong to every moment EXCEPT the round.
		     They stood on screen for the whole match, in the middle of the bottom edge, between the
		     two thumbs and over the ice — a sentence nobody re-reads while playing, in the one place
		     the eye keeps returning to (Daniel, 2026-08-16). During the countdown they are exactly
		     what a first-time player needs, and on the result screen they are what a child who has
		     just worked out why they lost is ready to read.

		     OUTSIDE the controls block, which is unmounted the moment a round is over — that block
		     is about controls that still do something, and this line outlives them. It keeps
		     `pointer-events-none` (the `.overlay` rule, and trap 4): it sits under the result panel's
		     own buttons and must never take a tap meant for "Nochmal".

		     Gone entirely when the host walked out: that screen is about a game that has stopped
		     existing, and telling somebody how to steer is the wrong thing to say on it. -->
		{#if phase !== 'playing' && !hostGone}
			<div class="safe-b pointer-events-none absolute inset-x-0 bottom-0 grid place-items-center">
				<!-- Two hints, one at a time, because naming both control schemes at once is a sentence
				     nobody finishes. The keys are named on a machine that has a real pointer, and from
				     the moment anybody presses one; the thumb version is the default everywhere else,
				     since a phone that offers keyboard instructions is telling a child about a
				     keyboard they do not have. -->
				<p class="pill px-3.5 py-1.5 text-center text-xs opacity-80" data-testid="hint">
					{#if hasMouse || usingKeys}
						<!-- No trailing "alles macht den Gegner schwindelig" on this branch: the key names
						     already cost half the line, and on a 568 px screen the sentence wrapped to two
						     lines and became the biggest thing on the countdown. -->
						<!-- Composed rather than tabulated, so the line says exactly what the buttons on
						     screen say: no Ball where the mode has no snowballs, and the dash under the
						     name that mode calls it. -->
						{`WASD oder Pfeiltasten · Leertaste Hüpf · ${
							spec.throwing ? 'J Ball · ' : ''
						}K ${spec.copy.dash.label}`}
					{:else}
						Links ziehen · Hüpf, Ball, Schubs — alles macht den Gegner kurz schwindelig
					{/if}
				</p>
			</div>
		{/if}

		<!-- Last in the DOM, so nothing can sit over it. The host walking out comes FIRST, because a
		     round that has stopped existing must not offer a "Nochmal" that restarts nothing. -->
		{#if hostGone}
			<!-- The BACKDROP takes no taps. It covers the whole screen, and the row of buttons in the
			     top corner is behind it — which is trap 4 in `CLAUDE.md` all over again, one layer up:
			     a control that is visible, looks pressable and silently is not. -->
			<div class="overlay p-6" data-testid="host-gone">
				<div class="panel px-8 py-6 text-center">
					<p class="text-2xl font-extrabold">Das Spiel ist weg</p>
					<p class="mt-2 opacity-80">Wer das Spiel gestartet hat, ist nicht mehr da.</p>
					<button
						class="action cta mt-5 h-16 w-48 text-xl"
						onclick={() => onAgain()}
						data-testid="again"
					>
						Zurück
					</button>
				</div>
			</div>
		{:else if phase === 'over'}
			<div class="overlay p-6" data-testid="result">
				<div class="panel result-panel px-8 py-6 text-center">
					<!-- Winning and losing used to differ by one word in the same weight and colour:
					     "Gewonnen!" against "Flauschi Flosse gewinnt", which states the fact and
					     leaves the child to work out that the fact is about them (Daniel,
					     2026-08-16). A loss now says so first, in its own colour, with a glyph — and
					     the winner's name follows as the detail rather than as the headline.

					     Never colour alone: the word carries it, the glyph carries it again, and
					     `--danger` only underlines what both already say. -->
					{#if iWon}
						<p class="result-glyph text-5xl leading-none">🏆{@render reward()}</p>
						<p class="mt-2 text-3xl font-extrabold" data-testid="result-verdict">Gewonnen!</p>
						<p class="result-note mt-1 text-sm opacity-80">{spec.copy.verdicts.won}</p>
					{:else if winner}
						<p class="result-glyph text-5xl leading-none">🌊{@render reward()}</p>
						<p
							class="mt-2 text-3xl font-extrabold"
							style="color: var(--danger)"
							data-testid="result-verdict"
						>
							Verloren
						</p>
						<p class="result-note mt-1 text-base">{spec.copy.verdicts.lost}</p>
						<p class="result-note mt-1 text-sm opacity-80">{spec.copy.verdicts.theirs(winner)}</p>
					{:else}
						<p class="result-glyph text-5xl leading-none">🌊{@render reward()}</p>
						<p class="mt-2 text-3xl font-extrabold" data-testid="result-verdict">
							{spec.copy.verdicts.nobody}
						</p>
						<p class="result-note mt-1 text-sm opacity-80">{spec.copy.verdicts.none}</p>
					{/if}
					<!-- The most prominent control on the screen, reachable in one tap, and the reason
					     there is no losing screen to sit in. -->
					<!-- BESIDE "Nochmal", not under it, and the reason is the arithmetic in `app.css`:
					     on a 568×320 landscape the result panel clears the mute button by sixteen
					     pixels, and a second row of buttons is sixty. That is trap 4 for the fifth
					     time — a control visible, apparently pressable and covered — so the way back
					     costs no height at all. `items-end` with a smaller top margin means the tallest
					     child is still "Nochmal" on both a tall screen (84 px) and a short one (61.6 px,
					     where `.panel .cta` shrinks it), so this row is exactly as tall as the single
					     button it replaces. -->
					<div class="result-actions flex items-end justify-center gap-3">
						<button
							class="action cta mt-5 h-16 w-48 text-xl disabled:opacity-40"
							disabled={!restartable}
							onclick={() => onAgain()}
							data-testid="again"
						>
							Nochmal
						</button>
						<!-- Offered only where there is somewhere to go back to, which is the route's
						     business and not this component's: it passed a way back, so there is one.

						     Second and smaller. The strongest wish an eight-year-old has in the two
						     seconds after a race is another race, so "Nochmal" keeps the one green CTA a
						     result screen is allowed — and this is the button that closes the loop rather
						     than the one that repeats it. 48 px, over the 44 px minimum. -->
						{#if onLeave}
							<button
								class="action mt-2 h-12 px-4 text-base"
								onclick={onLeave}
								data-testid="to-island"
							>
								Zur Insel
							</button>
						{/if}
					</div>
				</div>
			</div>
		{/if}
	{/if}
</div>
