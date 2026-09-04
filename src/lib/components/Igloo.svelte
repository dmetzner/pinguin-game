<script lang="ts">
	/**
	 * "Mein Iglu" — what has been built, what the next thing costs, and the way in.
	 *
	 * The one screen in this game where a child spends something, and it is built round one rule: **the
	 * next rung is the whole interface.** There is no shop grid, no list of four things to compare and
	 * no decision to get wrong — story 12's ladder is linear, so the screen shows the rung after this
	 * one, its price, and whether it is affordable yet. A child of eight reads one sentence and presses
	 * one button, or walks away and comes back with more Eis.
	 *
	 * **The purchase happens HERE**, through `lib/igloo.buyNext`, and the new totals go up to the page
	 * rather than the page reaching down to do the arithmetic. That keeps the economy in exactly two
	 * files — `eis.ts` earns and `igloo.ts` spends — and it means there is one place in the app where a
	 * child's Eis can go down. `onBought` exists so the HUD's own copy of the total does not go stale.
	 *
	 * It is a MODAL and blocking the taps behind it is the point, which is also the fix for a trap this
	 * repo has paid for four times: the joystick's zone is the whole left half of the screen and it
	 * comes later in the DOM, so anything that shares space with it is visible, pressable and dead.
	 * `Customise.svelte` is the same shape for the same reason.
	 *
	 * There is no text field and there will not be one. A house you can name is a free-text field with
	 * a roof on it — `docs/DECISIONS/0004` — and every word a child reads here is one of the four in
	 * `IGLOO_LADDER`.
	 */
	import { untrack } from 'svelte';
	import { buyNext, IGLOO_LADDER, iglooStage, nextStep, priceOf, type Purchase } from '$lib/igloo';

	interface Props {
		/**
		 * Eis in hand, as the page has it.
		 *
		 * Passed in rather than read here, because the page is already holding the number for its HUD
		 * and two readers of one value is how a corner of the screen ends up disagreeing with a button.
		 */
		eis: number;
		/** The new stage and the new total, after a purchase. The page's HUD needs both. */
		onBought: (bought: Purchase) => void;
		/** Look inside. The interior is a framing, not a screen — see `render/igloo.ts`. */
		onInside: () => void;
		onClose: () => void;
	}

	let { eis, onBought, onInside, onClose }: Props = $props();

	/**
	 * How much is built, held here and updated by a purchase.
	 *
	 * Read once at mount, which is all it takes: this sheet is the only thing in the app that can
	 * change it, so nothing can move it under us while it is open.
	 */
	let stage = $state(iglooStage());
	/**
	 * The wallet as this sheet draws it, seeded from the page and moved by a purchase.
	 *
	 * A copy rather than the prop, and not for reactivity's sake: writing back to a prop is writing to
	 * somebody else's state from inside a component, and the page owns that number for its HUD. Nothing
	 * can earn Eis while this modal is open — it is a hub, there is no round running behind it — so the
	 * only thing that moves the total is the button below, which is why a snapshot is enough.
	 */
	let held = $state(untrack(() => eis));

	const step = $derived(nextStep(stage));
	const price = $derived(priceOf(stage));
	const affordable = $derived(step !== null && held >= price);
	/** How many Eis short, for the line that says so. Never negative, so it never reads "noch -12". */
	const short = $derived(Math.max(0, price - held));

	function build() {
		const bought = buyNext();
		if (!bought.built) return;
		stage = bought.stage;
		held = bought.eis;
		onBought(bought);
	}
</script>

<!-- Deliberately NOT `.overlay`: a modal, and taps behind it are meant to stop here. -->
<div class="absolute inset-0 z-30 grid place-items-center p-4" data-testid="igloo">
	<!-- `max-h-full overflow-y-auto`, copied from `Profile.svelte` and not optional: the content adds up
	     to about 350 px, or 400 with the rungs on two lines, against the 288 px a 568x320 phone has. A
	     centred sheet taller than its budget pushes its own HEADER off the top edge — and the header
	     holds "Fertig", the only way out of a modal. That is trap 4's family for the sixth time in this
	     repo: a control that is visible in source, looks pressable, and cannot be reached. Found by the
	     UI designer at 568x320, which is the smallest screen this game claims to support. -->
	<div class="panel max-h-full w-full max-w-md overflow-y-auto p-4">
		<div class="mb-3 flex items-center justify-between gap-3">
			<p class="text-xl font-extrabold">Mein Iglu</p>
			<!-- The wallet, beside the prices rather than only in the corner of the game behind this
			     sheet: "can I afford it" is the only question this screen asks, and the two numbers that
			     answer it have to be in one glance of each other. -->
			<p class="text-lg font-extrabold" data-testid="igloo-eis">{held} Eis</p>
			<button class="action h-11 w-24 text-base" onclick={onClose} data-testid="igloo-done">
				Fertig
			</button>
		</div>

		<!-- What is built, as one chip per rung. The done ones carry a ✓ as well as their colour,
		     because nothing in this game carries information by colour alone.

		     `chip-done` rather than `chip-on`: same fill and rim, no outline ring. The ring means "this
		     is the one you picked" and a progress rung is not a selection — one class doing duty for two
		     states is what reads as a bug to whoever comes to add a third. From the UI designer, which
		     owns `app.css`. -->
		<div class="mb-4 flex flex-wrap gap-2" data-testid="igloo-rungs">
			{#each IGLOO_LADDER as rung, i (rung.label)}
				<span class="chip grid place-items-center" class:chip-done={i < stage}>
					{i < stage ? '✓ ' : ''}{rung.label}
				</span>
			{/each}
		</div>

		{#if step}
			<p class="text-lg font-extrabold">{step.label}</p>
			<p class="mb-3 text-base opacity-80">{step.detail}</p>

			<!-- Disabled rather than absent when it cannot be afforded, and the reason is the same one
			     that makes the shop a place before it is a screen: a child has to be able to see what
			     they are saving FOR. A button that appears out of nowhere at 40 Eis is a surprise; one
			     that has been sitting there saying "noch 12 Eis" is a goal. Disabled and not merely
			     grey — trap 4 is a control that looks pressable and does nothing. -->
			<button
				class="action cta h-16 w-full text-xl"
				onclick={build}
				disabled={!affordable}
				data-testid="igloo-build"
			>
				{affordable ? `Bauen — ${price} Eis` : `Noch ${short} Eis`}
			</button>
		{:else}
			<p class="text-lg font-extrabold" data-testid="igloo-finished">
				Fertig ausgebaut! Dein Iglu hat alles.
			</p>
			<p class="mb-3 text-base opacity-80">Bald gibt es Deko für drinnen.</p>
		{/if}

		<!-- The way in, and it is always here — an igloo you cannot go into is a prop. Below the
		     purchase rather than beside it, so the tap that spends Eis and the tap that does not are
		     never next to each other under the same thumb. -->
		<button class="action mt-3 h-14 w-full text-lg" onclick={onInside} data-testid="igloo-inside">
			Reingehen
		</button>
	</div>
</div>
