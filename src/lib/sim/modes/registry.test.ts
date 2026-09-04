import { describe, expect, it } from 'vitest';
import { decode, encode } from '../../net/protocol';
import { TICK_RATE } from '../constants';
import { step } from '../step';
import { createWorld } from '../world';
import {
	ALL_MODES,
	CLASSIC,
	DEFAULT_MODE,
	ISLAND,
	isModeId,
	MODE_CYCLE,
	modeFor,
	nextMode,
	ROYAL,
	resolveMode,
	SLIDE
} from './registry';

/**
 * The register itself: that it is complete, that it degrades rather than throws, and that every
 * descriptor on it actually builds a world that ticks.
 *
 * The last one is the part that pays for itself. It is written against `ALL_MODES` rather than against
 * five named modes, so the twenty-sixth minigame inherits a smoke test the day it is registered —
 * which is the only kind of coverage that survives a list this long.
 */

describe('the register', () => {
	it('holds every mode under its own id', () => {
		// Totality over `Mode` is the compiler's job (`MODES` is a `Record<Mode, GameMode>`). What a test
		// can catch is a descriptor filed under somebody else's key, which is a copy-paste away and
		// would silently give one mode another's rules.
		expect(ALL_MODES.length).toBeGreaterThanOrEqual(5);
		for (const mode of ALL_MODES) expect(modeFor(mode.id)).toBe(mode);
		expect(new Set(ALL_MODES.map((m) => m.id)).size).toBe(ALL_MODES.length);
	});

	it('gives every mode a name a child could read off a button', () => {
		// German, from the same curated discipline as `names.ts`, and DISTINCT — two modes called the
		// same thing is a switch button that appears not to work.
		const names = ALL_MODES.map((m) => m.name);
		for (const name of names) expect(name.length).toBeGreaterThan(2);
		expect(new Set(names).size).toBe(names.length);
	});

	it('states a player count that contains itself', () => {
		// A `solo` outside `min..max` would be a mode whose own single-player round it says is invalid.
		for (const mode of ALL_MODES) {
			expect(mode.players.min, mode.id).toBeGreaterThanOrEqual(1);
			expect(mode.players.solo, mode.id).toBeGreaterThanOrEqual(mode.players.min);
			expect(mode.players.solo, mode.id).toBeLessThanOrEqual(mode.players.max);
		}
	});

	it('only lets a mode with no arena to fit claim portrait', () => {
		// Story 11: the arena-fit camera is what makes portrait unshippable, because the camera frames
		// the whole arena and a tall screen pushes it back until a penguin is 4% of the screen. A mode
		// claiming both would be claiming the thing that cannot be claimed.
		for (const mode of ALL_MODES) {
			if (mode.framing === 'arena') expect(mode.portrait, mode.id).toBe(false);
		}
		expect(ISLAND.portrait).toBe(true);
	});
});

describe('anything that arrives from outside', () => {
	it('degrades an unknown mode instead of throwing', () => {
		// Every one of these is a real source: a preference written by an older build (this key held a
		// BOOLEAN before there were three modes), a query string typed by a child, and a room hosted by
		// a build that shipped after this one.
		expect(resolveMode('kartrennen')).toBe(DEFAULT_MODE);
		expect(resolveMode(undefined)).toBe(DEFAULT_MODE);
		expect(resolveMode(null)).toBe(DEFAULT_MODE);
		expect(resolveMode(true)).toBe(DEFAULT_MODE);
		expect(resolveMode(2)).toBe(DEFAULT_MODE);
		expect(resolveMode({ id: 'royal' })).toBe(DEFAULT_MODE);
	});

	it('keeps a mode it does know', () => {
		for (const mode of ALL_MODES) expect(resolveMode(mode.id)).toBe(mode.id);
	});

	it('does not mistake a prototype member for a mode', () => {
		// `Object.hasOwn` rather than `in`, because `'constructor' in MODES` is true and would resolve to
		// a `GameMode` that is a function.
		expect(isModeId('constructor')).toBe(false);
		expect(isModeId('toString')).toBe(false);
	});
});

describe('the mode the button offers next', () => {
	it('runs round the cycle and comes back', () => {
		let at = MODE_CYCLE[0] ?? DEFAULT_MODE;
		const seen = [at];
		for (let i = 1; i < MODE_CYCLE.length; i++) {
			at = nextMode(at);
			seen.push(at);
		}
		expect(seen).toEqual([...MODE_CYCLE]);
		// And closes: pressing it once more is where you started, or the cycle is a dead end whose last
		// mode a child can never leave.
		expect(nextMode(at)).toBe(MODE_CYCLE[0]);
	});

	it('leaves the island off the cycle', () => {
		// It is the place the games are reached FROM. Offering it as a fifth thing to press past would be
		// the menu the cycle exists to avoid — and an island round with no renderer is not a round.
		expect(MODE_CYCLE).not.toContain(ISLAND.id);
		expect(nextMode(ISLAND.id)).toBe(DEFAULT_MODE);
	});
});

describe('every registered mode builds a world that ticks', () => {
	// One test for all of them, so a new minigame cannot be registered without at least this much
	// proof. Four seconds is past the countdown (`COUNTDOWN_TICKS` is two) and into real play, which is
	// where a missing `open` or an empty `floes` shows up.
	it.each(ALL_MODES.map((mode) => [mode.id, mode] as const))('%s', (_id, mode) => {
		const ids = Array.from({ length: mode.players.solo }, (_, i) => `p${i}`);
		const world = createWorld(ids, 4242, mode.id);

		expect(world.floes.length).toBeGreaterThanOrEqual(1);
		expect(world.penguins).toHaveLength(ids.length);
		expect(world.round.phase).toBe(mode.opening);
		// Everybody starts on ice. A spawn that puts a penguin over water drowns it before the player
		// has touched the screen, and it reads as the mode being broken rather than the spawn.
		for (const p of world.penguins) expect(p.phase).toBe('skating');

		for (let i = 0; i < TICK_RATE * 4; i++) step(world, new Map());
		expect(world.tick).toBe(TICK_RATE * 4);
	});
});

describe('when the controls wake up', () => {
	// Pins `opensAfter` to the machine that reads it. A field the phase machine ignored would be a
	// gondola ride the simulation ends three seconds in, with the picture still going — and nothing
	// else in the suite would notice.
	it.each(ALL_MODES.map((mode) => [mode.id, mode] as const))('%s', (_id, mode) => {
		const ids = Array.from({ length: Math.max(2, mode.players.min) }, (_, i) => `p${i}`);
		const world = createWorld(ids, 12, mode.id);
		if (mode.opening !== 'countdown') {
			// Nothing counts down to a place: it is live from the first tick.
			expect(world.round.phase, mode.id).toBe('playing');
			step(world, new Map());
			expect(world.round.phase, mode.id).toBe('playing');
			return;
		}

		expect(mode.opensAfter, mode.id).toBeGreaterThan(0);
		// One tick short: still asleep. This half is what catches an off-by-one that would give every
		// mode in the game a countdown one tick shorter than it says.
		for (let i = 0; i < mode.opensAfter - 1; i++) step(world, new Map());
		expect(world.round.phase, `${mode.id} woke up early`).toBe('countdown');
		step(world, new Map());
		expect(world.round.phase, `${mode.id} did not wake up on time`).toBe('playing');
		// And the grace clock starts HERE, not when the world was built — which is why lengthening a
		// countdown cannot move when anybody may be hit. See `GameMode.opensAfter`.
		expect(world.round.ticks, mode.id).toBe(0);
	});
});

describe('a round ends and a place does not', () => {
	// `isRound` is a field rather than `opening === 'playing'` read sideways, and this is what stops the
	// two from drifting apart without welding them together: it pins the CONSEQUENCE — a round can
	// finish, a place cannot — rather than asserting the phase, so a future mode is free to be a place
	// with a countdown or a round without one and only has to change this test on purpose.
	it.each(ALL_MODES.map((mode) => [mode.id, mode] as const))('%s', (_id, mode) => {
		const ids = Array.from({ length: Math.max(2, mode.players.min) }, (_, i) => `p${i}`);
		const world = createWorld(ids, 9, mode.id);
		// The strongest case there is: everybody is out of the water's way for good. Anything that can
		// end has to end here, and anything that cannot must still be going.
		world.round.phase = 'playing';
		for (const p of world.penguins) p.phase = 'out';

		if (mode.isRound) expect(mode.ends(world), mode.id).not.toBeNull();
		else expect(mode.ends(world), mode.id).toBeNull();
	});
});

describe('the rules each mode actually declares', () => {
	it('forbids fighting where fighting was the bug', () => {
		// The slide: with the shove live, half the field was in the sea within a second of the opening
		// grace lifting. The island: a hub is not a fight.
		const mountain = createWorld(['a', 'b'], 7, SLIDE.id);
		const hub = createWorld(['a', 'b'], 7, ISLAND.id);
		for (let i = 0; i < TICK_RATE * 8; i++) {
			step(mountain, new Map());
			step(hub, new Map());
			expect(SLIDE.attackStrength(mountain)).toBe(0);
			expect(ISLAND.attackStrength(hub)).toBe(0);
		}
	});

	it('ramps the classic protection up rather than switching it on', () => {
		// A rule that flips at one tick is a rule a client running LEAD_TICKS ahead disagrees with, and
		// an 8 m/s shove is a big thing to disagree about: `session.test.ts` measured 0.69 m of
		// correction and refused it. So there has to be a tick where it is strictly between 0 and 1.
		const world = createWorld(['a', 'b', 'c'], 11, CLASSIC.id);
		const seen = new Set<number>();
		for (let i = 0; i < TICK_RATE * 6; i++) {
			step(world, new Map());
			seen.add(CLASSIC.attackStrength(world));
		}
		expect([...seen].some((s) => s > 0 && s < 1)).toBe(true);
	});

	it('gives a Royal the longer backstop, because its own clock is longer', () => {
		// Asserted against the two descriptors rather than against two copied tick counts: a Royal's
		// sinking ring takes about a hundred seconds, so a draw called on the classic backstop would be
		// a draw called before the mode had finished happening.
		expect(ROYAL.ends).not.toBe(CLASSIC.ends);
		const royal = createWorld(['a', 'b'], 3, ROYAL.id);
		royal.round.phase = 'playing';
		royal.round.ticks = 6000;
		const classic = createWorld(['a', 'b'], 3, CLASSIC.id);
		classic.round.phase = 'playing';
		classic.round.ticks = 6000;
		// Both worlds still have two penguins standing, so the only thing that can end either is the
		// backstop. At the classic one, exactly one of them is out of time.
		expect(CLASSIC.ends(classic)).toEqual({ winner: null });
		expect(ROYAL.ends(royal)).toBeNull();
	});
});

describe('the mode on the wire', () => {
	it('travels as a string and comes back as the same mode', () => {
		const sent = encode({ kind: 'welcome', seed: 9, you: 0, roster: [], mode: 'chase' });
		const back = decode(sent);
		expect(back?.kind).toBe('welcome');
		expect(back?.kind === 'welcome' && back.mode).toBe('chase');
	});

	it('degrades a minigame this build has never heard of', () => {
		// A client on an older build meeting a newer mode has to play SOMETHING, and `decode` must never
		// throw on bytes from another device — a peer that can end somebody else's round by sending nine
		// bytes is a worse problem than any desync.
		const bytes = new TextEncoder().encode(
			JSON.stringify({ kind: 'welcome', seed: 9, you: 0, roster: [], mode: 'kartrennen' })
		);
		const framed = new Uint8Array(bytes.length + 1);
		framed[0] = 2;
		framed.set(bytes, 1);

		const back = decode(framed);
		expect(back?.kind).toBe('welcome');
		expect(back?.kind === 'welcome' && back.mode).toBe(DEFAULT_MODE);
	});

	it('leaves a welcome that never mentioned a mode alone', () => {
		// A room hosted by a build that predates the field has no opinion, and inventing one for it
		// would be this build deciding what somebody else's host is running.
		const back = decode(encode({ kind: 'welcome', seed: 9, you: 0, roster: [] }));
		expect(back?.kind === 'welcome' && back.mode).toBeUndefined();
	});
});
