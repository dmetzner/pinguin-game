/**
 * Rasterise the app icons from SVG drawn here, into `static/`.
 *
 * Run it when the artwork changes; the PNGs it writes are committed, so a normal build and a normal
 * CI run never execute this file:
 *
 *     node scripts/make-icons.mjs
 *
 * Two decisions worth knowing. The renderer is **Playwright's Chromium**, which this repository
 * already installs for the end-to-end suite — a build-time PNG pipeline (`sharp`, `resvg`, a canvas
 * binding) would be a native dependency, on every machine and every CI runner, for four files that
 * change about never. And the artwork is **the same primitives the game is made of**: a penguin, a
 * floe and a polar sky, all shapes and no assets, which is `docs/DECISIONS/0003` applied to the home
 * screen.
 *
 * The maskable variant is not a resize of the plain one. Android crops a maskable icon to the
 * launcher's shape — a circle, a squircle, a rounded square — and only the middle 80% is guaranteed
 * to survive, so its artwork sits inside that safe zone with the background running to the edges.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const STATIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'static');

const SKY = '#9fd8ef';
const ICE = '#f4fbff';
const BODY = '#2b3a55';
const BELLY = '#fdf6e8';
const BEAK = '#f7a83c';
const EYE = '#14161c';
const SEA = '#2f7fae';

/**
 * The penguin, drawn in a 64×64 box.
 *
 * `inset` is how much of that box the maskable version gives up to the launcher's crop: the whole
 * drawing is scaled about the centre, the background is not.
 */
function artwork({ inset }) {
	const scale = 1 - inset;
	return `
	<g transform="translate(32 32) scale(${scale}) translate(-32 -32)">
		<path d="M0 44 q8 -3 16 0 t16 0 t16 0 t16 0 V64 H0 Z" fill="${SEA}"/>
		<ellipse cx="32" cy="49" rx="23" ry="7" fill="${ICE}"/>
		<ellipse cx="32" cy="33" rx="13" ry="16" fill="${BODY}"/>
		<ellipse cx="32" cy="35" rx="8" ry="12" fill="${BELLY}"/>
		<ellipse cx="19" cy="34" rx="4" ry="9" fill="${BODY}"/>
		<ellipse cx="45" cy="34" rx="4" ry="9" fill="${BODY}"/>
		<circle cx="32" cy="16" r="10" fill="${BODY}"/>
		<circle cx="28" cy="15" r="2.2" fill="${EYE}"/>
		<circle cx="36" cy="15" r="2.2" fill="${EYE}"/>
		<path d="M32 18 l5 4 -5 3 z" fill="${BEAK}"/>
		<ellipse cx="27" cy="48" rx="4" ry="2" fill="${BEAK}"/>
		<ellipse cx="37" cy="48" rx="4" ry="2" fill="${BEAK}"/>
	</g>`;
}

/** `rounded` gives the plain icon its own corner radius; a maskable one must run to the edges. */
const icon = ({ inset = 0, rounded = false }) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
	<rect width="64" height="64" ${rounded ? 'rx="12"' : ''} fill="${SKY}"/>
	${artwork({ inset })}
</svg>`;

const files = [
	{ name: 'icon-192.png', size: 192, svg: icon({ rounded: true }) },
	{ name: 'icon-512.png', size: 512, svg: icon({ rounded: true }) },
	// 20% inset: the safe zone every maskable shape is guaranteed to keep.
	{ name: 'icon-maskable-512.png', size: 512, svg: icon({ inset: 0.2 }) },
	// iOS ignores the manifest icons and takes this one, and it is composited onto a white sheet
	// with rounded corners by the system — so it is drawn square, like the maskable one.
	{ name: 'apple-touch-icon.png', size: 180, svg: icon({}) },
	{ name: 'favicon-32.png', size: 32, svg: icon({ rounded: true }) }
];

const browser = await chromium.launch();
const page = await browser.newPage();
await mkdir(STATIC, { recursive: true });

for (const file of files) {
	await page.setViewportSize({ width: file.size, height: file.size });
	// `background: transparent` on the page, so nothing but the SVG's own fill reaches the PNG.
	await page.setContent(
		`<style>html,body{margin:0;padding:0;background:transparent}svg{display:block;width:${file.size}px;height:${file.size}px}</style>${file.svg}`
	);
	const png = await page.locator('svg').screenshot({ omitBackground: true });
	await writeFile(join(STATIC, file.name), png);
	// `process.stdout` rather than `console`: this is a script whose only output is a progress
	// line, and the repository's lint rule against `console` is aimed at code that ships.
	process.stdout.write(`wrote static/${file.name} (${file.size}px)\n`);
}

await browser.close();
