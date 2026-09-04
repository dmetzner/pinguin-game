import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	build: {
		// Three.js is large and the game is unplayable without it, so there is nothing to gain from
		// splitting it out — but there IS something to lose from not noticing it growing. The limit
		// is set just above where the bundle sits today so that adding a second heavyweight
		// dependency produces a warning rather than a silently slower first load on a school wifi.
		chunkSizeWarningLimit: 700
	}
});
