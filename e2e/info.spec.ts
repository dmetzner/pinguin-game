import { expect, test } from '@playwright/test';

/**
 * The parents' page, and the promise it must not break.
 *
 * Three of the four tests here are about that promise rather than about the page: `docs/DESIGN.md` §6
 * asks for a child to be playing within two seconds of opening the app, and the single way this
 * feature could go wrong is by becoming the thing between them and the game. So `/` is asserted to
 * still open onto a canvas, from a spec whose whole subject is the page that must not be there.
 *
 * No project skips. This is the ONE route in the project that is not landscape-only — the rotate card
 * lives inside `Game.svelte`, so a document has none and reads in either orientation. Running the
 * same assertions in the portrait project is how that stays true.
 */
test.describe('the page for a grown-up', () => {
	test('is a real HTML file with the words already in it', async ({ page }) => {
		// THE assertion of this file. `routes/+layout.ts` turns SSR off for the whole app, because the
		// game is a canvas and a Node process cannot draw one — so this route re-enables it in its own
		// `+page.ts`. Without that, `adapter-static` writes the SPA shell and the prose only exists
		// after JavaScript runs: a crawler, a link unfurler and a store reviewer would each get an
		// empty page, and they are the audience the route exists for.
		//
		// Fetched with `request` rather than rendered, deliberately. A browser check passes either way,
		// which is exactly how this would ship broken.
		const response = await page.request.get('/info/');
		expect(response.status()).toBe(200);
		const html = await response.text();
		expect(html).toContain('Keine Werbung');
		expect(html).toContain('Kein Chat');
	});

	test('has no text field on it, and never can', async ({ page }) => {
		// Invariant 4 and `docs/DECISIONS/0004`: there is no free-text communication in this game, and
		// a contact form on the parents' page would be the first one. The game has no input anywhere;
		// this asserts the newest route did not become the exception, including the shapes that are
		// not `<input>` — a `contenteditable` div is a text field with extra steps.
		await page.goto('/info/');
		await expect(page.locator('input, textarea, form, select, [contenteditable]')).toHaveCount(0);
	});

	test('names the game from the brand module rather than from typed copy', async ({ page }) => {
		// Invariant 5. The name lives in `src/lib/brand.ts` and nowhere else, and `brand.test.ts` scans
		// `src/` for it — it caught a stray copy in an `app.css` comment. This is the end-to-end half:
		// the heading is DERIVED from the same place the document title is, so a hand-typed heading
		// that happened to be right today would still fail the day the codename changes.
		await page.goto('/info/');
		const brand = (await page.title()).split('—')[0]?.trim();
		expect(brand).toBeTruthy();
		await expect(page.locator('h1')).toHaveText(brand as string);
	});

	test('links nowhere off this origin yet, so a real payment URL has to be a deliberate act', async ({
		page
	}) => {
		// The donation destination is a placeholder — `DONATION_URL` is `null`, so the section renders
		// its honest sentence and NO button, because a live-looking button that goes nowhere is trap 4
		// with money on it. Filling it in turns this test red, which is the point: a page in a
		// children's game acquiring an outward link to somewhere that takes payments should not be
		// possible without somebody answering for it.
		//
		// `docs/DECISIONS/0005` is the other half — the CSP lists no third-party origin, so a payment
		// SDK cannot work here at all. A link that navigates away needs no CSP entry. If anybody has to
		// touch `svelte.config.js` to make this page work, the page is wrong.
		await page.goto('/info/');
		const hrefs = await page
			.locator('a[href]')
			.evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).getAttribute('href') ?? ''));
		expect(hrefs.length).toBeGreaterThan(0);
		// `origin` read from the page URL in Node rather than from `location` — `evaluateAll` runs in
		// the browser but this filter does not, and a `location` here is `undefined` at run time while
		// typechecking perfectly against the DOM lib. Trap 15's shape in a test.
		const origin = new URL(page.url()).origin;
		const outward = hrefs.filter((h) => /^[a-z]+:\/\//i.test(h) && !h.startsWith(origin));
		expect(
			outward,
			'this page has gained an external link. If it is the donation URL, update `DONATION_URL` ' +
				'and this test together, and check nothing had to be added to the CSP.'
		).toEqual([]);
	});

	test('reads in portrait as well as landscape, unlike the game', async ({ page }) => {
		// The one route with no rotate card, and the assertion that keeps it that way. The card is
		// rendered by `Game.svelte`, so a document has none — but a future shared layout could easily
		// acquire one, and a page of prose covered by "turn your phone" would be absurd.
		await page.goto('/info/');
		await expect(page.getByTestId('rotate-hint')).toHaveCount(0);
		await expect(page.locator('h1')).toBeVisible();
	});

	test('gets back to the game in one tap', async ({ page }) => {
		await page.goto('/info/');
		await page.getByTestId('info-to-game').click();
		await expect(page.locator('canvas')).toBeVisible({ timeout: 8000 });
	});
});

test.describe('the two-second promise, revised', () => {
	// **This described a decision that has since changed, and the test changed with it rather than
	// being deleted or bypassed.** `/` used to open straight onto the island with nothing to read
	// first; Daniel asked for a landing screen once the game was live at a real domain rather than a
	// laptop (2026-08-22), specifically so nobody starts "blindly" — a phrase that means a Play button
	// stands between a fresh visit and the controls. The promise this file title still keeps: a
	// RETURNING visitor, who has already pressed through once, is not asked again. `e2e/landing.spec.ts`
	// is where the gate itself is tested; this is only the part that touches `/info`.
	test('a returning visitor reaches the game without seeing the gate again', async ({ page }) => {
		// A fresh context has never pressed "Los geht's!" — seeding the flag it writes is what makes
		// this page a RETURNING visitor rather than a first one, which is the only thing this test is
		// about.
		await page.addInitScript(() => localStorage.setItem('floe.landing-seen', 'true'));
		await page.goto('/');
		await expect(page.locator('canvas')).toBeVisible();
		await expect(page.getByTestId('landing')).toHaveCount(0);
		await expect(page.getByTestId('info-to-game')).toHaveCount(0);
		await expect(page.getByTestId('hud')).toBeVisible({ timeout: 20_000 });
	});
});
