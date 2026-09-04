import { expect, type Page, test } from '@playwright/test';
import { ALL_MODES, CHASE, SLIDE } from '../src/lib/sim/modes/registry';
import { storageKeys } from '../src/lib/storageKeys';

/**
 * What phase 0 has to be true for a real browser.
 *
 * The unit suite covers the simulation completely and covers the renderer not at all — nothing
 * under `render/` is meaningfully unit-testable, so this file is the only evidence that the two
 * halves are actually wired together. It deliberately asserts BEHAVIOUR the player would notice
 * (the penguin moves when the thumb moves) rather than that objects exist.
 */

/**
 * Every test in this file is testing something that happens AFTER the front door, not the front
 * door itself — that gate has its own file (`e2e/landing.spec.ts`). Called before every bare
 * `goto('/')` below so a fresh browser context lands exactly where it always has.
 */
async function skipLanding(page: Page): Promise<void> {
	await page.addInitScript(
		(key: string) => localStorage.setItem(key, 'true'),
		storageKeys.landingSeen
	);
}

/**
 * Open the look editor from the top row's ⚙, the way a player actually reaches it now.
 *
 * "Mein Pinguin" used to be its own button; it moved inside the settings sheet the ⚙ opens
 * (Daniel, 2026-08-22: too many topbar buttons), so getting there costs one extra tap the sheet
 * itself is that tap.
 */
async function openCustomise(page: Page): Promise<void> {
	await page.getByTestId('profile-open').click();
	await page.getByTestId('profile-look').click();
}

/** Same story as `openCustomise`, for "Mit Freunden" — also moved inside the settings sheet. */
async function openFriends(page: Page): Promise<void> {
	await page.getByTestId('profile-open').click();
	await page.getByTestId('profile-friends').click();
}

/** How many penguins the HUD says are still on the ice. */
async function standing(page: Page): Promise<number> {
	const text = await page.getByTestId('hud').innerText();
	const match = text.match(/Noch\s+(\d+)/);
	if (!match?.[1]) throw new Error(`no count in HUD text: ${JSON.stringify(text)}`);
	return Number.parseInt(match[1], 10);
}

/** What the instructions currently say, or nothing at all while a round is being played. */
async function hintText(page: Page): Promise<string> {
	const hint = page.getByTestId('hint');
	return (await hint.count()) > 0 ? hint.innerText() : '';
}

/**
 * Press "Los geht's!" if it is there.
 *
 * The first round of a visit waits for it — a game that starts counting down at somebody who has not
 * looked at the screen yet was losing before it began. Every round after it starts on its own, so
 * this is a no-op then.
 */
/**
 * Get the round moving, whether or not this screen is asking permission first.
 *
 * Two states are legal here and they look nothing alike. A FIRST visit holds the world and shows
 * "Los geht's!"; a rematch or a mode switch has already been decided and starts counting down on its
 * own. So this waits for whichever arrives — the button or the countdown — rather than for one of
 * them.
 *
 * Both simpler versions are wrong, and both were shipped. `count() > 0` answers "no button" before
 * Svelte has hydrated, so the click never happened and the round never started. Waiting for the
 * button instead burns the whole timeout on every screen that does not have one, and the countdown
 * it was waiting to see has finished by the time it gives up. Four failures and three flakes, in
 * two different shapes, from the same two lines.
 *
 * @returns whether it actually pressed anything, which is the only way the caller can know a
 * countdown is still ahead of it rather than behind.
 */
async function play(page: Page): Promise<boolean> {
	const button = page.getByTestId('play');
	const countdown = page.getByTestId('countdown');
	await expect(button.or(countdown).first()).toBeVisible({ timeout: 20_000 });
	if (await button.isVisible().catch(() => false)) {
		await button.click();
		return true;
	}
	return false;
}

/** Wait out the countdown and get into the round proper. */
async function intoPlay(page: Page): Promise<void> {
	// Only assert the countdown when this call is what started it. Arriving at a round that is
	// already running is not a failure, and demanding to see the beginning of it is how a helper
	// turns a rematch into a red test.
	if (await play(page)) await expect(page.getByTestId('countdown')).toBeVisible();
	await expect(page.getByTestId('countdown')).toBeHidden({ timeout: 8000 });
}

/**
 * Flail about until the round resolves.
 *
 * Not skilful and not meant to be — the assertion is that a round ENDS and names somebody, which is
 * true however badly it is played. Bots finish it if the player does not.
 */
async function playUntilResult(page: Page): Promise<void> {
	// A round is genuinely long now: the floe holds its full 7.6 m for 18 s and then takes 27 s to
	// shrink, so a badly played round can run past a minute before anybody is alone on the ice. That
	// is the pace `docs/DESIGN.md` asks for; it is the DEFAULT 30 s test timeout that is wrong for a
	// test whose subject is a whole round, and raising it here keeps every caller honest instead of
	// each of them remembering.
	test.setTimeout(150_000);

	const box = page.viewportSize();
	if (!box) throw new Error('no viewport');
	const dash = await page.getByRole('button', { name: 'Schubsen' }).boundingBox();

	for (let i = 0; i < 220; i++) {
		if (
			await page
				.getByTestId('result')
				.isVisible()
				.catch(() => false)
		)
			return;
		await page.mouse.move(box.width * 0.22, box.height * 0.62);
		await page.mouse.down();
		await page.mouse.move(
			box.width * 0.22 + Math.cos(i * 0.7) * 50,
			box.height * 0.62 + Math.sin(i * 0.7) * 50,
			{ steps: 2 }
		);
		await page.waitForTimeout(320);
		await page.mouse.up();
		if (dash && i % 4 === 0) {
			await page.mouse.move(dash.x + dash.width / 2, dash.y + dash.height / 2);
			await page.mouse.down();
			await page.mouse.up();
		}
	}
	throw new Error('the round never finished');
}

/**
 * One round's worth of "does the keyboard reach the simulation".
 *
 * Returns 'ok', or what stopped it — an eliminated penguin freezes the very readout being polled,
 * and a caller that cannot tell that apart from a broken key mapping will hunt the wrong bug.
 */
async function probeKeyboardDash(page: Page): Promise<string> {
	// A countdown may not be what is on screen — a previous attempt can have left a finished round —
	// and that is a reason to try again rather than a failure. Every other caller of `intoPlay` runs
	// on a page it has just loaded, so the tolerance lives here rather than in the helper.
	try {
		await intoPlay(page);
	} catch {
		return 'no round was starting';
	}
	const shove = page.getByRole('button', { name: 'Schubsen' });
	const readiness = () =>
		shove.evaluate((el) => Number.parseFloat((el as HTMLElement).style.opacity));

	// A short push on the steering key, released before the dash probe: held, it does what a held key
	// does and walks the penguin into the sea.
	await page.keyboard.down('KeyW');
	await page.waitForTimeout(250);
	await page.keyboard.up('KeyW');

	for (let i = 0; i < 10; i++) {
		if (
			await page
				.getByTestId('hud')
				.innerText()
				.then((t) => t.includes('draußen'))
		) {
			return 'the penguin was eliminated before the dash landed';
		}
		await page.keyboard.press('k');
		await page.waitForTimeout(200);
		if ((await readiness()) < 0.99) {
			// And it comes back: 90 ticks of cooldown, not a button left disabled.
			//
			// Polled by hand rather than with `expect.poll`, because the interesting case is not a
			// slow ring — it is a penguin that goes in the water WHILE the ring is recharging.
			// `tickCooldowns` stops running for an eliminated penguin, so the readout freezes wherever
			// it was and a plain poll waits out its timeout against a number that will never move
			// again. On a fast machine that is rare; on a CI runner it is most rounds, which is
			// exactly how this passed locally and failed in CI.
			for (let wait = 0; wait < 30; wait++) {
				if ((await readiness()) > 0.99) return 'ok';
				if (
					await page
						.getByTestId('hud')
						.innerText()
						.then((t) => t.includes('draußen'))
				) {
					return 'the penguin was eliminated while the ring recharged';
				}
				await page.waitForTimeout(200);
			}
			return 'the ring never recharged';
		}
	}
	return 'the ring never moved';
}

test.describe('the feel test', () => {
	test('boots into a running scene with no console errors', async ({ page }) => {
		const problems: string[] = [];
		page.on('console', (m) => {
			if (m.type() === 'error') problems.push(m.text());
		});
		page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));

		await skipLanding(page);
		await page.goto('/');

		// The WebGL failure path renders a message instead of the game. If that is what came up, the
		// test should say so rather than time out on a missing canvas.
		await expect(page.getByTestId('webgl-failure')).toHaveCount(0);
		await expect(page.locator('canvas')).toBeVisible();

		// A canvas exists even when the context died, so ask whether it actually has one.
		const hasContext = await page.evaluate(() => {
			const canvas = document.querySelector('canvas');
			return !!canvas?.getContext('webgl2');
		});
		expect(hasContext).toBe(true);
		expect(problems).toEqual([]);
	});

	test('counts down, then hands the round over', async ({ page }, testInfo) => {
		// Not in portrait: the first round waits for "Los geht's!" and the rotate card deliberately
		// makes everything behind it inert, so there is no way to start a round there — which is the
		// rotate card working, not a bug.
		test.skip(
			testInfo.project.name === 'portrait',
			'nothing behind the rotate card can be pressed'
		);
		await page.goto('/?mode=classic');
		await expect(page.locator('canvas')).toBeVisible();
		await intoPlay(page);
		expect(await standing(page)).toBe(4);
	});

	test('the floe is already moving before anyone touches it', async ({ page }, testInfo) => {
		// The swell runs whether or not the player does anything, and a tilt readout stuck at one
		// value is how a frozen game loop or a stalled accumulator would present.
		//
		// `?mode=classic` specifically, and `classic` declares `portrait: false` — this test predates
		// the portrait split becoming per-mode and was never given the skip guard every other
		// arena-mode test in this file has, so it was reading a HUD hidden behind the rotate card and
		// failing for a reason that has nothing to do with the swell (found 2026-08-22, running the
		// full three-project suite rather than one project at a time).
		test.skip(
			testInfo.project.name === 'portrait',
			'the HUD this test reads is behind the rotate card'
		);
		await page.goto('/?mode=classic');
		await expect(page.getByTestId('hud')).toBeVisible();

		const readings = new Set<string>();
		for (let i = 0; i < 6; i++) {
			readings.add(await page.getByTestId('hud').innerText());
			await page.waitForTimeout(400);
		}
		expect(readings.size).toBeGreaterThan(1);
	});

	test('dragging the stick moves the penguin, and releasing it lets it coast', async ({
		page
	}, testInfo) => {
		// Landscape only, and the reason is a feature rather than a limitation: in portrait the
		// rotate card covers the screen and deliberately makes every control inert, so this test
		// failed there on the game behaving correctly. The portrait half of the rule is asserted in
		// its own test below rather than skipped away.
		test.skip(testInfo.project.name === 'portrait', 'controls are inert behind the rotate card');

		// The whole control chain end to end: pointer → stickVector → InputFrame → step → renderer.
		await page.goto('/?mode=classic');
		await expect(page.locator('canvas')).toBeVisible();

		await intoPlay(page);

		const box = page.viewportSize();
		if (!box) throw new Error('no viewport');
		const startX = box.width * 0.2;
		const startY = box.height * 0.6;

		await page.mouse.move(startX, startY);
		await page.mouse.down();
		// The stick is captured on down and appears where the thumb landed.
		await expect(page.getByTestId('stick-base')).toBeVisible();
		await page.mouse.move(startX + 70, startY, { steps: 6 });
		await page.waitForTimeout(700);

		await page.mouse.up();
		await expect(page.getByTestId('stick-base')).toHaveCount(0);
	});

	test('plays from the keyboard on a machine with no thumb on it', async ({ page }, testInfo) => {
		test.skip(testInfo.project.name === 'portrait', 'controls are inert behind the rotate card');
		// Generous, because a round is up to ninety seconds and this test may have to wait for one to
		// finish before the instructions come back on screen.
		test.setTimeout(240_000);

		// The whole keyboard chain, and it is provable because the dash COOLDOWN lives in the
		// simulation: the ring on the shove button is `dashReadiness(me)`, so a key that dims it has
		// gone keydown → keyboard.ts → the latch → an InputFrame → `step` → back out to the HUD.
		// Nothing about a jump or a snowball is visible on screen, which is why this asserts the one
		// action that leaves a mark.
		await page.goto('/?mode=classic');
		await expect(page.locator('canvas')).toBeVisible();

		// The instructions, BEFORE any key is pressed: the thumb version, because nothing has told this
		// page there is a keyboard yet.
		await expect.poll(() => hintText(page), { timeout: 60_000 }).toContain('Links ziehen');

		// The dash probe goes SECOND, while a countdown is still guaranteed. It used to run after the
		// hint assertions, and those can legitimately spend a whole round waiting for the instructions
		// to come back — leaving the probe to look for a countdown on a result screen.
		//
		// Retried across rounds, because the simulation refuses a dash from a penguin that is dizzy or
		// mid-air and stops ticking cooldowns entirely for one in the water. Nobody is steering this
		// penguin, so that happens; three rounds, and the failure says which wall it hit.
		let outcome = 'never started a round';
		for (let attempt = 0; attempt < 3; attempt++) {
			outcome = await probeKeyboardDash(page);
			if (outcome === 'ok') break;
			await page.reload();
		}
		expect(outcome, 'the keyboard never drove the simulation in three rounds').toBe('ok');

		// And now the slow half: the hint says WASD from the moment a key is pressed. Polled rather
		// than asserted, because the instructions are deliberately absent while a round is playing —
		// so this may have to wait for the round the probe just played to finish.
		await page.keyboard.press('ArrowRight');
		await expect.poll(() => hintText(page), { timeout: 150_000 }).toContain('WASD');

		// Space is the jump, and a page that scrolls out from under the canvas when you jump is the
		// oldest bug on the web.
		await page.keyboard.press('Space');
		expect(await page.evaluate(() => window.scrollY)).toBe(0);
	});

	test('does not overflow horizontally', async ({ page }) => {
		await skipLanding(page);
		await page.goto('/');
		await expect(page.locator('canvas')).toBeVisible();
		const overflows = await page.evaluate(
			() => document.documentElement.scrollWidth > window.innerWidth
		);
		expect(overflows).toBe(false);
	});
});

/**
 * These used to be about ORIENTATION. They are now about a MODE that declares itself landscape-only,
 * and the rename is the point rather than tidying.
 *
 * `playwright.config.ts` calls the three-project split load-bearing because "portrait deliberately
 * makes the controls inert, so a portrait project running the gameplay tests fails on the feature
 * working correctly". That was true of the whole game and is now true of only part of it: the island
 * declares `portrait: true` in `sim/modes/`, is played with a follow camera that needs no arena fit,
 * and is the FRONT DOOR — so at `/` in a tall frame there is no card and the stick is live.
 *
 * Both tests below therefore deep-link an ARENA mode. What they assert has not changed at all; what
 * has changed is that the subject has a name. `backlog/stories/11-portrait.md` predicted this
 * inversion before the island existed, and predicting it is not the same as doing it — these two
 * went red on the first full run after the hub became portrait-playable.
 */
test.describe('a mode that declares itself landscape-only', () => {
	test('shows the card in portrait and gets out of the way in landscape', async ({
		page
	}, testInfo) => {
		// `?mode=classic` and not `/`: the front door is the island, which is portrait-playable.
		await page.goto('/?mode=classic');
		await expect(page.locator('canvas')).toBeVisible();

		const viewport = page.viewportSize();
		if (!viewport) throw new Error('no viewport');
		const portrait = viewport.height > viewport.width;

		// Asserted from the project's actual shape rather than skipped on one, so BOTH halves of the
		// rule are covered by the run: the portrait project proves the card appears, the landscape
		// projects prove it does not cover a game anyone is playing.
		const hint = page.getByTestId('rotate-hint');
		if (portrait) {
			await expect(hint, `${testInfo.project.name} is portrait; the card must show`).toBeVisible();
		} else {
			await expect(hint, `${testInfo.project.name} is landscape; the card must hide`).toBeHidden();
		}
	});

	test('makes the controls inert behind that card', async ({ page }, testInfo) => {
		test.skip(testInfo.project.name !== 'portrait', 'only meaningful in portrait');

		// The other half of the rule, and the one worth asserting: a card that merely LOOKS like it
		// covers the screen, while the joystick underneath still answers, is worse than no card —
		// the player drives a penguin they cannot see. Pressing where the stick would be must
		// produce no stick at all.
		await page.goto('/?mode=classic');
		await expect(page.locator('canvas')).toBeVisible();

		const box = page.viewportSize();
		if (!box) throw new Error('no viewport');
		await page.mouse.move(box.width * 0.25, box.height * 0.7);
		await page.mouse.down();
		await page.waitForTimeout(150);

		await expect(page.getByTestId('stick-base')).toHaveCount(0);
		await page.mouse.up();
	});

	test('and the HUB is the opposite: no card, and a stick that answers', async ({
		page
	}, testInfo) => {
		test.skip(testInfo.project.name !== 'portrait', 'only meaningful in portrait');

		// The half the old pair could not express, and the reason they had to be renamed. `ISLAND`
		// declares `portrait: true`, so in a tall frame the card must be ABSENT rather than hidden —
		// `app.css` makes the controls inert with `.rotate-hint ~ *`, so it is the element's absence
		// that gives the stick back, and a hidden card would leave every control dead while looking
		// like the feature working.
		await page.goto('/?mode=island');
		await expect(page.locator('canvas')).toBeVisible();
		await expect(page.getByTestId('hud')).toBeVisible({ timeout: 20_000 });

		await expect(page.getByTestId('rotate-hint')).toHaveCount(0);

		// The thumb corner answers at all.
		const box = page.viewportSize();
		if (!box) throw new Error('no viewport');
		await page.mouse.move(box.width * 0.2, box.height * 0.85);
		await page.mouse.down();
		await page.waitForTimeout(150);
		await expect(page.getByTestId('stick-base')).toHaveCount(1);
		await page.mouse.up();
		await expect(page.getByTestId('stick-base')).toHaveCount(0);
	});

	/**
	 * The slide and the chase joined the hub on 2026-08-22: `framing: 'bearing'` stands a fixed
	 * number of metres behind the racer and turns with the run rather than fitting an arena, so the
	 * narrow horizontal FOV that pushes `classic`/`royal`'s camera back in portrait never enters the
	 * picture — and the axis that matters, the run stretching away downhill or the sea lion closing
	 * in behind, is the TALL one on a portrait screen. `backlog/stories/11-portrait.md` names this
	 * the cheapest real win in the story. Same shape as the hub test above: no card, and a stick
	 * that answers.
	 */
	for (const mode of [SLIDE, CHASE]) {
		test(`and so is ${mode.name}: no card, and a stick that answers`, async ({
			page
		}, testInfo) => {
			test.skip(testInfo.project.name !== 'portrait', 'only meaningful in portrait');

			await page.goto(`/?mode=${mode.id}`);
			await expect(page.locator('canvas')).toBeVisible();
			// Unlike the hub, these are `isRound: true` — a fresh load shows "Los geht's!" rather than
			// dropping straight into `running`, and the joystick is not in the document until that is
			// tapped away. Deliberately just `play`, not the slower `intoPlay`: this test is about the
			// stick answering, not about the countdown finishing.
			await play(page);
			await expect(page.getByTestId('hud')).toBeVisible({ timeout: 20_000 });

			await expect(page.getByTestId('rotate-hint')).toHaveCount(0);

			const box = page.viewportSize();
			if (!box) throw new Error('no viewport');
			await page.mouse.move(box.width * 0.2, box.height * 0.85);
			await page.mouse.down();
			await page.waitForTimeout(150);
			await expect(page.getByTestId('stick-base')).toHaveCount(1);
			await page.mouse.up();
			await expect(page.getByTestId('stick-base')).toHaveCount(0);
		});
	}

	test('and the dash is reachable in the band the stick used to swallow', async ({
		page
	}, testInfo) => {
		test.skip(testInfo.project.name !== 'portrait', 'only meaningful in portrait');

		// THE ASSERTION THE PREVIOUS TEST DOES NOT MAKE, and the distinction is worth the extra test.
		//
		// Pressing at 20% × 85% of a 320-wide screen is inside the bottom-left quadrant AND inside the
		// old full-height left HALF, so it goes green whether or not the quadrant rule exists. It
		// proves the hub's stick answers; it proves nothing about where the zone stops.
		//
		// What the quadrant was introduced for is a 32 px band: on 320×640 the stick's old zone reached
		// x=160 and the dash button starts at x=128, so the dash's left 40% sat under an invisible
		// control that comes later in the DOM. The corrected figure matters — it was first measured as
		// the WHOLE button — because **40% is the worse bug**: a control that never answers gets
		// reported, while a control that answers unless you hit its inner edge produces "it doesn't
		// always work", and the inner edge is the one nearest a resting thumb. That is the same
		// unfalsifiable report trap 7 generated for a whole phase.
		//
		// Coordinates are literal rather than fractions on purpose: the point of interest IS a 32 px
		// band, and a fraction of the viewport would drift out of it on the next device size added.
		//
		// **On the MOUNTAIN, and it used to be the island.** The hub lost its dash when walking up to
		// somebody became the interaction (`npc/talk.ts`, and `Game.svelte` says so beside the button:
		// `spec.dashing` is false on the island now). So this guard was asserting a control that had
		// been deliberately deleted — the geometry it exists to protect was fine and the test was
		// pointing at nothing, which is a stale guard rather than a regression. The claim only needs a
		// mode that is BOTH portrait-playable and dashing, and the slide is the one the two tests
		// above already drive; the button's box is the same 176 px corner in every mode, so the band
		// under test is unchanged.
		await page.goto(`/?mode=${SLIDE.id}`);
		// `intoPlay`, not `play`, and it is the countdown that forces it: the hub was `running` the
		// moment it loaded, but a round holds its input until the counting stops. `play` alone puts
		// the dash button on screen with a full cooldown ring and a simulation that will not take the
		// press — which reads as "the tap was swallowed", the exact bug this test is here to catch.
		await intoPlay(page);
		await expect(page.getByTestId('hud')).toBeVisible({ timeout: 20_000 });

		// The label comes from the REGISTER, not from a string typed here. Each mode names its own dash
		// (`Schubsen` in an arena, `Anschieben` on the mountain), and a literal in this file would be a
		// copy of a fact that lives in `sim/modes/` — the mistake `tapMode` above was already fixed
		// for. Guessing it wrong is how this test first failed.
		const dash = page.getByLabel(SLIDE.copy.dash.aria, { exact: true }).first();
		const opacityOf = () =>
			dash.evaluate((el) => Number.parseFloat((el as HTMLElement).style.opacity));
		const before = await opacityOf();

		// Tapped up to five times, spaced, and that is about the MOUNTAIN rather than about the
		// button: one segment in nine carries a bump, a racer crossing one is briefly airborne, and a
		// dash asks for ground. A single tap therefore lands on nothing perhaps one run in three,
		// which reads as the tap being swallowed — the exact failure this test exists to detect, from
		// the exact opposite cause. Needing a second press on a bumpy descent is the mode working.
		let after = before;
		for (let i = 0; i < 5 && after >= before; i++) {
			await page.mouse.move(136, 568);
			await page.mouse.down();
			await page.mouse.up();
			await page.waitForTimeout(400);
			after = await opacityOf();
		}

		// Both halves are needed. The first says the joystick did NOT take the tap — remove the
		// quadrant rule and this is what fails. The second says the dash actually fired, rather than
		// the tap landing on nothing at all, which would satisfy the first assertion for the wrong
		// reason. `dashReady` drives the button's own inline opacity, so it is the observable the
		// keyboard test already relies on.
		await expect(page.getByTestId('stick-base')).toHaveCount(0);
		expect(after).toBeLessThan(before);
	});
});

test.describe('a round, start to finish', () => {
	test('ends, names a result, and restarts on one tap', async ({ page }, testInfo) => {
		test.skip(testInfo.project.name === 'portrait', 'controls are inert behind the rotate card');

		const problems: string[] = [];
		page.on('pageerror', (e) => problems.push(e.message));

		await page.goto('/?mode=classic');
		await intoPlay(page);
		await playUntilResult(page);

		const result = page.getByTestId('result');
		await expect(result).toBeVisible();
		// `Verloren` rather than the old `gewinnt`: a loss used to be stated as the winner's name plus
		// a verb, which leaves the child to work out that the sentence is about them.
		await expect(result).toContainText(/Gewonnen!|Verloren|Alle im Wasser!|Alle gefressen!/);

		// Two bugs live here, both found by this test rather than by reading the code.
		//
		// The first: the joystick covers the left half of the screen and came AFTER the result panel
		// in the DOM, so it swallowed every tap on the one control this screen exists for. The button
		// is now the last thing in the document and the controls are unmounted once the round is over.
		const again = page.getByTestId('again');
		await expect(again).toBeEnabled({ timeout: 4000 });
		await again.click();

		// The second: a rematch used to be a `{#key}` around MARKUP, which re-creates the DOM but not
		// the component instance — so `onMount` never ran again and the new canvas was attached to
		// nothing. It looked exactly like a frozen game. Asserting that the countdown comes back, and
		// that everyone is on the ice again, is what distinguishes a restart from a repaint.
		await expect(page.getByTestId('countdown')).toBeVisible({ timeout: 4000 });
		await intoPlay(page);
		expect(await standing(page)).toBe(4);

		expect(problems).toEqual([]);
	});

	test('ends the round rather than hanging when the host walks out', async ({
		context
	}, testInfo) => {
		test.skip(testInfo.project.name === 'portrait', 'controls are inert behind the rotate card');
		test.setTimeout(120_000);

		// `backlog/stories/04-peer-to-peer.md` asks for this by name, and a client cannot notice it on
		// its own: no snapshot is not an event, so it predicts happily forever and a child goes on
		// steering a game nobody is running.
		const problems: string[] = [];
		const host = await context.newPage();
		const guest = await context.newPage();
		guest.on('pageerror', (e) => problems.push(e.message));
		guest.on('console', (m) => {
			if (m.type() === 'error') problems.push(m.text());
		});

		await skipLanding(host);
		await host.goto('/');
		await openFriends(host);
		await host.getByTestId('play-host').click();
		const code = (await host.getByTestId('room-code').innerText()).trim();

		await skipLanding(guest);
		await guest.goto('/');
		await openFriends(guest);
		await guest.getByTestId('play-join').click();
		await guest.getByTestId('code-input').fill(code);
		await guest.getByTestId('join-room').click();

		await host.bringToFront();
		await expect(host.getByTestId('roster').locator('li')).toHaveCount(2, { timeout: 20000 });
		await host.getByTestId('start-round').click();
		for (const page of [guest, host]) {
			await page.bringToFront();
			await expect(page.getByTestId('countdown')).toBeHidden({ timeout: 15000 });
		}

		// The host's phone is put away mid-round.
		await host.close();
		await guest.bringToFront();
		await expect(guest.getByTestId('host-gone')).toBeVisible({ timeout: 15000 });

		// And the way out works. A screen that says the game is gone and then goes nowhere is the
		// same dead end with better wording.
		await guest.getByTestId('again').click();
		await expect(guest.locator('canvas')).toBeVisible({ timeout: 8000 });

		// Closing a transport twice — once by the session saying goodbye, once by the component that
		// created it — used to throw on the way out of every room.
		expect(problems).toEqual([]);
	});
});

test.describe('my penguin', () => {
	test('remembers a colour, a hat and a name across a reload', async ({ page }, testInfo) => {
		test.skip(
			testInfo.project.name === 'portrait',
			'the sheet is reachable behind the rotate card'
		);

		await skipLanding(page);
		await page.goto('/');
		await openCustomise(page);
		await expect(page.getByTestId('customise')).toBeVisible();

		const nameBefore = await page.getByTestId('chosen-name').innerText();
		await page.locator('.swatch').nth(4).click();
		await page.getByRole('button', { name: 'Bommel' }).click();
		await page.getByTestId('reroll').click();

		const nameAfter = await page.getByTestId('chosen-name').innerText();
		expect(nameAfter).not.toBe(nameBefore);
		// The one property the whole of DECISIONS/0004 rests on: a name is two words from two fixed
		// lists, and there is no way for a player to put anything else there.
		expect(nameAfter).toMatch(/^[\p{L}’]+ [\p{L}’]+$/u);

		await page.getByTestId('customise-done').click();
		await expect(page.getByTestId('customise')).toHaveCount(0);

		// Stored under the domain-descriptive namespace, never under the product name — invariant 5.
		const stored = await page.evaluate(() => ({
			look: localStorage.getItem('floe.look'),
			name: localStorage.getItem('floe.name'),
			keys: Object.keys(localStorage)
		}));
		expect(stored.look).toContain('bobble');
		expect(stored.name).toContain(nameAfter);
		for (const key of stored.keys) expect(key.startsWith('floe.')).toBe(true);

		await page.reload();
		await openCustomise(page);
		await expect(page.getByTestId('chosen-name')).toHaveText(nameAfter);
	});

	test('shows the penguin while it is being made, not after', async ({ page }, testInfo) => {
		test.skip(testInfo.project.name === 'portrait', 'the sheet is behind the rotate card');

		// Every control in this sheet used to be a bet settled after "Fertig". The portrait is drawn
		// by the GAME's renderer into a corner of its buffer and copied into an ordinary 2D canvas
		// here (`render/preview.ts`), which is what keeps the page at one WebGL context — and which
		// makes the pixels readable, so this asserts that a penguin actually arrived rather than that
		// a canvas exists.
		const problems: string[] = [];
		page.on('console', (m) => {
			if (m.type() === 'error') problems.push(m.text());
		});
		page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));

		await skipLanding(page);
		await page.goto('/');
		// Opened once and kept open. An open-and-close loop looked like a cheap way to prove the
		// renderer survives it, and it is a trap: "Mein Pinguin" exists only while nothing is being
		// played, so by the second lap the countdown had ended and the button was correctly gone.
		await openCustomise(page);

		const preview = page.getByTestId('preview');
		await expect(preview).toBeVisible();

		/** How many distinct colours the portrait contains. One means nothing was drawn into it. */
		const colours = () =>
			preview.evaluate((c) => {
				const canvas = c as HTMLCanvasElement;
				const ctx = canvas.getContext('2d');
				if (!ctx || canvas.width === 0) return 0;
				const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
				const seen = new Set<number>();
				for (let i = 0; i < data.length; i += 4) {
					seen.add(((data[i] ?? 0) << 16) | ((data[i + 1] ?? 0) << 8) | (data[i + 2] ?? 0));
				}
				return seen.size;
			});

		// A sky-blue box would be one or two colours; a lit penguin standing in it is hundreds.
		await expect.poll(colours, { timeout: 8000 }).toBeGreaterThan(20);

		// Changing the look rebuilds the actor on every tap. A leak or a disposal bug here is a
		// context lost after a handful of choices, so this makes a handful of them.
		for (const nth of [1, 3, 6]) await page.locator('.swatch').nth(nth).click();
		await page.getByRole('button', { name: 'Krone' }).click();
		await page.getByRole('button', { name: 'Spitz' }).click();
		await expect(preview).toBeVisible();
		expect(problems).toEqual([]);
	});

	test('names the penguin the player is steering, before the round starts', async ({
		page
	}, testInfo) => {
		test.skip(testInfo.project.name === 'portrait', 'everything is behind the rotate card');

		// Four penguins land on the ice and three of them are strangers. The arrow over the head and
		// the ring on the ice are the markers; this line is the half that can be asserted, and it has
		// to carry the SAME name the tag over that penguin's head does.
		await page.goto('/?mode=classic');
		const stored = await page.evaluate(() => localStorage.getItem('floe.name'));
		await play(page);
		await expect(page.getByTestId('thats-you')).toBeVisible();
		await expect(page.getByTestId('thats-you')).toContainText('Du bist');
		if (stored) await expect(page.getByTestId('thats-you')).toContainText(JSON.parse(stored));

		// It belongs to the countdown: once the round is on, the markers do the job and a panel in the
		// middle of the arena would be in the way of the thing it is pointing at.
		await intoPlay(page);
		await expect(page.getByTestId('thats-you')).toBeHidden();
	});
});

/**
 * Tap the mode button, waiting for a moment when it exists.
 *
 * It is on screen during the countdown and on the result screen, and gone in between — so on a busy
 * machine the countdown can end before a test gets to it, and the next opportunity is the end of the
 * round. Waiting for the label rather than for a phase keeps this honest about what it is doing.
 */
async function tapMode(page: Page, label: string): Promise<void> {
	// The label is checked against the REGISTER rather than against a union typed out here, and that
	// is not a widening — it is the fix for a stale one. This parameter read
	// `'Royal' | 'Klassisch' | 'Rutsche'` and three call sites were already passing `'Flucht'`, which
	// has been the game's fourth mode for days: a type error that nothing reported, because
	// `.svelte-kit/tsconfig.json` includes `src`, `test` and `tests` and this suite lives in `e2e`.
	// See `tsconfig.e2e.json`, which exists because of this line.
	//
	// A hand-typed union of mode names is one fact written down twice, and the register is where that
	// fact lives — so a fifth minigame can never leave this list behind, and a typo fails here with
	// the real list in the message instead of failing later as a 150-second wait for a button whose
	// label nobody has.
	const names = ALL_MODES.map((mode) => mode.name);
	expect(names, `"${label}" is not a mode this build has`).toContain(label);

	const button = page.getByTestId('royal');
	// The switch says the name of the game it switches TO and, under it, how many penguins that game
	// has — so this matches the NAME rather than the button's whole text.
	await expect(button.locator('.mode-switch-name')).toHaveText(label, { timeout: 150_000 });
	await button.click();
}

test.describe('the slide', () => {
	test('races six penguins down a mountain and names whoever gets there', async ({
		page
	}, testInfo) => {
		test.skip(testInfo.project.name === 'portrait', 'everything is behind the rotate card');
		test.setTimeout(180_000);

		const problems: string[] = [];
		page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));

		// Two taps round the cycle: classic → Royal → slide.
		await page.goto('/?mode=classic');
		await tapMode(page, 'Royal');
		await tapMode(page, 'Rutsche');

		// A race has PLACES, not survivors: "Noch 3 auf dem Eis" on a mountain would be telling a
		// child how many rivals had fallen off, which is not what they are trying to do.
		await expect(page.getByTestId('hud')).toContainText('Platz', { timeout: 30_000 });
		await expect(page.getByTestId('hud')).toContainText('von 6');
		await expect(page.getByTestId('mode-line')).toContainText('Rutsch runter');

		// Nothing to throw on the mountain — `attackStrength` is zero for the whole run, so a Ball
		// button would be visible, pressable and dead.
		await intoPlay(page);
		await expect(page.getByRole('button', { name: 'Schneeball werfen' })).toHaveCount(0);
		await expect(page.getByRole('button', { name: 'Anschieben' })).toBeVisible();

		// And somebody arrives. Nobody is steering the local penguin, so this is the bots racing —
		// which is the claim: a course that cannot be finished is a course, not a race.
		await expect(page.getByTestId('result')).toBeVisible({ timeout: 150_000 });
		expect(problems).toEqual([]);
	});

	test('goes back round the cycle to the classic round', async ({ page }, testInfo) => {
		test.skip(testInfo.project.name === 'portrait', 'everything is behind the rotate card');
		test.setTimeout(180_000);

		await page.goto('/?mode=classic');
		await tapMode(page, 'Royal');
		await tapMode(page, 'Rutsche');
		await tapMode(page, 'Flucht');
		await tapMode(page, 'Klassisch');
		await expect.poll(() => standing(page), { timeout: 30_000 }).toBe(4);
	});

	test('offers a way out while the run is still going, on a mode nobody is ever "out" of', async ({
		page
	}, testInfo) => {
		test.skip(testInfo.project.name === 'portrait', 'everything is behind the rotate card');
		test.setTimeout(60_000);

		// The slide never sets `iAmOut` — `SLIDE.overboard` is `recoverOnTheCourse`, not the water —
		// so the sideline exits and the result panel are both unreachable while it runs, for its whole
		// fifty-ish seconds. This is exactly the trap Daniel found twice (2026-08-22): a broken run
		// with genuinely no button on the screen to leave it from.
		await page.goto('/?mode=classic');
		await tapMode(page, 'Royal');
		await tapMode(page, 'Rutsche');
		await intoPlay(page);

		const pause = page.getByTestId('pause');
		await expect(pause).toBeVisible();
		// Not covered by the joystick's zone — trap 4's family — and not covered by the top-row, which
		// is hidden for exactly the phase this button lives in.
		await pause.click();

		const panel = page.getByTestId('paused');
		await expect(panel).toBeVisible();
		await expect(page.getByTestId('stick-base')).toHaveCount(0);
		await expect(page.getByTestId('pause-leave')).toBeVisible();
		await expect(page.getByTestId('pause-again')).toBeVisible();

		// "Weiter" is the CTA and closes the door without leaving the round — the mode is still going
		// underneath, so the countdown stays gone rather than restarting.
		await page.getByTestId('pause-resume').click();
		await expect(panel).toBeHidden();
		await expect(page.getByTestId('countdown')).toBeHidden();
	});
});

test.describe('the chase', () => {
	test('runs six penguins away from a sea lion and names whoever gets to the shore', async ({
		page
	}, testInfo) => {
		test.skip(testInfo.project.name === 'portrait', 'everything is behind the rotate card');
		test.setTimeout(240_000);

		const problems: string[] = [];
		page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));

		// Three taps round the cycle: classic → Royal → slide → chase.
		await page.goto('/?mode=classic');
		await tapMode(page, 'Royal');
		await tapMode(page, 'Rutsche');
		await tapMode(page, 'Flucht');

		// A chase has places, like a race — not survivors. What a child is trying to do here is get
		// away, and "Noch 3 auf dem Eis" answers a question nobody asked.
		await expect(page.getByTestId('hud')).toContainText('Platz', { timeout: 30_000 });
		await expect(page.getByTestId('hud')).toContainText('von 6');
		await expect(page.getByTestId('mode-line')).toContainText('Seelöwe');

		await intoPlay(page);

		// Snowballs and shoves are LIVE here, unlike the mountain: knocking a rival into the water
		// with something eating its way up the line behind them is the meanest thing in this game and
		// it is deliberately still possible.
		await expect(page.getByRole('button', { name: 'Schneeball werfen' })).toBeVisible();

		// And it resolves: somebody reaches the shore, or the sea lion has the rest. Nobody is
		// steering the local penguin, so this is the bots running.
		await expect(page.getByTestId('result')).toBeVisible({ timeout: 200_000 });
		expect(problems).toEqual([]);
	});
});

test.describe('the sidelines', () => {
	test('leaves a knocked-out player one thing to do, and says so', async ({ page }, testInfo) => {
		test.skip(
			testInfo.project.name === 'portrait',
			'the controls are inert behind the rotate card'
		);
		test.setTimeout(150_000);

		// Elimination stopped being a fail screen when the eliminated got a chunk of ice to watch
		// from; this is the other half. Nobody touches the controls in this test, so the penguin goes
		// in on its own — and what it finds on the other side is the assertion.
		const problems: string[] = [];
		page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));

		// In a ROYAL, and not only because that is the mode where twenty-nine children are watching
		// rather than three: a classic round is over within seconds of the local penguin going in —
		// nobody is steering it — and the controls are unmounted the moment a round ends, so there is
		// no window in which to assert what a spectator can still do.
		await page.goto('/?mode=classic');
		await page.getByTestId('royal').click();
		await intoPlay(page);
		await expect(page.getByTestId('hud')).toContainText('Du bist draußen', { timeout: 120_000 });

		// Told, in the second it happens, that the button still does something.
		await expect(page.getByTestId('hud')).toContainText('Wirf Schneebälle');

		// And the controls that no longer do anything are GONE rather than dead: a spectator cannot
		// steer, jump or shove, and a button that is visible, pressable and inert is trap 4.
		await expect(page.getByRole('button', { name: 'Schneeball werfen' })).toBeVisible();
		await expect(page.getByRole('button', { name: 'Springen' })).toHaveCount(0);
		await expect(page.getByRole('button', { name: 'Schubsen' })).toHaveCount(0);
		await expect(page.getByLabel('Steuerkreuz — Daumen aufsetzen und ziehen')).toHaveCount(0);

		// The one action, exercised: throwing from the sidelines must not throw an exception from
		// them either, which is the failure a fixed snowball pool would produce.
		for (let i = 0; i < 4; i++) {
			await page.getByRole('button', { name: 'Schneeball werfen' }).click({ force: true });
			await page.waitForTimeout(700);
		}
		expect(problems).toEqual([]);
	});
});

test.describe('Pingu Royal', () => {
	test('deals thirty penguins across a sea of floes, and takes the ice away', async ({
		page
	}, testInfo) => {
		test.skip(testInfo.project.name === 'portrait', 'everything is behind the rotate card');
		test.setTimeout(120_000);

		// The mode's two claims, end to end: thirty penguins really are in the round, and the sea
		// really does take them. Everything under it is unit-tested against the simulation; this is
		// the evidence that thirty actors, a dozen floes and a camera that follows one of them survive
		// contact with a real browser.
		const problems: string[] = [];
		page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));

		await page.goto('/?mode=classic');
		await expect(page.getByTestId('hud')).toBeVisible();
		await page.getByTestId('royal').click();

		// Thirty on the ice, where the classic round has four.
		await expect.poll(() => standing(page), { timeout: 20_000 }).toBe(30);
		// And the button offers the next game round the cycle, so there is always somewhere to go from
		// here without reading a menu.
		await expect(page.getByTestId('royal').locator('.mode-switch-name')).toHaveText('Rutsche');

		await intoPlay(page);

		// The field thins. Nobody is playing — this browser is not touching the controls — so what is
		// eliminating penguins is the game itself: the tilt, the bots, and the floes going under.
		// Twenty penguins is proof that the mode is eliminating people; waiting for fifteen costs
		// another half minute of a suite that CI runs one worker at a time.
		await expect.poll(() => standing(page), { timeout: 60_000 }).toBeLessThan(20);
		expect(problems).toEqual([]);
	});

	test('the front door is the island, and every key it writes is namespaced', async ({
		page
	}, testInfo) => {
		test.skip(testInfo.project.name === 'portrait', 'everything is behind the rotate card');

		// This test used to assert the opposite, and the change is deliberate rather than a
		// regression. It read: a child who picked the big game wants the big game next time, so the
		// chosen mode was persisted and decided what the app opened into. That was the right answer
		// while the modes were reached from a button beside the game. It is the wrong answer now that
		// there is an island — the front door is a PLACE, and a child who loved the mountain yesterday
		// walks to the mountain today instead of being teleported onto it. `identity.modeChosen` was
		// left write-only by that change, which is worse than dead code: a value written to a child's
		// device that nothing ever reads. It is gone, and so is the key it wrote.
		//
		// What is still worth asserting is the half that was never about the preference.
		await page.goto('/?mode=classic');
		await page.getByTestId('royal').click();
		// The cycle still works: pressing it really does start the big game.
		await expect.poll(() => standing(page), { timeout: 30_000 }).toBe(30);

		// And the way in, with nothing in the query string, is the island. `spec.name` is the mode's
		// own player-visible name from the registry, so this asserts the hub rather than a string this
		// file typed twice.
		await skipLanding(page);
		await page.goto('/');
		await expect(page.getByTestId('hud')).toContainText('Insel');

		// Under the `floe.` namespace like everything else — invariant 5.
		//
		// This check got THINNER when the mode preference was deleted, and it is worth saying so: it
		// used to run over a key that every visit wrote, and the island persists nothing of its own. So
		// it now names the one thing a visit really does write, rather than leaning on `keys.length > 0`
		// to prove there was anything to iterate — a loop over an empty array passes forever.
		//
		// The NAME and not the look, and the difference is a fact about `identity.ts` that asserting
		// the pair is what taught me: `nameChosen` generates and WRITES on first read, because a player
		// must keep the name they were given; `lookChosen` reads with a default and writes only when a
		// child actually picks something in "Mein Pinguin". So a visit that touches nothing persists
		// exactly one key, and this is it.
		const keys = await page.evaluate(() => Object.keys(localStorage));
		expect(keys).toContain('floe.name');
		for (const key of keys) expect(key.startsWith('floe.')).toBe(true);
	});
});

test.describe('two phones, one floe', () => {
	test('opens a room, lets a second player in, and plays one round across both', async ({
		context
	}, testInfo) => {
		test.skip(testInfo.project.name === 'portrait', 'controls are inert behind the rotate card');
		// Two tabs that have to take turns in the foreground cannot be quick. See the note on
		// throttling below — every wait here is bounded by how fast the tab it is watching is allowed
		// to run, not by the game.
		test.setTimeout(150_000);

		// TWO PAGES IN ONE CONTEXT, deliberately. `net/broadcast.ts` is a `Transport` over
		// BroadcastChannel, which reaches other tabs of the same browser and nothing else — it is not
		// the multiplayer the design is for, and `docs/DECISIONS/0005` is explicit that a link with no
		// NAT and no loss proves nothing about whether two phones connect. What it does prove is
		// everything ABOVE the network: the lobby, the roster, the session wiring and the screens. When
		// Trystero goes behind the same interface, a failure is known to be the network's.
		const problems: string[] = [];
		const host = await context.newPage();
		const guest = await context.newPage();
		for (const [page, tag] of [
			[host, 'host'],
			[guest, 'guest']
		] as const) {
			page.on('pageerror', (e) => problems.push(`${tag}: ${e.message}`));
		}

		await skipLanding(host);
		await host.goto('/');
		await openFriends(host);
		await host.getByTestId('play-host').click();
		const code = (await host.getByTestId('room-code').innerText()).trim();
		// Four letters, consonant-vowel-consonant-vowel, so it can be read out loud.
		expect(code).toMatch(/^[BDFGHJKLMNPRSTWXZ][AEU][BDFGHJKLMNPRSTWXZ][AEU]$/);

		await skipLanding(guest);
		await guest.goto('/');
		await openFriends(guest);
		await guest.getByTestId('play-join').click();
		await guest.getByTestId('code-input').fill(code);
		await guest.getByTestId('join-room').click();

		// Two names, and two DIFFERENT ones: both tabs share one localStorage, so they ask to be
		// called the same thing, and the lobby renames the second. Two identical tags over two heads
		// is the one collision a player notices instantly.
		// Watching the host, so the host is the tab allowed to run.
		await host.bringToFront();
		const roster = host.getByTestId('roster');
		await expect(roster.locator('li')).toHaveCount(2, { timeout: 20000 });
		const names = await roster.locator('li').allInnerTexts();
		expect(new Set(names).size).toBe(2);

		await host.getByTestId('start-round').click();
		for (const page of [host, guest]) {
			await expect(page.locator('canvas')).toBeVisible({ timeout: 8000 });
		}

		// Each page has to be IN FRONT to get through its own countdown. Chromium throttles
		// requestAnimationFrame in a hidden tab to about 1 Hz, so a backgrounded tab takes two minutes
		// over two seconds of countdown. Two phones are both in front; two tabs of one browser are
		// not, and every wait below has to take turns because of it.
		for (const page of [guest, host]) {
			await page.bringToFront();
			await expect(page.getByTestId('countdown')).toBeHidden({ timeout: 15000 });
		}
		expect(await standing(host)).toBe(2);
		expect(await standing(guest)).toBe(2);

		// Drive the guest at the rim until the HOST's world says somebody went in. The host is the
		// only authority, so its count changing is proof an input crossed the wire and was simulated
		// there — nothing a client draws for itself can move that number.
		//
		const box = guest.viewportSize();
		if (!box) throw new Error('no viewport');
		let crossed = false;
		for (let i = 0; i < 20 && !crossed; i++) {
			await guest.bringToFront();
			await guest.mouse.move(box.width * 0.22, box.height * 0.62);
			await guest.mouse.down();
			await guest.mouse.move(box.width * 0.22 + 70, box.height * 0.62, { steps: 3 });
			await guest.waitForTimeout(400);
			await guest.mouse.up();
			await host.bringToFront();
			await host.waitForTimeout(400);
			crossed =
				(await standing(host).catch(() => 2)) < 2 ||
				(await host
					.getByTestId('result')
					.isVisible()
					.catch(() => false));
		}
		expect(crossed, 'nothing the guest did ever reached the host').toBe(true);

		// And the two screens agree about it. A penguin drowned on one and skating on the other is
		// the disagreement no position tolerance covers.
		await host.waitForTimeout(600);
		const over = await host
			.getByTestId('result')
			.isVisible()
			.catch(() => false);
		if (!over) expect(await standing(guest)).toBe(await standing(host));

		expect(problems).toEqual([]);
	});

	test('ends the round rather than hanging when the host walks out', async ({
		context
	}, testInfo) => {
		test.skip(testInfo.project.name === 'portrait', 'controls are inert behind the rotate card');
		test.setTimeout(120_000);

		// `backlog/stories/04-peer-to-peer.md` asks for this by name, and a client cannot notice it on
		// its own: no snapshot is not an event, so it predicts happily forever and a child goes on
		// steering a game nobody is running.
		const problems: string[] = [];
		const host = await context.newPage();
		const guest = await context.newPage();
		guest.on('pageerror', (e) => problems.push(e.message));
		guest.on('console', (m) => {
			if (m.type() === 'error') problems.push(m.text());
		});

		await skipLanding(host);
		await host.goto('/');
		await openFriends(host);
		await host.getByTestId('play-host').click();
		const code = (await host.getByTestId('room-code').innerText()).trim();

		await skipLanding(guest);
		await guest.goto('/');
		await openFriends(guest);
		await guest.getByTestId('play-join').click();
		await guest.getByTestId('code-input').fill(code);
		await guest.getByTestId('join-room').click();

		await host.bringToFront();
		await expect(host.getByTestId('roster').locator('li')).toHaveCount(2, { timeout: 20000 });
		await host.getByTestId('start-round').click();
		for (const page of [guest, host]) {
			await page.bringToFront();
			await expect(page.getByTestId('countdown')).toBeHidden({ timeout: 15000 });
		}

		// The host's phone is put away mid-round.
		await host.close();
		await guest.bringToFront();
		await expect(guest.getByTestId('host-gone')).toBeVisible({ timeout: 15000 });

		// And the way out works. A screen that says the game is gone and then goes nowhere is the
		// same dead end with better wording.
		await guest.getByTestId('again').click();
		await expect(guest.locator('canvas')).toBeVisible({ timeout: 8000 });

		// Closing a transport twice — once by the session saying goodbye, once by the component that
		// created it — used to throw on the way out of every room.
		expect(problems).toEqual([]);
	});
});

test.describe('sound', () => {
	test('can be turned off from the game, and stays off', async ({ page }, testInfo) => {
		test.skip(testInfo.project.name === 'portrait', 'the row is behind the rotate card');

		await page.goto('/?mode=classic');
		await expect(page.locator('canvas')).toBeVisible();

		// Done on the RESULT screen rather than during the countdown, for two reasons. It is the half
		// worth asserting — the result panel covers the whole screen, and its backdrop used to swallow
		// every tap meant for this row, which is trap 4 in `CLAUDE.md` one layer up. And it is the
		// only moment that STAYS: the row is unmounted while a round is playing, so a countdown that
		// ended mid-test took the button out from under the click.
		await intoPlay(page);
		await playUntilResult(page);

		const mute = page.getByTestId('mute');
		await expect(mute).toHaveAttribute('aria-pressed', 'false');
		await mute.click();
		await expect(mute).toHaveAttribute('aria-pressed', 'true');

		expect(await page.evaluate(() => localStorage.getItem('floe.muted'))).toBe('true');

		// A child who turned the sound off did not mean "until you reload".
		await page.reload();
		expect(await page.evaluate(() => localStorage.getItem('floe.muted'))).toBe('true');
		await expect(page.getByTestId('mute')).toHaveAttribute('aria-pressed', 'true');
	});
});

test.describe('installable and offline', () => {
	test('ships a manifest that names the game and asks for the whole screen', async ({ page }) => {
		await skipLanding(page);
		await page.goto('/');

		// The link has to be in the document, not just the file on the server: a manifest nothing
		// points at is a manifest no browser will ever offer to install.
		const href = await page.locator('link[rel="manifest"]').getAttribute('href');
		expect(href).toBeTruthy();

		const response = await page.request.get(href as string);
		expect(response.status()).toBe(200);
		const manifest = await response.json();

		// Generated from `brand.ts` rather than hand-written into `static/` — invariant 5. If this
		// ever disagrees with the document title, the manifest has been forked from the brand module.
		//
		// Waited for first, and that is a flake fix rather than a nicety: `goto` resolves on load and
		// the title arrives with the app, so the comparison could read `''` against `PinguIsland` and
		// report a forked manifest while both halves were perfectly correct. It failed about one run
		// in three, always on a different project, which is exactly the shape that gets rerun until
		// it is green instead of being read.
		await expect(page).toHaveTitle(/\S/);
		expect(manifest.name).toBe((await page.title()).split('—')[0]?.trim());
		expect(manifest.display).toBe('fullscreen');
		expect(manifest.orientation).toBe('landscape');
		// A maskable icon is what stops Android cropping the penguin's head off on a round launcher.
		expect(manifest.icons.some((i: { purpose: string }) => i.purpose === 'maskable')).toBe(true);
	});

	test('plays with the network off', async ({ page, context }) => {
		// The whole promise of the game — no backend, nothing to fetch — was true of the code and
		// false in a browser, which showed the offline dinosaur for a page it had every byte of.
		await skipLanding(page);
		await page.goto('/');
		await expect(page.locator('canvas')).toBeVisible();
		await page.evaluate(() => navigator.serviceWorker.ready);
		// `claim()` in `activate` is what makes THIS tab controlled without a reload; the tab that
		// installed the worker is exactly the one about to walk out of wifi range.
		await expect
			.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 10000 })
			.toBe(true);

		await context.setOffline(true);
		await page.reload();
		await expect(page.locator('canvas')).toBeVisible({ timeout: 15000 });
		// Not just the shell: a canvas with no WebGL context would pass a visibility check while the
		// game was a blue rectangle.
		expect(
			await page.evaluate(() => !!document.querySelector('canvas')?.getContext('webgl2'))
		).toBe(true);
		await context.setOffline(false);
	});

	test('does not grab the screen off a mouse click', async ({ page }, testInfo) => {
		test.skip(testInfo.project.name === 'portrait', 'the row is behind the rotate card');

		// Playwright's projects are mouse-driven, i.e. `(pointer: coarse)` is false, which is the
		// desktop rule in `lib/fullscreen.ts`: a page that goes fullscreen because you clicked in it
		// is a page nobody trusts. The phone path is the one that cannot be asserted here — no
		// headless browser will enter fullscreen on a synthetic gesture — so what this pins down is
		// the restraint, plus the button that covers every case the automatic path cannot.
		await skipLanding(page);
		await page.goto('/');
		await expect(page.locator('canvas')).toBeVisible();
		await page.mouse.click(400, 200);
		expect(await page.evaluate(() => !!document.fullscreenElement)).toBe(false);
		await expect(page.getByTestId('fullscreen')).toBeVisible();
	});
});

test.describe('what the round says', () => {
	test('keeps the instructions out of the game and brings them back after', async ({
		page
	}, testInfo) => {
		test.skip(testInfo.project.name === 'portrait', 'everything is behind the rotate card');

		// The line sat on screen for the whole match, in the middle of the bottom edge between the
		// two thumbs (Daniel, 2026-08-16). It belongs to the countdown and to the result screen.
		await page.goto('/?mode=classic');
		await expect(page.getByTestId('hint')).toBeVisible();
		await intoPlay(page);
		await expect(page.getByTestId('hint')).toBeHidden();

		await playUntilResult(page);
		await expect(page.getByTestId('hint')).toBeVisible();
	});

	test('says whether you won or lost, and never names a bot', async ({ page }, testInfo) => {
		test.skip(testInfo.project.name === 'portrait', 'the controls are inert behind the card');

		await page.goto('/?mode=classic');
		await intoPlay(page);
		await playUntilResult(page);

		// One of the three verdicts, in its own line rather than as a name plus a verb — losing used
		// to read "Flauschi Flosse gewinnt", which states a fact and leaves the child to work out
		// that the fact is about them.
		await expect(page.getByTestId('result-verdict')).toBeVisible();
		const verdict = (await page.getByTestId('result-verdict').innerText()).trim();
		expect(['Gewonnen!', 'Verloren', 'Alle im Wasser!', 'Alle gefressen!']).toContain(verdict);

		// And the winner is a NAME. `world.round.winner` is a penguin id, and solo those ids are
		// `bot1`..`bot3`; one used to be printed verbatim.
		const panel = await page.getByTestId('result').innerText();
		expect(panel).not.toMatch(/bot\d/);
	});
});
