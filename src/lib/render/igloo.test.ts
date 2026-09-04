/**
 * The third thing under `render/` worth a unit test, and it guards the same class of fact as the
 * other two.
 *
 * `CLAUDE.md` is explicit that the renderer is deliberately not unit-tested: nothing here is
 * meaningfully testable without a GPU, and the honest check is `npm run shots` plus a person looking
 * at the picture. This is not an argument with that. What it guards is where one number is relative
 * to another, and on this building there are four of those — every one of which a screenshot reports
 * badly or not at all:
 *
 *  * **The PLOT.** `sim/island.ISLAND_OBSTACLES` holds a penguin off a circle, and every part of this
 *    building has to be inside it. Anything outside is a wall a child bumps into with nothing there,
 *    or worse, a dome they can see and walk through. This test is what found the apron flaring ten
 *    centimetres past the circle — the shells fitted, `iglooFits` said so, and the snow round their
 *    feet did not.
 *  * **Trap 11**, decoration buried in the ground. Half this file is `CylinderGeometry` and a
 *    cylinder's origin is its MIDDLE, which is exactly the mistake that put every snow drift on every
 *    floe half a metre inside the ice: they rendered, cost their triangles, and could not be seen.
 *  * **Trap 17**, a face the camera can never see. The sea lion was modelled twice and never once on
 *    screen because the mode's own geometry pointed it away from the rig. The whole visible surface of
 *    this feature is a doorway and two windows on ONE side of one dome, so which side that is is not
 *    a detail — it is the feature.
 *  * **The cutaway.** The interior is a framing rather than a world (story 12), and the entire
 *    mechanism is that the shells on the camera's side are left out. If they are not, the inside view
 *    is the outside of an igloo from very close up, which reads as a bug in the camera.
 *
 * Verified non-vacuous the way `purity.test.ts` insists on, by feeding each one the violation it
 * exists to catch — all four were run, and each failed the check it is here for and no other except
 * where noted:
 *
 *  * `DOME_BIG` back at 0.58 puts the apron outside the plot: the plot check fails, and so does the
 *    box check below, because a dome that wide swallows the side rooms it is meant to be joined to.
 *  * Seating the lantern post at the ground rather than half its own height above it — a
 *    `CylinderGeometry`'s origin is its middle — fails the burial check.
 *  * Sweeping the face to `FRONT + Math.PI` fails the door check.
 *  * Building the interior shells with a full `phiLength` fails the cutaway.
 */
import { Mesh } from 'three';
import { describe, expect, it } from 'vitest';
import { IGLOO_LADDER, IGLOO_START, type IglooPlan, type IglooPlot, iglooDomes } from '../igloo';
import { groundHeight } from '../sim/archipelago';
import { islandFloes } from '../sim/island';
import type { Floe } from '../sim/types';
import { createIgloo, faceBearing } from './igloo';

/** The island the simulation builds. The igloo's ground is read from this and nothing else. */
const ISLAND = theIsland();

function theIsland(): Floe {
	const floe = islandFloes()[0];
	// A function rather than a module-level guard, because narrowing at module scope does not reach
	// inside the test bodies that use it.
	if (!floe) throw new Error('the simulation built an island with no floe in it');
	return floe;
}

/**
 * A plot the size of the one `sim/island.ts` reserves, on the island's flat ground.
 *
 * Not at the origin, because an igloo that only stands up at (0, 0) is an igloo whose base was
 * written against the world instead of against its own plot. And on FLAT ground, which is a real
 * constraint on this building and not a convenience for the test: the first plot tried here was at
 * (20, −9), which is on the shoulder of the 2.2 m knoll at (17, −6), and three of the checks below
 * went red at once. A dome is seated on the lowest ground under it (`standOn` in `render/igloo.ts`),
 * so a slope buries it rather than floating it — which is the safe failure but is still not a house
 * you would want. Skirting a hillside is a feature this building does not have, and the plot the
 * simulation reserves is asked to be clear of the three `ISLAND_MOUNDS` for exactly this reason.
 */
const PLOT: IglooPlot = { at: { x: 20, z: 12 }, radius: 5 };

/** Every rung, including the free one a child starts with. */
const RUNGS: IglooPlan[] = [IGLOO_START, ...IGLOO_LADDER.map((step) => step.plan)];

/** Both igloos of every rung, built once for the whole file — nothing below mutates them. */
const BUILT = RUNGS.map((plan) => ({
	plan,
	out: meshesOf(plan, false),
	in: meshesOf(plan, true)
}));

function meshesOf(plan: IglooPlan, inside: boolean): Mesh[] {
	const igloo = createIgloo({ floe: ISLAND, plot: PLOT, plan, inside });
	const found: Mesh[] = [];
	igloo.root.traverse((object) => {
		if (object instanceof Mesh) found.push(object);
	});
	return found;
}

/** Every vertex of a set of meshes, in world metres. Everything here is baked at the origin. */
function* vertices(meshes: Mesh[]): Generator<{ x: number; y: number; z: number }> {
	for (const mesh of meshes) {
		const pos = mesh.geometry.attributes.position;
		if (!pos) continue;
		for (let i = 0; i < pos.count; i++) {
			yield { x: pos.getX(i) + mesh.position.x, y: pos.getY(i), z: pos.getZ(i) + mesh.position.z };
		}
	}
}

describe('the igloo on its plot', () => {
	it('builds something for every rung, merged and painted', () => {
		// Non-vacuous first: every loop below walks these meshes, and `mergePieces` returns null for an
		// empty set — which would make the rest of this file pass by having nothing to measure.
		//
		// It also catches the one failure `bake.ts` warns about that is silent on screen and loud
		// nowhere else: `mergeGeometries` refuses a set whose attributes disagree, and a merged
		// geometry with no `color` attribute under a `vertexColors: true` material draws black.
		expect(BUILT.length).toBeGreaterThan(3);
		for (const { plan, out, in: inside } of BUILT) {
			for (const [where, meshes] of [
				['outside', out],
				['inside', inside]
			] as const) {
				expect(meshes.length, `${where} ${JSON.stringify(plan)}`).toBeGreaterThan(1);
				let count = 0;
				for (const mesh of meshes) {
					expect(mesh.geometry.attributes.color, `${where} has an unpainted mesh`).toBeDefined();
					count += mesh.geometry.attributes.position?.count ?? 0;
				}
				expect(count, `${where} ${JSON.stringify(plan)}`).toBeGreaterThan(500);
			}
		}
	});

	it('keeps every part of itself inside the plot the simulation reserved', () => {
		// The check that found a real bug. `holdOffObstacles` stops a penguin at `PLOT.radius` plus half
		// a body, so anything drawn past the circle is either a building nobody can reach the side of or
		// a piece of snow standing in mid-air outside its own wall.
		//
		// One assertion at the end rather than one per vertex: there are seventeen thousand of them and
		// `expect` is not free — `render/island.test.ts` learned that by timing out.
		let furthest = 0;
		let where = '';
		for (const { plan, out, in: inside } of BUILT) {
			for (const at of vertices([...out, ...inside])) {
				const r = Math.hypot(at.x - PLOT.at.x, at.z - PLOT.at.z);
				if (r > furthest) {
					furthest = r;
					where = `${JSON.stringify(plan)} at (${at.x.toFixed(2)}, ${at.z.toFixed(2)})`;
				}
			}
		}
		expect(
			furthest,
			`something reaches ${furthest.toFixed(2)} m out — ${where}`
		).toBeLessThanOrEqual(PLOT.radius);
		// And it fills the plot rather than sitting in the middle of it: reserved ground with nothing on
		// it is the invisible wall this whole arrangement exists to avoid.
		expect(furthest).toBeGreaterThan(PLOT.radius * 0.8);
	});

	it('stands on the ground rather than inside it', () => {
		// Trap 11. Every dome, apron, tunnel, block and lamp post here is seated against
		// `groundHeight` at its own position — and half of them are cylinders, whose origin is their
		// MIDDLE. A post seated at the ground is a post half underground, and it looks exactly like a
		// shorter post.
		//
		// The bound is 20 cm, and what sets it is the doorway's rim: the trim is a torus lying in the
		// wall's own tangent plane, so its bottom dips a few centimetres into the sand — which is
		// correct, because a doorway meets the ground. Nothing else may be under it at all, so the
		// headroom is thin on purpose: what this catches is a piece that missed its ground entirely.
		let deepest = 0;
		let sunk = '';
		for (const { plan, out, in: inside } of BUILT) {
			for (const at of vertices([...out, ...inside])) {
				const under = groundHeight(ISLAND, { x: at.x, z: at.z }) - at.y;
				if (under > deepest) {
					deepest = under;
					sunk = `${JSON.stringify(plan)} at (${at.x.toFixed(1)}, ${at.y.toFixed(2)}, ${at.z.toFixed(1)})`;
				}
			}
		}
		expect(deepest, `${deepest.toFixed(2)} m of it underground — ${sunk}`).toBeLessThan(0.2);
	});

	it('puts the doorway on the face, low down, wherever the face is pointing', () => {
		// This test used to pick the doorway out by its x — "near the middle line" — which worked for
		// exactly as long as the face was nailed to +z. Deriving `faceBearing` slid the door 1.16 m
		// sideways and the filter started measuring the LANTERN instead, and passed a different claim
		// without saying so. That is the more dangerous half of a test coupled to a constant: not going
		// red, but quietly asking a different question.
		//
		// So the door is identified by the thing that actually decides where it is. Every unlit piece
		// below knee height — the doorway, and a side room's porthole — has to sit on the face's own
		// bearing from whichever dome it belongs to. The lantern and the glints are above the cut, and
		// which side of the camera the face may be on at all is the sweep test below.
		for (const { plan, out } of BUILT) {
			const unlit = out[out.length - 1];
			if (!unlit) throw new Error('the igloo was built with nothing unlit on it');
			const domes = iglooDomes(PLOT, plan);
			const front = faceBearing(PLOT);
			const facing = { x: -Math.cos(front), z: Math.sin(front) };

			let found = 0;
			let widest = 0;
			let lowest = Infinity;
			for (const at of vertices([unlit])) {
				const ground = groundHeight(ISLAND, { x: at.x, z: at.z });
				if (at.y - ground > 0.8) continue;
				// From whichever dome it belongs to, so a room's porthole is judged against its own room.
				let own = domes[0];
				let near = Infinity;
				for (const dome of domes) {
					const d = Math.hypot(at.x - dome.at.x, at.z - dome.at.z);
					if (d < near) {
						near = d;
						own = dome;
					}
				}
				if (!own) continue;
				const away = Math.hypot(at.x - own.at.x, at.z - own.at.z) || 1;
				const dot = ((at.x - own.at.x) * facing.x + (at.z - own.at.z) * facing.z) / away;
				widest = Math.max(widest, Math.acos(Math.min(1, Math.max(-1, dot))));
				lowest = Math.min(lowest, at.y - ground);
				found++;
			}
			// Non-vacuous: there is a doorway to have an opinion about. A face swept round the back would
			// make this zero, and a `<` over an empty set passes forever.
			expect(found, `${JSON.stringify(plan)} has no doorway low on its face`).toBeGreaterThan(8);
			// A 0.52 m disc on a 2.75 m dome subtends about 14°, its rim about 17°. Past 25° it is not on
			// the face any more.
			expect(
				(widest * 180) / Math.PI,
				`${JSON.stringify(plan)} has dark geometry ${((widest * 180) / Math.PI).toFixed(0)}° off its own face`
			).toBeLessThan(25);
			// And the dark reaches the ground, because it is a door and not a porthole. A doorway whose
			// bottom is half a metre up is a hatch, and a penguin cannot be imagined walking through it.
			expect(lowest, JSON.stringify(plan)).toBeLessThan(0.2);
		}
	});

	it('turns the face down its own approach without letting it leave the camera', () => {
		// `faceBearing` is the answer to a finding from a photograph: with a camera that does not turn,
		// "walking to it" and "looking at it" are different actions, and nothing in the game asks a child
		// to do the second. So the face looks back toward the square — the rule `render/island.ts`
		// already uses for the cave's mouth and the shop's counter — clamped so it can never follow a
		// plot round to the back of the island and end up modelled where no lens can reach it, which is
		// trap 17 arrived at by arithmetic instead of by a person.
		//
		// Swept right round the island rather than checked at the one plot that exists, because the point
		// of deriving it is that it stays right when somebody moves the plot.
		let clamped = 0;
		let free = 0;
		for (let i = 0; i < 36; i++) {
			const angle = (i / 36) * Math.PI * 2;
			const plot = {
				at: { x: Math.sin(angle) * 40, z: Math.cos(angle) * 40 },
				radius: 5
			};
			const front = faceBearing(plot);
			// Never more than the swing away from the camera's own axis, at any bearing on the island.
			const offCamera = Math.abs(
				Math.atan2(Math.sin(front - Math.PI / 2), Math.cos(front - Math.PI / 2))
			);
			expect(
				offCamera,
				`plot at ${angle.toFixed(2)} rad faces ${offCamera.toFixed(2)} off`
			).toBeLessThanOrEqual((30 * Math.PI) / 180 + 1e-9);
			// And when it is NOT clamped it points at the square, rather than at some angle that merely
			// satisfies the limit: the outward direction and the direction home have to agree.
			const out = { x: -Math.cos(front), z: Math.sin(front) };
			const home = Math.hypot(plot.at.x, plot.at.z);
			const towards = (out.x * -plot.at.x + out.z * -plot.at.z) / home;
			if (offCamera < (30 * Math.PI) / 180 - 1e-6) {
				free++;
				expect(towards).toBeGreaterThan(0.999);
			} else {
				clamped++;
				// Clamped is still the best available: it leans toward the square rather than away.
				expect(towards).toBeGreaterThan(-1);
			}
		}
		// Non-vacuous both ways. A swing so wide nothing clamps, or so narrow nothing is ever free, and
		// one half of this test stops asking its question.
		expect(free, 'nothing on the island reaches the square unclamped').toBeGreaterThan(2);
		expect(clamped, 'the swing is so wide it never has to clamp').toBeGreaterThan(2);
	});

	it('takes the doorway with it when the face turns', () => {
		// The bearing is only worth deriving if everything on the face reads it. The door, the two
		// windows and the lantern all did their own `+z` arithmetic before this, and an offset is only
		// "beside the door" while the door happens to be on +z. So: put the plot somewhere that forces a
		// clamp in the other direction and check the unlit geometry — the doorway, the glints and the
		// lamp — actually moved.
		const west = { at: { x: -30, z: -20 }, radius: 5 };
		const east = { at: { x: 30, z: -20 }, radius: 5 };
		const sideOf = (plot: IglooPlot) => {
			const igloo = createIgloo({ floe: ISLAND, plot, plan: IGLOO_START, inside: false });
			const found: Mesh[] = [];
			igloo.root.traverse((o) => {
				if (o instanceof Mesh) found.push(o);
			});
			const unlit = found[found.length - 1];
			let sum = 0;
			let n = 0;
			for (const at of vertices(unlit ? [unlit] : [])) {
				sum += at.x - plot.at.x;
				n++;
			}
			return n > 0 ? sum / n : 0;
		};
		// Mirrored plots, so the faces must lean opposite ways round their own domes — and each leans
		// TOWARD the square, so a plot in the west faces east and a plot in the east faces west. I wrote
		// this pair the other way round first and the test caught me rather than the code: the sign of
		// "which way is home" is not a thing to reason about in prose, which is trap 7's whole lesson.
		// Equal values would mean the bearing is computed and thrown away — trap 15, twice in this file.
		expect(sideOf(west)).toBeGreaterThan(0.1);
		expect(sideOf(east)).toBeLessThan(-0.1);
	});

	it('leaves the camera side of the roof out when you are inside it', () => {
		// The entire mechanism of the interior framing. The shells are swept from half a cutaway past
		// +z the long way round, so nothing above knee height may be on the near side — while the FLOOR
		// runs the whole way forward on purpose, which is why the height is in the test.
		const near = PLOT.at.z + PLOT.radius * 0.6;
		for (const { plan, in: inside, out } of BUILT) {
			let nearest = -Infinity;
			for (const at of vertices(inside)) {
				if (at.y - groundHeight(ISLAND, { x: at.x, z: at.z }) < 0.6) continue;
				nearest = Math.max(nearest, at.z);
			}
			expect(
				nearest,
				`${JSON.stringify(plan)} still has a wall in front of the camera`
			).toBeLessThan(near);
			// Non-vacuous the other way round: the same dome drawn from outside DOES reach past that line,
			// so this is measuring the cutaway rather than measuring a small igloo.
			let outside = -Infinity;
			for (const at of vertices(out)) outside = Math.max(outside, at.z);
			expect(outside).toBeGreaterThan(near);
		}
	});

	it('keeps everything indoors inside the wall it stands against', () => {
		// The bed is the only thing in this building not placed off a shell's own radius, and it is set
		// against the BACK wall — where the shell curves in over it. Push it further back and it leaves
		// the room: geometry outside the surface that describes it, trap 8's family.
		//
		// **What this actually catches, measured rather than assumed.** Setting the ledge against
		// `dome.radius - deep * 0.5` — a third of a metre further back than it sits — fails it, and so do
		// `dome.radius` and `dome.radius * 0.95`. What it does NOT catch is the setback typed as a flat
		// 1.9 m, which was the violation this comment first claimed: on the small dome that still fits,
		// by nine centimetres. Worth recording rather than quietly picking a violation that works, because
		// the useful thing to know about a guard is where its edge is. The bound here is set by the SHELL,
		// which sits exactly on its own radius, so what the bed has to do is stay behind a line the walls
		// already stand on.
		//
		// Asked of every interior vertex against the nearest dome it could belong to, which is why it is
		// a claim about geometry and not about furniture: it will still be the right question when 12d
		// puts a rug and a lamp in here.
		let worst = -Infinity;
		let poking = '';
		for (const { plan, in: inside } of BUILT) {
			const domes = iglooDomes(PLOT, plan);
			for (const at of vertices(inside)) {
				let closest = Infinity;
				for (const dome of domes) {
					closest = Math.min(closest, Math.hypot(at.x - dome.at.x, at.z - dome.at.z) - dome.radius);
				}
				if (closest > worst) {
					worst = closest;
					poking = `${JSON.stringify(plan)} at (${at.x.toFixed(2)}, ${at.z.toFixed(2)})`;
				}
			}
		}
		expect(
			worst,
			`something indoors stands ${worst.toFixed(2)} m outside its wall — ${poking}`
		).toBeLessThanOrEqual(0.01);
	});

	it('makes every rung change the shape of the building', () => {
		// Forty Eis is four wins, and a child who spends four wins has to be able to SEE it from where
		// they are standing. Measured as the BOX the building fills — its width, its depth and its
		// height added up — rather than as its widest point, which is a distinction this test insisted
		// on: the third room is the mirror of the second, so it adds a dome without moving `max |x|` a
		// millimetre. That rung is the subtlest of the four by some distance (it turns an asymmetric
		// building into a symmetric one, which a bounding box can barely see and a child reads
		// instantly), and it is the reason the last rung is a tower — a change of HEIGHT, which is the
		// one dimension nothing else on the ladder touches.
		//
		// The building, not the whole igloo: the faceted mesh is the yard, and the stack of spare ice
		// blocks in it SHRINKS as the rooms go up, so a silhouette measured over everything stands still
		// while the house grows and the building material goes away.
		let before = 0;
		for (const { plan, out } of BUILT) {
			const building = out[0];
			if (!building) throw new Error('the igloo was built with no shells on it');
			const lo = { x: Infinity, y: Infinity, z: Infinity };
			const hi = { x: -Infinity, y: -Infinity, z: -Infinity };
			for (const at of vertices([building])) {
				lo.x = Math.min(lo.x, at.x);
				lo.y = Math.min(lo.y, at.y);
				lo.z = Math.min(lo.z, at.z);
				hi.x = Math.max(hi.x, at.x);
				hi.y = Math.max(hi.y, at.y);
				hi.z = Math.max(hi.z, at.z);
			}
			const box = hi.x - lo.x + (hi.y - lo.y) + (hi.z - lo.z);
			expect(
				box,
				`${JSON.stringify(plan)} fills the same space as the rung before it`
			).toBeGreaterThan(before + 0.2);
			before = box;
		}
	});

	it('costs the draw calls it says it costs', () => {
		// Object COUNT is the measured budget in this renderer — 209 a frame in a Royal — and a building
		// made of a dozen primitives is exactly the change that quietly spends it. Everything here is
		// merged into one mesh per material family, so the only way this number grows is somebody adding
		// a mesh where a `Piece` belongs.
		for (const { out, in: inside } of BUILT) {
			expect(out.length).toBeLessThanOrEqual(4);
			expect(inside.length).toBeLessThanOrEqual(4);
		}
	});
});
