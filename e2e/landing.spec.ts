import { expect, test } from '@playwright/test';

/**
 * The landing gate — the first thing anybody meets at `/` on a device that has not pressed through
 * it before, and the reason `e2e/game.spec.ts`'s own `skipLanding` helper exists: every other test
 * in this suite is testing something AFTER this screen, and this is the only file testing the screen
 * itself.
 *
 * Added 2026-08-22, once the game was live at a real domain rather than staying on a laptop: Daniel
 * asked for something to stand between a fresh visit and the controls, specifically so nobody starts
 * "blindly" — a phrase that means a Play button, and room for the links a public site now needs
 * (`/info`, `/datenschutz`, `/impressum`). `docs/DESIGN.md` §6's two-second promise survives this
 * only because the screen is this light and only asked once per device — the second half of that
 * claim is what the second test below proves rather than assumes.
 */

test.describe('the landing gate', () => {
	test('a first visit meets it, and the game underneath is not reachable through it', async ({
		page
	}, testInfo) => {
		test.skip(testInfo.project.name === 'portrait', 'the rotate card covers everything anyway');

		await page.goto('/');
		const gate = page.getByTestId('landing');
		await expect(gate).toBeVisible();

		// The scene renders and idles behind it — this is not `Game.svelte`'s own held-world start
		// screen, it is a second layer in front of a hub that has no world to hold.
		await expect(page.locator('canvas')).toBeVisible();

		// The three links a public site needs, all present, none of them the product's own front door
		// pretending to be one of them.
		await expect(page.getByRole('link', { name: 'Für Eltern' })).toHaveAttribute('href', '/info');
		await expect(page.getByRole('link', { name: 'Datenschutz' })).toHaveAttribute(
			'href',
			'/datenschutz'
		);
		await expect(page.getByRole('link', { name: 'Impressum' })).toHaveAttribute(
			'href',
			'/impressum'
		);

		// Covered rather than merely present — a tap where the joystick would be must land on the
		// gate, not on the half of the screen the joystick claims underneath it. `force: true` would
		// skip exactly the check this test exists to make, so it is never used here.
		await page.mouse.move(120, 220);
		await page.mouse.down();
		await page.mouse.move(160, 180, { steps: 4 });
		await page.mouse.up();
		await expect(gate).toBeVisible();
		await expect(page.getByTestId('stick-base')).toHaveCount(0);
	});

	test('"Los geht\'s!" opens the island and is not asked again on the next visit', async ({
		page
	}, testInfo) => {
		test.skip(testInfo.project.name === 'portrait', 'the rotate card covers everything anyway');
		test.setTimeout(30_000);

		await page.goto('/');
		await page.getByTestId('landing-play').click();
		await expect(page.getByTestId('landing')).toHaveCount(0);
		await expect(page.getByTestId('hud')).toContainText('Insel', { timeout: 20_000 });

		// A reload rather than a fresh context, on purpose: this is the same device asking again,
		// which is exactly the case `storageKeys.landingSeen` exists to answer.
		await page.reload();
		await expect(page.getByTestId('landing')).toHaveCount(0);
		await expect(page.getByTestId('hud')).toContainText('Insel', { timeout: 20_000 });
	});

	test('a deep link counts as having pressed through, for every test that relies on one', async ({
		page
	}, testInfo) => {
		test.skip(testInfo.project.name === 'portrait', 'the rotate card covers everything anyway');

		// The one behaviour `e2e/game.spec.ts`, `e2e/island.spec.ts` and `npm run shots` all depend on
		// without seeding storage first — see `alreadyPastTheGate` in `routes/+page.svelte`.
		await page.goto('/?mode=classic');
		await expect(page.getByTestId('landing')).toHaveCount(0);
		await expect(page.getByTestId('hud')).toBeVisible({ timeout: 20_000 });
	});
});
