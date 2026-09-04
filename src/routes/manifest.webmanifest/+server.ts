import { APP } from '$lib/brand';

/**
 * The web app manifest, as a PRERENDERED route rather than a file in `static/`.
 *
 * Because of invariant 5. `brand.ts` is the only place the product name lives, and a manifest is
 * the most name-shaped file in a project: name, short_name, description. Dropping a hand-written
 * copy into `static/` would put the name in a second place immediately — and the one that shows up
 * under a child's home-screen icon, i.e. the copy that would silently go stale on a rename.
 *
 * `prerender` writes it out at build time, so this is still a static file on the CDN with no server
 * behind it; it just gets its strings from the module the rest of the app gets them from. The
 * extension in the route name is what makes the prerenderer emit `manifest.webmanifest` rather than
 * a directory with an index in it (`trailingSlash: 'always'` applies to pages, not to a path that
 * already names a file).
 */
export const prerender = true;

export function GET(): Response {
	const manifest = {
		name: APP.name,
		short_name: APP.name,
		description: APP.tagline,
		lang: 'de',
		// Both '/' — the game is one page. `start_url` with the trailing slash matches
		// `trailingSlash: 'always'`, so an installed app opens the prerendered page rather than
		// taking a redirect on every launch.
		start_url: '/',
		scope: '/',
		// FULLSCREEN, not `standalone`. Standalone still leaves the status bar, and on a phone in
		// landscape that is a strip of clock and battery across the sky. `display_override` is how a
		// browser that will not do fullscreen falls back one step at a time instead of all the way
		// to `browser`, which would put the address bar back.
		display: 'fullscreen',
		display_override: ['fullscreen', 'standalone', 'minimal-ui'],
		// The game is landscape-only and says so here as well as in the rotate card, because an
		// installed app is the one context where the browser can actually honour it.
		orientation: 'landscape',
		background_color: '#9fd8ef',
		theme_color: '#9fd8ef',
		categories: ['games', 'kids'],
		icons: [
			{ src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
			{ src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
			// A SEPARATE maskable icon, not the same file listed twice. Android crops a maskable icon
			// to whatever shape the launcher uses, so the artwork needs its own safe margin — reusing
			// the plain one gets the penguin's head clipped off on any device with round icons.
			{ src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
		]
	};

	return new Response(JSON.stringify(manifest, null, '\t'), {
		headers: { 'content-type': 'application/manifest+json' }
	});
}
