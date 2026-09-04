import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Page, test } from '@playwright/test';

/**
 * The studio's eyes.
 *
 * `render/` is not unit-testable and `CLAUDE.md` lists fifteen traps, of which four were a picture
 * that was wrong in a way the source read as correct: a mountain wound inside out and drawn dark
 * grey, decoration buried half a metre inside the ice, a marker labelling the penguin behind it, an
 * arena that never shrank on screen. Every one of them was found by LOOKING. This file is how
 * looking becomes something an agent can do, and something CI can do on every change.
 *
 * Two jobs, and the second is the one with teeth:
 *
 *  1. Write a PNG per mode into `shots/`, so a person — or a model that can read an image — can
 *     compare before and after at a fixed seed.
 *  2. Assert the frame is not degenerate. A blank scene is the failure mode this stack actually has
 *     (the shadow-map attempt in `scene.ts` produced sky, HUD and nothing else, with no console
 *     error anywhere) and it is trivially detectable: count how many distinct coarse colours the
 *     frame contains and how much of it the single commonest colour occupies. Sky plus HUD is two
 *     or three buckets; a polar day with ice, sea, penguins and a horizon in it is dozens.
 *
 * It runs against the same production build as the rest of `e2e/` — a shader a minifier mangles is
 * exactly the kind of thing that only shows up here.
 */

const SHOTS = join(process.cwd(), 'shots');

/** Fixed, so two runs of the same mode are comparable pictures rather than two different rounds. */
const SEED = 20260821;

/**
 * Every mode, including the island — which is not on the mode cycle a player sees (it is the place
 * the games are reached FROM, see `sim/modes/registry.ts`) and is therefore reachable only by the
 * query string this file already uses. A hub nobody screenshots is a hub that rots.
 */
const MODES = ['classic', 'royal', 'slide', 'chase', 'island'] as const;

/**
 * How long to let the round run before the shutter.
 *
 * Long enough that the countdown is over and penguins have moved — a shot of the countdown is a
 * shot of a numeral — and short enough that a classic round has not ended.
 */
const SETTLE_MS = 4200;

/**
 * What a real frame looks like, measured against this game rather than assumed.
 *
 * A landscape phone frame of the classic round buckets into well over a hundred coarse colours and
 * its commonest bucket is the sea at roughly a third of the pixels. The thresholds are set far below
 * that: they exist to catch "nothing rendered", not to police art direction.
 */
const MIN_DISTINCT_BUCKETS = 24;
const MAX_SINGLE_COLOUR_SHARE = 0.8;

interface Frame {
	buckets: number;
	dominantShare: number;
}

/**
 * Read the canvas back and describe it coarsely.
 *
 * Done in the page rather than by decoding the PNG here, because `drawImage` of a WebGL canvas into
 * a 2D one is the cheapest readback available and needs no image library. The canvas is preserved
 * by three's default `preserveDrawingBuffer: false`, so this has to happen inside a frame — hence
 * `requestAnimationFrame` before the copy.
 */
async function describeFrame(page: Page): Promise<Frame> {
	return page.evaluate(async () => {
		const canvas = document.querySelector('canvas');
		if (!canvas) throw new Error('no canvas on the page');
		await new Promise((done) => requestAnimationFrame(() => done(null)));
		const w = 160;
		const h = Math.max(1, Math.round((canvas.height / canvas.width) * w));
		const copy = document.createElement('canvas');
		copy.width = w;
		copy.height = h;
		const ctx = copy.getContext('2d');
		if (!ctx) throw new Error('no 2d context');
		ctx.drawImage(canvas, 0, 0, w, h);
		const { data } = ctx.getImageData(0, 0, w, h);
		const counts = new Map<number, number>();
		for (let i = 0; i < data.length; i += 4) {
			// 5 bits per channel: two shades of ice a player cannot tell apart land in one bucket,
			// while ice, sea, sky and a penguin never do.
			const key =
				(((data[i] as number) >> 3) << 10) |
				(((data[i + 1] as number) >> 3) << 5) |
				((data[i + 2] as number) >> 3);
			counts.set(key, (counts.get(key) ?? 0) + 1);
		}
		const total = (data.length / 4) | 0;
		let dominant = 0;
		for (const n of counts.values()) if (n > dominant) dominant = n;
		return { buckets: counts.size, dominantShare: dominant / total };
	});
}

/** Get past the "Los geht's!" gate if this visit has one. See `e2e/game.spec.ts` for the shape. */
async function play(page: Page): Promise<void> {
	const button = page.getByTestId('play');
	await Promise.race([
		button.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => undefined),
		page.getByTestId('hud').waitFor({ state: 'visible', timeout: 15_000 })
	]);
	if (await button.count()) await button.click().catch(() => undefined);
}

test.describe('shots', () => {
	test.beforeAll(() => mkdirSync(SHOTS, { recursive: true }));

	/**
	 * Landscape only, and that is the point rather than a limitation.
	 *
	 * The portrait project exists to prove the rotate card appears AND that nothing behind it
	 * responds — `playwright.config.ts` calls that split load-bearing, because portrait deliberately
	 * makes the controls inert. So in portrait there is no scene to photograph and the frame is
	 * SUPPOSED to be one flat colour behind a card: the degeneracy check below would fail on the
	 * feature working correctly, which is exactly the trap the three-project split was created to
	 * avoid. `npm run shots` pins `--project=phone-landscape`; a bare `playwright test` does not, and
	 * that is how this was found.
	 */

	for (const mode of MODES) {
		test(`${mode} renders something`, async ({ page }, info) => {
			// Landscape only, and that is the point rather than a limitation. The portrait project
			// exists to prove the rotate card appears AND that nothing behind it responds — a split
			// `playwright.config.ts` calls load-bearing, because portrait deliberately makes the
			// controls inert. So in portrait there is no scene to photograph and the frame is SUPPOSED
			// to be one flat colour behind a card: the degeneracy check below would then fail on the
			// feature working correctly, which is the exact trap the three-project split was created to
			// avoid. `npm run shots` pins `--project=phone-landscape`; a bare `playwright test` does
			// not, and that is how this was found.
			test.skip(info.project.name === 'portrait', 'no scene behind the rotate card');

			const problems: string[] = [];
			page.on('console', (m) => {
				if (m.type() === 'error') problems.push(m.text());
			});
			page.on('pageerror', (e) => problems.push(String(e)));

			await page.goto(`/?mode=${mode}&seed=${SEED}`);
			await play(page);
			await page.waitForTimeout(SETTLE_MS);

			const frame = await describeFrame(page);
			await page.screenshot({ path: join(SHOTS, `${info.project.name}-${mode}.png`) });

			// The picture is saved BEFORE the assertions on purpose: a failure is exactly when
			// somebody wants to look at what was on the screen.
			expect(problems, `console errors in ${mode}`).toEqual([]);
			expect(
				frame.buckets,
				`${mode} frame has ${frame.buckets} distinct colours — a blank or near-blank scene`
			).toBeGreaterThan(MIN_DISTINCT_BUCKETS);
			expect(
				frame.dominantShare,
				`${mode} frame is ${Math.round(frame.dominantShare * 100)}% one colour`
			).toBeLessThan(MAX_SINGLE_COLOUR_SHARE);
		});
	}
});
