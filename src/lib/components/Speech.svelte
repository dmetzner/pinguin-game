<script lang="ts">
	/**
	 * What the penguin in front of you is saying.
	 *
	 * A sign, not a control: `pointer-events-none` all the way down, because the joystick's zone is the
	 * whole left half of the screen and this hangs over part of it. That is trap 4/12 in this repo,
	 * paid for four times, and the rule that came out of it is that anything drawn over the play area
	 * either takes its own tap deliberately or takes none at all. This takes none — there is nothing to
	 * press, you walk away instead.
	 *
	 * **Screen-centre (Daniel, 2026-08-22), riding over whatever door sign is there.** It used to sit
	 * bottom-centre, in the one slot the hub never otherwise uses (`Game.svelte` puts the readout
	 * top-left, the buttons top-right and the door sign bottom-right, and the control hints occupy
	 * bottom-centre only `{#if phase !== 'playing'}`, which the island's `opening: 'playing'` /
	 * `ends: neverEnds` never is). A talking penguin is met standing right in front of a door on the
	 * island, though, and a line planted at the bottom of the screen was easy to miss under the thumbs
	 * while the eye was still on the two people who were just talking. Middle of the screen is where
	 * that conversation is actually happening, so the bubble goes there and overlaps the door sign
	 * instead of dodging it — `pointer-events-none` all the way down, same as before, so it never
	 * costs a tap either way.
	 *
	 * The one thing here that is NOT decoration: `aria-live`. A speech bubble that appears because you
	 * walked somewhere is the only content in this game that arrives without being asked for.
	 */
	import type { Speech } from '$lib/npc/talk';

	interface Props {
		/** From `npc/talk.ts`'s `poll`. Null whenever nobody is close enough, which is most of the time. */
		speech: Speech | null;
	}

	let { speech }: Props = $props();
</script>

<div
	class="pointer-events-none absolute inset-0 grid place-items-center"
	aria-live="polite"
	data-testid="speech"
>
	{#if speech}
		<!-- Keyed on the TEXT so each new line pops in on its own. Without the key Svelte updates the
		     paragraph in place and a penguin who has moved on to their next sentence does it silently,
		     which reads as a bubble that never changes until you look away and back. -->
		{#key speech.text}
			<div class="panel bubble max-w-80 px-4 py-2.5">
				<!-- The name, in the accent ink rather than at full contrast: the words are what a child
				     is here to read, and the label above them is how they find out who said it. It is
				     the SAME string as the tag over the head (`Speech.speaker`), so the bubble and the
				     penguin cannot disagree about who is talking. -->
				<p class="text-accent text-xs leading-none font-extrabold">{speech.speaker}</p>
				<p class="mt-1 text-sm leading-snug font-bold">{speech.text}</p>
				{#if speech.mission}
					<!-- What the errand is worth, beside the words that ask for it. A reward mentioned in
					     prose is a number a child has to hold in their head across a whole minigame; a
					     number on the bubble is one they can walk away and come back to. -->
					<p class="mt-1.5 text-xs font-extrabold opacity-70">
						Belohnung: {speech.mission.reward}
						<span aria-hidden="true">❄</span> Eis
					</p>
				{/if}
			</div>
		{/key}
	{/if}
</div>

<style>
	/* `--accent-ink` rather than `--accent`: the warm the renderer uses is 1.9:1 on a cream plaque,
	   which is a colour you can see and not a word you can read. `app.css` records the measurement. */
	.text-accent {
		color: var(--accent-ink);
	}

	/* A small pop on arrival, which is the only motion here and exists to say "this is new" — three
	   lines in a row from the same penguin otherwise look like one line that changed by itself. The
	   global `prefers-reduced-motion` rule in `app.css` cuts the duration to nothing, so this needs no
	   query of its own. */
	.bubble {
		animation: bubble-in 140ms ease-out;
	}

	@keyframes bubble-in {
		from {
			opacity: 0;
			transform: translateY(6px) scale(0.97);
		}
		to {
			opacity: 1;
			transform: none;
		}
	}
</style>
