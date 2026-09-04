/**
 * No server, ever. `ssr = false` because the whole page is a WebGL canvas that a Node process
 * cannot produce, and `prerender` still writes the shell at build time so the first paint is a
 * static file — which is what makes solo play work offline from a CDN with no backend at all.
 */
export const ssr = false;
export const prerender = true;
export const trailingSlash = 'always';
