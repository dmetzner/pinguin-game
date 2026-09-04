/**
 * The clouds.
 *
 * Pure scenery, like `bergs.ts` and the fins — nothing in the simulation knows they exist. They earn
 * their place for one reason: a STILL frame of this game read as a diagram, and the sky was the only
 * part of it with nothing in it at all. The gradient dome (`createSky` in `scene.ts`) got half of
 * that; a gradient still has no shapes, and shapes are what tell a child they are looking at weather
 * rather than at a background colour.
 *
 * Sprites from ONE canvas-drawn texture, because every pixel in this game is generated in code
 * (`docs/DECISIONS/0003`) and because draw calls are the measured budget: eight sprites is eight
 * calls against a frame that already spends 209 of them in a Royal. One puff per object would be
 * forty.
 *
 * **The band they have to live in is four degrees tall, and that is the whole design constraint
 * here.** The camera pitches 27° down with a 58° lens (`camera.ts`, a measured pair), so the top of
 * the frame points 2° ABOVE level, and the ocean plane's own far edge sits about 2° below it. Every
 * cloud therefore has to sit within a few metres of the camera's own eye height at its distance, or
 * it is off the top of the screen — which is what the first attempt did, at a height that looked
 * perfectly reasonable in the source. They read as low cumulus sitting on the horizon, which is what
 * that band can hold.
 */
import {
	CanvasTexture,
	Color,
	Group,
	LinearFilter,
	Sprite,
	SpriteMaterial,
	SRGBColorSpace
} from 'three';

/**
 * How many. Eight is one draw call each, and enough that turning the camera never finds bare sky.
 *
 * Every one past this is a transparent quad the size of a third of the screen, which on a phone is
 * fill rate rather than geometry — the one cost that does not show up in a draw-call count.
 */
const COUNT = 8;

/**
 * How far out they sit, in metres.
 *
 * Bounded below by the sea: the ocean plane reaches about 200 m and the haze finishes with it, so a
 * cloud nearer than that would hang in front of water the player can still see moving, and read as
 * floating on it. Bounded above by nothing in particular — past this the parallax as the camera pans
 * between floes stops being visible, and a cloud that does not move relative to the horizon is a
 * decal on the glass.
 */
const NEAR = 135;
const FAR = 200;

/**
 * How high the middle of a cloud sits above the water, in metres, and how much that varies.
 *
 * Measured against the camera rather than chosen: the rig sits 4.3–6.9 m above the sea depending on
 * the floe it is framing, and at 165 m a degree of screen is 2.9 m — so the four degrees of visible
 * sky is about twelve metres of altitude at this distance. Anything above twenty is off the top of
 * the frame at every camera height, and anything below five is behind the sea.
 */
const BASE_Y = 8;
const LIFT = 7;

/** How wide one gets, in metres. A 55 m cloud at 165 m fills about a fifth of the frame. */
const MIN_WIDTH = 38;
const MAX_WIDTH = 86;

/**
 * How tall, as a fraction of the width.
 *
 * Flat and wide, because that is what a cumulus looks like from sea level and because a tall cloud
 * spends its height off the top of the screen (see the header).
 */
const MIN_SQUAT = 0.2;
const MAX_SQUAT = 0.32;

/**
 * How fast the sky turns, radians a second.
 *
 * They drift around the ring rather than across it, so nothing ever has to be respawned and the sky
 * is never briefly empty. At 165 m this is about 0.7 m/s — slow enough that it never draws the eye
 * away from the ice, fast enough that a screenshot taken twenty seconds later is a different sky.
 */
const DRIFT = 0.004;

/**
 * How much of the near and far cloud is haze, 0 to 1.
 *
 * A cloud does NOT use `scene.fog`, and that is a deliberate exception rather than an oversight. The
 * scene's curve is measured against a 15 m arena and is total by 95 m (`FOG_NEAR`/`FOG_FAR` in
 * `scene.ts`), and a cloud has to stand further off than the sea's own far edge — so the scene's fog
 * would fade every one of them to exactly the band behind them and there would be no clouds. They carry their own,
 * much longer haze instead: the colour is mixed toward the sky rather than the opacity dropped, which
 * is what real haze does to a distant white thing — it takes its CONTRAST away and leaves its shape.
 */
const HAZE_NEAR = 0.18;
const HAZE_FAR = 0.45;

/** Never fully solid: a hard-edged white shape against a pale sky reads as a sticker. */
const OPACITY = 0.9;

export interface Clouds {
	root: Group;
	/**
	 * Put the deck somewhere else: around this point, at this altitude, this much further out.
	 *
	 * The default is the sea — a ring around the origin at the waterline, which is right in four modes
	 * and wrong in the one that has a two-hundred-metre mountain in it. On a chute the clouds were still
	 * drawn at sea level, so a racer three-quarters of the way up looked DOWN on them: a mountain
	 * floating above the weather, which reads as the clouds being wallpaper on the water and destroys the
	 * one thing that mode is about. Measured on `shots/phone-landscape-slide.png`: they were in the lower
	 * third of the frame, under the deck.
	 *
	 * A deck rather than a height, because two of the three numbers have to move together. The ring is
	 * 135–200 m across and a chute is 200 m long, so a deck left at the origin is behind the racer by the
	 * halfway gate; and pushing it out without growing the clouds with it makes distant specks. `spread`
	 * scales the radius AND the sprites, so the angular size is unchanged and only the parallax drops —
	 * which is what "further away" should cost.
	 */
	setDeck(centre: { x: number; z: number }, altitude: number, spread: number): void;
	/** Drift. On the seconds the loop already passes in — `render/loop.ts` owns the only clock. */
	setTime(seconds: number): void;
	dispose(): void;
}

/**
 * @param bandColour The colour of the band they sit IN — the scene's HAZE, handed in rather than
 *   imported so it cannot drift from the value the horizon is actually painted with. Not the sky
 *   overhead: a cloud in this game lives in the four degrees ON the horizon (see the header), which is
 *   the warm band, and hazing it toward the blue above would make it grey against cream.
 */
export function createClouds(bandColour: number): Clouds {
	const root = new Group();
	const texture = puffTexture();
	const owned: { dispose(): void }[] = [texture];
	const drifting: {
		sprite: Sprite;
		angle: number;
		away: number;
		width: number;
		height: number;
		flip: number;
	}[] = [];

	const band = new Color(bandColour);

	for (let i = 0; i < COUNT; i++) {
		// The golden-ratio sequence rather than a seeded random, for the reason `bergs.ts` spreads its
		// icebergs around a ring: a purely random placement leaves a whole quadrant of empty sky about
		// a third of the time, and this camera turns to face different floes. It also needs no seed
		// plumbed through `SceneHandles` for a sky nobody is going to describe to a friend.
		const jitter = golden(i);
		const angle = ((i + jitter * 0.7) / COUNT) * Math.PI * 2;
		const away = NEAR + golden(i + 3) * (FAR - NEAR);
		const width = MIN_WIDTH + golden(i + 5) * (MAX_WIDTH - MIN_WIDTH);
		const squat = MIN_SQUAT + golden(i + 7) * (MAX_SQUAT - MIN_SQUAT);

		// Haze by distance, computed once on the CPU: these never move toward or away from the camera
		// by more than the few metres the focus pans, so a per-frame recomputation would be arithmetic
		// nobody could see.
		const haze = HAZE_NEAR + ((away - NEAR) / (FAR - NEAR)) * (HAZE_FAR - HAZE_NEAR);
		const material = new SpriteMaterial({
			map: texture,
			color: new Color(0xffffff).lerp(band, haze),
			transparent: true,
			opacity: OPACITY,
			// Depth-TESTED so the ice, the penguins and the icebergs all occlude a cloud the way
			// anything nearer occludes anything further; depth-WRITE off because a transparent quad
			// that writes depth punches a cloud-shaped hole in whatever is drawn after it.
			depthWrite: false,
			// Not fogged. See HAZE_NEAR — the scene's curve is total long before a cloud's distance.
			fog: false
		});
		const sprite = new Sprite(material);
		// Mirrored on every other one. One texture is the budget (see the header), so the only way to
		// stop eight identical silhouettes is to flip half of them and vary how squat they are.
		const flip = i % 2 === 1 ? -1 : 1;
		sprite.scale.set(width * flip, width * squat, 1);
		sprite.position.set(
			Math.sin(angle) * away,
			BASE_Y + golden(i + 11) * LIFT,
			Math.cos(angle) * away
		);
		root.add(sprite);
		owned.push(material);
		drifting.push({ sprite, angle, away, width, height: width * squat, flip });
	}

	/** Where the deck is and how far out it stands. See `setDeck`; the sea is the default. */
	let deckX = 0;
	let deckZ = 0;
	let spread = 1;

	return {
		root,
		setDeck(centre, altitude, howFar) {
			deckX = centre.x;
			deckZ = centre.z;
			spread = howFar;
			root.position.y = altitude;
			for (const cloud of drifting) {
				// The sprite grows with the ring, so a cloud pushed twice as far away is twice as wide and
				// the sky looks the same. Only the parallax changes.
				cloud.sprite.scale.set(cloud.width * spread * cloud.flip, cloud.height * spread, 1);
			}
		},
		setTime(seconds) {
			for (const cloud of drifting) {
				const angle = cloud.angle + seconds * DRIFT;
				cloud.sprite.position.x = deckX + Math.sin(angle) * cloud.away * spread;
				cloud.sprite.position.z = deckZ + Math.cos(angle) * cloud.away * spread;
			}
		},
		dispose() {
			for (const thing of owned) thing.dispose();
		}
	};
}

/**
 * The low-discrepancy sequence the layout is spread with.
 *
 * The fractional parts of multiples of the golden ratio, which never clump and never repeat over any
 * count this file will use. A named function rather than the expression inline, because it is called
 * with five different offsets and each one has to be the same sequence read from a different place.
 */
function golden(i: number): number {
	return (i * 0.618033988749895) % 1;
}

/**
 * One cloud, drawn on a canvas.
 *
 * Six overlapping soft discs with their centres on the upper half, then a blue-grey wash from the
 * bottom. The wash is what makes it a cloud rather than a smudge: a cumulus is lit from above and its
 * base is in its own shade, and without that shading a white blob on a pale sky has no volume at all
 * — which is the same problem the ice had before it was tinted faintly blue (trap 11).
 */
function puffTexture(): CanvasTexture {
	// 256 × 128 for a shape whose edges are all gradient: there is no detail here to resolve, and a
	// cloud sixty metres wide is at most a third of a phone screen across.
	const canvas = document.createElement('canvas');
	canvas.width = 256;
	canvas.height = 128;
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new Error('2D canvas context unavailable — cannot draw a cloud');

	// Hand-placed rather than random: every sprite shares this one shape, so it is worth it being
	// a shape somebody looked at. Flat along the bottom, tallest a third of the way in.
	const puffs: [number, number, number][] = [
		[0.3, 0.62, 0.3],
		[0.46, 0.46, 0.26],
		[0.6, 0.6, 0.24],
		[0.72, 0.66, 0.19],
		[0.19, 0.72, 0.19],
		[0.85, 0.74, 0.13]
	];
	for (const [cx, cy, r] of puffs) {
		const x = cx * canvas.width;
		const y = cy * canvas.height;
		const radius = r * canvas.width * 0.5;
		const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
		// Solid for over half the radius and then away to nothing. A linear ramp from the centre
		// reads as a soft ball rather than as cloud, because a cumulus has a definite edge in the
		// middle of its silhouette and a ragged one only at the very rim.
		gradient.addColorStop(0, 'rgba(255,255,255,1)');
		gradient.addColorStop(0.58, 'rgba(255,255,255,0.97)');
		gradient.addColorStop(1, 'rgba(255,255,255,0)');
		ctx.fillStyle = gradient;
		ctx.beginPath();
		ctx.arc(x, y, radius, 0, Math.PI * 2);
		ctx.fill();
	}

	// Only where there is already cloud: `source-atop` keeps the alpha the puffs built and tints it,
	// so the wash cannot leak a rectangle of grey into the sky around them.
	ctx.globalCompositeOperation = 'source-atop';
	const shade = ctx.createLinearGradient(0, 0, 0, canvas.height);
	shade.addColorStop(0, 'rgba(255,255,255,0)');
	shade.addColorStop(0.55, 'rgba(255,255,255,0)');
	shade.addColorStop(1, 'rgba(176,205,228,0.7)');
	ctx.fillStyle = shade;
	ctx.fillRect(0, 0, canvas.width, canvas.height);

	const texture = new CanvasTexture(canvas);
	// The canvas is sRGB and the renderer works in linear: without saying so, every soft edge is
	// gamma-wrong, which on a gradient this wide is a visible rim rather than a subtlety.
	texture.colorSpace = SRGBColorSpace;
	// No mipmaps and linear both ways, for the reason `nameTag.ts` gives: this texture is nothing but
	// a soft gradient, and a mip chain of a soft gradient is a smaller soft gradient plus memory.
	texture.minFilter = LinearFilter;
	texture.magFilter = LinearFilter;
	texture.generateMipmaps = false;
	return texture;
}
