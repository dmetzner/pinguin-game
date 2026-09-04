<script lang="ts">
	/**
	 * The shared shell for every DOCUMENT page — `/info`, `/impressum`, `/datenschutz`. One `<main>`,
	 * one `<article>`, one stylesheet, so a fix to the scroll behaviour or the typography lands on all
	 * three at once instead of drifting between three copies of the same 120 lines. `(docs)` is a
	 * route GROUP — the parentheses are invisible to the URL, so every page keeps the path it would
	 * have had without this file.
	 *
	 * Extracted from `/info`, which was the only page here when it was written and said so in its own
	 * comment. That stopped being true the moment a second document existed.
	 */
	let { children } = $props();
</script>

<!--
	A DOCUMENT, which is a thing this project has otherwise never had, and the two rules it breaks say
	so.

	`app.css` puts `position: fixed; overflow: hidden; touch-action: none` on `body`, because the whole
	viewport is a control surface and a rubber-band scroll in the middle of a round is never what was
	meant. A page of prose has to scroll, so the scroller is this element rather than the document —
	and `touch-action` has to be given back explicitly, because the effective value is intersected up
	the ancestor chain and `none` on `body` otherwise stops a finger panning a descendant.

	`user-select` likewise: the game turns it off so a long-press on a penguin does not select the HUD,
	and a parent who wants to copy an address needs it back.

	Landscape-only does NOT apply here, and this is the one family of routes where that is true. The
	rotate card lives inside `Game.svelte`, so there is none on any page in this group — they read in
	either orientation, which is what a document should do and what the arena cannot.
-->
<main class="doc">
	<article class="panel">
		{@render children()}
	</article>
</main>

<style>
	/**
	 * Route-scoped rather than in `app.css`, and the split is meaningful: that file is the game's
	 * interface — plaques, chunky buttons, thumb targets — and this group is running text. Putting a
	 * document's typography in the shared sheet would invite the next person to reuse it for a HUD.
	 *
	 * It still borrows every token, because custom properties inherit: the plaque, the ink and the
	 * display face are the game's, so every page here looks like it belongs to it.
	 */
	.doc {
		/* The scroller is here, not the document — `body` is `position: fixed; overflow: hidden`. */
		height: 100%;
		overflow-y: auto;
		/* Given back explicitly. `body` has `touch-action: none` and the effective value is intersected
		   up the ancestor chain, so without this a finger cannot pan this element at all. */
		touch-action: pan-y;
		-webkit-user-select: text;
		user-select: text;
		padding: 1.5rem 1rem calc(3rem + env(safe-area-inset-bottom));
	}

	article {
		max-width: 34rem;
		margin: 0 auto;
		padding: 1.75rem 1.5rem 2rem;
		/**
		 * 400, against the 700 `app.css` puts on `body`.
		 *
		 * That weight is right for the game — every string there is a label two words long, and heavy
		 * is what stops it reading like a website. It is wrong for running prose: Baloo 2 at 700 is a
		 * wall of text, and this group is the only place in the project with running text in it. The
		 * headings keep 800, so a page still sounds like the same game.
		 */
		font-weight: 400;
		line-height: 1.6;
	}

	:global(.kicker) {
		margin: 0;
		font-size: 0.8rem;
		font-weight: 800;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		/* The one place `--accent-ink` earns its keep outside the HUD: a warm label that is still 4.7:1
		   on the plaque, where `--accent` itself is 1.9:1 and unreadable. */
		color: var(--accent-ink);
	}

	:global(h1) {
		margin: 0.15rem 0 0;
		font-size: clamp(1.9rem, 7vw, 2.6rem);
		font-weight: 800;
		line-height: 1.1;
	}

	:global(.lede) {
		margin: 0.35rem 0 0;
		font-size: 1.05rem;
		font-weight: 700;
		/* Dimmed with a token rather than with `opacity`, so the ink stays a measured 5.3:1 on the
		   plaque instead of whatever 80% of it happens to come out at. */
		color: var(--on-panel-dim);
	}

	:global(h2) {
		margin: 1.75rem 0 0.4rem;
		font-size: 1.15rem;
		font-weight: 800;
	}

	:global(p) {
		margin: 0.65rem 0 0;
	}

	:global(strong) {
		font-weight: 800;
	}

	/* The three-facts pattern each page uses, as a definition list because that is what it is: a claim
	   and what it means. A `<ul>` would have been a lie about the structure to a screen reader. */
	:global(.facts) {
		margin: 0.5rem 0 0;
	}
	:global(.facts dt) {
		margin-top: 0.9rem;
		font-weight: 800;
	}
	:global(.facts dd) {
		margin: 0.2rem 0 0;
	}

	/**
	 * `.action` sets no `display`, on purpose — `app.css` explains at length why that file does not
	 * touch layout properties on classes the markup also positions. So an anchor wearing it has to be
	 * told, here, where it is uncontested and route-local.
	 */
	:global(.btn) {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: 3rem;
		padding: 0 1.4rem;
		font-size: 1.05rem;
		text-decoration: none;
	}

	:global(.back) {
		margin-top: 2rem;
	}

	:global(a:not(.btn)) {
		color: var(--on-panel);
		text-decoration-thickness: 2px;
		text-underline-offset: 3px;
	}

	/* A runtime-assembled email, styled to read as a link — `/impressum` and `/datenschutz` both
	   need one, for the same anti-scraper reason (see either page's own comment). */
	:global(.maillink) {
		background: none;
		border: none;
		padding: 0;
		font: inherit;
		color: var(--on-panel);
		font-weight: 600;
		cursor: pointer;
		text-decoration: underline;
		text-decoration-thickness: 1px;
		text-underline-offset: 2px;
	}
</style>
