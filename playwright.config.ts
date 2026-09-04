import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

/**
 * A pre-installed Chromium, if this machine has one.
 *
 * Some sandboxes ship a browser at a fixed path and block the download Playwright would otherwise
 * do, and the revision they ship rarely matches the one the installed Playwright expects — which
 * surfaces as "Executable doesn't exist at …chromium_headless_shell-1234…" and a suggestion to run
 * an install that cannot succeed. Pointing at what is actually there fixes it without pinning
 * anything: where the path does not exist (CI, a normal laptop), this is `undefined` and Playwright
 * uses its own managed browser exactly as before.
 */
const PREINSTALLED_CHROMIUM = '/opt/pw-browsers/chromium';
const executablePath = existsSync(PREINSTALLED_CHROMIUM) ? PREINSTALLED_CHROMIUM : undefined;

/**
 * End-to-end against a REAL production build, never the dev server.
 *
 * The things that break in this game break in the build: a shader that a minifier mangles, a
 * dynamic import that never lands, a CSP directive that blocks the canvas texture. A dev-server
 * suite would pass through every one of them.
 */
export default defineConfig({
	testDir: 'e2e',
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 1 : 0,
	reporter: process.env.CI ? 'github' : 'list',

	// PORT 4319, not Vite's default 4173, and that is not a preference.
	//
	// 4173 is what every Vite project on a machine picks, so a sibling repo's preview left running in
	// another terminal answers on it — and Playwright happily tested it. The failure is spectacular
	// and completely mute: every locator in the suite misses, on a page that loads fine, because it
	// is a different application. Three full runs were spent on it, one of them blamed on a shadow
	// map. `--strictPort` is the other half: without it Vite quietly moves to the next free port and
	// the suite tests whatever was already there.
	webServer: {
		command: 'npm run build && npm run preview -- --port 4319 --strictPort',
		port: 4319,
		// `reuseExistingServer` is what makes a local green meaningless if you are not careful: a
		// stale preview from before your change happily answers, so the suite passes against code
		// that was never built. Under CI it always builds fresh, which is the only run whose green
		// means anything — reproduce a suspicious pass with `CI=1 npx playwright test`.
		reuseExistingServer: !process.env.CI,
		timeout: 180_000
	},

	use: {
		baseURL: 'http://localhost:4319',
		trace: 'on-first-retry',
		launchOptions: {
			// CI runners have no GPU, and without a software rasteriser every WebGL test fails for a
			// reason that has nothing to do with the game. SwiftShader is what makes the renderer
			// testable at all in headless Linux.
			args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
			...(executablePath ? { executablePath } : {})
		}
	},

	// Three projects, split by ORIENTATION rather than only by size, because this game treats the
	// two differently on purpose: portrait is covered by a card that makes the controls inert, so a
	// portrait project running the gameplay tests fails on the feature working correctly. That is
	// exactly what a two-project split did on its first run.
	projects: [
		{
			// The orientation the game is actually played in.
			name: 'phone-landscape',
			use: { ...devices['Pixel 7 landscape'] }
		},
		{
			// The narrowest landscape still in use — an iPhone SE on its side. Where a control that
			// overlaps another one, or crowds the safe area, shows up first.
			name: 'small-landscape',
			use: { ...devices['Pixel 7'], viewport: { width: 568, height: 320 }, isMobile: false }
		},
		{
			// Portrait exists to prove the rotate card appears AND that nothing behind it responds.
			name: 'portrait',
			use: { ...devices['Pixel 7'], viewport: { width: 320, height: 640 }, isMobile: false }
		}
	]
});
