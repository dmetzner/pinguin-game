/**
 * Vector helpers for the XZ plane.
 *
 * Every function here RETURNS A NEW OBJECT and mutates nothing. The allocation is deliberate: the
 * step function runs sixty times a second over at most six penguins, which is nowhere near a budget
 * worth trading clarity for, and the alternative — scratch vectors reused across calls — is the
 * classic source of "the value changed under me two frames later" bugs in exactly this kind of code.
 * If a profile ever says otherwise, the place to fix it is `step.ts`, not here.
 */
import type { Vec2 } from './types';

export function vec(x: number, z: number): Vec2 {
	return { x, z };
}

export const ZERO: Readonly<Vec2> = Object.freeze({ x: 0, z: 0 });

export function add(a: Vec2, b: Vec2): Vec2 {
	return { x: a.x + b.x, z: a.z + b.z };
}

export function sub(a: Vec2, b: Vec2): Vec2 {
	return { x: a.x - b.x, z: a.z - b.z };
}

export function scale(a: Vec2, k: number): Vec2 {
	return { x: a.x * k, z: a.z * k };
}

export function length(a: Vec2): number {
	return Math.hypot(a.x, a.z);
}

/**
 * Unit vector, or the zero vector if there is no direction to speak of.
 *
 * The zero fallback rather than a NaN is load-bearing in combat: two penguins can be exactly
 * co-located after a simultaneous stomp, and a NaN velocity propagates silently into a position and
 * then into every collision test that penguin is part of for the rest of the round.
 */
export function normalize(a: Vec2): Vec2 {
	const len = Math.hypot(a.x, a.z);
	return len > 1e-9 ? { x: a.x / len, z: a.z / len } : { x: 0, z: 0 };
}

/** Shorten `a` to at most `max`, leaving anything shorter untouched. */
export function clampLength(a: Vec2, max: number): Vec2 {
	const len = Math.hypot(a.x, a.z);
	if (len <= max || len < 1e-9) return { x: a.x, z: a.z };
	return { x: (a.x / len) * max, z: (a.z / len) * max };
}

/**
 * The heading `a` points in, radians, measured so that 0 is +Z and the angle grows toward +X.
 *
 * That convention rather than the usual `atan2(z, x)` because it matches Three.js's `rotation.y`
 * directly, which means the renderer assigns this number and does no conversion — and a conversion
 * that exists in one place is a conversion someone will forget in the second place.
 */
export function heading(a: Vec2): number {
	return Math.atan2(a.x, a.z);
}

/**
 * The unit vector pointing along `angle`. The exact inverse of `heading`.
 *
 * It exists because the sin/cos ORDER is the only place that convention is written down, and
 * swapping the pair is silent — a dash that goes 90° off, an aim cone that points sideways. It was
 * hand-written in four places before this helper, three of them added by one commit.
 */
export function fromHeading(angle: number): Vec2 {
	return { x: Math.sin(angle), z: Math.cos(angle) };
}

/**
 * Dot product. Positive when two vectors broadly agree, zero at a right angle.
 *
 * For unit vectors it is the cosine of the angle between them, which is how the aim cone tests
 * "is this in front of me" without a trigonometric call.
 */
export function dot(a: Vec2, b: Vec2): number {
	return a.x * b.x + a.z * b.z;
}

/**
 * Squared distance between two points.
 *
 * For radius comparisons, which is all this game does with distance in its hot paths. Comparing
 * against a squared radius avoids a square root per pair per tick, and `Math.hypot` is a
 * particularly expensive one — it is variadic and does overflow scaling, measured at 14× a plain
 * `Math.sqrt`.
 */
export function distance(a: Vec2, b: Vec2): number {
	return Math.sqrt(distanceSq(a, b));
}

export function distanceSq(a: Vec2, b: Vec2): number {
	const dx = a.x - b.x;
	const dz = a.z - b.z;
	return dx * dx + dz * dz;
}
