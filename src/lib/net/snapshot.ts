/**
 * The host's view of the world, as a thing that can be sent and applied.
 *
 * Host-authoritative multiplayer (`docs/DECISIONS/0005`) means exactly one peer's `World` is real
 * and everyone else's is a copy that keeps being corrected. This module is that copy operation, and
 * it is deliberately a PLAIN OBJECT step rather than a direct world-to-bytes path: the wire format
 * in `protocol.ts` quantises, and mixing "what is in a snapshot" with "how many bits each field
 * gets" makes both harder to change and neither easy to test.
 *
 * Penguins are identified by their INDEX here, not by their id. That is what makes the numbers in
 * `docs/DECISIONS/0005` work — an id is ten-odd bytes against seventeen for a whole penguin — and it
 * is safe because the roster is fixed when the room closes and never reordered afterwards.
 */
import { mainFloe } from '../sim/archipelago';
import type { Penguin, RoundPhase, Snowball, Vec2, World } from '../sim/types';

/** One penguin, flattened. Everything `step` needs to carry on from here, and nothing else. */
export interface PenguinState {
	pos: Vec2;
	vel: Vec2;
	height: number;
	heightVel: number;
	facing: number;
	phase: Penguin['phase'];
	fallTicks: number;
	stunTicks: number;
	dashCooldown: number;
	throwCooldown: number;
	/** Mid-air jumps left. See `Penguin.airJumps` — a client and the host must agree about the flap. */
	airJumps: number;
}

export interface SnowballState {
	id: number;
	/** Index into the roster, not an id — see the note at the top of this file. */
	owner: number;
	pos: Vec2;
	vel: Vec2;
	height: number;
	heightVel: number;
	ticks: number;
}

export interface Snapshot {
	tick: number;
	roundPhase: RoundPhase;
	roundTicks: number;
	/** Index of the winner, or -1 for a draw or for a round that has not finished. */
	winner: number;
	floeRadius: number;
	slope: Vec2;
	weightSlope: Vec2;
	penguins: PenguinState[];
	snowballs: SnowballState[];
	nextSnowballId: number;
}

/** Everything the host knows, in roster order. */
export function capture(world: World): Snapshot {
	const index = new Map(world.penguins.map((p, i) => [p.id, i]));
	return {
		tick: world.tick,
		roundPhase: world.round.phase,
		roundTicks: world.round.ticks,
		winner: world.round.winner === null ? -1 : (index.get(world.round.winner) ?? -1),
		// The floe everybody is on. A room plays the CLASSIC round — one floe — and a Royal is solo
		// for now (`backlog/stories/06-pingu-royal.md`); sending an archipelago over the wire is that
		// story's networking slice, and it is a wire-format change rather than an extra field.
		floeRadius: mainFloe(world).radius,
		slope: mainFloe(world).slope,
		weightSlope: mainFloe(world).weightSlope,
		penguins: world.penguins.map((p) => ({
			pos: p.pos,
			vel: p.vel,
			height: p.height,
			heightVel: p.heightVel,
			facing: p.facing,
			phase: p.phase,
			fallTicks: p.fallTicks,
			stunTicks: p.stunTicks,
			dashCooldown: p.dashCooldown,
			throwCooldown: p.throwCooldown,
			airJumps: p.airJumps
		})),
		snowballs: world.snowballs.map((s) => ({
			id: s.id,
			owner: index.get(s.owner) ?? 0,
			pos: s.pos,
			vel: s.vel,
			height: s.height,
			heightVel: s.heightVel,
			ticks: s.ticks
		})),
		nextSnowballId: world.nextSnowballId
	};
}

/**
 * Overwrite a world with what the host says, in place.
 *
 * In place, and the world keeps its own `penguins` array and its own `id` strings: a client's roster
 * was agreed when it joined, and a snapshot that could rename or reorder players would be a way for
 * one peer to reshape another's game. The snapshot carries state, never identity.
 *
 * A penguin the snapshot does not mention is left alone rather than removed. That is the honest
 * behaviour for a truncated or malformed message — a stale penguin is corrected by the next
 * snapshot, where an emptied roster is a game that has visibly fallen apart.
 */
export function apply(world: World, snap: Snapshot): void {
	world.tick = snap.tick;
	world.round.phase = snap.roundPhase;
	world.round.ticks = snap.roundTicks;
	world.round.winner = snap.winner < 0 ? null : (world.penguins[snap.winner]?.id ?? null);
	const floe = mainFloe(world);
	floe.radius = snap.floeRadius;
	floe.slope = snap.slope;
	floe.weightSlope = snap.weightSlope;

	for (const [i, state] of snap.penguins.entries()) {
		const p = world.penguins[i];
		if (!p) continue;
		p.pos = state.pos;
		p.vel = state.vel;
		p.height = state.height;
		p.heightVel = state.heightVel;
		p.facing = state.facing;
		p.phase = state.phase;
		p.fallTicks = state.fallTicks;
		p.stunTicks = state.stunTicks;
		p.dashCooldown = state.dashCooldown;
		p.throwCooldown = state.throwCooldown;
		p.airJumps = state.airJumps;
	}

	// Snowballs are rebuilt rather than reconciled: there are at most eight, they carry no state a
	// client can have opinions about, and matching them up by id would be more code than the array.
	world.snowballs = snap.snowballs.map(
		(s): Snowball => ({
			id: s.id,
			owner: world.penguins[s.owner]?.id ?? '',
			pos: s.pos,
			vel: s.vel,
			height: s.height,
			heightVel: s.heightVel,
			ticks: s.ticks
		})
	);
	world.nextSnowballId = snap.nextSnowballId;
}
