<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { APP } from '$lib/brand';
	import { armFullscreen } from '$lib/fullscreen';

	let { children } = $props();

	// Here rather than in `Game.svelte`, for the same reason the audio unlock lives in `sound.ts`:
	// the browser gates fullscreen behind a gesture, and the first gesture of a session can land on
	// the start screen or inside a room, both of which are rendered outside the game. One listener
	// for the life of the page, and it hands back its own undo so a remount cannot stack them.
	onMount(armFullscreen);
</script>

<svelte:head>
	<title>{APP.name} — {APP.tagline}</title>
	<meta name="description" content={APP.tagline} />
	<!--
		The display face, fetched in parallel with the bundle rather than after the stylesheet that
		asks for it. Without this the browser learns the font exists only once `app.css` has parsed,
		which on a phone is late enough that the first countdown numeral is drawn in the fallback and
		then reflows — and the countdown is the largest thing on the screen at the moment it happens.

		`crossorigin` is required even though the file is same-origin: a font is always fetched in CORS
		mode, so a preload without it is a second, unused download rather than a warm cache. The CSP
		in `svelte.config.js` allows it under `font-src 'self'`, which is the whole reason the file is
		in `static/` instead of on Google's CDN.

		Here rather than in `app.html` for the same reason the fullscreen arming is: this is the one
		place that wraps every screen the game has, and `app.html` is a template nobody reads twice.
	-->
	<link
		rel="preload"
		href="/fonts/baloo2-latin-700-800.woff2"
		as="font"
		type="font/woff2"
		crossorigin="anonymous"
	/>
</svelte:head>

{@render children()}
