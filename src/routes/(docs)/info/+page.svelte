<script lang="ts">
	/**
	 * The page for a grown-up, and the reason it is a separate route rather than the front door.
	 *
	 * `docs/DESIGN.md` §6 asks for a child to be playing within two seconds of opening the app, and
	 * `/` now shows a light landing screen first (2026-08-22, once the game went live at a real
	 * domain rather than staying on a laptop) — but that screen names the game and offers "Los
	 * geht's!" and nothing to READ, so the promise is still kept for anybody who is not looking for
	 * this page. This is still where the reading happens: it is linked from the landing screen's
	 * footer and from the profile sheet, and a player who only wants to play still never has to open
	 * it. `backlog/stories/13-shipping-it.md` §3 argues the split at length.
	 *
	 * ## Why `/info` and not `/eltern`
	 *
	 * The page addresses a parent, so `/eltern` is the tempting name — and it names one of two
	 * audiences that are the same person at different moments. The other is anyone who lands here
	 * from a link or a store listing wanting to know what this thing is: a teacher, a relative,
	 * somebody Daniel sent it to. `/eltern` tells that person the page is not for them.
	 *
	 * And a path is the piece of copy you cannot change later. Every link that exists breaks, which
	 * is the same argument story 13 §1 makes about an Android `applicationId` and `CLAUDE.md` makes
	 * about the `floe.` storage namespace: **an identifier that is written once and read for ever
	 * should be descriptive and unglamorous.** `/info` is legible in German and English, is where a
	 * "more information" link is expected to point, and costs nothing if the audience is described in
	 * the first line of the page instead — which it is. The audience belongs in the copy. The copy can
	 * be rewritten.
	 *
	 * ## What this file may not contain
	 *
	 * - **No text input of any kind** (invariant 4, `docs/DECISIONS/0004`). Not a contact form, not a
	 *   newsletter box, not a search field. A `mailto:` is a link and is fine.
	 * - **No third-party anything** (`docs/DECISIONS/0005`). The CSP is `connect-src: 'self'` with no
	 *   remote origin listed, and a donation SDK is a third party with script access. A donation LINK
	 *   navigates away and needs no CSP entry, so that is what this uses. If anybody ever needs to add
	 *   an origin to `svelte.config.js` to make this page work, the page is wrong, not the CSP.
	 * - **The product name, typed** (invariant 5). It comes from `$lib/brand` and `brand.test.ts`
	 *   scans for it — it caught exactly this mistake in `app.css` earlier tonight.
	 */
	import { APP } from '$lib/brand';

	/**
	 * Where a donation would go, and it is deliberately not decided here.
	 *
	 * `null` renders the section with its honest sentence and NO button. That is not a stub, it is the
	 * correct behaviour for today: a live-looking button pointing nowhere is trap 4 with money on it,
	 * and a real destination that takes real payments is an outward-facing decision that belongs to
	 * the owner and to nobody else. Set the string, and the button appears.
	 *
	 * `e2e/info.spec.ts` asserts this page links to no external origin at all, so filling this in is a
	 * deliberate act that turns a test red and has to be answered. That is the point.
	 */
	const DONATION_URL: string | null = null;

	/** Same shape, same reason: a support address is the owner's to give out, not this file's to guess. */
	const CONTACT_EMAIL: string | null = null;
</script>

<!-- The shared document shell — scroll, touch-action, typography — is `(docs)/+layout.svelte` now.
     This page is only its content. -->
<svelte:head><title>{APP.name} — Für Eltern</title></svelte:head>

<!-- "Für Eltern" first, above the name, because the first thing this page has to do is tell a
		     child that it is not for them and a parent that it is. -->
<p class="kicker">Für Eltern</p>
<h1>{APP.name}</h1>
<p class="lede">{APP.tagline}</p>

<h2>Was das ist</h2>
<p>
	Ein kleines Pinguin-Spiel für Kinder von etwa acht bis zwölf Jahren. Es läuft im Browser, kostet
	nichts und muss nicht installiert werden. Wer mag, kann es über das Browser-Menü zum
	Startbildschirm hinzufügen — dann verhält es sich wie eine App.
</p>

<h2>Es ist noch nicht fertig</h2>
<p>
	Eine sehr frühe Version. Manches ist halb gebaut, manches ändert sich noch, und manches
	funktioniert vielleicht nicht.
</p>
<p>
	Wichtiger: der Fortschritt eines Kindes — sein Pinguin und sein gesammeltes Eis — liegt
	<strong>nur auf diesem einen Gerät</strong>. Es gibt kein Konto und keinen Server, auf dem etwas
	liegt. Wer die Browserdaten löscht oder das Gerät wechselt, fängt neu an. Das ist der ehrliche
	Stand und keine Einstellung, die man ändern kann.
</p>

<!-- The three things a parent actually wants to know, and all three are properties of how the
		     game is BUILT rather than settings somebody could switch off. Worth stating in that form:
		     "there is no chat" is a much stronger sentence than "chat is disabled". -->
<h2>Keine Werbung, kein Chat, keine Daten</h2>
<dl class="facts">
	<dt>Keine Werbung. Nie.</dt>
	<dd>
		Es gibt hier keine Anzeigen und es wird keine geben. Werbung in einem Spiel für Achtjährige ist
		ein Fremder, der mit ihnen spricht.
	</dd>

	<dt>Kein Chat und keine Namenseingabe.</dt>
	<dd>
		Kinder können sich hier nichts schreiben — auch nicht, wenn sie zusammen spielen. Die Namen der
		Pinguine kommen aus zwei festen Wortlisten, und es gibt kein Textfeld, in das man etwas anderes
		eintragen könnte. Das ist nicht abgeschaltet, sondern nicht gebaut.
	</dd>

	<dt>Keine Daten, kein Server.</dt>
	<dd>
		Das Spiel lädt keine fremden Inhalte, misst nichts und schickt nichts an Dritte. Alleine spielen
		funktioniert auch ganz ohne Internet.
	</dd>
</dl>

<h2>Geld</h2>
<p>
	Im Moment kostet nichts etwas, und es gibt nichts zu kaufen. Später soll man Dinge fürs
	<em>Aussehen</em> kaufen können — Farben, Hüte, Deko fürs Iglu.
</p>
<p>
	Was es nie geben wird: etwas Gekauftes, das einen Pinguin schneller, stärker oder besser macht. <strong
		>Ein Kind ohne Eis muss gewinnen können.</strong
	> Das ist eine feste Regel des Spiels und keine Absicht.
</p>
{#if DONATION_URL}
	<!-- A plain link, never an embedded payment widget — see the note on the CSP above. -->
	<p>
		<a class="action cta btn" href={DONATION_URL} rel="noreferrer">Spenden</a>
	</p>
{:else}
	<p>
		Spenden sind noch nicht möglich. Wenn es soweit ist, steht der Link hier — und er führt auf eine
		normale Webseite, nicht in eine Bezahlfunktion im Spiel.
	</p>
{/if}

<h2>Fragen?</h2>
{#if CONTACT_EMAIL}
	<p><a href="mailto:{CONTACT_EMAIL}">{CONTACT_EMAIL}</a></p>
{:else}
	<p>
		Eine Kontaktadresse kommt hier hin, sobald es eine gibt. Es gibt bewusst kein Kontaktformular:
		dieses Spiel hat kein einziges Textfeld, und diese Seite bekommt auch keins.
	</p>
{/if}

<!-- The way back, and it is the most prominent control on the page for the same reason
		     "Nochmal" is on the result screen: this is a page somebody arrived at from a game they
		     were playing. -->
<p class="back">
	<a class="action cta btn" href="/" data-testid="info-to-game">Zum Spiel</a>
</p>
