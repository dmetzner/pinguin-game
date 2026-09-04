/**
 * `ssr = true` for the whole group, once — see `routes/info/+page.ts`'s old comment for the full
 * argument, kept here because every page under this group needs exactly the same reasoning.
 *
 * The root layout turns SSR off because the game is a WebGL canvas a Node process cannot render.
 * Every page in `(docs)` is the opposite kind of thing: prose, for a person rather than a player, and
 * with SSR off `adapter-static` would write the SPA shell and the words would only appear once
 * JavaScript has run — the one audience a legal notice and a privacy page cannot afford to be
 * invisible to is a crawler, a store reviewer, or a parent who wants to read it before anything runs.
 *
 * `(docs)` is a route GROUP: the parentheses keep every page's URL exactly what it would have been
 * without this file (`/info`, `/impressum`, `/datenschutz`) — grouping is what lets three pages share
 * this one setting and the shared document shell in `+layout.svelte`, without three copies of either.
 */
export const ssr = true;
