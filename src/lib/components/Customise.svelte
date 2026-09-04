<script lang="ts">
	/**
	 * "Mein Pinguin" — colours, a hat, and a name you can re-roll.
	 *
	 * Optional by construction: it is never in front of the game, only ever one tap to the side of
	 * it, and closing it needs no decision. `docs/DESIGN.md` §6 asks for a child to be playing within
	 * two seconds of opening the app, so anything that must be answered before the first round is a
	 * design failure however nice it looks.
	 *
	 * There is no text field, and there will not be one — `docs/DECISIONS/0004`. The die is the whole
	 * naming interface, and it is meant to be the toy: children re-roll a name generator far longer
	 * than they would spend typing.
	 */
	import {
		BEAK_COLOURS,
		BODY_COLOURS,
		HAT_COLOURS,
		HATS,
		type HatId,
		type PenguinLook,
		resolveLook
	} from '$lib/look';
	import { createPreview, type Preview } from '$lib/render/preview';
	import type { SceneHandles } from '$lib/render/scene';

	interface Props {
		look: PenguinLook;
		name: string;
		/**
		 * The game's renderer, which draws the live penguin too.
		 *
		 * Passed in rather than created here, because a page gets ONE WebGL context — see
		 * `render/preview.ts`. Null only where the game has no renderer at all, and then the picker
		 * simply has no portrait in it.
		 */
		host: SceneHandles | null;
		/** Hand the round's draw loop something to paint each frame, or null on the way out. */
		onPreview: (preview: Preview | null) => void;
		onChange: (look: PenguinLook) => void;
		onReroll: () => void;
		onClose: () => void;
	}

	let { look, name, host, onPreview, onChange, onReroll, onClose }: Props = $props();

	/** German labels for the hats, so the buttons say something rather than showing an id. */
	const HAT_LABELS: Record<HatId, string> = {
		none: 'Ohne',
		bobble: 'Bommel',
		crown: 'Krone',
		cap: 'Kappe',
		party: 'Spitz'
	};

	const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

	/**
	 * The live penguin.
	 *
	 * Every control below used to be a bet: a child picked a colour from a square, a hat from a word,
	 * and found out what they had made only after "Fertig" restarted the round. The one screen in the
	 * game whose entire subject is what something looks like was the one screen that did not show it.
	 *
	 * It draws the REAL actor (`render/preview.ts`), so nothing here can disagree with the ice — with
	 * the GAME's renderer, because a page gets one WebGL context and the game owns it.
	 */
	let canvas = $state<HTMLCanvasElement | null>(null);
	let preview = $state<Preview | null>(null);
	/** A device with no renderer at all still gets the whole picker, minus the portrait. */
	let previewFailed = $state(false);

	$effect(() => {
		// Assigned on every run rather than only on the failing one: a latch that is never cleared
		// leaves the canvas hidden for the rest of the sheet's life once it has been true once.
		previewFailed = !canvas || !host;
		if (!canvas || !host) return;
		const made = createPreview(
			host,
			canvas,
			!window.matchMedia('(prefers-reduced-motion: reduce)').matches
		);
		preview = made;
		// The GAME's loop paints it, once per frame, just before it draws itself. That is what keeps
		// the clock in `render/loop.ts` and the context count at one.
		onPreview(made);

		return () => {
			onPreview(null);
			preview = null;
			made.dispose();
		};
	});

	// Every tap rebuilds the bird. Cheap — a penguin is a dozen primitives over shared geometry — and
	// it is the same construction path the round uses, so a look that is wrong here is wrong there.
	$effect(() => {
		preview?.setLook(resolveLook(look));
	});
</script>

<!-- Deliberately NOT `.overlay`: this one is a modal and blocking taps behind it is the point. -->
<div class="absolute inset-0 z-30 grid place-items-center p-4" data-testid="customise">
	<!-- TWO COLUMNS on anything as wide as a landscape phone, and that is the preview's doing: the
	     single stacked column fitted this sheet onto a 390 px-tall screen only as long as nothing
	     stood above the swatches, and a penguin standing above them pushed the hats off the bottom
	     (found by looking at it, not by reading it). The bird and its name now sit in a column of
	     their own beside a picker that scrolls on its own. -->
	<div class="panel max-h-full w-full max-w-md overflow-hidden p-4 sm:max-w-2xl">
		<div class="mb-3 flex items-center justify-between gap-3">
			<p class="text-xl font-extrabold">Mein Pinguin</p>
			<button class="action h-11 w-24 text-base" onclick={onClose} data-testid="customise-done">
				Fertig
			</button>
		</div>

		<div class="customise-body flex max-h-[70vh] flex-col gap-4">
			<div class="customise-aside flex shrink-0 flex-col gap-2">
				<!-- The label sits on the BOX, not on the canvas: a canvas is embedded content and cannot
				     carry role="img", and a screen reader given the canvas itself has nothing to read.
				     The box keeps its place when there is no renderer to borrow — the picker beside it
				     still works, and a hole in the layout would be the only symptom of it. -->
				<div
					class="penguin-preview"
					role="img"
					aria-label="Vorschau deines Pinguins — jede Auswahl ändert ihn sofort"
				>
					<canvas
						bind:this={canvas}
						class="block h-full w-full"
						class:invisible={previewFailed}
						data-testid="preview"
					></canvas>
				</div>

				<!-- The name, and the die. One control, and the die is deliberately the larger of the two. -->
				<div class="flex items-center gap-3">
					<p class="grow text-base font-bold" data-testid="chosen-name">{name}</p>
					<button
						class="action action-glyph h-12 w-12 text-xl"
						onclick={onReroll}
						aria-label="Anderen Namen würfeln"
						data-testid="reroll"
					>
						🎲
					</button>
				</div>
			</div>

			<!-- The picker scrolls, never the whole sheet: "Fertig" and the penguin have to stay where
			     they were put, and a sheet that scrolled as one moved the way out of it off the screen. -->
			<div class="grow overflow-y-auto pr-1 pb-1">
				<!-- Every swatch is a 44 px target, and the chosen one carries a ring AND a check, because
				     no information in this game is ever carried by colour alone — least of all here. -->
				<p class="mb-1 text-sm opacity-80">Farbe</p>
				<div class="mb-4 flex flex-wrap gap-2">
					{#each BODY_COLOURS as colour, i (colour)}
						<button
							class="swatch"
							class:swatch-on={look.body === i}
							style="background: {hex(colour)}"
							onclick={() => onChange({ ...look, body: i })}
							aria-label="Körperfarbe {i + 1}"
							aria-pressed={look.body === i}
						>
							{look.body === i ? '✓' : ''}
						</button>
					{/each}
				</div>

				<p class="mb-1 text-sm opacity-80">Schnabel</p>
				<div class="mb-4 flex flex-wrap gap-2">
					{#each BEAK_COLOURS as colour, i (colour)}
						<button
							class="swatch"
							class:swatch-on={look.beak === i}
							style="background: {hex(colour)}"
							onclick={() => onChange({ ...look, beak: i })}
							aria-label="Schnabelfarbe {i + 1}"
							aria-pressed={look.beak === i}
						>
							{look.beak === i ? '✓' : ''}
						</button>
					{/each}
				</div>

				<p class="mb-1 text-sm opacity-80">Mütze</p>
				<div class="mb-3 flex flex-wrap gap-2">
					{#each HATS as hat (hat)}
						<button
							class="chip"
							class:chip-on={look.hat === hat}
							onclick={() => onChange({ ...look, hat })}
							aria-pressed={look.hat === hat}
						>
							{HAT_LABELS[hat]}
						</button>
					{/each}
				</div>

				{#if look.hat !== 'none'}
					<div class="flex flex-wrap gap-2">
						{#each HAT_COLOURS as colour, i (colour)}
							<button
								class="swatch"
								class:swatch-on={look.hatColour === i}
								style="background: {hex(colour)}"
								onclick={() => onChange({ ...look, hatColour: i })}
								aria-label="Mützenfarbe {i + 1}"
								aria-pressed={look.hatColour === i}
							>
								{look.hatColour === i ? '✓' : ''}
							</button>
						{/each}
					</div>
				{/if}
			</div>
		</div>
	</div>
</div>
