<script lang="ts">
	/**
	 * Offenlegung gemäß § 25 Mediengesetz und § 5 ECG (Österreich) — the operator identity is stated
	 * once here and matches the author's other projects rather than inventing a fourth version.
	 * Austrian law, not German: `§ 25 MedienG` for a private "kleine Website" wants the owner's name
	 * and place of residence, NOT a street, which is why this file prints only a postal code and a
	 * city.
	 *
	 * If this game ever earns money — a donation link is the first candidate — the pattern worth
	 * copying is to render the fuller commercial imprint (a real street address, a VAT id if one
	 * applies) off the SAME flag that turns on taking money, so the two states can never disagree.
	 */
	import { onMount } from 'svelte';
	import { APP } from '$lib/brand';

	const OPERATOR_NAME = 'Daniel Metzner';
	const OPERATOR_PLACE = '8010 Graz, Österreich';

	/**
	 * Filled in from `onMount`, which never runs during SSR — checked against the live deploy
	 * rather than assumed, because the first version of this (the address assembled from parts at the
	 * TOP of the script) turned out not to help at all: `ssr = true` for this route runs the whole
	 * script server-side to prerender it, so the assembled string still landed in the served HTML as
	 * plain text — and Cloudflare's own edge (Scrape Shield's email obfuscation) then rewrote it into
	 * a `[email protected]` placeholder before anybody saw it. That was found on a live deploy, not
	 * guessed at.
	 *
	 * Deferred to `onMount` instead, the address is simply ABSENT from the bytes this route
	 * prerenders — nothing for Cloudflare's edge to pattern-match, and nothing for a scraper reading
	 * the response to find either. A visitor's own browser fills it in a moment after the page
	 * loads, which costs nothing on a page that needs JavaScript for everything else on it anyway.
	 */
	let email = $state('');
	onMount(() => {
		// The legal alias, not the address a human writes to: § 5 ECG wants a contact that WORKS,
		// and a purpose-specific one can be burned after harvesting without collateral damage.
		email = ['legal', 'metzner.uk'].join('@');
	});
	function mail() {
		if (email) window.location.href = `mailto:${email}`;
	}
</script>

<svelte:head><title>{APP.name} — Impressum</title></svelte:head>

<p class="kicker">Rechtliches</p>
<h1>Impressum</h1>
<p class="lede">Offenlegung gemäß § 25 Mediengesetz und § 5 ECG.</p>

<h2>Medieninhaber, Herausgeber und für den Inhalt verantwortlich</h2>
<p>
	{OPERATOR_NAME}<br />
	{OPERATOR_PLACE}<br />
	<button class="maillink" onclick={mail}>{email}</button>
</p>

<h2>Gegenstand</h2>
<p>
	{APP.name} ist ein privates, nicht kommerzielles Freizeitprojekt: ein Pinguin-Spiel ohne Werbung, ohne
	In-App-Käufe und ohne Konten. Es besteht keine Gewinnabsicht, es liegt kein Gewerbe vor und es ist keine
	UID-Nummer vorhanden.
</p>

<h2>Urheberrecht</h2>
<p>
	© 2026 {OPERATOR_NAME}. Alle Rechte vorbehalten. Programmcode, Grafik, Texte und Töne sind eigene
	Werke und dürfen ohne schriftliche Zustimmung nicht kopiert, weiterverbreitet, verändert oder
	unter anderem Namen veröffentlicht werden — auch nicht als Datensatz zum Trainieren von Modellen.
	Spielen und Benutzen ist ausdrücklich erlaubt.
</p>

<h2>Fremde Bestandteile</h2>
<p>
	Die Anwendung enthält keine fremden Schriften, Bilder oder Audiodateien — die Grafik ist
	prozedural erzeugt und Töne werden im Gerät synthetisiert. Verwendete Open-Source-Bibliotheken
	(SvelteKit, Three.js und andere) bleiben unter ihrer jeweils eigenen Lizenz.
</p>

<h2>Haftung</h2>
<p>
	Das Spiel wird ohne Gewähr bereitgestellt. Für Inhalte verlinkter Seiten ist deren jeweiliger
	Betreiber verantwortlich.
</p>

<p>Zum Umgang mit Daten siehe die <a href="/datenschutz">Datenschutzerklärung</a>.</p>

<p class="back">
	<a class="action cta btn" href="/" data-testid="impressum-to-game">Zum Spiel</a>
</p>
