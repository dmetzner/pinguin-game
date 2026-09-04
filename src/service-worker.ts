/// <reference types="@sveltejs/kit" />
/// <reference lib="webworker" />

/**
 * Offline, which for this game is not a feature but the removal of a lie.
 *
 * Solo play already needs no network: no backend, no accounts, no assets to fetch — every penguin,
 * floe and wave is generated in code, and the whole download is the bundle. A player on a school
 * wifi that drops, or on a phone in a car, was nevertheless shown the browser's dinosaur, because
 * nothing had ever said the files could be kept. This says it.
 *
 * SvelteKit registers this file automatically in a production build. It is deliberately the plainest
 * possible service worker — no Workbox, no runtime strategy per route — because there is exactly one
 * page and it is all static.
 */

// `ServiceWorkerGlobalScope` is what `self` is here; TypeScript's DOM lib types it as a Window.
const worker = self as unknown as ServiceWorkerGlobalScope;

import { build, files, prerendered, version } from '$service-worker';

/**
 * A cache per BUILD, and that is the whole update story.
 *
 * `version` changes with every build, so a new deployment fills a new cache and then deletes every
 * other one in `activate`. Nothing has to reason about which individual file changed — the hashed
 * asset names in `build` make that question meaningless anyway — and there is no way to end up
 * serving last week's `_app/immutable/entry.js` against this week's page, which is the failure mode
 * every hand-written service worker eventually produces.
 */
const CACHE = `floe-${version}`;

/**
 * What may be answered from the cache without asking the network first.
 *
 * `build` is this build's content-hashed output, so a cached copy cannot be stale; `files` is
 * `static/`, which changes only with a deploy. Confirming either over the network would cost a
 * round trip for an answer that is knowable in advance — and `files` includes the icons, where a
 * miss matters more than it sounds: an installed app whose icon 404s is one the launcher may
 * quietly replace with a generic square.
 *
 * The PAGE is precached (see `fill`) but deliberately NOT here: it is the one URL whose content
 * changes under a fixed name, so it stays network-first with the cache as its fallback — online you
 * get the new build immediately, offline you get the last one.
 */
const CACHE_FIRST = new Set([...build, ...files]);

/**
 * Fill the cache, and do not let one missing file take the whole worker down with it.
 *
 * `cache.addAll` is all-or-nothing: ONE rejection and the install fails, and a failed install is
 * discarded entirely — no worker, no offline, and `getRegistrations()` returning an empty array as
 * if nothing had ever tried. That is exactly what happened here, and the culprit is worth naming:
 * `files` includes `static/.nojekyll`, a leftover from the GitHub Pages deployment, and most static
 * servers (`vite preview`'s sirv among them) refuse to serve dotfiles. So a 404 on a zero-byte file
 * nothing reads silently disabled the entire offline story, and the only symptom was that the
 * dinosaur still appeared.
 *
 * So the lists are treated differently, on purpose. `build` is this build's own hashed output:
 * every entry must exist, and if one does not, something is wrong enough that failing loudly is
 * right. `files` is whatever happens to be in `static/`, a directory people drop things into, and
 * `prerendered` is the page — each of those is added on its own and a failure is skipped.
 *
 * `prerendered` is the entry that is easy to leave out and fatal to leave out: `build` is the
 * JavaScript and CSS, but the HTML that loads it is a prerendered path, and without it the first
 * offline navigation fails before a single one of those assets is asked for. That presents as "the
 * worker is registered and the game still shows the dinosaur", which is indistinguishable from
 * having no worker at all. A red end-to-end run is what found it.
 */
async function fill(): Promise<void> {
	const cache = await caches.open(CACHE);
	await cache.addAll(build);
	await Promise.all(
		[...files, ...prerendered].map(async (file) => {
			try {
				await cache.add(file);
			} catch {
				// One un-servable file in `static/` is not a reason to have no offline game.
			}
		})
	);
}

worker.addEventListener('install', (event) => {
	// `skipWaiting` because there is nothing to lose by replacing an old worker immediately: this is
	// a single-page game with no unsaved state on the wire and no open connections that a swap could
	// interrupt. Without it a new version waits for every tab to close, which on a phone means the
	// player is on last week's build until they remember to swipe the tab away.
	event.waitUntil(fill().then(() => worker.skipWaiting()));
});

worker.addEventListener('activate', (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) =>
				Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))
			)
			// Claim the pages that are already open, so the very first visit is offline-capable
			// without a reload. Without this the tab that INSTALLED the worker is the one tab it does
			// not control, which is exactly the tab someone is about to walk out of wifi range with.
			.then(() => worker.clients.claim())
	);
});

worker.addEventListener('fetch', (event) => {
	const request = event.request;

	// Only GET, and only this origin. A POST is not cacheable, and the game makes no cross-origin
	// requests at all — the CSP in `svelte.config.js` forbids them — so anything else is something
	// this worker has no business answering.
	if (request.method !== 'GET') return;
	const url = new URL(request.url);
	if (url.origin !== location.origin) return;

	event.respondWith(
		(async () => {
			const cache = await caches.open(CACHE);

			// Build output and static files are cache-FIRST and never revalidated. Their names carry
			// a content hash, so a cached one cannot be stale; going to the network to confirm that
			// would cost a round trip on every asset for an answer that is knowable in advance.
			if (CACHE_FIRST.has(url.pathname)) {
				const hit = await cache.match(url.pathname);
				if (hit) return hit;
			}

			// Everything else — the page itself — is network-first, so a player who IS online gets a
			// new build the moment it exists rather than whenever the cache happens to turn over.
			try {
				const response = await fetch(request);
				// Only real, complete responses go in the cache. A 404 or an opaque redirect stored
				// here would be served back forever, and "the game 404s offline but works online" is
				// a bug report nobody can reproduce.
				if (response.status === 200 && response.type === 'basic') {
					cache.put(request, response.clone());
				}
				return response;
			} catch {
				const hit = await cache.match(request);
				if (hit) return hit;
				// Offline, and never seen this URL. Nothing useful to return — but an error thrown
				// out of `respondWith` gives the browser its own offline page, which is the right
				// answer for a URL this game does not have.
				throw new Error(`offline and not cached: ${url.pathname}`);
			}
		})()
	);
});
