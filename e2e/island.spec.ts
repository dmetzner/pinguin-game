import { expect, type Page, test } from '@playwright/test';
import { EIS_FOR_FINISHING, EIS_FOR_WINNING, SAVE_VERSION } from '../src/lib/eis';
import { priceOf } from '../src/lib/igloo';
import { CHASE } from '../src/lib/sim/modes/registry';

/**
 * The loop: the island needs no answering, a place offers its game, and finishing comes back to it.
 *
 * Four modes reached from a cycle button are four modes; four modes reached by walking to them are a
 * game. This file is the only evidence that the walking, the offer, the entry and the return are
 * actually wired to each other — the simulation's half is unit-tested (`sim/island.test.ts`,
 * `sim/modes/registry.test.ts`) and the component's half is not testable any other way.
 *
 * It asserts BEHAVIOUR a child would notice, in the same spirit as `game.spec.ts`: that the front
 * door needs no answering, that crossing a place cannot start a game by itself, and that the game you
 * walked to puts you back where you were standing.
 */

/**
 * The island, by link.
 *
 * Deep-linked rather than reached at `/`, and deliberately so: `routes/+page.svelte` holds the front
 * door behind one named constant (`FRONT_DOOR`) that the art director flips once the island is a place
 * worth arriving at, and a suite that asserted today's default would go red on the commit that flips it
 * and again on any commit that flipped it back. `?mode=` is the same door `e2e/shots.spec.ts` uses and
 * it works on both sides of that decision, so nothing in this file needs to change when it is made.
 */
const ISLAND = '/?mode=island';

/** How much Eis the island says the player has. */
async function eis(page: Page): Promise<number> {
	const text = await page.getByTestId('eis').innerText();
	const match = text.match(/(\d+)/);
	if (!match?.[1]) throw new Error(`no number in the Eis plaque: ${JSON.stringify(text)}`);
	return Number.parseInt(match[1], 10);
}

/** What the readout says. On the island that is where you are, not how many are left. */
async function readout(page: Page): Promise<string> {
	return page.getByTestId('hud').innerText();
}

/**
 * One push on the stick, from a resting thumb, and then a pause to settle.
 *
 * For LEAVING somewhere, which is all a pulse can be trusted to do — see `walkTo` for why arriving
 * somewhere needs a held stick instead. Ice keeps what you give it (`ICE_DRAG` is 0.72 per second),
 * so a push and a pause is how a test steps off a place rather than through it.
 *
 * `dx` is in stick units: +1 is a full push right, which is +x in the world and therefore east. That
 * is `stickVector` passing `dx` straight through and the rig standing on the +z side looking along
 * −z (`render/camera.ts`) — derived from the code rather than from a sentence about the screen,
 * because trap 7 was exactly a sentence about the screen.
 */
async function nudge(page: Page, dx: number): Promise<void> {
	const box = page.viewportSize();
	if (!box) throw new Error('no viewport');
	const x = box.width * 0.22;
	const y = box.height * 0.62;
	await page.mouse.move(x, y);
	await page.mouse.down();
	await page.mouse.move(x + dx * 70, y, { steps: 3 });
	await page.waitForTimeout(120);
	await page.mouse.up();
	await page.waitForTimeout(450);
}

/**
 * Walk until the readout says this is where we are: stick HELD down, released on arrival.
 *
 * **A pulsed walk cannot cross this island, and that is a fact about the terrain rather than about
 * the machine it runs on.** This was 45 short pushes, on the reasoning that ice keeps what you give
 * it and a place is only twelve metres across — true on the flat, and wrong the moment the walk
 * crosses a hill. `ISLAND_MOUNDS[1]` sits at (17, −6) with a 7.5 m radius directly across the line
 * east to the Eisarena, at a perfectly climbable 0.46 gradient, and `MOUND_MAX_SLOPE`'s own note
 * says exactly what that means for a thumb that lets go: "walking up works and stopping half way
 * slides you back down". So every pulse gained a little of the hill and every pause gave back more,
 * and the walker finished each attempt back on the square it started from — a readout of
 * "Geh zu einem Platz" that read like a lost penguin and was really a test standing still.
 *
 * Measured east across the island, 45 pushes each: 0.12 s of push never arrives, 0.4 s never
 * arrives, 0.9 s arrives on push 36 — and 36 of 45 is not a margin, it is the next slow machine's
 * failure. A player crossing an island holds the stick, so this holds it, which spends the budget
 * on walking instead of on 45 pauses that each hand the hill back.
 *
 * **`dx`/`dy` are SCREEN directions, and which zone one of them reaches is a MEASUREMENT.** This
 * used to carry a sentence saying "+1 is a full push right, which is +x in the world and therefore
 * east", derived from `stickVector` and where the rig stands. That derivation is sound for the two
 * arena modes and wrong here, because the hub's camera is a FOLLOW camera: `scene.setFollow` chases
 * the player's own facing into `applied`, and `scene.steer` rotates the thumb by it, so the stick is
 * camera-relative and the camera is player-relative. A held direction therefore converges on a world
 * heading rather than naming one, and no amount of reading `camera.ts` will tell you which. It is
 * trap 7's shape with the sign replaced by a feedback loop — so the honest thing is to drive it and
 * look. Held from the square, twenty seconds each: up reaches Der Berg at 9.2 s, down reaches the
 * Robbenhöhle at 6.4 s, left passes Der Laden at 2.4 s, and RIGHT reaches nothing at all. East is
 * the one cardinal with a hill on the line (`ISLAND_MOUNDS[1]` at (17, −6), a climbable 0.46
 * gradient), the walk deflects around it, and a chasing camera never turns it back — which is why
 * the Eisarena is not the game this test walks to any more.
 *
 * Polls the observable rather than counting seconds, because a walk timed in milliseconds is a walk
 * that arrives on a fast machine and stops short on a slow one — and a slow one is the normal case
 * here: `render/loop.ts` caps catch-up at `MAX_CATCHUP_SECONDS`, so a browser drawing this island
 * on a CPU rasteriser advances the simulation slower than the wall clock, and every fixed-duration
 * walk silently covers less ground. The failure names what the readout actually said, because
 * "never got there" and "got somewhere else" are different bugs.
 */
async function walkTo(page: Page, place: string, dx: number, dy = 0, seconds = 45): Promise<void> {
	const box = page.viewportSize();
	if (!box) throw new Error('no viewport');
	const x = box.width * 0.22;
	const y = box.height * 0.62;
	const deadline = Date.now() + seconds * 1000;

	/**
	 * There, and STILL there 400 ms later.
	 *
	 * A single check returns the moment the readout names the place, which is the moment the walker
	 * ENTERS it — brake or no brake, it is still moving, and the door button it is about to be asked
	 * to press is being mounted and unmounted underneath the click. Playwright reported that exactly:
	 * "element is not stable", then "element was detached from the DOM". Standing in a place and
	 * arriving in it are different states and this test needs the first one.
	 */
	const settled = async (): Promise<boolean> => {
		if (!(await readout(page)).includes(place)) return false;
		await page.waitForTimeout(400);
		return (await readout(page)).includes(place);
	};

	while (Date.now() < deadline) {
		if (await settled()) return;

		await page.mouse.move(x, y);
		await page.mouse.down();
		await page.mouse.move(x + dx * 70, y + dy * 70, { steps: 3 });
		try {
			while (Date.now() < deadline && !(await readout(page)).includes(place)) {
				await page.waitForTimeout(250);
			}
		} finally {
			// **BRAKE rather than let go.** Ice keeps what you give it — about five metres of coast,
			// against a zone ten metres across entered off-centre by a walk that converged on its own
			// heading. Letting go read the door of a place the walker had already slid out of the far
			// side of, intermittently, which is the worst way for a test to be wrong. A full deflection
			// the other way is the same 9.5 m/s² of grip trap 1 is about, pointed at stopping, and it
			// is what a thumb does at a door. The outer loop sets off again if it was not enough.
			await page.mouse.move(x - dx * 70, y - dy * 70, { steps: 2 });
			await page.waitForTimeout(250);
			await page.mouse.up();
			await page.waitForTimeout(250);
		}
	}
	throw new Error(
		`${seconds}s of walking and never stopped in ${place}; the readout says ${JSON.stringify(
			await readout(page)
		)}`
	);
}

/**
 * Walk one way and photograph the screen the moment a place is reached, without stopping there.
 *
 * For a claim about what a place SAYS rather than about standing in it. `walkTo` has to park the
 * walker, and parking is the hard half: a zone can be as small as Der Laden's four metres and a
 * released walk coasts about five, so a test that arrives, brakes and then reads the DOM is reading
 * it a second later and somewhere else. Everything here is read in ONE `evaluate`, so the readout
 * and the sign beside it cannot come from two different frames — which is the whole reason this is
 * a snapshot rather than three locator assertions.
 */
async function signAt(
	page: Page,
	place: string,
	dx: number,
	dy = 0,
	seconds = 30
): Promise<{ door: string | null; hasEnter: boolean }> {
	const box = page.viewportSize();
	if (!box) throw new Error('no viewport');
	const x = box.width * 0.22;
	const y = box.height * 0.62;

	await page.mouse.move(x, y);
	await page.mouse.down();
	await page.mouse.move(x + dx * 70, y + dy * 70, { steps: 3 });
	try {
		const deadline = Date.now() + seconds * 1000;
		while (Date.now() < deadline) {
			const shot = await page.evaluate(() => {
				const text = (id: string) =>
					(document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null)?.innerText ??
					null;
				return {
					readout: text('hud') ?? '',
					door: text('door'),
					hasEnter: !!document.querySelector('[data-testid="door-enter"]')
				};
			});
			if (shot.readout.includes(place)) return { door: shot.door, hasEnter: shot.hasEnter };
			await page.waitForTimeout(200);
		}
		throw new Error(
			`${seconds}s of walking and never passed through ${place}; the readout says ${JSON.stringify(
				await readout(page)
			)}`
		);
	} finally {
		await page.mouse.up();
	}
}

/** Flail about until the round resolves. Not skilful: the claim is that a round ENDS. */
async function playUntilResult(page: Page): Promise<void> {
	const box = page.viewportSize();
	if (!box) throw new Error('no viewport');
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
	}
	throw new Error('the round never finished');
}

test.describe('the island', () => {
	test('needs no answering: no gate, no countdown, no body count', async ({ page }, testInfo) => {
		test.skip(testInfo.project.name === 'portrait', 'everything is behind the rotate card');

		const problems: string[] = [];
		page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));

		await page.goto(ISLAND);

		// `docs/DESIGN.md` §6 asks for a child to be playing two seconds after arriving, and this is the
		// half of that promise the island keeps better than any round could: walking around IS the
		// activity, so there is nothing to wait for.
		await expect(page.getByTestId('hud')).toContainText('Insel', { timeout: 30_000 });

		// NOTHING to answer first. Not a start button, not a countdown — a hub is not a round
		// (`GameMode.isRound`), so there is nothing to hold behind a button. Asserted after the readout
		// is up, because "absent" and "not hydrated yet" look identical.
		await expect(page.getByTestId('play')).toHaveCount(0);
		await expect(page.getByTestId('countdown')).toHaveCount(0);

		// And no body count. "Noch 1 auf dem Eis" on a hub is a number that can never move, in the one
		// corner this game reserves for the only score it has.
		expect(await readout(page)).not.toContain('Noch');

		// The row in the top corner stays up while the island is being played, because there is no
		// round for it to cover and it is the only way to the sound and, through the settings sheet,
		// to "Mein Pinguin" and to a room. Hidden here the way it is hidden mid-round, the island would
		// be a place with no way out.
		await expect(page.getByTestId('mute')).toBeVisible();
		await expect(page.getByTestId('profile-open')).toBeVisible();
		// But not the mode switch: the doors are the way into a game now, and two ways in is the menu
		// the island exists to replace.
		await expect(page.getByTestId('royal')).toHaveCount(0);
		// Nor a snowball, in a place where nobody may hit anybody (`ISLAND.throwing` is false).
		await expect(page.getByRole('button', { name: 'Schneeball werfen' })).toHaveCount(0);

		expect(problems).toEqual([]);
	});

	test('offers the game you are standing in, and stops offering it when you walk away', async ({
		page
	}, testInfo) => {
		test.skip(testInfo.project.name === 'portrait', 'controls are inert behind the rotate card');
		test.setTimeout(120_000);

		await page.goto(ISLAND);
		// Everybody arrives on the Rathausplatz — `spawnOnTheIsland` — so the first thing a child sees
		// offered is the big game, one tap away and named before they commit to it.
		await expect(page.getByTestId('hud')).toContainText('Rathausplatz', { timeout: 30_000 });
		// The GAME's name is on the button, not on the card. It moved there because the top-right button
		// row painted over the card's title on a 568×320 screen: anything that must be READ cannot live
		// in the sixty pixels that row occupies.
		await expect(page.getByTestId('door-enter')).toBeVisible();
		await expect(page.getByTestId('door-enter')).toContainText('Royal');
		// And the card carries the rules, at the last moment they are still free. A child who pressed
		// "Royal" without knowing what it meant used to find out by drowning.
		await expect(page.getByTestId('door')).toContainText('Schollen');

		// Walk off it, and the offer goes with the place. This is the half that matters most: a place is
		// a PLACE, so crossing the square on the way to the mountain cannot start a thirty-penguin
		// Royal by itself — there is no way in except the button, and the button is only here.
		for (let i = 0; i < 12; i++) {
			if (!(await readout(page)).includes('Rathausplatz')) break;
			await nudge(page, 1);
		}
		expect(await readout(page)).not.toContain('Rathausplatz');
		await expect(page.getByTestId('door-enter')).toHaveCount(0);
		await expect(page.getByTestId('door')).toHaveCount(0);
		await expect(page.getByTestId('hud')).toContainText('Geh zu einem Platz');
	});

	test('walks to a game, plays it, and comes back to the same place', async ({
		page
	}, testInfo) => {
		test.skip(testInfo.project.name === 'portrait', 'controls are inert behind the rotate card');
		// The whole loop end to end: a walk, a round of up to ninety seconds, and the way back. The
		// WALK is the variable part — it is a control loop against a follow camera (see `walkTo`), so it
		// costs anything from seven seconds to most of a minute depending on how the heading converges.
		test.setTimeout(420_000);

		const problems: string[] = [];
		page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));

		await page.goto(ISLAND);
		await expect(page.getByTestId('hud')).toContainText('Rathausplatz', { timeout: 30_000 });

		// Nothing earned yet, on a browser profile Playwright made a moment ago. Read rather than
		// assumed, because the whole assertion at the bottom is that this number went UP.
		await expect(page.getByTestId('eis')).toBeVisible();
		expect(await eis(page)).toBe(0);

		// South, to the cave. Deliberately not the square we spawned on: coming back to the place you
		// spawned in would prove nothing about coming back to the place you LEFT. It was the jetty
		// due east until the walk was actually measured — see `walkTo`, which now records what each
		// screen direction reaches and why east is the one that reaches nothing.
		const CAVE = 'Robbenhöhle';
		await walkTo(page, CAVE, 0, 1);
		// From the REGISTRY rather than typed here, so the door and the mode cannot drift apart —
		// the same rule the rest of this suite already follows for a mode's name and its dash label.
		await expect(page.getByTestId('door-enter')).toContainText(CHASE.name);
		// The card carries the RULES where a mode has them, and its field where it does not — the
		// classic round's `copy.rules` is null, which is why this line used to read "4 Pinguine".
		await expect(page.getByTestId('door')).toContainText(CHASE.copy.rules ?? CHASE.copy.who);

		// One deliberate press, and it is a different game on the other side.
		await page.getByTestId('door-enter').click();
		// Through the door and into something else, which is the whole claim here. Asserted as "the
		// hub's readout is gone, and a RACE standing is in its place": this line used to read
		// "Noch 4 auf dem Eis", a body count belonging to the classic round, and a chase does not
		// have one — it says "Platz 1 von 6 · Ufer 229 m". The field size is deliberately not
		// asserted either, because the sea lion eats it down to "von 4" while the round runs, so a
		// number here would be a race between this expectation and the animal.
		await expect(page.getByTestId('hud')).not.toContainText('Insel', { timeout: 30_000 });
		await expect(page.getByTestId('hud')).toContainText('Platz', { timeout: 30_000 });
		// No second question: the button at the door was the decision, so there is no "Los geht's!"
		// behind it — but there IS a countdown, because a round is a round.
		await expect(page.getByTestId('play')).toHaveCount(0);
		await expect(page.getByTestId('countdown')).toBeHidden({ timeout: 15_000 });

		await playUntilResult(page);

		// PAID, and paid for finishing: nobody steered the local penguin, so it almost certainly lost —
		// which is the case this payout shape exists for. The amount comes from `lib/eis.ts` rather than
		// from a number typed here, so a change to the rate changes this test's mind with it.
		await expect(page.getByTestId('earned')).toContainText('Eis');
		const paid = Number.parseInt(
			(await page.getByTestId('earned').innerText()).match(/(\d+)/)?.[1] ?? '0',
			10
		);
		expect(paid).toBeGreaterThanOrEqual(EIS_FOR_FINISHING);
		expect(paid).toBeLessThanOrEqual(EIS_FOR_FINISHING + EIS_FOR_WINNING);

		// And the way back, beside "Nochmal" rather than under it — a second row of buttons on a
		// 568×320 screen covers the mute button, which is trap 4's shape.
		await expect(page.getByTestId('again')).toBeVisible();
		await page.getByTestId('to-island').click();

		// Home, and standing at the cave we left from rather than back on the square. That is the loop
		// closed: the island is a place that was still there, not a level that reloaded.
		await expect(page.getByTestId('hud')).toContainText('Insel', { timeout: 30_000 });
		await expect(page.getByTestId('hud')).toContainText(CAVE);
		await expect(page.getByTestId('door-enter')).toBeVisible();

		// And the number on the island went up by exactly what the round said it paid. This is the whole
		// of story 12a end to end: earned in a game, credited outside `sim/`, and shown on the hub.
		expect(await eis(page)).toBe(paid);

		// It survives being closed and opened again — the half a counter is worthless without.
		await page.reload();
		await expect(page.getByTestId('eis')).toBeVisible({ timeout: 30_000 });
		expect(await eis(page)).toBe(paid);

		expect(problems).toEqual([]);
	});

	test('tells a child who can afford something that there is somewhere to spend it', async ({
		page
	}, testInfo) => {
		test.skip(testInfo.project.name === 'portrait', 'everything is behind the rotate card');

		// The trap this guards is a whole feature nobody can find: the doorstep says "Mein Iglu" when you
		// are standing on it, and nothing anywhere told a child that spending existed or where. Traps 5
		// and 15 are both that shape, and both cost a session.
		//
		// The wallet is SEEDED rather than earned, because the first rung is four wins and this test is
		// about one clause of text. The blob is the real one — same key, same version — so this exercises
		// the same read path a child's device does.
		const price = priceOf(0);
		await page.goto(ISLAND);
		await expect(page.getByTestId('eis')).toBeVisible({ timeout: 30_000 });

		// Nothing to say yet at zero: a hint about a price a child cannot reach is a nag, not a door.
		await expect(page.getByTestId('eis')).not.toContainText('Iglu');

		await page.evaluate(
			([key, blob]) => localStorage.setItem(key ?? '', blob ?? ''),
			['floe.island.v1', JSON.stringify({ version: SAVE_VERSION, eis: price })]
		);
		await page.reload();

		// Affordable, so the total says where to go — and the PRICE is read from `lib/igloo.ts`, so
		// re-tuning either payout constant moves the ladder and this test together.
		await expect(page.getByTestId('eis')).toContainText(String(price), { timeout: 30_000 });
		await expect(page.getByTestId('eis')).toContainText('Iglu');
	});

	test('tells the truth about what a profile is, and has nowhere to type', async ({
		page
	}, testInfo) => {
		test.skip(testInfo.project.name === 'portrait', 'the sheet is behind the rotate card');

		await page.goto(ISLAND);
		await expect(page.getByTestId('hud')).toContainText('Insel', { timeout: 30_000 });
		await page.getByTestId('profile-open').click();

		// Who you are: a name from the curated generator, and the Eis the games have paid for.
		await expect(page.getByTestId('profile')).toBeVisible();
		await expect(page.getByTestId('profile-eis')).toContainText('Eis');
		const before = await page.getByTestId('profile-name').innerText();
		// Two words from two fixed lists, which is the property `docs/DECISIONS/0004` rests on.
		expect(before).toMatch(/^[\p{L}’]+ [\p{L}’]+$/u);

		// The honest part, said plainly enough for a child to read: this is a pre-alpha, and the penguin
		// lives on this device. The owner asked for account creation and his own caveat was that saving
		// is not possible yet — so the word "Account" appears exactly once, in the sentence saying there
		// is not one.
		await expect(page.getByTestId('profile')).toContainText('PRE-ALPHA');
		await expect(page.getByTestId('profile')).toContainText('diesem Gerät');
		await expect(page.getByTestId('profile')).toContainText('noch keinen Account');

		// **INVARIANT 4, asserted rather than trusted.** An account with a typed display name is free
		// text between players wearing a different hat, and this is the screen where one would have been
		// added. There is no field to type into anywhere on the page — not disabled, not hidden: absent.
		await expect(page.locator('input, textarea, [contenteditable="true"]')).toHaveCount(0);

		// The die is what a name is changed with instead.
		await page.getByTestId('profile-reroll').click();
		await expect(page.getByTestId('profile-name')).not.toHaveText(before);
	});

	test('lets a knocked-out player leave instead of watching to the end', async ({
		page
	}, testInfo) => {
		test.skip(testInfo.project.name === 'portrait', 'controls are inert behind the rotate card');
		// A child knocked out of a Royal in the first ten seconds used to be held there until the round
		// decided to end — up to a hundred seconds of a game that had stopped answering them. This is
		// the P0 that fixed it, and it is asserted the way the four earlier versions of this trap were
		// missed: not "the button is in the DOM" but "the button is pressable and it does the thing".
		test.setTimeout(300_000);

		// The Royal, entered from the square everybody spawns on — no walking, and thirty penguins means
		// the local one goes in the water on its own long before the round ends.
		await page.goto(ISLAND);
		await expect(page.getByTestId('door-enter')).toContainText('Royal', { timeout: 30_000 });
		await page.getByTestId('door-enter').click();
		await expect(page.getByTestId('hud')).toContainText('Noch', { timeout: 30_000 });

		// Nobody touches the controls: what puts this penguin in the sea is the tilt, the bots and the
		// floes going under.
		await expect(page.getByTestId('hud')).toContainText('Du bist draußen', { timeout: 180_000 });

		// The sidelines keep exactly what they kept before: one thing to do, and no controls that answer
		// nothing. This is the part the fix was not allowed to break.
		await expect(page.getByRole('button', { name: 'Schneeball werfen' })).toBeVisible();
		await expect(page.getByRole('button', { name: 'Springen' })).toHaveCount(0);
		await expect(page.getByLabel('Steuerkreuz — Daumen aufsetzen und ziehen')).toHaveCount(0);

		// And now there are two doors, mid-round, while the Royal is still going.
		await expect(page.getByTestId('out-again')).toBeVisible();
		const island = page.getByTestId('out-to-island');
		await expect(island).toBeVisible();

		// PRESSED, not merely present. Every earlier version of this trap was a button that was visible
		// and looked pressable — `click()` with no force is what tells them apart, because Playwright
		// refuses a click that would land on something else.
		await island.click();

		// Back on the island, in the middle of a Royal that was never finished.
		await expect(page.getByTestId('hud')).toContainText('Insel', { timeout: 30_000 });
		// And it paid nothing: a round walked out of is not a round finished (`lib/eis.ts`).
		expect(await eis(page)).toBe(0);
	});

	test('gives a place with nothing behind it yet a sign and no button', async ({
		page
	}, testInfo) => {
		test.skip(testInfo.project.name === 'portrait', 'controls are inert behind the rotate card');
		test.setTimeout(120_000);

		// Der Laden is a building before it is a screen (story 10d), and `Door.opens` is null for it. A
		// button there would be visible, pressable and dead, which is the trap this repo has paid for
		// four times — so the sign appears and the button does not.
		await page.goto(ISLAND);
		await expect(page.getByTestId('hud')).toContainText('Rathausplatz', { timeout: 30_000 });

		// West, and it is the shortest walk on the island on purpose: a child who wants a different hat
		// should not have to cross the island for it.
		// Read as it is REACHED rather than after stopping in it. Der Laden is the smallest zone on
		// the island at four metres of radius, and a walk that brakes at its edge coasts most of the
		// way back out — so the sign was being read from a frame in which the walker had already
		// left, and the test failed on a claim that was true. `signAt` takes the readout and the sign
		// in one evaluate, which is the only way they are guaranteed to describe the same moment.
		const sign = await signAt(page, 'Der Laden', -1);
		expect(sign.door).toContain('Öffnet bald');
		expect(sign.hasEnter).toBe(false);
	});

	test('has no Zack button — walking up to somebody is the interaction now', async ({
		page
	}, testInfo) => {
		test.skip(testInfo.project.name === 'portrait', 'controls are inert behind the rotate card');

		// `attackStrength` is zero on the island and a dash could shove nobody, so the control that
		// used to sit here did nothing describable (Daniel, 2026-08-22). `spec.dashing` is false for
		// this mode now, and the slot it occupied is free for the thing that actually happens when you
		// walk up to somebody — `npc/talk.ts`, wired through the `speech` region below.
		await page.goto(ISLAND);
		await expect(page.getByTestId('hud')).toContainText('Rathausplatz', { timeout: 30_000 });
		await expect(page.getByRole('button', { name: 'Schneller laufen' })).toHaveCount(0);
		await expect(page.getByTestId('speech')).toHaveCount(1);
	});
});
