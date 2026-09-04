/**
 * The penguin on a turntable in "Mein Pinguin".
 *
 * The sheet used to be eight coloured squares, four more, five word chips and a die — a colour
 * picker for a bird nobody could see. Every choice in it was made blind and only paid off after
 * "Fertig" restarted the round, which is the wrong order for the one screen in this game whose whole
 * subject is what something LOOKS like.
 *
 * So it shows the real thing: the same `createActor` the round builds, lit by the same three lights
 * (`polarDayLights`), turning slowly. Not an illustration that would have to be kept in step with
 * the model by hand — a new hat appears here for free, and a hat that renders wrong is visibly wrong
 * before it ever reaches the ice.
 *
 * **ONE WebGL context per page**, which is the whole shape of this file. The first version was a
 * second `WebGLRenderer` on the sheet's own canvas: one line, and it cost the game its context. A
 * browser caps contexts process-wide and drops the OLDEST when it runs out, so what broke was never
 * the preview — it was the game behind it, frozen mid-countdown while the picker worked perfectly.
 * Five parallel test pages found it every run; a phone with a few tabs open is the same machine with
 * a smaller cap.
 *
 * So the turntable borrows the game's renderer (`SceneHandles.drawInset`) for a corner of its
 * buffer, and the corner is copied into an ordinary 2D canvas in the sheet. The copy happens BEFORE
 * the game's own frame, which clears the buffer again, so nobody ever sees the corner.
 */
import { Color, Group, PerspectiveCamera, Scene } from 'three';
import type { ResolvedLook } from '../look';
import { createWorld } from '../sim/world';
import { type Actor, createActor, PENGUIN_HEIGHT } from './penguin';
import { polarDayLights, type SceneHandles, SKY_COLOUR } from './scene';

/** How fast the turntable turns, in turns per second. Slow enough to read the hat at every angle. */
const SPIN_HZ = 0.11;

/**
 * A three-quarter view, in radians, for when the turntable is not allowed to turn.
 *
 * `prefers-reduced-motion` stops the interface's animations (`app.css`), and a spinning penguin is
 * an interface animation however charming it is. Held at an angle rather than face-on because the
 * beak and the side of the hat are both part of what is being chosen, and a penguin looking straight
 * down the lens hides the profile of every one of them.
 */
const HELD_ANGLE = 0.62;

/**
 * Where the camera stands, in metres.
 *
 * Closer and higher than the game's camera on purpose: this is a portrait, not an arena. The look-at
 * point is up at chest height so the bird sits in the middle of the frame rather than in the bottom
 * third — framed the way the game frames it, the hat would be at the very top edge, and the hat is
 * most of what this screen is about.
 */
const CAMERA = { x: 0, y: PENGUIN_HEIGHT * 0.78, z: 3.15 };
const LOOK_AT_HEIGHT = PENGUIN_HEIGHT * 0.52;

/** Device pixels per CSS pixel in the portrait. Capped at 2, exactly like the game's renderer. */
const MAX_PIXEL_RATIO = 2;

export interface Preview {
	/** Rebuild the penguin. Called on every tap in the sheet; the old actor is disposed. */
	setLook(look: ResolvedLook): void;
	/**
	 * Draw one frame into the sheet's canvas.
	 *
	 * Called by the GAME's draw loop, before it renders itself, and given the game's own clock —
	 * `render/loop.ts` stays the only file in the app that reads one.
	 */
	paint(seconds: number): void;
	dispose(): void;
}

export function createPreview(host: SceneHandles, canvas: HTMLCanvasElement, spin = true): Preview {
	const context = canvas.getContext('2d');
	if (!context) throw new Error('2D canvas context unavailable — cannot draw the penguin preview');

	const scene = new Scene();
	scene.background = new Color(SKY_COLOUR);
	for (const light of polarDayLights()) scene.add(light);

	const camera = new PerspectiveCamera(34, 1, 0.1, 40);
	camera.position.set(CAMERA.x, CAMERA.y, CAMERA.z);
	camera.lookAt(0, LOOK_AT_HEIGHT, 0);

	// The turntable. Rotating a GROUP rather than the penguin's own `facing`: the actor chases its
	// heading at TURN_RATE and leans into its velocity, so a preview that steered would waddle and
	// lean its way around every turn instead of simply presenting itself.
	const turntable = new Group();
	scene.add(turntable);

	// A real `Penguin`, borrowed from a one-bird world rather than hand-built here. `Actor.update`
	// reads phase, stun and velocity off it, and a literal typed to satisfy the compiler would be a
	// second definition of what a penguin at rest is — one that goes stale the first time the
	// simulation gains a field.
	const still = createWorld(['preview'], 1).penguins[0];
	if (!still) throw new Error('the preview world was built without a penguin');
	const at = { x: 0, z: 0, height: 0, facing: 0, penguin: still };

	let actor: Actor | null = null;

	return {
		setLook(look) {
			if (actor) {
				turntable.remove(actor.root);
				actor.dispose();
			}
			// No name tag text and no "this is you" marker: the sheet says whose penguin it is in its
			// own heading, and both would sit between the player and the hat they came here to look at.
			actor = createActor(look, '', false);
			turntable.add(actor.root);
		},

		paint(seconds) {
			// The CSS box owns the size and the canvas follows it — reading it here rather than through
			// a ResizeObserver keeps one source of truth and costs a layout read on a box that is a few
			// hundred pixels across.
			const ratio = Math.min(globalThis.devicePixelRatio ?? 1, MAX_PIXEL_RATIO);
			const width = Math.max(1, Math.round(canvas.clientWidth * ratio));
			const height = Math.max(1, Math.round(canvas.clientHeight * ratio));
			if (canvas.width !== width || canvas.height !== height) {
				canvas.width = width;
				canvas.height = height;
				camera.aspect = width / height;
				camera.updateProjectionMatrix();
			}

			turntable.rotation.y = spin ? seconds * SPIN_HZ * Math.PI * 2 : HELD_ANGLE;
			// The actor still gets the clock: the waddle and the gait read it, and a preview whose
			// penguin were frozen would be a photograph of a game that moves.
			actor?.update(at, seconds);

			const source = host.drawInset(scene, camera, width, height);
			// The inset lands in the BOTTOM-left of the drawing buffer, because that is where WebGL's
			// origin is; `drawImage` counts from the top. Getting this wrong copies a slice of ocean.
			context.drawImage(source, 0, source.height - height, width, height, 0, 0, width, height);
		},

		dispose() {
			actor?.dispose();
			// The scene itself owns nothing else worth freeing: the lights are plain objects and every
			// geometry under an actor is shared and module-owned (`penguin.ts`).
		}
	};
}
