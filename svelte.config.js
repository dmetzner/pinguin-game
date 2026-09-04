import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/**
 * `BASE_PATH` exists so the same build can be served from a project subpath (GitHub Pages puts a
 * repo at `/pinguin-game/`) or from a domain root (Cloudflare Pages). Unset means root, which is
 * what `npm run dev` and every test uses.
 */
const base = process.env.BASE_PATH ?? '';

/** @type {import('@sveltejs/kit').Config} */
export default {
	preprocess: vitePreprocess(),
	compilerOptions: { runes: true },
	kit: {
		// A static SPA. There is no server and there will not be one: solo play must work with the
		// network off (invariant 5), and phase 3's multiplayer is peer-to-peer, so the only thing a
		// backend would ever do is introduce two browsers to each other.
		//
		// `fallback: '404.html'` and NOT `index.html` — with `index.html`, adapter-static prerenders
		// the landing page and then silently overwrites it with the SPA shell, which costs the only
		// page a crawler or a link preview ever sees. The sibling repos document having shipped
		// exactly that; there is no reason to inherit it.
		adapter: adapter({ fallback: '404.html', precompress: false, strict: false }),
		paths: { base },
		csp: {
			mode: 'hash',
			directives: {
				'default-src': ['self'],
				'script-src': ['self'],
				// `blob:` is for the name tags: each penguin's label is drawn to a canvas and uploaded
				// as a texture, and `data:`/`blob:` is how that reaches WebGL. No remote image origin
				// is listed, because the game loads none — every pixel is generated in code.
				'img-src': ['self', 'data:', 'blob:'],
				'style-src': ['self', 'unsafe-inline'],
				'font-src': ['self'],
				// Deliberately empty of third parties. Phase 3 adds exactly one entry here for the
				// signalling transport, plus `wss:` for the peer connections, and that will be the
				// complete list of everything this game can talk to.
				'connect-src': ['self'],
				'base-uri': ['none'],
				'form-action': ['none'],
				'object-src': ['none'],
				'worker-src': ['self', 'blob:']
			}
		}
	}
};
