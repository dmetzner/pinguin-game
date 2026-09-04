/**
 * The thing that appears over a penguin's head when it says something.
 *
 * `lib/emote.ts` is the data and it hands out a `glyph` per emote — 👋 💜 😄 😠 🎵 💦 — which is
 * exactly right for the BUTTON, drawn in HTML on the player's own device with the player's own emoji
 * font. It is the wrong thing to put in a WebGL texture, and the reason is not taste:
 *
 *  * an emoji in a canvas is a font dependency, and the one font this project ships deliberately
 *    excludes them (`nameTag.ts` — they are handed to the fallback by `unicode-range`);
 *  * a machine with no colour emoji font draws a tofu box, silently, and the two places this game is
 *    looked at are a phone (fine) and a headless Chromium taking screenshots (not fine) — so the
 *    review picture would be the one place it breaks;
 *  * `docs/DECISIONS/0003` says everything is procedural. Six shapes are six paths.
 *
 * So the shapes are drawn here, and the whole set is SIX TEXTURES for the page rather than per
 * penguin: they are identical for everybody, and a Royal of thirty birds would otherwise be thirty
 * canvases waiting for an emote that only the local player can send.
 *
 * **The unambiguity requirement is invariant 4's, not decoration.** This is the only channel between
 * two children in a game with no chat, so each symbol has to be distinguishable from the other five
 * at the distance a Royal is played at, on a small screen, in motion — and from the STUN, which is
 * the one other thing that appears over a head. That is why every glyph here is a distinct
 * SILHOUETTE rather than a distinct colour, why the bubble is white behind all of them (a shape on a
 * pale ground reads; a coloured shape on bright ice does not), and why nothing here orbits or spins.
 */
import { CanvasTexture, LinearFilter, Sprite, SpriteMaterial, type Texture } from 'three';
import type { EmoteId } from '../emote';

/** Texture pixels. 128 is plenty for a shape that is at most 60 CSS pixels across on a phone. */
const SIZE = 128;
/** How tall the bubble is drawn in WORLD metres — its parent is unscaled, like the name tag's. */
const BUBBLE_METRES = 0.62;
/**
 * How long the pop-in and the fade-out take, as a fraction of the emote's own duration.
 *
 * Fractions rather than seconds because `emote.ts` gives every emote its own length: a wave is 1.5 s
 * and a dance is 3, and a fixed 0.2 s pop is a third of one and a fifteenth of the other.
 */
const POP = 0.12;
const FADE = 0.2;
/** How far past full size the pop overshoots. This is the whole "it arrived" reading. */
const POP_OVERSHOOT = 0.22;

const cache = new Map<EmoteId, Texture>();

export interface Bubble {
	readonly sprite: Sprite;
	/** Point it at an emote. Cheap — the textures are shared and already built. */
	show(id: EmoteId): void;
	/** `progress` is 0..1 from `emoteProgress`, or null when there is nothing to draw. */
	update(progress: number | null): void;
	dispose(): void;
}

/**
 * One bubble, for one penguin.
 *
 * `depthTest: false`, unlike the name tag and for the opposite reason: a name is one of thirty and
 * has to lose gracefully to the penguins in front of it, while an emote is a thing a child has just
 * pressed a button to say. There is at most one per penguin and they are rare, so nothing here can
 * mush the way a floe of labels could.
 */
export function createBubble(): Bubble {
	const material = new SpriteMaterial({ transparent: true, depthTest: false, opacity: 0 });
	const sprite = new Sprite(material);
	sprite.renderOrder = 12;
	sprite.visible = false;
	sprite.scale.setScalar(BUBBLE_METRES);

	return {
		sprite,
		show(id) {
			material.map = bubbleTexture(id);
			// A material whose map changes needs its program rebuilt, and three only knows to do that
			// if it is told. Without it the second emote a penguin ever sends shows the first one's
			// glyph — which would look exactly like a state bug in the picker.
			material.needsUpdate = true;
		},
		update(progress) {
			if (progress === null) {
				sprite.visible = false;
				return;
			}
			sprite.visible = true;
			// Pops in past full size, holds, fades out. The scale is what says "arrived" and the fade is
			// what says "over" — a bubble that vanished at full size reads as a dropped frame.
			const pop = progress < POP ? progress / POP : 1;
			const eased = pop < 1 ? Math.sin((pop * Math.PI) / 2) : 1;
			const overshoot = pop < 1 ? Math.sin(pop * Math.PI) * POP_OVERSHOOT : 0;
			sprite.scale.setScalar(BUBBLE_METRES * (eased + overshoot));
			material.opacity = progress > 1 - FADE ? (1 - progress) / FADE : 1;
		},
		dispose() {
			// The TEXTURE is shared with every other penguin on the page and owned by this module.
			material.dispose();
		}
	};
}

export function bubbleTexture(id: EmoteId): Texture {
	const had = cache.get(id);
	if (had) return had;

	const canvas = document.createElement('canvas');
	canvas.width = SIZE;
	canvas.height = SIZE;
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new Error('2D canvas context unavailable — cannot draw an emote bubble');

	// The bubble: a white rounded square with a tail, and a soft dark rim so it survives being seen
	// against white ice as well as against the sea.
	const pad = 8;
	const size = SIZE - pad * 2;
	ctx.beginPath();
	const r = size * 0.3;
	ctx.moveTo(pad + r, pad);
	ctx.arcTo(pad + size, pad, pad + size, pad + size, r);
	ctx.arcTo(pad + size, pad + size, pad, pad + size, r);
	ctx.arcTo(pad, pad + size, pad, pad, r);
	ctx.arcTo(pad, pad, pad + size, pad, r);
	ctx.closePath();
	ctx.fillStyle = '#ffffff';
	ctx.fill();
	ctx.lineWidth = 4;
	ctx.strokeStyle = 'rgba(14, 32, 54, 0.35)';
	ctx.stroke();
	// The tail, which is what makes it a speech bubble rather than a badge — and therefore what says
	// the penguin under it is the one talking.
	ctx.beginPath();
	ctx.moveTo(SIZE / 2 - 12, pad + size - 2);
	ctx.lineTo(SIZE / 2, SIZE - 2);
	ctx.lineTo(SIZE / 2 + 12, pad + size - 2);
	ctx.closePath();
	ctx.fillStyle = '#ffffff';
	ctx.fill();

	draw(ctx, id);

	const texture = new CanvasTexture(canvas);
	texture.minFilter = LinearFilter;
	texture.magFilter = LinearFilter;
	texture.generateMipmaps = false;
	cache.set(id, texture);
	return texture;
}

/**
 * Six silhouettes.
 *
 * Each one is tested by the same question: at ten pixels across, is it the only one of the six with
 * that outline? Hence a heart rather than a smiling face for "lieb", a note with a flag rather than a
 * pair of notes for "tanz", and an exclamation mark for "grr" rather than an angry face — two angry
 * eyebrows and a frown are three small marks that merge into a grey smudge, and a bar with a dot
 * under it does not.
 */
function draw(ctx: CanvasRenderingContext2D, id: EmoteId): void {
	const mid = SIZE / 2;
	// A touch above centre: the tail takes the bottom, so the optical middle is higher than the
	// geometric one.
	const eye = mid - 6;
	ctx.save();
	ctx.lineJoin = 'round';
	ctx.lineCap = 'round';

	if (id === 'heart') {
		// Two lobes and a point. Filled, because a heart outline at this size is a ring.
		ctx.fillStyle = '#e2574c';
		ctx.beginPath();
		ctx.moveTo(mid, eye + 26);
		ctx.bezierCurveTo(mid - 34, eye + 2, mid - 22, eye - 26, mid, eye - 10);
		ctx.bezierCurveTo(mid + 22, eye - 26, mid + 34, eye + 2, mid, eye + 26);
		ctx.closePath();
		ctx.fill();
	} else if (id === 'wave') {
		// A mitten with a thumb, plus two motion arcs. A penguin's flipper has no fingers, and this
		// has to read as the same limb the body is waving.
		ctx.fillStyle = '#f0a43a';
		ctx.beginPath();
		ctx.ellipse(mid + 2, eye + 4, 15, 22, 0.2, 0, Math.PI * 2);
		ctx.fill();
		ctx.beginPath();
		ctx.ellipse(mid - 13, eye + 6, 7, 12, -0.5, 0, Math.PI * 2);
		ctx.fill();
		ctx.strokeStyle = '#3f6fd8';
		ctx.lineWidth = 5;
		for (const at of [24, 34]) {
			ctx.beginPath();
			ctx.arc(mid + 2, eye + 2, at, -1.1, -0.1);
			ctx.stroke();
		}
	} else if (id === 'laugh') {
		// A wide open mouth with two closed eyes over it: the only glyph here made of a big filled
		// arc, which is what separates it from the heart at distance.
		ctx.strokeStyle = '#1b2740';
		ctx.lineWidth = 6;
		for (const side of [-1, 1]) {
			ctx.beginPath();
			ctx.arc(mid + side * 16, eye - 12, 9, Math.PI * 1.15, Math.PI * 1.85);
			ctx.stroke();
		}
		ctx.fillStyle = '#1b2740';
		ctx.beginPath();
		ctx.arc(mid, eye + 4, 24, 0.15, Math.PI - 0.15);
		ctx.closePath();
		ctx.fill();
	} else if (id === 'grumpy') {
		// One heavy bar and a dot: an exclamation mark, which is the strongest small silhouette there
		// is, in the one colour nothing else here uses.
		ctx.fillStyle = '#d63a2f';
		ctx.beginPath();
		ctx.moveTo(mid - 9, eye - 30);
		ctx.lineTo(mid + 9, eye - 30);
		ctx.lineTo(mid + 6, eye + 12);
		ctx.lineTo(mid - 6, eye + 12);
		ctx.closePath();
		ctx.fill();
		ctx.beginPath();
		ctx.arc(mid, eye + 26, 8, 0, Math.PI * 2);
		ctx.fill();
	} else if (id === 'dance') {
		// A quaver: filled head, stem, flag. Nothing else in the set has a straight vertical line in
		// it, which is what makes it unmistakable small.
		ctx.fillStyle = '#25b08a';
		ctx.beginPath();
		ctx.ellipse(mid - 12, eye + 22, 15, 11, -0.3, 0, Math.PI * 2);
		ctx.fill();
		ctx.strokeStyle = '#25b08a';
		ctx.lineWidth = 7;
		ctx.beginPath();
		ctx.moveTo(mid + 2, eye + 20);
		ctx.lineTo(mid + 2, eye - 30);
		ctx.stroke();
		ctx.beginPath();
		ctx.moveTo(mid + 2, eye - 30);
		ctx.quadraticCurveTo(mid + 26, eye - 24, mid + 20, eye - 2);
		ctx.stroke();
	} else {
		// oops — two drops, which is the only glyph here made of more than one piece of the same shape.
		ctx.fillStyle = '#3f6fd8';
		for (const [dx, dy, scale] of [
			[-12, 4, 1],
			[14, -6, 0.7]
		] as const) {
			ctx.beginPath();
			ctx.moveTo(mid + dx, eye + dy - 26 * scale);
			ctx.bezierCurveTo(
				mid + dx + 18 * scale,
				eye + dy + 4 * scale,
				mid + dx + 12 * scale,
				eye + dy + 24 * scale,
				mid + dx,
				eye + dy + 24 * scale
			);
			ctx.bezierCurveTo(
				mid + dx - 12 * scale,
				eye + dy + 24 * scale,
				mid + dx - 18 * scale,
				eye + dy + 4 * scale,
				mid + dx,
				eye + dy - 26 * scale
			);
			ctx.closePath();
			ctx.fill();
		}
	}
	ctx.restore();
}
