<script lang="ts">
	/**
	 * The privacy page, and why it can be short and specific rather than long and vague.
	 *
	 * Most of these pages hedge, because most sites do not know what they collect until a vendor's
	 * SDK is audited. This one does not have that problem: `svelte.config.js`'s CSP is `connect-src:
	 * 'self'` with no third-party origin listed anywhere, so the honest answer to "what is sent
	 * where" is "nothing, because there is nowhere for it to go" — except the one thing every site
	 * on the internet discloses and this one had missed: the HOST ITSELF sees an access log. That
	 * gap is closed below, in a plain "Hosting" register that states the same fact about the same
	 * host the author's other sites use.
	 *
	 * **Derived from `storageKeys.ts` rather than typed from memory**, for the reason every other list
	 * in this codebase is derived from its source: a key added there and not here would be a fact this
	 * page is wrong about, silently, the day it ships.
	 *
	 * The email is filled in from `onMount` rather than present at all in the prerendered HTML —
	 * see `/impressum`'s comment on this exact field for why: `ssr = true` runs this script
	 * server-side, so a string merely assembled at the top of it (the first version of this) still
	 * ends up in the served response as plain text, which Cloudflare's own edge then mangles into a
	 * `[email protected]` placeholder before anybody sees it — checked against a live deploy, not
	 * guessed at. `onMount` never runs during SSR, so this way the address is simply absent from the
	 * bytes this route prerenders.
	 */
	import { onMount } from 'svelte';
	import { APP } from '$lib/brand';

	let email = $state('');
	onMount(() => {
		// Same alias the imprint prints — the two pages must not disagree about where a
		// data-protection request goes.
		email = ['legal', 'metzner.uk'].join('@');
	});
	function mail() {
		if (email) window.location.href = `mailto:${email}`;
	}
</script>

<svelte:head><title>{APP.name} — Datenschutz</title></svelte:head>

<p class="kicker">Rechtliches</p>
<h1>Datenschutzerklärung</h1>
<p class="lede">Stand: August 2026. Kurz, weil es kurz sein kann.</p>

<h2>Hosting</h2>
<p>
	Diese Seite wird über Cloudflare Pages (Cloudflare, Inc.) ausgeliefert. Beim Aufruf werden
	technisch notwendige Zugriffsdaten (u. a. die IP-Adresse) in Server-Logfiles verarbeitet.
	Rechtsgrundlage: berechtigtes Interesse am sicheren und stabilen Betrieb (Art. 6 Abs. 1 lit. f
	DSGVO).
</p>

<h2>Kein Konto, keine Übertragung im Spiel</h2>
<p>
	{APP.name} läuft vollständig im Browser. Solange man alleine spielt, verlässt kein einziges Byte das
	Gerät — es gibt keinen Server, der Spielstände, Namen oder irgendetwas anderes empfängt. Es gibt keine
	Analyse-Tools, keine Werbenetzwerke, keine eingebetteten Inhalte von Dritten und keine Cookies. Die
	technische Absicherung dafür ist eine Content-Security-Policy, die jede Verbindung außer zur eigenen
	Seite und zum Hosting oben blockiert.
</p>

<h2>Was auf dem Gerät gespeichert wird</h2>
<p>
	Ein paar Kleinigkeiten liegen im <code>localStorage</code> des Browsers — dem Teil des Speichers, der
	nur diesem Gerät und nur dieser Seite gehört und nirgendwo hin übertragen wird:
</p>
<dl class="facts">
	<dt>Ein Name und ein Aussehen</dt>
	<dd>
		Der Pinguin-Name kommt aus zwei festen Wortlisten (kein Freitext möglich) und das Aussehen aus
		einer Farb- und Hutauswahl. Beides ist frei erfunden und sagt nichts über die Person aus, die
		spielt.
	</dd>
	<dt>Ob der Ton aus ist</dt>
	<dd>Eine einzelne Ja/Nein-Einstellung.</dd>
	<dt>Der Spielstand auf der Insel</dt>
	<dd>
		Gesammeltes Eis und der Ausbau des eigenen Iglus. Nichts davon ist mit einer Person verknüpft —
		nur mit dem Gerät, auf dem gespielt wurde.
	</dd>
	<dt>Ob die Startseite schon einmal bestätigt wurde</dt>
	<dd>Damit sie beim nächsten Besuch nicht noch einmal erscheint.</dd>
</dl>
<p>
	Nichts davon wird gesendet, ausgewertet oder mit einer Person verknüpft. Löscht man die
	Browserdaten oder wechselt man das Gerät, ist alles davon weg — es gibt keine Kopie irgendwo
	anders, weil es nirgendwo anders hin geschickt wurde.
</p>

<h2>Falls doch einmal mit anderen gespielt wird</h2>
<p>
	Ein gemeinsames Spiel mit anderen Geräten ist noch nicht möglich. Wenn diese Funktion fertig ist,
	wird sie ohne einen zentralen Server auskommen (Geräte verbinden sich direkt miteinander); dabei
	ist es technisch nicht zu vermeiden, dass die beteiligten Geräte für die Dauer der Verbindung ihre
	IP-Adresse gegenseitig sehen — das ist bei jeder Direktverbindung zwischen zwei Geräten so und
	nicht spezifisch für dieses Spiel. Diese Seite wird aktualisiert, sobald diese Funktion aktiv ist,
	mit einer genauen Beschreibung statt dieser Vorschau.
</p>

<h2>Deine Rechte &amp; Kontakt</h2>
<p>
	Auskunft, Berichtigung und Löschung: <button class="maillink" onclick={mail}>{email}</button>.
	Siehe auch das <a href="/impressum">Impressum</a> für Name und Anschrift.
</p>

<p class="back">
	<a class="action cta btn" href="/" data-testid="datenschutz-to-game">Zum Spiel</a>
</p>
