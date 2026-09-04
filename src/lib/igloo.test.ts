import { afterEach, describe, expect, it } from 'vitest';
import { EIS_FOR_FINISHING, EIS_FOR_WINNING, earn, readSave, SAVE_VERSION } from './eis';
import {
	buyNext,
	EIS_AN_AFTERNOON,
	hasLeftTheIgloo,
	IGLOO_LADDER,
	IGLOO_START,
	type IglooPlot,
	iglooDomes,
	iglooFits,
	iglooStage,
	myIgloo,
	nextStep,
	planFor,
	priceOf
} from './igloo';
import { storageKeys } from './storageKeys';

/**
 * The igloo: what the ladder costs, what it comes out as on the ground, and the ways a browser can
 * refuse to remember any of it.
 *
 * All of it is pure or is `storage.ts`'s discipline applied to a second kind of value, which is the
 * whole reason the house lives in `lib/` beside the wallet rather than as a field on a `World` — the
 * part of this feature that can actually be wrong is testable without a GPU or a DOM. The drawn igloo
 * is not tested and deliberately: nothing under `render/` is meaningfully testable without a screen,
 * and `iglooFits` below is the one fact about the drawing that can be checked here, because it is the
 * one that can produce a visible lie.
 */

/** Install a `localStorage` for the length of one test. The same shape `eis.test.ts` uses. */
function withStorage(store: Storage | (() => never) | null): void {
	if (store === null) {
		Reflect.deleteProperty(globalThis, 'localStorage');
		return;
	}
	Object.defineProperty(globalThis, 'localStorage', {
		configurable: true,
		get: typeof store === 'function' ? store : () => store
	});
}

function memoryStorage(): Storage {
	const map = new Map<string, string>();
	return {
		get length() {
			return map.size;
		},
		clear: () => map.clear(),
		getItem: (k) => map.get(k) ?? null,
		key: (i) => [...map.keys()][i] ?? null,
		removeItem: (k) => void map.delete(k),
		setItem: (k, v) => void map.set(k, v)
	};
}

/** A store holding an island blob written the way a browser would have written it. */
function holding(blob: unknown): Storage {
	const store = memoryStorage();
	store.setItem(storageKeys.island, JSON.stringify(blob));
	return store;
}

/** A child with this many Eis and this many rungs paid for. */
function saved(eis: number, built?: number): Storage {
	return holding({
		version: SAVE_VERSION,
		eis,
		...(built === undefined ? {} : { igloo: { built } })
	});
}

const PLOT: IglooPlot = { at: { x: 24, z: -18 }, radius: 5 };

afterEach(() => withStorage(null));

describe('what the ladder costs', () => {
	it('is a ladder at all, and every rung changes something', () => {
		// Without this the loops below pass by having nothing to do, and a rung that produced the same
		// igloo as the one before it would be a purchase a child made and could not see — the worst
		// possible thing to charge forty Eis for.
		expect(IGLOO_LADDER.length).toBeGreaterThan(2);
		let before = IGLOO_START;
		for (const [i, step] of IGLOO_LADDER.entries()) {
			expect(step.plan, `rung ${i} (${step.label})`).not.toEqual(before);
			before = step.plan;
		}
	});

	it('puts the first upgrade inside one afternoon, which is what story 12 asks for', () => {
		// DERIVED from `eis.ts`'s two payout constants by way of `EIS_AN_AFTERNOON`, never against a
		// copied 40: raise the win bonus and both sides of this move together, which is the whole reason
		// the price is arithmetic rather than a table. Ten rounds and one win in four is the middle of
		// the 30–100 Eis the story measures an afternoon at.
		expect(priceOf(0)).toBeLessThanOrEqual(EIS_AN_AFTERNOON);
		// And not free. A first rung a child reaches before they have noticed they are earning is not a
		// reward, it is a cutscene.
		expect(priceOf(0)).toBeGreaterThan(EIS_FOR_FINISHING + EIS_FOR_WINNING);
	});

	it('prices every rung as a whole number of WINS', () => {
		// A win is the one number an eight-year-old already knows, because the result screen just handed
		// it to them. `(n + 2)²` wins is a price they can plan against without arithmetic, and it is
		// asserted against the payout constants rather than against 40, 90, 160, 250.
		const win = EIS_FOR_FINISHING + EIS_FOR_WINNING;
		for (let stage = 0; stage < IGLOO_LADDER.length; stage++) {
			expect(priceOf(stage) % win, `rung ${stage}`).toBe(0);
			expect(priceOf(stage)).toBe((stage + 2) * (stage + 2) * win);
		}
	});

	it('gets dearer, but stays a matter of afternoons rather than of months', () => {
		// The ceiling is the point. An exponential ladder makes the last rung a thing a child hears
		// about rather than reaches, and a hub whose furthest reward is unreachable is a hub with a
		// locked door in it.
		let last = 0;
		let total = 0;
		for (let stage = 0; stage < IGLOO_LADDER.length; stage++) {
			expect(priceOf(stage)).toBeGreaterThan(last);
			last = priceOf(stage);
			total += priceOf(stage);
		}
		expect(total / EIS_AN_AFTERNOON).toBeLessThan(15);
		expect(last / EIS_AN_AFTERNOON).toBeLessThan(7);
	});

	it('sells nothing that changes a penguin', () => {
		// The hard line, and the same kind as "no free text": the child who has played for a week and
		// the child who opened the app five minutes ago have to be able to lose to each other. Asserted
		// STRUCTURALLY rather than by reading the labels, so a `grip` or a `jump` added to `IglooPlan`
		// fails here instead of shipping — every field on a plan is a piece of geometry, and this is the
		// test that says so.
		const geometry = new Set(['main', 'rooms', 'tower']);
		for (const plan of [IGLOO_START, ...IGLOO_LADDER.map((step) => step.plan)]) {
			for (const key of Object.keys(plan)) expect(geometry.has(key), key).toBe(true);
		}
	});

	it('says every rung in German, and says something', () => {
		// Invariant 4 reaches further than chat: a house you can name is a free-text field with a roof
		// on it. These four strings are the whole vocabulary of the feature.
		for (const step of IGLOO_LADDER) {
			expect(step.label.length).toBeGreaterThan(2);
			expect(step.detail.length).toBeGreaterThan(8);
		}
		expect(new Set(IGLOO_LADDER.map((s) => s.label)).size).toBe(IGLOO_LADDER.length);
	});

	it('runs out, and says so rather than offering a rung that does not exist', () => {
		expect(nextStep(IGLOO_LADDER.length)).toBeNull();
		expect(nextStep(0)).toBe(IGLOO_LADDER[0]);
		expect(planFor(0)).toEqual(IGLOO_START);
		expect(planFor(IGLOO_LADDER.length)).toEqual(IGLOO_LADDER[IGLOO_LADDER.length - 1]?.plan);
		// A stage past the end draws the finished igloo rather than nothing. `iglooStage` clamps, so
		// this is the belt to that braces: a save from a build with a longer ladder is a house, not a
		// hole in the ground.
		expect(planFor(99)).toEqual(IGLOO_LADDER[IGLOO_LADDER.length - 1]?.plan);
	});
});

describe('where the domes stand', () => {
	it('keeps every rung inside the plot, at any size of plot', () => {
		// **The check that matters most in this file.** The plot is the circle `holdOffObstacles` stops a
		// penguin at, so a dome reaching past it is a building a child can see and walk through — trap 8
		// with the sign flipped, and the one way this feature can put a visible lie on screen.
		//
		// Asserted over three plot radii rather than the island's one, because every radius in
		// `iglooDomes` is a FRACTION of the plot: if it holds for one it holds for all, and asserting it
		// that way means the day somebody widens the plot this test still means something.
		for (const radius of [3, 5, 9]) {
			const plot: IglooPlot = { at: { x: -7, z: 12 }, radius };
			for (const [i, plan] of [IGLOO_START, ...IGLOO_LADDER.map((s) => s.plan)].entries()) {
				expect(iglooFits(plot, plan), `rung ${i} on a ${radius} m plot`).toBe(true);
			}
		}
	});

	it('puts as many domes on the ground as the plan says, and the big one first', () => {
		for (const plan of [IGLOO_START, ...IGLOO_LADDER.map((s) => s.plan)]) {
			const domes = iglooDomes(PLOT, plan);
			expect(domes.length).toBe(plan.rooms + (plan.tower ? 1 : 0));
			// First, because it is the one with the face on it and every caller that wants one dome wants
			// that one — `render/igloo.ts` reads `[0]` for both the door and the lantern.
			expect(domes[0]?.kind).toBe('main');
		}
	});

	it('sticks the domes together rather than standing them apart', () => {
		// "An igloo is domes stuck together" is the entire reason this feature costs no new art, and a
		// side room that did not TOUCH the big dome would be a second igloo with a corridor of daylight
		// between them. Overlap, not adjacency: the shells intersect.
		const domes = iglooDomes(PLOT, { main: 0.58, rooms: 3, tower: false });
		const main = domes[0];
		if (!main) throw new Error('the plan lost its big dome');
		for (const room of domes.slice(1)) {
			const gap = Math.hypot(room.at.x - main.at.x, room.at.z - main.at.z);
			expect(gap, room.kind).toBeLessThan(main.radius + room.radius);
		}
	});

	it('faces the big dome at the doorstep, which is where the camera is', () => {
		// Trap 17: the sea lion was given a face the mode's own geometry pointed away from the camera by
		// construction. The island puts the plot NORTH of its doorstep, the camera stands on the +z side
		// and looks back along −z, so the dome carrying the face has to sit FORWARD of the plot's middle
		// or the whole visible surface of this feature is behind the building.
		for (const plan of [IGLOO_START, ...IGLOO_LADDER.map((s) => s.plan)]) {
			const main = iglooDomes(PLOT, plan)[0];
			expect(main?.at.z ?? 0).toBeGreaterThan(PLOT.at.z);
			expect(main?.at.x).toBe(PLOT.at.x);
		}
	});

	it('adds the second room on the same side every time', () => {
		// A child who buys a room and comes back tomorrow has to find it where they left it, so the first
		// of the two side rooms may never move when the second arrives.
		//
		// Found by SEARCHING the ladder rather than by indexing into it, because the last two rungs have
		// been re-ordered once already — a test that reads `planFor(2)` and `planFor(3)` is a test that
		// quietly stops asking its question the next time somebody swaps two rows.
		const plans = [IGLOO_START, ...IGLOO_LADDER.map((s) => s.plan)];
		const rooms = (n: number) =>
			iglooDomes(PLOT, plans.find((p) => p.rooms === n) ?? IGLOO_START).filter(
				(d) => d.kind === 'room'
			);
		const one = rooms(2);
		const both = rooms(3);
		expect(one.length).toBe(1);
		expect(both.length).toBe(2);
		expect(both[0]).toEqual(one[0]);
	});

	it('sinks the tower into the crown rather than balancing it on top', () => {
		// A sphere sitting ON a dome shows daylight at the join from any camera below it, and this
		// camera is 27° above the ground — trap 16 is the same mistake made with an iceberg. So the
		// tower's foot has to be inside the big dome's own surface at that height.
		const domes = iglooDomes(PLOT, planFor(IGLOO_LADDER.length));
		const main = domes.find((d) => d.kind === 'main');
		const tower = domes.find((d) => d.kind === 'tower');
		if (!main || !tower) throw new Error('the finished igloo lost its tower');
		expect(tower.lift).toBeGreaterThan(0);
		expect(tower.lift).toBeLessThan(main.height);
		// The big dome is an ellipsoid, so its radius at the tower's foot is what has to hold it.
		const across = main.radius * Math.sqrt(1 - (tower.lift / main.height) ** 2);
		expect(tower.radius).toBeLessThan(across);
		// And it has to come out of the top far enough to be a tower rather than a bump.
		expect(tower.lift + tower.height).toBeGreaterThan(main.height + tower.height * 0.5);
	});
});

describe('keeping it', () => {
	it('gives a child who has never played a one-room igloo, for nothing', () => {
		// Story 12: "one room to start, and it is yours the moment the island is". Not a purchase, not a
		// tutorial, not an empty plot.
		withStorage(memoryStorage());
		expect(iglooStage()).toBe(0);
		expect(myIgloo()).toEqual(IGLOO_START);
		expect(myIgloo().rooms).toBe(1);
	});

	it('builds the next rung and takes exactly its price', () => {
		withStorage(saved(500));
		const bought = buyNext();
		expect(bought.built).toBe(true);
		expect(bought.stage).toBe(1);
		expect(bought.eis).toBe(500 - priceOf(0));
		expect(myIgloo()).toEqual(IGLOO_LADDER[0]?.plan);
	});

	it('refuses a rung the child cannot afford, and takes nothing for it', () => {
		// Refusing is a RESULT and not an exception: there is no path here where a child taps a button
		// and the game stops. And the wallet has to be untouched — a purchase that half happened is the
		// one bug in this feature that costs a real afternoon.
		withStorage(saved(priceOf(0) - 1));
		const refused = buyNext();
		expect(refused.built).toBe(false);
		expect(refused.stage).toBe(0);
		expect(refused.eis).toBe(priceOf(0) - 1);
		expect(iglooStage()).toBe(0);
	});

	it('refuses when the ladder is finished', () => {
		withStorage(saved(100_000, IGLOO_LADDER.length));
		expect(buyNext().built).toBe(false);
		expect(iglooStage()).toBe(IGLOO_LADDER.length);
	});

	it('pays and builds in ONE write, into the blob the wallet already lives in', () => {
		const store = memoryStorage();
		withStorage(store);
		store.setItem(storageKeys.island, JSON.stringify({ version: SAVE_VERSION, eis: 500 }));
		buyNext();
		const raw = store.getItem(storageKeys.island);
		expect(JSON.parse(raw ?? '')).toEqual({
			version: SAVE_VERSION,
			eis: 500 - priceOf(0),
			igloo: { built: 1 }
		});
		// One key. A wallet in one place and the house it paid for in another is a purchase that can be
		// half-written, and the child who lands on the wrong half has lost an afternoon.
		expect(store.length).toBe(1);
	});

	it('carries through the parts of the blob it does not own', () => {
		// `eis.ts` owns `eis` and `version` and this file owns `igloo`, and a writer that rebuilt the blob
		// out of the fields it knows about would delete the other one's every time it wrote — which is
		// exactly the bug `earn` had until it learned to spread what it read, and it ate the igloo.
		//
		// The contract is `IslandSave`, not "anything that happens to be in there": a field story 12d
		// adds has to be declared on that interface to survive, which is the rule `eis.ts` now records
		// beside the scar. Asserted through EARNING as well as through buying, because the guarantee is
		// only worth anything if it holds in both directions.
		withStorage(saved(500));
		buyNext();
		expect(readSave().igloo).toEqual({ built: 1 });
		earn(7);
		expect(readSave().igloo).toEqual({ built: 1 });
		expect(readSave().eis).toBe(500 - priceOf(0) + 7);
	});
});

describe('a save this build cannot read', () => {
	it('reads a blob from a version this build does not understand as a fresh igloo', () => {
		// The gate is `eis.readSave`'s and this file borrows it rather than keeping its own. Read off the
		// key directly, this would hand back three rooms while `myEis()` handed back zero — one save
		// telling two stories, which is worse than either answer on its own.
		withStorage(holding({ version: SAVE_VERSION + 1, eis: 900, igloo: { built: 3 } }));
		expect(iglooStage()).toBe(0);
		expect(myIgloo()).toEqual(IGLOO_START);
	});

	it('reads an igloo that is not an igloo as a fresh one', () => {
		for (const igloo of [null, 7, 'gross', [], true, {}, { built: 'zwei' }]) {
			withStorage(holding({ version: SAVE_VERSION, eis: 0, igloo }));
			expect(iglooStage(), JSON.stringify(igloo)).toBe(0);
		}
	});

	it('clamps a rung count from a build with a longer ladder', () => {
		// The ordinary path when the shape changes, and the reason `built` is a COUNT rather than a
		// stored plan: a child on an older build meets a newer save and gets the biggest igloo this
		// build knows how to draw, instead of a crash or an empty plot.
		withStorage(saved(0, 99));
		expect(iglooStage()).toBe(IGLOO_LADDER.length);
		expect(myIgloo()).toEqual(IGLOO_LADDER[IGLOO_LADDER.length - 1]?.plan);
	});

	it('clamps everything else a rung count should not be', () => {
		for (const built of [-3, Number.NaN, 1.7, null]) {
			withStorage(saved(0, built as number));
			const stage = iglooStage();
			expect(Number.isInteger(stage), String(built)).toBe(true);
			expect(stage, String(built)).toBeGreaterThanOrEqual(0);
			expect(stage, String(built)).toBeLessThanOrEqual(IGLOO_LADDER.length);
		}
	});

	it('reads a blob from before this feature existed as a fresh igloo', () => {
		// A v1 save with no `igloo` in it is every save that exists today. Adding a field needed no
		// version bump precisely because this is what the absence reads as.
		withStorage(holding({ version: SAVE_VERSION, eis: 41 }));
		expect(iglooStage()).toBe(0);
		expect(buyNext().built).toBe(true);
	});
});

describe('a browser that will not hold it', () => {
	it('reads as a fresh igloo where there is no localStorage at all', () => {
		// A locked-down school tablet, squarely this audience. The point of asserting it is that a
		// missing store must not throw on the way to the first frame of a hub that wants to draw a house.
		withStorage(null);
		expect(() => myIgloo()).not.toThrow();
		expect(iglooStage()).toBe(0);
		expect(buyNext().built).toBe(false);
	});

	it('still shows the room that was just bought when the write cannot stick', () => {
		// Safari in private browsing throws on `setItem`. The child watches their igloo grow for the
		// rest of the session and loses it on reload — the same bargain a hat makes, and far better than
		// an exception at the moment they spent four wins.
		withStorage({
			...memoryStorage(),
			getItem: () => JSON.stringify({ version: SAVE_VERSION, eis: 500 }),
			setItem: () => {
				throw new DOMException('QuotaExceededError');
			}
		});
		const bought = buyNext();
		expect(bought.built).toBe(true);
		expect(bought.stage).toBe(1);
	});

	it('does not throw when the store itself is unreachable', () => {
		// Some embedded browsers throw on the property ACCESS rather than on the call.
		withStorage(() => {
			throw new DOMException('SecurityError');
		});
		expect(() => buyNext()).not.toThrow();
		expect(iglooStage()).toBe(0);
	});
});

describe('walking away from it', () => {
	const doorstep: IglooPlot = { at: { x: 24, z: -9 }, radius: 4.5 };

	it('is not left by standing on the doorstep', () => {
		expect(hasLeftTheIgloo(doorstep.at, doorstep)).toBe(false);
		expect(hasLeftTheIgloo({ x: 24 + 4, z: -9 }, doorstep)).toBe(false);
	});

	it('is left by walking clear of it', () => {
		expect(hasLeftTheIgloo({ x: 24, z: -9 + 8 }, doorstep)).toBe(true);
	});

	it('keeps a metre and a half of slack outside the mat', () => {
		// Not zero, and this is the whole reason the function exists rather than being a `>` at the call
		// site: leaving the interior changes the camera distance by half, so a boundary a shuffling thumb
		// can cross twice a second is the whole screen changing shape twice a second.
		const justOut = { x: doorstep.at.x, z: doorstep.at.z + doorstep.radius + 0.6 };
		expect(hasLeftTheIgloo(justOut, doorstep)).toBe(false);
	});
});
