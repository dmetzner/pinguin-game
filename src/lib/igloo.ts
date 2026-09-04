/**
 * The igloo: what a child has built, what the next thing costs, and where the domes stand.
 *
 * This is the other half of `eis.ts` and it lives beside it for the same reason. A `World` is pure,
 * seeded and replayable; a house is one child's history on one device, and it changes without a tick.
 * So nothing in `sim/` reads this file, and nothing in this file reads a world. What crosses between
 * them is geometry going the other way: the simulation owns the PLOT (`ISLAND_OBSTACLES`, id `iglu`)
 * because the simulation is the authority on where anything is, and everything here is expressed as a
 * fraction of that plot rather than in metres — the same normalised form `ISLAND_MOUNDS` uses, and for
 * the same reason. A radius typed out twice is two numbers that part company.
 *
 * **The plot is reserved at its FINISHED size from the first frame, and that is a consequence of
 * invariant 1 rather than a convenience.** An obstacle list that grew when a child bought a room
 * would be simulation state derived from a wallet: two devices replaying one seed would disagree
 * about where a wall is, and they would disagree *intermittently*, which is the failure mode
 * `CLAUDE.md` names as the worst way for a networking bug to break. So the child owns a yard from the
 * day the island exists and the igloo grows inside it — which is also why `render/igloo.ts` fills the
 * empty part of the yard with the ice blocks the next room will be built out of. Reserved ground you
 * can see the purpose of is a plot; reserved ground you cannot is an invisible wall.
 *
 * **Nothing on this ladder changes a penguin's speed, grip, jump or snowball.** Every step is a
 * bigger dome or another dome. That is the hard line `eis.ts` states where the earning is, restated
 * here where the spending is, so neither file's silence can be read as an oversight: the child who
 * has played for a week and the child who opened the app five minutes ago have to be able to lose to
 * each other.
 *
 * **And nobody names their igloo.** Invariant 4 is not about chat alone — a house with a sign on it
 * is a free-text field with a roof. Every word a child sees here is in `IGLOO_LADDER`, in German, and
 * there are five of them.
 */
import { EIS_FOR_FINISHING, EIS_FOR_WINNING, readSave, SAVE_VERSION } from './eis';
import type { Vec2 } from './sim/types';
import { writeJson } from './storage';
import { storageKeys } from './storageKeys';

/**
 * What has been built: how wide the big dome is, how many domes there are, and whether there is a
 * lookout on top.
 *
 * Radii are FRACTIONS OF THE PLOT'S RADIUS, never metres — see the note at the top of this file. The
 * metres beside each constant below are what they come to on the 5 m plot the island actually has,
 * and they are there to be read, not to be used.
 */
export interface IglooPlan {
	/** The big dome, the one with the face on it. */
	readonly main: number;
	/** How many domes there are altogether: 1, 2 or 3. The second and third are the small ones. */
	readonly rooms: number;
	/** A small dome perched on the big one's crown. */
	readonly tower: boolean;
}

/**
 * The big dome, before and after the first upgrade: 2.4 m and 2.75 m of radius on the island's plot.
 *
 * A penguin is about a metre tall, so the small igloo is 4.8 m across and 2.2 m high — two penguins
 * tall and nearly five wide, which is the "wide base, nothing tapering" of `docs/ART-DIRECTION.md`
 * expressed as a proportion rather than as a wish. The big one is 5.5 m across and 2.5 m high.
 *
 * The ceiling is the PLOT and not taste, and it is tighter than the shells alone suggest. `iglooDomes`
 * places the big dome forward of the plot's middle so its face is near the doorstep, which spends
 * `MAIN_FORWARD` of the radius before the dome starts — and the DRAWN igloo then flares an apron of
 * packed snow 14% past the shell, because a hemisphere meets grass at a tangent and has no base at
 * all. 0.36 + 0.55 leaves the shell at 0.91 of the plot and the apron at 0.99. At 0.58 the apron
 * stood 10 cm outside the circle a child is held at — geometry drawn past the collision that
 * describes it, which is trap 8's family, and it was `render/igloo.test.ts` that said so rather than
 * anybody's eye.
 */
const DOME_SMALL = 0.48;
const DOME_BIG = 0.55;

/** A side room: 1.55 m of radius, so 3.1 m across and 1.4 m high. Half the big dome, deliberately. */
const ROOM = 0.31;

/**
 * The lookout on the crown: how wide it is, and how far up the big dome's own height it sits.
 *
 * Both numbers are pinned between two failures and `igloo.test.ts` asserts each of them. Too low or
 * too wide and its foot is outside the big dome's surface at that height, which is trap 16's mistake
 * (daylight under something that should be sunk into what carries it) on a roof instead of at a
 * waterline. Too high and less than half of it clears the crown, which is a bump rather than a tower —
 * and the whole reason the last rung is a tower is that it changes the SILHOUETTE, which is the only
 * part of a building anybody reads from across an island.
 *
 * At the island's 5 m plot: 1.30 m of radius, sitting 2.18 m up, topping out at 3.37 m — a third
 * taller than the igloo under it, and three and a half penguins high.
 */
const TOWER = 0.26;
const TOWER_UP = 0.86;

/**
 * How tall a dome is, as a fraction of its own radius.
 *
 * Not 1.0, which would be a true hemisphere and reads as a bubble. Squashed a little, because "big
 * head, small body, WIDE BASE" is the first hard rule in `docs/ART-DIRECTION.md` and a dome is all
 * base. Not squashed much, because at 0.7 it stops being an igloo and becomes a pancake — and the
 * door has to fit in the front of it.
 */
export const DOME_SQUASH = 0.92;

/**
 * Where the domes sit on the plot, as fractions of its radius. Forward means toward the doorstep.
 *
 * The side rooms sit close enough to OVERLAP the big dome by a third of a metre, and that number is
 * the one that matters: "an igloo is domes stuck together" is the whole reason this feature costs no
 * new art, and at 0.36 / 0.42 the two shells touched with five millimetres to spare — which is not
 * stuck together, it is two igloos that happen to be adjacent, and the first change to any radius
 * would have opened a seam of daylight between them.
 */
const MAIN_FORWARD = 0.36;
const ROOM_ASIDE = 0.33;
const ROOM_BACK = 0.36;

/** A child who has just been given an island. One room, and it is theirs before they earn anything. */
export const IGLOO_START: IglooPlan = { main: DOME_SMALL, rooms: 1, tower: false };

/** One rung: what the child reads on the button, and what the igloo becomes. */
export interface IglooStep {
	/** Player-visible, German, curated. There are exactly four of these in the game. */
	readonly label: string;
	/** A second line, for what the picture does not say on its own. */
	readonly detail: string;
	readonly plan: IglooPlan;
}

/**
 * The ladder: bigger, a second room, a tower, a third room.
 *
 * **Bigger comes first because it is the cheapest**, and the story is explicit that the first upgrade
 * has to be reachable in one afternoon. It is also the step that shows up worst in a screenshot and
 * best on a phone in a child's hands: the same igloo, half a metre wider, is a thing you notice
 * because you knew the old one.
 *
 * **The last two rungs are DELIBERATELY not in the story's order**, which asks for bigger → more rooms
 * → something new. They are swapped, and the reason is a measurement rather than a preference:
 * `render/igloo.test.ts` measures the box each rung fills, and the THIRD room is the mirror of the
 * second — it adds a whole dome without moving the building's width by a millimetre or its height at
 * all. It is the subtlest change on the ladder, and at the story's ordering it was also the second
 * most expensive: 160 Eis of spot-the-difference. The tower is the loudest change there is, because it
 * is the only rung that touches HEIGHT, which is the one dimension nothing else on the ladder moves
 * and the one a child reads from across the island. So the loud one is bought earlier and the quiet
 * one closes the set, where its job is completeness rather than surprise.
 *
 * The plot is full at three domes — `iglooFits` is the test that says so — so up was the only
 * direction left for a fourth rung in any case. A lookout on the crown is the first thing a child
 * would draw if you gave them a crayon, and it costs one more sphere.
 */
export const IGLOO_LADDER: readonly IglooStep[] = [
	{
		label: 'Größer',
		detail: 'Das gleiche Iglu, breiter.',
		plan: { main: DOME_BIG, rooms: 1, tower: false }
	},
	{
		label: 'Zweites Zimmer',
		detail: 'Eine zweite Kuppel, hinten links.',
		plan: { main: DOME_BIG, rooms: 2, tower: false }
	},
	{
		label: 'Aussichtsturm',
		detail: 'Eine kleine Kuppel oben drauf.',
		plan: { main: DOME_BIG, rooms: 2, tower: true }
	},
	{
		label: 'Drittes Zimmer',
		detail: 'Und eine dritte Kuppel, hinten rechts.',
		plan: { main: DOME_BIG, rooms: 3, tower: true }
	}
];

/**
 * What one round pays a child who wins one in four, and what ten of them come to.
 *
 * The story's anchor, made arithmetic: "at roughly ten rounds an afternoon a child earns 30–100 Eis".
 * The floor of that range is a child who never wins (ten finishes) and the ceiling is one who always
 * does; one win in four is the middle, and it is the number the first price is checked against in
 * `igloo.test.ts`. Derived from `eis.ts`'s two constants rather than typed, so raising the win bonus
 * moves the prices and the affordability test together instead of quietly making the ladder cheap.
 */
export const ROUNDS_AN_AFTERNOON = 10;
export const EIS_AN_AFTERNOON = ROUNDS_AN_AFTERNOON * (EIS_FOR_FINISHING + EIS_FOR_WINNING / 4);

/**
 * What the nth rung costs: `(n + 2)²` wins.
 *
 * So 40, 90, 160 and 250 Eis — four wins, then nine, sixteen, twenty-five. Squares of 2 upward rather
 * than of 1, because a first rung of one single win is a purchase a child reaches before they have
 * noticed they are earning, which is a cutscene rather than a reward. Three things made it arithmetic
 * rather than a typed table:
 *
 *  * **It is a price in WINS**, and a win is `EIS_FOR_FINISHING + EIS_FOR_WINNING` — the one number an
 *    eight-year-old already knows, because it is what the result screen just handed them. A price
 *    that is a whole number of wins is a price a child can plan against without arithmetic.
 *  * **It is derived**, so a change to either payout constant moves every price with it. A copied 40
 *    would still say 40 on the afternoon somebody doubles the win bonus, and the first upgrade would
 *    silently become half an afternoon's work.
 *  * **Square rather than doubling.** The gaps are 50, 70 and 90 — the ladder gets dearer, but the
 *    last rung is five afternoons rather than the twenty an exponential curve would ask for, and a
 *    child can see the end of it. The whole ladder is 540 Eis, about eleven afternoons.
 */
export function priceOf(stage: number): number {
	return (stage + 2) * (stage + 2) * (EIS_FOR_FINISHING + EIS_FOR_WINNING);
}

/** The rung after this one, or null for an igloo that is finished. */
export function nextStep(stage: number): IglooStep | null {
	return IGLOO_LADDER[stage] ?? null;
}

/**
 * What the igloo looks like after `stage` rungs have been paid for.
 *
 * CLAMPED at the top rather than falling back to the start, which is the difference between a save
 * from a build with a longer ladder drawing the biggest igloo this build knows and drawing an empty
 * plot. `iglooStage` clamps as well; this is the brace to that belt, because the two have different
 * callers — one reads a device and one is asked a hypothetical by the build screen.
 */
export function planFor(stage: number): IglooPlan {
	if (stage <= 0) return IGLOO_START;
	const rung = Math.min(IGLOO_LADDER.length, Math.floor(stage)) - 1;
	return IGLOO_LADDER[rung]?.plan ?? IGLOO_START;
}

/**
 * One dome, in world metres, ready to be drawn.
 *
 * The renderer plots these and adds nothing of its own — the `moundsFor` precedent, which
 * `CLAUDE.md` states as "an iceberg you can see is exactly the one you can climb". Here the stake is
 * smaller but the shape is identical: the wall a child bumps into is the plot, and a dome placed by
 * the renderer's own arithmetic could stand outside it.
 */
export interface Dome {
	/** Which one it is. The big one carries the face; the others carry a window and nothing else. */
	readonly kind: 'main' | 'room' | 'tower';
	/** The middle, in world metres. */
	readonly at: Vec2;
	readonly radius: number;
	/** How tall it stands above its own base, in metres. */
	readonly height: number;
	/** How far its base sits above the ground, in metres. Zero except for the tower. */
	readonly lift: number;
}

/** The ground a plot occupies: an `Obstacle` from `sim/island.ts`, and nothing more of it than this. */
export interface IglooPlot {
	readonly at: Vec2;
	readonly radius: number;
}

/**
 * Every dome this plan puts on this plot, front one first.
 *
 * Front one first because the big dome is the one with the face, and a caller that only wants to know
 * where to aim a camera or hang a door wants that one — `render/igloo.ts` reads `[0]` for both.
 *
 * The side rooms go BEHIND the big dome rather than beside it, and that is the whole composition. Set
 * side by side, three domes of these radii are ten metres of wall and read as a caterpillar; tucked
 * behind at ±0.36, they peek over the big one's shoulders and the whole thing reads as one cloven
 * mass with a face on the front. It also keeps the plot circular, which is what lets one obstacle
 * describe the building — the simulation has exactly one collision shape and it is a circle.
 *
 * They very nearly TOUCH the big dome (0.03 of a plot radius, 15 cm, of overlap), because "an igloo
 * is domes stuck together" is the whole reason this feature costs no new art, and a tunnel between
 * two domes that are already merged is a detail rather than a load-bearing join.
 */
export function iglooDomes(plot: IglooPlot, plan: IglooPlan): readonly Dome[] {
	const r = plot.radius;
	const main = plan.main * r;
	const domes: Dome[] = [
		{
			kind: 'main',
			// Forward is +z: the doorstep is south of the plot and so is the camera. See `render/igloo.ts`.
			at: { x: plot.at.x, z: plot.at.z + MAIN_FORWARD * r },
			radius: main,
			height: main * DOME_SQUASH,
			lift: 0
		}
	];

	// Left first, then right, so a second room is always the same room. A child who buys one and
	// comes back tomorrow has to find it where they left it.
	for (const side of [-1, 1].slice(0, plan.rooms - 1)) {
		domes.push({
			kind: 'room',
			at: { x: plot.at.x + side * ROOM_ASIDE * r, z: plot.at.z - ROOM_BACK * r },
			radius: ROOM * r,
			height: ROOM * r * DOME_SQUASH,
			lift: 0
		});
	}

	if (plan.tower) {
		const tower = TOWER * r;
		domes.push({
			kind: 'tower',
			at: { x: plot.at.x, z: plot.at.z + MAIN_FORWARD * r },
			radius: tower,
			height: tower * DOME_SQUASH,
			// Sunk into the crown rather than balanced on it. A sphere sitting ON a dome shows daylight
			// at the join from any camera below it, and this camera is 27° above the ground (trap 16 is
			// the same mistake with an iceberg).
			lift: main * DOME_SQUASH * TOWER_UP
		});
	}

	return domes;
}

/**
 * Does every dome of this plan stand inside this plot?
 *
 * Exported so `igloo.test.ts` can ask it of every rung, which is the check that matters most in this
 * file: the plot is what the simulation holds a penguin out of, so a dome reaching past it is ice a
 * child can see and walk through — trap 8 with the sign flipped, and the one way this feature can
 * produce a visible lie.
 *
 * It asks about the SHELLS, because shells are all this file knows about. The drawing hangs an apron,
 * a doorway rim and a lantern off them, all of which reach further, and `render/igloo.test.ts` is
 * what measures those against the same circle — one of them was outside it.
 */
export function iglooFits(plot: IglooPlot, plan: IglooPlan): boolean {
	return iglooDomes(plot, plan).every((dome) => {
		const out = Math.hypot(dome.at.x - plot.at.x, dome.at.z - plot.at.z);
		return out + dome.radius <= plot.radius;
	});
}

// ---------------------------------------------------------------------------
// Keeping it
// ---------------------------------------------------------------------------

/**
 * What is persisted, which is one number.
 *
 * How many rungs are paid for — not the plan, and deliberately not: a stored `{ main: 0.58, rooms: 2 }`
 * would be a copy of `IGLOO_LADDER` on every child's device, frozen at the shape it had the day they
 * played, and the first change to a radius would leave every existing igloo drawn to the old table.
 * A rung count is the smallest thing that survives the ladder being re-tuned.
 *
 * It rides inside the ISLAND blob (`floe.island.v1`), under `igloo`, beside the wallet that paid for
 * it — one key, one JSON blob, the one `version` the envelope already carries. There is no second
 * version field in here on purpose: `eis.ts` documents that this project has exactly two version
 * markers with two different jobs, and a third nested inside the second would be a marker with no
 * job at all. Adding a field to a v1 blob needs no bump — an older save simply has no `igloo` in it
 * and reads as a fresh one, which is the ordinary path this whole scheme exists to provide.
 *
 * And it is read THROUGH `eis.readSave` rather than off the key, which is the one thing that keeps the
 * two halves of this save telling the same story. Read raw, a blob from a build with a newer
 * `SAVE_VERSION` would give a child an igloo with three rooms and a wallet of zero — the envelope's
 * version gate applied to one field and not the other. One reader, one gate.
 */
interface StoredIgloo {
	readonly built: number;
}

/**
 * How many rungs are paid for, clamped to a rung that exists.
 *
 * Coerced rather than trusted, exactly as `look.ts` clamps a stored look and `eis.ts` clamps a stored
 * total. A blob from a newer build with a longer ladder, a hand-edited console, a truncated write:
 * none of them is a reason to fail on the way to the first frame, and all of them read as an igloo
 * this build can draw.
 */
export function iglooStage(): number {
	const igloo = readSave().igloo;
	if (typeof igloo !== 'object' || igloo === null) return 0;
	const built = (igloo as Partial<StoredIgloo>).built;
	if (typeof built !== 'number' || !Number.isFinite(built)) return 0;
	return Math.min(IGLOO_LADDER.length, Math.max(0, Math.floor(built)));
}

/** What this child's igloo looks like right now. The one reader anything on screen goes through. */
export function myIgloo(): IglooPlan {
	return planFor(iglooStage());
}

/** What a purchase did: whether it happened, and what the child now has. */
export interface Purchase {
	readonly built: boolean;
	readonly stage: number;
	readonly eis: number;
}

/**
 * Buy the next rung, if there is one and it is affordable.
 *
 * ONE write, holding both halves. `eis.ts`'s `earn` is the same shape for the same reason — and the
 * total comes back rather than being asked for again, because the write may not have stuck: a
 * locked-down school tablet and Safari in private browsing both refuse `setItem`, and a child on one
 * of those should still watch their igloo grow for the rest of the session. What they lose is a
 * reload, which is the bargain every stored thing in this game makes.
 *
 * Refusing is a RESULT and not an exception. There is no path here where a child taps a button and
 * the game stops: an unaffordable rung, a finished ladder and a browser that will not hold the answer
 * all come back as `built: false` with the truth about what they have.
 */
export function buyNext(): Purchase {
	// ONE read of the envelope and one write back, so the wallet going down and the room going up are
	// never separately observable: a child who pays and gets nothing has lost an afternoon. The spread
	// is what carries the fields this file does not own — `eis.ts`'s own, and whatever story 12d adds —
	// through a write that has no business editing them. `eis.ts` records what a partial write to this
	// blob costs; it ate the igloo once already.
	const save = readSave();
	const stage = iglooStage();
	const step = nextStep(stage);
	const price = priceOf(stage);

	if (!step || save.eis < price) return { built: false, stage, eis: save.eis };

	const left = save.eis - price;
	const next: StoredIgloo = { built: stage + 1 };
	writeJson(storageKeys.island, { ...save, version: SAVE_VERSION, eis: left, igloo: next });
	return { built: true, stage: stage + 1, eis: left };
}

/**
 * Has the player walked away from their own front door?
 *
 * The way OUT of the interior view, alongside the button, and it is a place rather than an event for
 * the same reason every other answer on the island is: `sim/island.ts`'s zones are points and radii,
 * `chase.ts`'s hunter is a position, and neither has an "entered" to miss or a "left" to leak. A
 * child who wandered off while looking at the inside of their igloo gets the island back without
 * having to find a button.
 *
 * Measured from the DOORSTEP rather than from the plot, because the doorstep is the thing the child is
 * standing in when they press the button and it is the one circle both halves of this agree about.
 * The slack is a metre and a half outside it, so shuffling on the mat does not flicker the framing —
 * which at this camera distance is the whole screen changing shape twice a second.
 */
export function hasLeftTheIgloo(pos: Vec2, doorstep: IglooPlot): boolean {
	return Math.hypot(pos.x - doorstep.at.x, pos.z - doorstep.at.z) > doorstep.radius + 1.5;
}
