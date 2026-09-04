/**
 * Getting the browser out of the way.
 *
 * A phone browser spends 15–20% of a landscape screen on an address bar and a gesture area, and
 * this game is a fixed camera fitted to the arena: every pixel it loses makes every penguin
 * smaller. So the game asks for the screen, in the two ways that exist, and neither of them is
 * available to a page that simply wants it:
 *
 *  * **Installed**, the manifest's `display: fullscreen` does it with no code at all and no prompt.
 *    That is the good path, and it is why the app is installable (`routes/manifest.webmanifest`).
 *  * **In a tab**, the Fullscreen API needs a USER GESTURE. `requestFullscreen()` outside one is
 *    rejected, and on iPhone Safari it does not exist at all — `Element.requestFullscreen` is
 *    unimplemented there to this day, which is why nothing here treats fullscreen as reachable and
 *    the game is playable, laid out and tested without it.
 *
 * Everything below is therefore best-effort and silent on failure. A game that cannot get the
 * screen is a game with a smaller screen; a game that shows a child an error about the Fullscreen
 * API is a broken game.
 *
 * ## Turning the phone, which is the other half
 *
 * Asked for on 2026-08-21: *"we need an auto screen switch? like clash of clans does it.. i have
 * friends too 'stupid' for changing their screen direction"*. Clash of Clans is a native app that
 * declares its orientation and lets the OS turn the picture; the web has exactly two ways to ask for
 * the same thing, and this is the honest map of where each one lands:
 *
 *  * **Installed** — the manifest's `orientation: 'landscape'`. Costs nothing, needs no code, and is
 *    the only route that works before the first touch. Android honours it. **iOS ignores it**, along
 *    with the rest of the manifest's display fields.
 *  * **In a tab** — `screen.orientation.lock('landscape')`, which every implementation refuses
 *    outside fullscreen, so it rides along with the request above. Chrome and Samsung Internet on
 *    Android do it. **iOS Safari implements no Screen Orientation API at all**, in a tab or
 *    installed, and has never shipped one.
 *
 * So: on Android the phone turns itself. On iPhone nothing here can turn anything, and the rotate
 * card in `app.css` is not a fallback but the entire mechanism — which is why that card is a big
 * animated phone and three words rather than a paragraph. Saying this out loud in one place, because
 * "the orientation lock is in the code" reads like the problem is solved for everybody, and it is
 * solved for about half the audience.
 *
 * Rotating the CONTENT 90° in portrait was considered as a way to reach the other half and is not
 * done here. It is not a stylesheet change: `input/joystick.ts` derives its steering from pointer
 * deltas in untransformed viewport space, so a rotated container rotates the controls by 90° — trap
 * 7, which cost a phase of "the controls feel off" — and `env(safe-area-inset-*)` stops naming the
 * edges it is used for. See the report for what it would actually cost.
 */

/** What the decision depends on. Passed in rather than read, so the rule can be tested. */
export interface FullscreenEnv {
	/** Does this browser have the API at all? False on iPhone Safari. */
	supported: boolean;
	/** Are we already filling the screen — by API, or because the app was installed? */
	already: boolean;
	/** A touch screen, i.e. `(pointer: coarse)`. */
	coarse: boolean;
}

/**
 * Should the first tap take the screen?
 *
 * Auto-entering on a gesture the player made for another reason is a liberty, and it is taken
 * deliberately: the audience is 8–12, the game is landscape-only and full-bleed, and asking a nine
 * -year-old to find a fullscreen button before the game looks right is a worse trade than a browser
 * chrome that disappears when they start playing. Escape, the back gesture and the system swipe all
 * still leave — this cannot trap anybody.
 *
 * `coarse` is what keeps it off the desktop, and that is not a device sniff for its own sake: on a
 * laptop the window is already the size the player chose, a click anywhere is not necessarily a
 * request to play, and a page that goes fullscreen when you click it is a page nobody trusts. It is
 * also what keeps the development loop and the end-to-end suite in an ordinary window.
 */
export function shouldAutoEnter(env: FullscreenEnv): boolean {
	return env.supported && env.coarse && !env.already;
}

/** What the orientation decision depends on. Passed in rather than read, so the rule can be tested. */
export interface OrientationEnv {
	/** Does this browser implement `screen.orientation.lock`? False on every iOS browser. */
	lockable: boolean;
	/** Filling the screen — by API or because the app was installed. */
	fullscreen: boolean;
	/** A touch screen, i.e. `(pointer: coarse)`. */
	coarse: boolean;
}

/**
 * Should we ask the phone to turn?
 *
 * All three conditions are refusals rather than preferences, which is why this is a decision worth
 * naming instead of a condition worth inlining:
 *
 *  * `lockable` — iOS has no API to call. Calling it anyway is a rejected promise on every launch.
 *  * `fullscreen` — every implementation refuses `lock()` outside fullscreen. This is the condition
 *    the old code expressed by only ever calling `lock()` on the line after `requestFullscreen()`
 *    resolved, which is correct and also the reason an ALREADY-fullscreen app never asked at all.
 *  * `coarse` — a laptop has no orientation to lock, and locking the one thing a desktop browser
 *    might honour would be taking a liberty with a window the player sized themselves.
 *
 * Deliberately NOT conditional on the mode. The island is playable upright (`sim/modes/island.ts`
 * declares `portrait: true`) and this still asks for landscape there, because the island is playable
 * in landscape too and a game that re-orients the phone when you walk through a door would be worse
 * than one that picks a side. That policy field is what decides whether the rotate card appears when
 * the lock does not work — a permission for the fallback, not an instruction to this.
 */
export function shouldLockLandscape(env: OrientationEnv): boolean {
	return env.lockable && env.coarse && env.fullscreen;
}

/** Does this browser implement the orientation lock? No iOS browser does. */
export function orientationLockable(): boolean {
	return typeof screen !== 'undefined' && typeof screen.orientation?.lock === 'function';
}

/**
 * Ask for landscape, if asking can work. Best-effort and silent, like everything else here.
 *
 * `'landscape'` rather than `'landscape-primary'`, so a child holding the phone with the camera on
 * the right is not fought by the game for holding it the other way round.
 */
export async function lockLandscape(): Promise<void> {
	if (
		!shouldLockLandscape({
			lockable: orientationLockable(),
			fullscreen: isFullscreen(),
			coarse: isCoarse()
		})
	) {
		return;
	}
	try {
		await screen.orientation.lock('landscape');
	} catch {
		// Refused — some Android builds allow the API and deny the request. The rotate card covers it.
	}
}

/** A touch screen. One reader, because three call sites used to spell out the same media query. */
export function isCoarse(): boolean {
	return globalThis.matchMedia?.('(pointer: coarse)').matches ?? false;
}

/** Is the document filling the screen right now, by either route? */
export function isFullscreen(): boolean {
	if (typeof document === 'undefined') return false;
	if (document.fullscreenElement) return true;
	// An installed app is fullscreen without the API ever being involved, and asking the API would
	// answer "no" while the game covers the whole screen — which would put an "enter fullscreen"
	// button on a screen that has nothing left to give.
	return globalThis.matchMedia?.('(display-mode: fullscreen), (display-mode: standalone)').matches;
}

/** Does this browser implement the API? */
export function fullscreenSupported(): boolean {
	return typeof document !== 'undefined' && !!document.documentElement.requestFullscreen;
}

/**
 * Take the screen, and then ask the phone to turn.
 *
 * The order is the whole reason these are two calls and not one: `lock()` is refused outside
 * fullscreen, so it can only be asked for once this has succeeded. `lockLandscape` re-checks
 * `isFullscreen()` rather than trusting that, because it has a second caller that did not just
 * enter — see `armFullscreen`.
 */
export async function enterFullscreen(): Promise<void> {
	if (!fullscreenSupported()) return;
	try {
		await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
	} catch {
		// Denied, or no gesture. Not an error worth a word to anybody: the game is fine in a tab.
		return;
	}
	await lockLandscape();
}

/** Give it back, orientation included — the same support test the lock uses, the other way round. */
export async function exitFullscreen(): Promise<void> {
	try {
		if (orientationLockable()) screen.orientation.unlock();
		if (document.fullscreenElement) await document.exitFullscreen();
	} catch {
		// Nothing to do about it, and nothing worth saying.
	}
}

/**
 * Ask for the screen on the first touch anywhere, and ask for landscape whenever we have it.
 *
 * The same shape as the audio unlock in `audio/sound.ts` and for the same reason: "browsers gate
 * this behind a gesture" is a fact about the browser, not about any one screen, and a handler on
 * the game component would miss a first touch that landed on the start screen or in a room. Capture
 * so a control that stops propagation cannot swallow it, `once` so it costs one listener per arming.
 *
 * Three things happen here, and the last two exist because the orientation lock used to be reachable
 * only down the first of them:
 *
 *  1. **The first touch takes the screen**, if `shouldAutoEnter` says so, and `enterFullscreen` asks
 *     for landscape on the way.
 *  2. **A lock attempt at mount.** An INSTALLED app is already fullscreen, so `shouldAutoEnter` is
 *     false, so `enterFullscreen` never runs, so nothing ever asked for landscape — the manifest was
 *     carrying that case alone. Android honours the manifest; a browser that honours `display` but
 *     not `orientation` left an installed app upright with no code path that would have fixed it.
 *  3. **Re-arming when the game comes BACK.** `once` meant the auto-enter was spent for the life of
 *     the page: a phone call, an app switch or a screen lock drops fullscreen, and from then on the
 *     game sat in a tab with the address bar back and the orientation unlocked until somebody found
 *     the button. Keyed on `visibilitychange` rather than on `fullscreenchange`, and that is a
 *     deliberate limit: leaving fullscreen by gesture while staying on the page is a decision the
 *     player made and gets to keep — re-entering on their next tap would be a fight. Coming back to
 *     a game that lost the screen while it was in the background is not the same event.
 *
 * Returns its own undo, because a component that armed it must be able to disarm it — without that,
 * a hot reload or a remount would stack listeners.
 */
export function armFullscreen(): () => void {
	if (typeof document === 'undefined') return () => {};

	let armed = false;

	const onFirstTouch = () => {
		// `once` has already removed it by the time this runs, so the flag has to be cleared here or
		// re-arming would be a no-op forever.
		armed = false;
		if (
			shouldAutoEnter({
				supported: fullscreenSupported(),
				already: isFullscreen(),
				coarse: isCoarse()
			})
		) {
			void enterFullscreen();
		}
	};

	const arm = () => {
		if (armed) return;
		armed = true;
		document.addEventListener('pointerdown', onFirstTouch, { capture: true, once: true });
	};

	const onVisible = () => {
		if (document.visibilityState !== 'visible') return;
		// Whichever of the two applies: still fullscreen, so just re-assert the orientation; or the
		// background took it, so the next touch may have it back.
		void lockLandscape();
		arm();
	};

	arm();
	void lockLandscape();
	document.addEventListener('visibilitychange', onVisible);

	return () => {
		document.removeEventListener('pointerdown', onFirstTouch, { capture: true });
		document.removeEventListener('visibilitychange', onVisible);
	};
}
