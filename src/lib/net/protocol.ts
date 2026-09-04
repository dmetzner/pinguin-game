/**
 * What goes over the wire, and how many bits each field gets.
 *
 * Two kinds of message and two different reasons for their shapes. The hot pair — inputs going up
 * and snapshots coming down — is packed by hand into quantised integers, because it runs at 20 Hz
 * for the length of a round and `docs/DECISIONS/0005` costed the whole feature on roughly 20 bytes
 * per penguin. The cold ones — joining, the roster, leaving — are JSON, because they happen once
 * each and a byte saved there buys nothing.
 *
 * Every scale below is chosen against the range the simulation actually produces, and the resulting
 * TOLERANCE is exported so tests assert against the quantisation rather than against a copied
 * number. A snapshot is not lossless and nothing should pretend otherwise: what matters is that the
 * loss is smaller than a pixel at arena distance.
 */
import type { PenguinLook } from '../look';
import { resolveMode } from '../sim/modes/registry';
import type { InputFrame, Mode, RoundPhase } from '../sim/types';
import type { Snapshot } from './snapshot';

/** Positions and velocities, to the centimetre. int16 then covers ±327 m and ±327 m/s. */
const POS_SCALE = 100;
/** Heights, to the millimetre: the jump apex is 0.85 m and a centimetre of it would be visible. */
const HEIGHT_SCALE = 1000;
/** Facing and gradients. 1/10000 rad is far finer than a screen can show; int16 covers ±3.27. */
const ANGLE_SCALE = 10000;
/** The floe radius, to the millimetre. It shrinks continuously and a step in it would read as a jerk. */
const RADIUS_SCALE = 1000;
/** Stick deflection, into a single signed byte. The dead zone is larger than the resulting step. */
const MOVE_SCALE = 127;

/**
 * The worst error each field can carry, DERIVED from the scale above rather than restated.
 *
 * Half a quantum, because rounding goes to the nearest. Tests assert against these, so a scale and
 * a claim about accuracy cannot drift apart.
 */
export const POS_TOLERANCE = 0.5 / POS_SCALE;
export const HEIGHT_TOLERANCE = 0.5 / HEIGHT_SCALE;
export const ANGLE_TOLERANCE = 0.5 / ANGLE_SCALE;
export const RADIUS_TOLERANCE = 0.5 / RADIUS_SCALE;
export const MOVE_TOLERANCE = 0.5 / MOVE_SCALE;

/**
 * How many past inputs ride along with each one sent.
 *
 * A dropped input is not a dropped frame, it is a HOLE: the host has nothing to step that tick with
 * and substitutes `NO_INPUT`, so the player's penguin stops pushing for a sixtieth of a second and
 * then gets corrected back — a stutter, at the exact moment the connection is worst. Re-sending the
 * last few costs three bytes each and closes every gap shorter than four ticks.
 */
export const INPUT_BACKLOG = 4;

/**
 * How often the host broadcasts, in ticks. Three is 20 Hz.
 *
 * The number `docs/DECISIONS/0005` costed the feature on. Faster buys the client a shorter replay
 * and almost nothing a player can see — the correction is invisible when prediction is right, which
 * it is whenever the connection is working. Slower makes a remote penguin's dead reckoning carry it
 * further before it is checked, and on ice that error grows with the square of the gap.
 */
export const SNAPSHOT_EVERY_TICKS = 3;

/** Phase ordering. Written down once, because these numbers are on the wire and cannot be reordered. */
const PHASES: readonly RoundPhase[] = ['countdown', 'playing', 'over'];
const PENGUIN_PHASES = ['skating', 'falling', 'out'] as const;

const KIND_HELLO = 1;
const KIND_WELCOME = 2;
const KIND_INPUT = 3;
const KIND_SNAPSHOT = 4;
const KIND_BYE = 5;

/** A peer announcing itself. Its name comes from the generator and its look from the picker. */
export interface HelloMessage {
	kind: 'hello';
	name: string;
	look: PenguinLook;
}

/** The host closing the room: who is in it, in the order every later message indexes by. */
export interface WelcomeMessage {
	kind: 'welcome';
	seed: number;
	/** Which slot in the roster the receiver is. */
	you: number;
	roster: { id: string; name: string; look: PenguinLook }[];
	/**
	 * Which minigame the host is running, as a STRING and never an index.
	 *
	 * An index would be a number whose meaning is the order of a list in somebody else's build, and
	 * `sim/modes/registry.ts` is a list the owner intends to grow to twenty or thirty entries. A
	 * string costs a handful of bytes in the one message that is sent once per room.
	 *
	 * Optional, and `decode` resolves it through the register (`resolveMode`), so a client on an older
	 * build that meets a newer minigame DEGRADES to the default round instead of dying — and a welcome
	 * from a build that predates this field is simply a welcome with no opinion. Nothing on the wire
	 * may end somebody else's round from across the room.
	 */
	mode?: Mode;
}

/** Inputs going up, oldest first, ending at `fromTick + frames.length - 1`. */
export interface InputMessage {
	kind: 'input';
	fromTick: number;
	frames: InputFrame[];
}

export interface SnapshotMessage {
	kind: 'snapshot';
	snapshot: Snapshot;
}

export interface ByeMessage {
	kind: 'bye';
}

export type NetMessage =
	| HelloMessage
	| WelcomeMessage
	| InputMessage
	| SnapshotMessage
	| ByeMessage;

/** Clamp into a signed 16-bit range before rounding, so an absurd value truncates rather than wraps. */
function clamp(value: number, low: number, high: number): number {
	return value < low ? low : value > high ? high : value;
}

class Writer {
	private view: DataView;
	private at = 0;

	constructor(bytes: number) {
		this.view = new DataView(new ArrayBuffer(bytes));
	}

	u8(v: number) {
		this.view.setUint8(this.at, clamp(Math.round(v), 0, 255));
		this.at += 1;
	}
	i8(v: number) {
		this.view.setInt8(this.at, clamp(Math.round(v), -128, 127));
		this.at += 1;
	}
	u16(v: number) {
		this.view.setUint16(this.at, clamp(Math.round(v), 0, 65535));
		this.at += 2;
	}
	i16(v: number) {
		this.view.setInt16(this.at, clamp(Math.round(v), -32768, 32767));
		this.at += 2;
	}
	u32(v: number) {
		this.view.setUint32(this.at, clamp(Math.round(v), 0, 0xffffffff));
		this.at += 4;
	}
	done(): Uint8Array {
		return new Uint8Array(this.view.buffer, 0, this.at);
	}
}

class Reader {
	private view: DataView;
	private at = 0;

	constructor(bytes: Uint8Array) {
		this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	}

	u8(): number {
		const v = this.view.getUint8(this.at);
		this.at += 1;
		return v;
	}
	i8(): number {
		const v = this.view.getInt8(this.at);
		this.at += 1;
		return v;
	}
	u16(): number {
		const v = this.view.getUint16(this.at);
		this.at += 2;
		return v;
	}
	i16(): number {
		const v = this.view.getInt16(this.at);
		this.at += 2;
		return v;
	}
	u32(): number {
		const v = this.view.getUint32(this.at);
		this.at += 4;
		return v;
	}
}

/** Serialise anything the game sends. */
export function encode(message: NetMessage): Uint8Array {
	switch (message.kind) {
		case 'input':
			return encodeInput(message);
		case 'snapshot':
			return encodeSnapshot(message.snapshot);
		default:
			return encodeJson(message);
	}
}

/**
 * Parse anything the game receives, or `null`.
 *
 * `null` rather than a throw, and that is the important half: every byte here arrived from another
 * device over a channel this one does not control. A malformed message has to cost a dropped packet
 * and nothing more — a peer that can crash another peer's round by sending nine bytes is a worse
 * problem than any desync.
 */
export function decode(bytes: Uint8Array): NetMessage | null {
	try {
		if (bytes.length === 0) return null;
		const kind = bytes[0];
		if (kind === KIND_INPUT) return decodeInput(bytes);
		if (kind === KIND_SNAPSHOT) return decodeSnapshot(bytes);
		if (kind === KIND_HELLO || kind === KIND_WELCOME || kind === KIND_BYE) {
			return decodeJson(bytes);
		}
		return null;
	} catch {
		return null;
	}
}

function encodeJson(message: HelloMessage | WelcomeMessage | ByeMessage): Uint8Array {
	const kind =
		message.kind === 'hello' ? KIND_HELLO : message.kind === 'welcome' ? KIND_WELCOME : KIND_BYE;
	const body = new TextEncoder().encode(JSON.stringify(message));
	const out = new Uint8Array(body.length + 1);
	out[0] = kind;
	out.set(body, 1);
	return out;
}

function decodeJson(bytes: Uint8Array): NetMessage | null {
	const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes.subarray(1)));
	if (typeof parsed !== 'object' || parsed === null) return null;
	const kind = (parsed as { kind?: unknown }).kind;
	if (kind !== 'hello' && kind !== 'welcome' && kind !== 'bye') return null;
	const message = parsed as NetMessage;
	// The one field on the wire whose vocabulary can differ between two builds. Normalised HERE rather
	// than at every reader: a mode this build has never heard of becomes the default, an absent one
	// stays absent, and no caller has to remember to be careful.
	if (message.kind === 'welcome' && message.mode !== undefined) {
		message.mode = resolveMode(message.mode);
	}
	return message;
}

function encodeInput(message: InputMessage): Uint8Array {
	const frames = message.frames.slice(0, 255);
	const w = new Writer(6 + frames.length * 3);
	w.u8(KIND_INPUT);
	w.u32(message.fromTick);
	w.u8(frames.length);
	for (const f of frames) {
		w.i8(f.move.x * MOVE_SCALE);
		w.i8(f.move.z * MOVE_SCALE);
		// Three booleans in one byte. Not a saving worth chasing on its own — it is that a frame is
		// then exactly three bytes, which is what makes re-sending the backlog free.
		w.u8((f.jump ? 1 : 0) | (f.throw ? 2 : 0) | (f.dash ? 4 : 0));
	}
	return w.done();
}

function decodeInput(bytes: Uint8Array): InputMessage | null {
	const r = new Reader(bytes);
	r.u8();
	const fromTick = r.u32();
	const count = r.u8();
	const frames: InputFrame[] = [];
	for (let i = 0; i < count; i++) {
		const x = r.i8() / MOVE_SCALE;
		const z = r.i8() / MOVE_SCALE;
		const flags = r.u8();
		frames.push({
			move: { x, z },
			jump: (flags & 1) !== 0,
			throw: (flags & 2) !== 0,
			dash: (flags & 4) !== 0
		});
	}
	return { kind: 'input', fromTick, frames };
}

/** Header, then one fixed-width record per penguin and per snowball. See the note at the top. */
function encodeSnapshot(snap: Snapshot): Uint8Array {
	// 20 bytes a penguin, not 19: the flap (`airJumps`) is the twentieth. A hand-counted buffer size
	// is exactly the kind of number that goes wrong silently when a field is added — this one did,
	// and the symptom was every networking test failing with "Offset is outside the bounds of the
	// DataView" rather than anything about jumping. `protocol.test.ts` round-trips a full snapshot,
	// which is what makes the miscount loud instead of a corrupted wire message.
	const w = new Writer(23 + snap.penguins.length * 20 + snap.snowballs.length * 16);
	w.u8(KIND_SNAPSHOT);
	w.u32(snap.tick);
	w.u8(Math.max(0, PHASES.indexOf(snap.roundPhase)));
	w.u16(snap.roundTicks);
	w.i8(snap.winner);
	w.u16(snap.floeRadius * RADIUS_SCALE);
	w.i16(snap.slope.x * ANGLE_SCALE);
	w.i16(snap.slope.z * ANGLE_SCALE);
	w.i16(snap.weightSlope.x * ANGLE_SCALE);
	w.i16(snap.weightSlope.z * ANGLE_SCALE);
	w.u16(snap.nextSnowballId);

	w.u8(snap.penguins.length);
	for (const p of snap.penguins) {
		w.i16(p.pos.x * POS_SCALE);
		w.i16(p.pos.z * POS_SCALE);
		w.i16(p.vel.x * POS_SCALE);
		w.i16(p.vel.z * POS_SCALE);
		w.i16(p.height * HEIGHT_SCALE);
		w.i16(p.heightVel * POS_SCALE);
		w.i16(p.facing * ANGLE_SCALE);
		w.u8(Math.max(0, PENGUIN_PHASES.indexOf(p.phase)));
		w.u8(p.fallTicks);
		w.u8(p.stunTicks);
		w.u8(p.dashCooldown);
		w.u8(p.throwCooldown);
		// One byte for the flap. It has to be on the wire: a client predicts its own penguin and the
		// host steps it, and if they disagree about whether the second jump is still available, a
		// correction takes it away in mid-gap — which is the worst possible moment to lose it.
		w.u8(p.airJumps);
	}

	w.u8(snap.snowballs.length);
	for (const s of snap.snowballs) {
		w.u16(s.id);
		w.u8(s.owner);
		w.i16(s.pos.x * POS_SCALE);
		w.i16(s.pos.z * POS_SCALE);
		w.i16(s.vel.x * POS_SCALE);
		w.i16(s.vel.z * POS_SCALE);
		w.i16(s.height * HEIGHT_SCALE);
		w.i16(s.heightVel * POS_SCALE);
		w.u8(s.ticks);
	}
	return w.done();
}

function decodeSnapshot(bytes: Uint8Array): SnapshotMessage | null {
	const r = new Reader(bytes);
	r.u8();
	const tick = r.u32();
	const roundPhase = PHASES[r.u8()] ?? 'countdown';
	const roundTicks = r.u16();
	const winner = r.i8();
	const floeRadius = r.u16() / RADIUS_SCALE;
	const slope = { x: r.i16() / ANGLE_SCALE, z: r.i16() / ANGLE_SCALE };
	const weightSlope = { x: r.i16() / ANGLE_SCALE, z: r.i16() / ANGLE_SCALE };
	const nextSnowballId = r.u16();

	const penguinCount = r.u8();
	const penguins = [];
	for (let i = 0; i < penguinCount; i++) {
		penguins.push({
			pos: { x: r.i16() / POS_SCALE, z: r.i16() / POS_SCALE },
			vel: { x: r.i16() / POS_SCALE, z: r.i16() / POS_SCALE },
			height: r.i16() / HEIGHT_SCALE,
			heightVel: r.i16() / POS_SCALE,
			facing: r.i16() / ANGLE_SCALE,
			phase: PENGUIN_PHASES[r.u8()] ?? 'skating',
			fallTicks: r.u8(),
			stunTicks: r.u8(),
			dashCooldown: r.u8(),
			throwCooldown: r.u8(),
			airJumps: r.u8()
		});
	}

	const snowballCount = r.u8();
	const snowballs = [];
	for (let i = 0; i < snowballCount; i++) {
		snowballs.push({
			id: r.u16(),
			owner: r.u8(),
			pos: { x: r.i16() / POS_SCALE, z: r.i16() / POS_SCALE },
			vel: { x: r.i16() / POS_SCALE, z: r.i16() / POS_SCALE },
			height: r.i16() / HEIGHT_SCALE,
			heightVel: r.i16() / POS_SCALE,
			ticks: r.u8()
		});
	}

	return {
		kind: 'snapshot',
		snapshot: {
			tick,
			roundPhase,
			roundTicks,
			winner,
			floeRadius,
			slope,
			weightSlope,
			penguins,
			snowballs,
			nextSnowballId
		}
	};
}
