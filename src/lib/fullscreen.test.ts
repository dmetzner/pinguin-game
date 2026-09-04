import { describe, expect, it } from 'vitest';
import {
	type FullscreenEnv,
	type OrientationEnv,
	shouldAutoEnter,
	shouldLockLandscape
} from './fullscreen';

/**
 * Only the DECISION is tested here, and that is the whole reason it is a separate function.
 *
 * Everything around it — `requestFullscreen`, the orientation lock, the `pointerdown` listener — is
 * browser API that a unit test can only assert against its own mock of the browser, which proves
 * that the mock was called. The end-to-end suite covers the parts that matter about the wiring: the
 * button exists, and a desktop-shaped run does NOT go fullscreen on the first click.
 */
const env = (over: Partial<FullscreenEnv> = {}): FullscreenEnv => ({
	supported: true,
	already: false,
	coarse: true,
	...over
});

describe('shouldAutoEnter', () => {
	it('takes the screen on a phone', () => {
		expect(shouldAutoEnter(env())).toBe(true);
	});

	it('leaves a mouse-driven window alone', () => {
		// A desktop window is the size the person chose. A page that goes fullscreen because you
		// clicked in it is a page nobody trusts — and this is also what keeps `npm run dev` and the
		// Playwright suite in an ordinary window.
		expect(shouldAutoEnter(env({ coarse: false }))).toBe(false);
	});

	it('does not ask twice', () => {
		// `already` is true both after the API succeeded AND for an installed app, which is
		// fullscreen through the manifest with the API never involved.
		expect(shouldAutoEnter(env({ already: true }))).toBe(false);
	});

	it('gives up quietly where there is no API', () => {
		// iPhone Safari, to this day. The game is laid out and playable without it; the manifest is
		// the route to a full screen there, via "Zum Home-Bildschirm".
		expect(shouldAutoEnter(env({ supported: false }))).toBe(false);
	});
});

/**
 * The other decision in that file, and the one Daniel actually asked for: *"we need an auto screen
 * switch? like clash of clans does it"*.
 *
 * All three conditions below are REFUSALS — a browser that will reject the call, or a device with
 * nothing to rotate — which is why they are worth a named function rather than an `if` at one call
 * site. The function grew a second call site immediately (`armFullscreen` asks at mount, for the
 * installed app that is already fullscreen and therefore never enters), and that is the case these
 * tests exist to pin: the rule may not be "we just called requestFullscreen".
 */
const orient = (over: Partial<OrientationEnv> = {}): OrientationEnv => ({
	lockable: true,
	fullscreen: true,
	coarse: true,
	...over
});

describe('shouldLockLandscape', () => {
	it('turns a phone that is filling the screen', () => {
		expect(shouldLockLandscape(orient())).toBe(true);
	});

	it('asks even when this code was not the thing that went fullscreen', () => {
		// The whole point of the second call site. An installed app starts fullscreen, so
		// `shouldAutoEnter` is false and `enterFullscreen` never runs — and for as long as the lock
		// lived inside `enterFullscreen`, an installed app never asked to be turned at all. The
		// manifest was carrying that case by itself, which is fine on Android and nowhere else.
		expect(shouldAutoEnter({ supported: true, already: true, coarse: true })).toBe(false);
		expect(shouldLockLandscape(orient({ fullscreen: true }))).toBe(true);
	});

	it('does not ask outside fullscreen, because every implementation refuses there', () => {
		// Not politeness: `lock()` rejects outside fullscreen, and an unhandled rejection on every
		// launch is a console error in a game that is otherwise silent about what it cannot have.
		expect(shouldLockLandscape(orient({ fullscreen: false }))).toBe(false);
	});

	it('does not ask on iOS, where there is no API to ask with', () => {
		// No iOS browser implements the Screen Orientation API, in a tab or installed. This is the
		// case the rotate card in `app.css` is the entire mechanism for rather than a fallback to.
		expect(shouldLockLandscape(orient({ lockable: false }))).toBe(false);
	});

	it('leaves a laptop alone, which has no orientation to lock', () => {
		// Same restraint as `shouldAutoEnter`, and the same side effect: it keeps `npm run dev` and
		// the Playwright projects in a window nobody rotated.
		expect(shouldLockLandscape(orient({ coarse: false }))).toBe(false);
	});
});
