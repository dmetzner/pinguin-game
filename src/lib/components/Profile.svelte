<script lang="ts">
	/**
	 * "Mein Profil": who this player is on this device, and an honest sentence about what that means.
	 *
	 * Asked for as ACCOUNT CREATION, with the owner's own caveat that it is a pre-alpha and that saving
	 * is not possible yet. What is built is a profile screen that says so plainly, and the word "Account"
	 * appears exactly once — in the sentence explaining that there is not one. The reasoning, because it
	 * is a product decision and not a shortcut:
	 *
	 *  * An account is a thing you can log into from another device and get your penguin back. This one
	 *    cannot do that, and there is no server for it to do it against. Calling it an account would be
	 *    a promise to the audience least able to check it — and the way that promise breaks is a child
	 *    who believes their Eis is safe, clears their browser data, and loses it. A screen that tells
	 *    them the truth in a sentence they can read is worth more than the word.
	 *  * **There is no text field here, and there never can be.** A typed display name is free text
	 *    between players wearing a different hat, and `docs/DECISIONS/0004` forbids it: the name comes
	 *    from the curated generator in `lib/names.ts` (two word lists, 1156 combinations) and is
	 *    re-rolled with the die, exactly as it is in "Mein Pinguin". That is not a limitation of this
	 *    screen; it is invariant 4, and it is why this screen has a die on it instead of a keyboard.
	 *
	 * It owns nothing. The name, the look and the Eis are all read by `Game.svelte` and passed in, so
	 * there is one reader of `identity.ts` and one of `eis.ts` rather than two of each.
	 */
	interface Props {
		/** The name over this player's penguin, from the generator. Never typed. */
		name: string;
		/** Eis in hand, from `lib/eis.ts`. Shown because it is the thing a child comes here to look at. */
		eis: number;
		/** Roll another name from the curated lists. The same handler "Mein Pinguin" uses. */
		onReroll: () => void;
		/** Open the look editor, which is where colours and hats live. */
		onCustomise: () => void;
		/**
		 * Join or host a room, or absent — the same condition `Game.svelte`'s own "Mit Freunden"
		 * button used to be gated on. Undefined rather than a boolean, so there is no state here that
		 * can disagree with the caller about whether multiplayer exists at all.
		 */
		onFriends?: () => void;
		onClose: () => void;
	}

	let { name, eis, onReroll, onCustomise, onFriends, onClose }: Props = $props();
</script>

<!-- `z-30` and `pointer-events-auto`, the same as the look editor: this sheet is MEANT to block, and
     says so rather than relying on being late in the DOM. It covers the joystick's half of the screen,
     which is exactly what should happen while a child is reading a sentence about their penguin.

     Still named `Profile.svelte` and still `data-testid="profile"` — it grew into the settings sheet
     the top-row ⚙ opens (Daniel, 2026-08-22: too many topbar buttons), and everything that button used
     to reach ("Mein Pinguin", "Mit Freunden") moved in here rather than each keeping its own spot in a
     row that was already crowded. The file keeps its name because what it is ABOUT did not change —
     who you are on this device — it just says more about it now. -->
<div class="absolute inset-0 z-30 grid place-items-center p-4" data-testid="profile">
	<div class="panel max-h-full w-full max-w-md overflow-y-auto p-4">
		<div class="mb-3 flex items-center justify-between gap-3">
			<p class="text-xl font-extrabold">Einstellungen</p>
			<button class="action h-11 w-24 text-base" onclick={onClose} data-testid="profile-done">
				Fertig
			</button>
		</div>

		<!-- The name, and the die beside it. A `<p>` and a button, never an input: see the note above. -->
		<div class="mb-3 flex items-center gap-3">
			<p class="grow text-lg font-bold" data-testid="profile-name">{name}</p>
			<button
				class="action action-glyph h-12 w-12 text-xl"
				onclick={onReroll}
				aria-label="Anderen Namen würfeln"
				data-testid="profile-reroll"
			>
				🎲
			</button>
		</div>

		<!-- What the games have paid for. The same glyph and the same word as the plaque on the island,
		     because a child should not have to learn that two things are the same thing.
		     Plain text rather than a `.pill`: a pill is a plaque, and a plaque drawn on a plaque is the
		     same cream fill inside a 2 px ring — `.pill` and `.panel` share `--panel`, so this reads as a
		     mistake on top of the sheet rather than as a label on the ice. -->
		<p class="mb-4 text-base" data-testid="profile-eis">
			<span aria-hidden="true">❄</span> <b class="text-xl">{eis}</b> Eis
		</p>

		<!-- The honest part, and it is written for a child first and a parent second: short sentences,
		     no jargon, and the one thing that could actually cost them something said in bold. -->
		<div class="mb-4">
			<p class="mb-1 text-xs font-extrabold" style="color: var(--danger)">PRE-ALPHA</p>
			<p class="text-sm">Das Spiel ist noch nicht fertig.</p>
			<p class="mt-1 text-sm">
				Dein Pinguin und dein Eis bleiben nur auf <b>diesem Gerät</b>. Es gibt noch keinen Account —
				später kannst du dich anmelden, dann ist alles auch auf anderen Geräten da.
			</p>
		</div>

		<button class="action h-12 w-full text-base" onclick={onCustomise} data-testid="profile-look">
			Aussehen ändern
		</button>

		<!-- Only where a room exists to go to — the same gate `Game.svelte`'s old standalone button
		     carried, moved rather than loosened: the roster is fixed when a round starts, so this has
		     never been offered mid-room. -->
		{#if onFriends}
			<button
				class="action mt-2 h-12 w-full text-base"
				onclick={onFriends}
				data-testid="profile-friends"
			>
				Mit Freunden spielen
			</button>
		{/if}

		<!-- The way to the parents' page, and it is deliberately the quietest thing on this sheet.
		     A text link rather than an `.action`, because every chunky button in this game is an
		     invitation and this one is not for the person holding the phone: `/info/` is written for a
		     grown-up, and story 13 §2 puts anything about money behind a door a child does not pass
		     through to play. Making it look pressable would be aiming it at exactly the wrong reader.

		     A plain `<a>`, so it works with the back gesture and needs no handler. It navigates, which
		     ends the current round — acceptable here because this sheet is only reachable when the
		     button row is up, and a rematch is one tap away. -->
		<p class="mt-4 text-center text-xs">
			<a class="parents-link" href="/info/" data-testid="profile-info">
				Für Eltern: Infos, Daten und Kosten
			</a>
		</p>
	</div>
</div>

<style>
	/* Route-local rather than in `app.css`: this is the only link-as-text in the whole interface, and
	   the shared sheet has no anchor styling at all because the game has no other links in it. Dimmed
	   with the token rather than with `opacity`, so it stays a measured 5.3:1 on the plaque. */
	.parents-link {
		color: var(--on-panel-dim);
		text-decoration-thickness: 2px;
		text-underline-offset: 3px;
	}
</style>
