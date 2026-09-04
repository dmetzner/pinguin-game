<script lang="ts">
	/**
	 * The left thumb.
	 *
	 * A FLOATING stick: it appears wherever the thumb lands inside its zone rather than sitting at a
	 * fixed spot. Fixed sticks require the player to look down and find them, and on a phone held
	 * two-handed by an eight-year-old the comfortable thumb position is different for every hand and
	 * every grip. Appearing under the thumb removes the problem instead of documenting it.
	 *
	 * Pointer events, not touch events, so the same code answers a mouse during development and a
	 * finger in a match. The pointer is CAPTURED on down, which is what lets a thumb slide outside
	 * the zone — or off the screen edge — without the stick going dead mid-manoeuvre.
	 */
	import { knobOffset, STICK_RADIUS, stickVector } from '$lib/input/joystick';
	import type { Vec2 } from '$lib/sim/types';

	interface Props {
		/** The live movement request. Bound outward; the game loop reads it every tick. */
		move: Vec2;
		label: string;
	}

	let { move = $bindable(), label }: Props = $props();

	let pointerId = $state<number | null>(null);
	let origin = $state({ x: 0, y: 0 });
	let knob = $state({ x: 0, y: 0 });

	const active = $derived(pointerId !== null);

	function down(event: PointerEvent) {
		if (pointerId !== null) return;
		pointerId = event.pointerId;
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
		origin = { x: event.clientX, y: event.clientY };
		knob = { x: 0, y: 0 };
		move = { x: 0, z: 0 };
	}

	function moved(event: PointerEvent) {
		if (event.pointerId !== pointerId) return;
		const dx = event.clientX - origin.x;
		const dy = event.clientY - origin.y;
		knob = knobOffset(dx, dy);
		move = stickVector(dx, dy);
	}

	function up(event: PointerEvent) {
		if (event.pointerId !== pointerId) return;
		pointerId = null;
		knob = { x: 0, y: 0 };
		// Releasing means "no input", which the simulation reads as coasting rather than braking.
		move = { x: 0, z: 0 };
	}
</script>

<!--
	`pointercancel` matters as much as `pointerup` here: an incoming call, a system gesture or the
	browser deciding the gesture is a scroll all fire cancel and never up. Without it the stick
	stays stuck at whatever it last read and the penguin walks off the edge on its own.
-->
<div
	class="pointer-events-auto absolute inset-y-0 left-0 w-1/2 touch-none"
	role="application"
	aria-label={label}
	onpointerdown={down}
	onpointermove={moved}
	onpointerup={up}
	onpointercancel={up}
>
	<!--
		`fixed`, not `absolute`, and that is the difference between a drawn stick that follows the thumb
		and one that follows the thumb plus an offset.

		`origin` is `event.clientX/clientY` — VIEWPORT coordinates — and these two divs place themselves
		with it directly. Under `absolute` they are positioned against the zone above, so the inline
		numbers only mean what they say while that zone's own origin happens to BE the viewport's, which
		it is today because of `inset-y-0 left-0`. Give the zone a `top` (which portrait wants, so the
		stick's half stops covering the dash button — trap 4's sixth instance) and every stick would be
		drawn that far down the screen from the finger holding it.

		`fixed` makes the coordinate space the one the numbers were already written in, so the zone can
		be moved and resized freely from `app.css` without this file having to know. Nothing else
		changes: the pointer is captured on `pointerdown`, so a base drawn outside the zone is normal
		and correct — a floating stick has to be landed in, never reached across.
	-->
	{#if active}
		<div
			class="fixed rounded-full border-2 border-white/70 bg-white/20"
			data-testid="stick-base"
			style="width:{STICK_RADIUS * 2}px; height:{STICK_RADIUS * 2}px; left:{origin.x -
				STICK_RADIUS}px; top:{origin.y - STICK_RADIUS}px;"
		></div>
		<div
			class="fixed rounded-full border-2 border-white/90 bg-white/85 shadow-lg"
			style="width:52px; height:52px; left:{origin.x + knob.x - 26}px; top:{origin.y +
				knob.y -
				26}px;"
		></div>
	{/if}
</div>
