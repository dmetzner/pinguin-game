/**
 * The name floating over a penguin's head.
 *
 * A canvas texture on a sprite. Sprites rather than HTML overlays: an overlay would need a
 * world-to-screen projection every frame for every player and would fight the canvas for compositing
 * on mobile Safari.
 *
 * **This is the fourth version in one day and the first three all failed the same way**, so the
 * reasoning is worth keeping rather than the numbers:
 *
 *  1. 0.62 m tall, one line, `depthTest: false`. Legible, and 3.1 m WIDE — wider than the bird —
 *     because a two-word German name on one line is. Four penguins together made one smear.
 *  2. 0.30 m tall and wrapped. Stopped competing with the characters by becoming a coloured smudge:
 *     a nine-device-pixel cap height, reported as "3-4 pixel smears".
 *  3. 0.52 m and faded out by projected size. Better, and still the wrong SHAPE of answer: a smooth
 *     fade means there is always a band of distance where the tag is drawn and cannot be read.
 *
 * The fourth is a BUDGET, which is what the art direction asked for: a tag is either legible or it is
 * not drawn, and only the nearest few are drawn at all. Four decisions carry it:
 *
 *  * **A measured floor.** Every tag works out its own cap height in CSS pixels each frame and is
 *    switched off below `TAG_MIN_CAP_PX`. Not faded — off. A tag too small to read is worse than no
 *    tag: it costs a draw call, it covers the character it labels, and it says nothing.
 *  * **A count.** At most `TAG_BUDGET` tags in the frame, the nearest ones, chosen among all of them
 *    (see `chooseTheNearest`). This is the part a per-tag threshold cannot do — six penguins on one
 *    chase platform are all at the same distance, so a distance rule keeps all six or none.
 *  * **The local player gets NO text tag.** It carries an arrow over its head and a ring on the ice
 *    (`penguin.ts`), which are shapes rather than words and survive both a pile-up and a child who
 *    cannot read at speed. Its name is the one on screen that never needed spelling out, and
 *    dropping it frees the budget slot that was always taken by the penguin closest to the camera.
 *  * **Two type sizes.** The name is the part a child reads; the adjective in front of it exists so
 *    that two penguins are never the same word (`names.ts` only guarantees the PAIR is unique). At
 *    `ADJECTIVE_SCALE` the long word no longer sets the pill's width, which is what let the name
 *    itself go back up to a legible size.
 *
 * The accessibility requirement is unchanged and is met: no information is carried by colour alone,
 * because every penguin near you is named in words and the one you steer is marked by shape.
 *
 * It is also the one thing in `render/` that depends on a FONT having arrived, which is a
 * correctness problem rather than a styling one — see `FONT_PROBE` and the rebake at the bottom.
 */
import {
	CanvasTexture,
	LinearFilter,
	type PerspectiveCamera,
	Sprite,
	SpriteMaterial,
	Vector2,
	Vector3,
	type WebGLRenderer
} from 'three';

/** Device pixels per CSS pixel in the label texture. 2 is enough at the distances involved. */
const SCALE = 2;
const FONT_PX = 28;
const PAD = 8;
/** Line spacing, as a multiple of the font size. Tight, because the pill has two lines in it. */
const LINE_HEIGHT = 1.05;
/**
 * How much smaller the adjective is than the name.
 *
 * "Watschel Fiete" is fourteen characters and the first eight of them are the part nobody reads
 * twice. At 0.62 the adjective stops setting the pill's width — which is now the wider of a small
 * "Watschel" and a full-size "Fiete", about a quarter narrower than both at one size — and that is
 * what paid for the name being legible. It is still there, still readable if you look, and still the
 * thing that separates two penguins whose given name collides.
 */
const ADJECTIVE_SCALE = 0.62;
/**
 * How long a name has to be before it splits at its space.
 *
 * `names.ts` generates two German words and most of them are long. Short single-word names stay on
 * one line, because a wrapped "Ida" is a tall thin box that reads as a mistake.
 */
const WRAP_ABOVE_CHARS = 8;

/**
 * The face, and the one place in this renderer where a font is a correctness problem.
 *
 * `--font-display` in `app.css` is a self-hosted Baloo 2, and 800 rather than the interface's 700
 * because a tag is small and outlined: the stroke eats a weight, so the text under it has to bring
 * one more. Every glyph a name can contain (ä ö ü ß) is inside the declared subset — the symbols
 * that are NOT (▼ ✓ ⤢ ⤡ and the emoji) are handed to the fallback by `unicode-range`, so nothing
 * drawn into THIS canvas may ever be one of them or it will silently arrive in a different family.
 *
 * `FONT_PROBE` is one family at one size, which is what `document.fonts.load` wants; the file is a
 * variable font, so loading it at any size loads it for both sizes drawn here.
 */
const FONT_WEIGHT = 800;
const FONT_FAMILY = "'Baloo 2', 'Trebuchet MS', system-ui, sans-serif";
const FONT_PROBE = `${FONT_WEIGHT} ${FONT_PX}px 'Baloo 2'`;

/**
 * The one number that sets how big a tag is: WORLD metres per texture pixel.
 *
 * Sizing used to be "how tall is the pill", with a second constant for the two-line case — and that
 * is exactly how version 2 ended up with a wrapped name at half the cap height of an unwrapped one.
 * Expressed this way there is nothing to keep in step: every variant, one line or two, gets the same
 * letters at the same size, and the pill is however tall its own content makes it.
 *
 * 0.0153 puts the name's cap height at 0.30 m — about 11 CSS pixels on the penguin nearest the
 * camera in the classic round, which is a phone's smallest comfortable text. That is the whole
 * derivation: `CAP_METRES` is what "readable" means in metres, and this constant and the threshold
 * below are two views of the same decision.
 */
const METRES_PER_TEX_PX = 0.0153;
/** A heavy face's cap height is about 0.7 em. Derived, so a font-size change carries the rest. */
const CAP_METRES = 0.7 * FONT_PX * METRES_PER_TEX_PX;

/**
 * The floor, and the budget.
 *
 * `TAG_MIN_CAP_PX` is where a name stops being readable at all — eight CSS pixels of cap height, in
 * a heavy 800-weight face with an outline. With the sizing above that lands at about sixteen metres
 * from the camera: the penguins on your own floe keep their names, the next island in a Royal loses
 * them completely, and a chase route's far platform never had a chance. Measured against the camera
 * this game actually uses — 58° vertical (`scene.ts`), a near penguin about eleven metres out.
 *
 * `TAG_BUDGET` is the second half, and the one that fixes a scrum: three, chosen among every tag on
 * the page rather than per tag, because six penguins on one platform are all the same distance away
 * and a distance rule would keep all six. Three names plus the two "you" markers is what a child can
 * take in at a glance; six is a wall of text and thirty is what the last three versions looked like.
 *
 * `TAG_KEEP` is hysteresis: a tag already drawn holds its slot until it falls a tenth below the bar,
 * so two penguins at the same distance do not flicker their labels at each other.
 */
const TAG_MIN_CAP_PX = 8;
const TAG_BUDGET = 3;
const TAG_KEEP = 0.9;

/**
 * How much of the frame's WIDTH one label may take, and why a world size was never going to be enough.
 *
 * A tag is sized in metres, so how big it looks depends entirely on the projection — and portrait is a
 * fifth geometry nobody had measured. The vertical field of view is fixed at 58°, so a 390 × 844 frame
 * has more than twice the pixels-per-metre of a 844 × 390 one AND less than half the width to spend
 * them on: the same tag over the same penguin is four times the fraction of the frame. Photographed on
 * the island, "Schlingel Pieps" ran off the left edge (2026-08-22).
 *
 * So the size is capped as a fraction of the frame and the label is SQUEEZED to fit — and because the
 * squeeze scales the cap height too, a frame narrow enough to make a name illegible hides it instead,
 * through the floor above. One rule, two outcomes, no separate portrait branch.
 */
const TAG_MAX_FRAME = 0.42;
/**
 * How close to the frame edge a label may come, in CSS pixels, before it slides inward.
 *
 * Squeezing stops a tag being wider than the frame; it does not stop one being at the edge OF it. A
 * penguin two metres from the left of the screen has a label whose left half is simply not there, and
 * a name with its first three letters missing is not a name. So the sprite's own CENTRE is offset —
 * screen space, no world position touched, so the tag stays over its penguin as far as the depth test
 * and the budget are concerned and merely stops hanging off the edge.
 */
const TAG_EDGE_PX = 6;

/**
 * What every tag on the page reported last frame, so the nearest few can be picked from among them.
 *
 * A module-level ledger is the awkward part of this file and it is load-bearing: a budget is a
 * decision about ALL the tags, and nothing in this renderer holds all the tags. `scene.ts` holds the
 * camera and belongs to another owner; an actor knows only itself. What every tag does share is the
 * renderer, one frame, and this module.
 */
interface Seen {
	/** Cap height in CSS pixels, as measured during the frame numbered `frame`. */
	cap: number;
	frame: number;
	shown: boolean;
}
const live = new Set<Seen>();
/** Scratch, shared: both are read and used inside one statement, on one thread, per tag per frame. */
const viewport = new Vector2();
const projected = new Vector3();
let ranked = -1;
/** The cap height a tag has to beat to be inside the budget. Recomputed once per frame. */
let bar = 0;

/**
 * Set the bar, once per frame, from what the tags reported LAST frame.
 *
 * A frame of lag rather than a pre-pass, because there is nowhere to put a pre-pass: this runs from
 * `onBeforeRender`, which is per-object and mid-draw. At sixteen milliseconds behind, a penguin
 * cannot have changed rank in a way anybody sees.
 *
 * Entries older than a frame or two are ignored rather than trusted: a tag whose sprite is hidden or
 * outside the frustum stops reporting entirely, and a stale reading of a penguin that has walked
 * off-screen would hold a slot against one standing in front of you.
 */
function chooseTheNearest(renderer: WebGLRenderer): void {
	const frame = renderer.info.render.frame;
	if (frame === ranked) return;
	ranked = frame;
	const caps: number[] = [];
	for (const seen of live) if (seen.cap > 0 && seen.frame >= frame - 2) caps.push(seen.cap);
	caps.sort((a, b) => b - a);
	// The first entry that does NOT fit the budget is the bar. With fewer tags than the budget there
	// is no bar at all, and only the readability floor applies.
	bar = caps.length > TAG_BUDGET ? (caps[TAG_BUDGET] ?? 0) : 0;
}

export interface NameTag {
	sprite: Sprite;
	dispose(): void;
}

export function createNameTag(name: string, accent: number): NameTag {
	const canvas = document.createElement('canvas');
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new Error('2D canvas context unavailable — cannot draw a name tag');

	const texture = new CanvasTexture(canvas);
	// Mipmaps on a label this small produce a grey mush at distance; linear filtering on both ends
	// keeps it crisp and costs nothing at these texture sizes.
	texture.minFilter = LinearFilter;
	texture.magFilter = LinearFilter;
	texture.generateMipmaps = false;

	const material = new SpriteMaterial({
		map: texture,
		transparent: true,
		// `depthTest: false` was defended for a long time — a name hidden behind another penguin has
		// failed at its one job — and it is what turned four penguins standing together into one smear
		// of overlapping pills, because every tag won against every other tag AND against the birds.
		// Depth-tested, the nearest label is whole and the ones behind it are partly hidden, which is
		// what "further away" looks like everywhere else in the frame.
		//
		// `depthWrite` needs the `alphaTest`: a transparent sprite that writes depth over its own fully
		// transparent corners punches a rectangular hole in whatever is behind it. The test discards
		// those fragments before they reach the depth buffer. It can be low now that the cull switches
		// tags off rather than fading them — the threshold only has to beat the texture's empty corners.
		depthTest: true,
		depthWrite: true,
		alphaTest: 0.1
	});
	const sprite = new Sprite(material);
	// Drawn after the other transparent things hanging off a penguin — the blob shadow and the "you"
	// ring — so a tag is never dimmed by a shadow it happens to sit in front of.
	sprite.renderOrder = 10;

	const seen: Seen = { cap: 0, frame: -1, shown: false };
	live.add(seen);
	/** The pill's unsqueezed size in world metres, set by `redraw` and read by the frame check. */
	let tall = 0;
	let wide = 0;

	/**
	 * Measure, size the canvas, draw, and size the sprite. Run twice — see the rebake below.
	 *
	 * Assigning `canvas.width` resets the entire 2D context: the font, the alignment and the
	 * transform. That is why they are all set after it rather than before, and it is also what makes
	 * this safely repeatable — the `scale(SCALE, SCALE)` applies to a fresh identity every time
	 * instead of compounding.
	 */
	const redraw = () => {
		const lines = layout(name);
		let text = 0;
		let block = 0;
		for (const line of lines) {
			ctx.font = fontFor(line.scale);
			text = Math.max(text, ctx.measureText(line.text).width);
			block += FONT_PX * line.scale * LINE_HEIGHT;
		}
		const width = Math.ceil(text) + PAD * 2;
		const height = Math.ceil(block) + PAD * 2;

		canvas.width = width * SCALE;
		canvas.height = height * SCALE;
		ctx.scale(SCALE, SCALE);
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';

		// The turntable in "Mein Pinguin" builds an actor with no name (`preview.ts`), and an empty
		// pill over the penguin the player came to look at is exactly what that call was asking not to
		// have. Nothing drawn means every fragment fails the `alphaTest` above.
		if (name !== '') paint(ctx, lines, width, height, accent);

		// The canvas IS the texture's image, so a resize plus a repaint needs exactly this to reach the
		// GPU. Without it the old, fallback-metric texture stays uploaded forever.
		texture.needsUpdate = true;
		// In world units, and its parent is NOT scaled by `PENGUIN_SCALE` (`penguin.ts`). Recomputed
		// here rather than once outside, because the metrics AND the line count can both change when
		// the real face lands.
		tall = height * METRES_PER_TEX_PX;
		wide = (width / height) * tall;
		sprite.scale.set(wide, tall, 1);
	};

	redraw();

	/**
	 * How big this label actually IS on the screen, asked every frame, and switched off when the
	 * answer is "too small to read" or "not one of the nearest few".
	 *
	 * `onBeforeRender` is the only place in this renderer that can ask: the actor that owns the sprite
	 * is handed a world position and a clock and no camera, and `scene.ts` — which does hold the
	 * camera — belongs to somebody else. It runs immediately before this sprite's own draw call, so
	 * what it writes to the material lands in the same frame, and it is only called for a sprite that
	 * is visible and inside the frustum, which is exactly the set worth measuring.
	 *
	 * The opacity is the lever rather than `visible`, and that is not a preference: a hidden object is
	 * never submitted, so `onBeforeRender` would never run again and the tag could never come back.
	 * Zero opacity with the `alphaTest` above discards every fragment, so it costs no pixels.
	 */
	sprite.onBeforeRender = (renderer, _scene, camera) => {
		chooseTheNearest(renderer);
		const perspective = camera as PerspectiveCamera;
		if (!perspective.isPerspectiveCamera) return;
		// World positions off the matrices, because `camera.position` is local to whatever the camera
		// is parented to and this has to be right in every mode.
		const eye = camera.matrixWorld.elements;
		const at = sprite.matrixWorld.elements;
		const away = Math.hypot(at[12] - eye[12], at[13] - eye[13], at[14] - eye[14]);
		renderer.getSize(viewport);
		// CSS pixels per world metre at that distance, from the projection's own half-angle: `fov` is
		// vertical and in degrees, hence 360 rather than 180.
		const perMetre = viewport.y / (2 * Math.tan((perspective.fov * Math.PI) / 360) * away);
		if (!(perMetre > 0)) return;

		// Squeezed to fit the FRAME, not just measured against the eye.
		//
		// Measured from `wide` — the size the label was BAKED at — and never from `sprite.scale`, which
		// is the size it was squeezed to last frame. Reading back its own output would compound the
		// squeeze every frame and shrink every label to nothing in about a second.
		const widePx = wide * perMetre;
		const squeeze = Math.min(1, (TAG_MAX_FRAME * viewport.x) / Math.max(widePx, 0.001));
		sprite.scale.set(wide * squeeze, tall * squeeze, 1);
		// A sprite takes its size from `matrixWorld`, and the scene's matrices were updated before this
		// callback ran — so without this the new scale arrives one frame late. `center` below does not
		// need it: that one is a uniform, refreshed after `onBeforeRender` on its own.
		sprite.updateMatrixWorld(true);

		// The cap height AFTER the squeeze, which is the whole point of doing them in this order: a
		// frame too narrow to fit a readable label does not get a small one, it gets none.
		const cap = CAP_METRES * squeeze * perMetre;
		seen.cap = cap;
		seen.frame = renderer.info.render.frame;
		// Readable at all, AND inside the budget — with a tenth of hysteresis on a slot it already
		// holds, so two penguins side by side do not swap labels every other frame.
		const readable = cap >= TAG_MIN_CAP_PX;
		const chosen = cap > bar || (seen.shown && cap > bar * TAG_KEEP);
		seen.shown = readable && chosen;
		material.opacity = seen.shown ? 1 : 0;

		// And slid inward if it would hang off an edge. `center` is the sprite's own anchor inside its
		// quad, so moving it costs nothing and moves nothing else: a label at the left of the screen
		// shifts right on screen while staying exactly where it is in the world.
		if (seen.shown) {
			projected.set(at[12], at[13], at[14]).applyMatrix4(camera.matrixWorldInverse);
			projected.applyMatrix4(perspective.projectionMatrix);
			const midX = (projected.x * 0.5 + 0.5) * viewport.x;
			const halfPx = (widePx * squeeze) / 2;
			let push = 0;
			if (midX - halfPx < TAG_EDGE_PX) push = TAG_EDGE_PX - (midX - halfPx);
			else if (midX + halfPx > viewport.x - TAG_EDGE_PX)
				push = viewport.x - TAG_EDGE_PX - (midX + halfPx);
			// Capped at half a label: past that it is nearer some other penguin than its own, and a
			// name on the wrong bird is the one failure worse than a name half off the screen.
			const shift = Math.max(-0.5, Math.min(0.5, -push / Math.max(widePx * squeeze, 0.001)));
			sprite.center.set(0.5 + shift, 0.5);
		} else {
			sprite.center.set(0.5, 0.5);
		}
	};

	/**
	 * And again, once the face is really here.
	 *
	 * This is the trap the font pass came with, and it is trap 5's shape: `ctx.measureText` falls back
	 * SILENTLY, so a tag baked before Baloo 2 has landed gets the fallback's metrics and the
	 * fallback's glyphs burned into a texture that nothing ever measures again. It looks correct in
	 * the source forever and wrong on every screen.
	 *
	 * `document.fonts.load` rather than `document.fonts.ready` alone, and that distinction is the
	 * whole reason this is three lines and not one: `ready` settles when the loads the DOCUMENT has
	 * started are done, and drawing into a canvas starts none — so on any screen where no HTML
	 * element happens to be using the face yet, `ready` resolves with the file never fetched and the
	 * rebake bakes the fallback a second time. `load` asks for it explicitly.
	 *
	 * It stays synchronous for the caller: an actor is built inside a mount, and a tag that needed
	 * awaiting would make every call site above it async for a texture that is correct 40 ms later.
	 * `disposed` is what keeps a rematch from repainting a texture that has already been freed.
	 */
	let disposed = false;
	document.fonts
		?.load(FONT_PROBE)
		.then(() => {
			if (!disposed) redraw();
		})
		// A face that cannot be fetched leaves the fallback on screen, which is what this whole
		// promise is an improvement ON. It is not a reason to take down a round.
		.catch(() => {});

	return {
		sprite,
		dispose() {
			disposed = true;
			live.delete(seen);
			texture.dispose();
			material.dispose();
		}
	};
}

interface Line {
	text: string;
	/** A multiple of FONT_PX. The name is 1; an adjective in front of it is smaller. */
	scale: number;
}

const fontFor = (scale: number) => `${FONT_WEIGHT} ${Math.round(FONT_PX * scale)}px ${FONT_FAMILY}`;

/**
 * One line, or a small adjective over a full-size name, split at the LAST space.
 *
 * The last space rather than the first, because `names.ts` puts the adjective first and the given
 * name last ("Watschel Fiete"), and the given name is the one a child looks for.
 */
function layout(name: string): Line[] {
	if (name.length <= WRAP_ABOVE_CHARS) return [{ text: name, scale: 1 }];
	const at = name.lastIndexOf(' ');
	if (at <= 0 || at >= name.length - 1) return [{ text: name, scale: 1 }];
	return [
		{ text: name.slice(0, at), scale: ADJECTIVE_SCALE },
		{ text: name.slice(at + 1), scale: 1 }
	];
}

/** The pill and the name in it. Split out so the no-name case is one `if` rather than a branch. */
function paint(
	ctx: CanvasRenderingContext2D,
	lines: Line[],
	width: number,
	height: number,
	accent: number
): void {
	roundRect(ctx, 1.5, 1.5, width - 3, height - 3, height * 0.3);
	ctx.fillStyle = `#${accent.toString(16).padStart(6, '0')}`;
	// Softer than the 0.92 it was: the pill is the loudest thing in the frame at full opacity, and
	// the penguin under it is wearing the same colour.
	ctx.globalAlpha = 0.72;
	ctx.fill();
	ctx.globalAlpha = 1;
	// A pale rim rather than a dark one. It separates the pill from bright ice without adding a
	// second heavy dark shape to a frame that already has the text's outline in it.
	ctx.lineWidth = 1.5;
	ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
	ctx.stroke();

	let y = PAD;
	for (const line of lines) {
		const box = FONT_PX * line.scale * LINE_HEIGHT;
		ctx.font = fontFor(line.scale);
		// Scaled with the type: a 3.5 px stroke that is right under a 28 px name closes up a 17 px
		// adjective from the inside.
		ctx.lineWidth = 3.5 * line.scale;
		ctx.strokeStyle = 'rgba(12, 20, 34, 0.55)';
		ctx.strokeText(line.text, width / 2, y + box / 2);
		ctx.fillStyle = '#ffffff';
		ctx.fillText(line.text, width / 2, y + box / 2);
		y += box;
	}
}

function roundRect(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	w: number,
	h: number,
	r: number
): void {
	ctx.beginPath();
	ctx.moveTo(x + r, y);
	ctx.arcTo(x + w, y, x + w, y + h, r);
	ctx.arcTo(x + w, y + h, x, y + h, r);
	ctx.arcTo(x, y + h, x, y, r);
	ctx.arcTo(x, y, x + w, y, r);
	ctx.closePath();
}
