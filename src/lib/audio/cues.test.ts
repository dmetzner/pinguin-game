import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TALK_RANGE, TALK_RANGE_EXIT } from '../npc/talk';
import { mainFloe } from '../sim/archipelago';
import {
	COUNTDOWN_TICKS,
	DASH_TICKS,
	JUMP_APEX,
	ROUND_GRACE_FADE_TICKS,
	ROUND_GRACE_TICKS,
	THROW_COOLDOWN_TICKS,
	TICK_RATE
} from '../sim/constants';
import { ISLAND_RADIUS, ISLAND_ZONES } from '../sim/island';
import { step } from '../sim/step';
import type { InputFrame, World } from '../sim/types';
import { createWorld } from '../sim/world';
import {
	BEACH_FROM,
	createCueWatcher,
	EARSHOT,
	FOOTFALL_METRES,
	SCRAPE_METRES,
	SLED_SPEED
} from './cues';

const PLAY: InputFrame = { move: { x: 0, z: 0 }, jump: false, throw: false, dash: false };

/** A world already past the countdown, so a test is not waiting two seconds for it. */
function playing(ids: string[] = ['me', 'you']): World {
	const world = createWorld(ids, 31);
	world.round.phase = 'playing';
	// Past the opening grace and its fade: for the first three seconds of a round nothing may hit anybody, so a
	// throw is refused and there is no sound to hear (`round.attacksAllowed`).
	world.round.ticks = ROUND_GRACE_TICKS + ROUND_GRACE_FADE_TICKS;
	return world;
}

/** Run `ticks`, collecting everything the watcher reports. */
function listen(world: World, ticks: number, inputs: (t: number) => Map<string, InputFrame>) {
	const watcher = createCueWatcher();
	watcher.poll(world, 'me');
	const heard: string[] = [];
	for (let t = 0; t < ticks; t++) {
		step(world, inputs(t));
		heard.push(...watcher.poll(world, 'me'));
	}
	return heard;
}

describe('hearing what happened', () => {
	it('says nothing on the first look', () => {
		// Otherwise every penguin appears to have just started doing whatever it is already doing —
		// and a watcher built mid-round, which is what a client joining a room in progress is, would
		// announce a whistle it never heard.
		const watcher = createCueWatcher();
		expect(watcher.poll(playing(), 'me')).toEqual([]);
	});

	it('is silent while nothing happens', () => {
		const heard = listen(playing(), 120, () => new Map([['me', PLAY]]));
		expect(heard).toEqual([]);
	});

	it('hears a jump exactly once', () => {
		// Once, not once per airborne tick. `JUMP_AIRTIME` is nearly a second, which at 60 Hz would
		// be forty-five copies of the same blip.
		const world = playing();
		let apex = 0;
		const heard = listen(world, 90, (t) => {
			apex = Math.max(apex, world.penguins.find((p) => p.id === 'me')?.height ?? 0);
			return new Map([['me', { ...PLAY, jump: t === 0 }]]);
		});
		expect(heard.filter((c) => c === 'jump')).toHaveLength(1);
		// Non-vacuous: a take-off that never left the ice would make "exactly once" pass by hearing
		// nothing at all.
		expect(apex).toBeGreaterThan(JUMP_APEX * 0.9);
	});

	it('hears a throw and a shove', () => {
		const world = playing();
		const heard = listen(
			world,
			THROW_COOLDOWN_TICKS + DASH_TICKS + 10,
			(t) => new Map([['me', { ...PLAY, throw: t === 0, dash: t === 5 }]])
		);
		expect(heard).toContain('throw');
		expect(heard).toContain('dash');
	});

	it('hears a hit landed on somebody already stunned', () => {
		// The moment a player most wants to hear, and the one a naive "was it zero, is it now above
		// zero" check misses entirely.
		const world = playing();
		const you = world.penguins.find((p) => p.id === 'you');
		if (!you) throw new Error('roster');
		const watcher = createCueWatcher();
		watcher.poll(world, 'me');

		you.stunTicks = 40;
		step(world, new Map());
		expect(watcher.poll(world, 'me')).toContain('hit');

		you.stunTicks = 70;
		step(world, new Map());
		expect(watcher.poll(world, 'me')).toContain('hit');
	});

	it('hears a splash when somebody crosses the rim', () => {
		const world = playing();
		const you = world.penguins.find((p) => p.id === 'you');
		if (!you) throw new Error('roster');
		you.pos = { x: mainFloe(world).radius * 2, z: 0 };
		const heard = listen(world, 5, () => new Map());
		expect(heard.filter((c) => c === 'splash')).toHaveLength(1);
	});

	it('collapses a scrum into one thud per tick', () => {
		// Three hits landing together is a click, not three thuds — the samples overlap inside a few
		// milliseconds and cancel into a spike.
		const world = playing(['me', 'a', 'b', 'c']);
		const watcher = createCueWatcher();
		watcher.poll(world, 'me');
		for (const p of world.penguins) p.stunTicks = 30;
		step(world, new Map());
		expect(watcher.poll(world, 'me').filter((c) => c === 'hit')).toHaveLength(1);
	});
});

describe('the sea lion', () => {
	it('growls once when it gets close, not once a tick', () => {
		// The danger in a chase is behind the player and the camera looks forward, so this is the only
		// thing that tells a child sprinting for the next platform that they are about to be eaten.
		// Once per approach: the latch is what stops a player running level with the threshold from
		// setting off a chainsaw.
		const world = createWorld(['me', 'you', 'them'], 31, 'chase');
		world.round.phase = 'playing';
		const heard = listen(world, 12 * 60, () => new Map());
		expect(heard.filter((cue) => cue === 'growl')).toHaveLength(1);
		// And it keeps breathing. The growl is the news, once; a chase whose news is ten seconds old
		// sounds like nothing is behind you, which is the opposite of what the mode is.
		expect(heard.filter((cue) => cue === 'huff').length).toBeGreaterThan(1);
	});

	it('says nothing in a mode with no sea lion in it', () => {
		// Non-vacuousness for the test above: `hunterAt` is zero in every other mode, and a growl
		// derived from it without checking the mode would fire on the first tick of a classic round.
		const heard = listen(playing(), 6 * 60, () => new Map());
		expect(heard).not.toContain('growl');
	});
});

describe('how far away a noise is worth making', () => {
	// The Royal fix. Thirty penguins across 78 m of sea, announced into one speaker with no distance
	// in it, was a wall of blips belonging to penguins nobody could see.
	const stunAt = (metres: number): readonly string[] => {
		const world = playing(['me', 'you']);
		const you = world.penguins.find((p) => p.id === 'you');
		const me = world.penguins.find((p) => p.id === 'me');
		if (!you || !me) throw new Error('roster');
		me.pos = { x: 0, z: 0 };
		you.pos = { x: metres, z: 0 };
		const watcher = createCueWatcher();
		watcher.poll(world, 'me');
		you.stunTicks = 40;
		you.pos = { x: metres, z: 0 };
		step(world, new Map());
		return watcher.poll(world, 'me');
	};

	it('says nothing about a fight on the far side of the sea', () => {
		expect(stunAt(EARSHOT * 2)).not.toContain('hit');
	});

	it('and says everything about the one next to you', () => {
		// The other half of the pair: without this, a gate that silenced EVERYTHING would pass the
		// test above for ever.
		expect(stunAt(2)).toContain('hit');
	});
});

describe('landing', () => {
	it('hears the feet come back down, once per jump', () => {
		// The squash on landing is on the art direction's short list of what makes these games feel
		// the way they do, and it was drawn with nothing under it.
		const world = playing();
		const heard = listen(world, 90, (t) => new Map([['me', { ...PLAY, jump: t === 0 }]]));
		expect(heard.filter((c) => c === 'jump')).toHaveLength(1);
		expect(heard.filter((c) => c === 'land')).toHaveLength(1);
	});
});

describe('walking about on the island', () => {
	/** A hub, already being roamed, with the local penguin put somewhere on purpose. */
	function island(at: { x: number; z: number }): World {
		const world = createWorld(['me', 'you'], 31, 'island');
		const me = world.penguins.find((p) => p.id === 'me');
		if (!me) throw new Error('roster');
		me.pos = at;
		return world;
	}

	/** Walk for `ticks` in one direction, and report both what was heard and how far it got. */
	function walk(world: World, ticks: number, move: { x: number; z: number }) {
		const me = world.penguins.find((p) => p.id === 'me');
		if (!me) throw new Error('roster');
		const from = { ...me.pos };
		const heard = listen(world, ticks, () => new Map([['me', { ...PLAY, move }]]));
		const went = Math.hypot(me.pos.x - from.x, me.pos.z - from.z);
		return { heard, went };
	}

	it('takes about one step per stride walked, not per tick', () => {
		// Asserted against the distance actually covered rather than against a step count copied out
		// of the constant: a footstep is a thing that happens per metre, so a change to how fast a
		// penguin walks may not change how many footsteps a metre costs.
		const { heard, went } = walk(island({ x: 6, z: 20 }), 120, { x: 0, z: -1 });
		const steps = heard.filter((c) => c === 'stepGrass').length;
		expect(went).toBeGreaterThan(4);
		expect(steps).toBeGreaterThanOrEqual(Math.floor(went / FOOTFALL_METRES) - 1);
		expect(steps).toBeLessThanOrEqual(Math.ceil(went / FOOTFALL_METRES) + 1);
	});

	it('is silent underfoot while standing still', () => {
		// A penguin that is not moving is not walking, however long it stands there. This is what a
		// tick-driven footstep gets wrong, and it is the same reason the renderer drives the gait by
		// distance.
		const { heard } = walk(island({ x: 6, z: 20 }), 180, { x: 0, z: 0 });
		expect(heard.filter((c) => c.startsWith('step'))).toEqual([]);
	});

	it('sounds like sand at the water and like grass inland', () => {
		// Walking ALONG the shore rather than into it: the beach is the last few metres and the
		// simulation holds a penguin at the top of it, so pushing outward would spend the whole test
		// pressed against the clamp.
		const shore = walk(island({ x: ISLAND_RADIUS * 0.95, z: 0 }), 120, { x: 0, z: 1 });
		expect(shore.heard).toContain('stepSand');
		expect(shore.heard).not.toContain('stepGrass');

		const inland = walk(island({ x: 6, z: 20 }), 120, { x: 0, z: -1 });
		expect(inland.heard).toContain('stepGrass');
		expect(inland.heard).not.toContain('stepSand');

		// Non-vacuous: the two positions have to actually straddle the line the renderer draws the
		// sand at, or this test is two names for the same ground.
		expect(ISLAND_RADIUS * 0.95).toBeGreaterThan(ISLAND_RADIUS * BEACH_FROM);
		expect(Math.hypot(6, 20)).toBeLessThan(ISLAND_RADIUS * BEACH_FROM);
	});

	/** Walk from the open island into one named zone, and report what was heard on arrival. */
	function walkInto(id: string) {
		const world = island({ x: 0, z: -20 });
		const me = world.penguins.find((p) => p.id === 'me');
		if (!me) throw new Error('roster');
		const zone = ISLAND_ZONES.find((z) => z.id === id);
		if (!zone) throw new Error(`no ${id} on the island`);
		const watcher = createCueWatcher();
		watcher.poll(world, 'me');
		me.pos = { x: zone.at.x, z: zone.at.z };
		step(world, new Map());
		const arriving = watcher.poll(world, 'me');
		step(world, new Map());
		return { arriving, standing: watcher.poll(world, 'me') };
	}

	it('says something when the player walks into a door, once', () => {
		// A door is a PLACE, not a trigger (`sim/island.ts`), so this is the id changing — and
		// standing in it afterwards is not an event, however long the child stands there reading the
		// prompt.
		const { arriving, standing } = walkInto('mountain');
		expect(arriving).toContain('door');
		expect(standing).not.toContain('door');
	});

	it('greets the penguin who is about to say something, once', () => {
		// The bubble opens because somebody is within `TALK_RANGE` of you (`npc/talk.ts`); this is the
		// noise under it. Latched the same way the door is, because standing next to somebody is not an
		// event that keeps happening.
		const world = island({ x: 6, z: 20 });
		const me = world.penguins.find((p) => p.id === 'me');
		const you = world.penguins.find((p) => p.id === 'you');
		if (!me || !you) throw new Error('roster');
		you.pos = { x: 30, z: 20 };
		const watcher = createCueWatcher();
		watcher.poll(world, 'me');

		you.pos = { x: me.pos.x + TALK_RANGE * 0.5, z: me.pos.z };
		step(world, new Map());
		expect(watcher.poll(world, 'me')).toContain('greet');

		step(world, new Map());
		expect(watcher.poll(world, 'me')).not.toContain('greet');

		// And nothing at all from the far side of the square, which is the non-vacuous half: a greeting
		// that fired at any distance would be eight penguins saying hello at once.
		you.pos = { x: 30, z: 20 };
		step(world, new Map());
		const heard = watcher.poll(world, 'me');
		expect(heard).not.toContain('greet');
	});

	it('does not re-greet every tick while hovering right at TALK_RANGE', () => {
		// A wanderer stops and drifts near a landmark rather than sitting still (`sim/bot.ts`), and a
		// player standing still is never perfectly still either — so two people parked near the exact
		// range boundary cross it constantly. Every crossing used to read as a fresh greeting, because
		// `nearestTalker` reported null for a tick and `greet` fires on the id CHANGING — which is what
		// "just bip bip bip endless" (Daniel, 2026-08-22) actually was. `TALK_RANGE_EXIT` gives the
		// current companion the same slack `npc/talk.ts`'s own conversation gets.
		const world = island({ x: 6, z: 20 });
		const me = world.penguins.find((p) => p.id === 'me');
		const you = world.penguins.find((p) => p.id === 'you');
		if (!me || !you) throw new Error('roster');
		you.pos = { x: 30, z: 20 };
		const watcher = createCueWatcher();
		watcher.poll(world, 'me');

		you.pos = { x: me.pos.x + TALK_RANGE * 0.5, z: me.pos.z };
		step(world, new Map());
		expect(watcher.poll(world, 'me')).toContain('greet');

		for (const nudge of [0.05, -0.05, 0.05, -0.05]) {
			you.pos = { x: me.pos.x + TALK_RANGE + nudge, z: me.pos.z };
			step(world, new Map());
			expect(watcher.poll(world, 'me')).not.toContain('greet');
		}

		// Still the non-vacuous half: clearly leaving — past `TALK_RANGE_EXIT`, not just the inner
		// line — silences it exactly as before.
		you.pos = { x: me.pos.x + TALK_RANGE_EXIT + 0.5, z: me.pos.z };
		step(world, new Map());
		watcher.poll(world, 'me');
		you.pos = { x: me.pos.x + TALK_RANGE * 0.5, z: me.pos.z };
		step(world, new Map());
		expect(watcher.poll(world, 'me')).toContain('greet');
	});

	it('says something quieter when the place opens nothing', () => {
		// Der Laden is a building before it is a screen (`Door.opens` is null on purpose), so it
		// raises no button — and a door chime there would be the sound promising a game the picture
		// is not offering. The pair is the point: same walk, same latch, two different arrivals.
		const shop = walkInto('shop');
		expect(shop.arriving).toContain('arrive');
		expect(shop.arriving).not.toContain('door');

		const mountain = walkInto('mountain');
		expect(mountain.arriving).not.toContain('arrive');
	});
});

describe('the place a mode is played in', () => {
	/** Everything heard over `ticks` of a mode nobody is touching. */
	function idle(mode: Parameters<typeof createWorld>[2], ticks: number): readonly string[] {
		const world = createWorld(['me', 'you'], 31, mode);
		world.round.phase = 'playing';
		return listen(world, ticks, () => new Map([['me', PLAY]]));
	}

	it('gives the hub the sea and the birds', () => {
		// A hub is where a child stands still and decides what to do next, and it was silent. This is
		// the one sound in the game that has to happen when nothing is happening.
		const heard = idle('island', 700);
		expect(heard.filter((c) => c === 'wave').length).toBeGreaterThanOrEqual(2);
		expect(heard).toContain('bird');
	});

	it('gives a course moving air', () => {
		expect(idle('chase', 400)).toContain('wind');
	});

	it('and gives an arena none of it', () => {
		// Non-vacuousness for both of the above, and a rule rather than an omission: there is a fight
		// on, and ambience fills a silence rather than the gap between two thuds.
		const heard = idle('classic', 700);
		expect(heard).not.toContain('wave');
		expect(heard).not.toContain('bird');
		expect(heard).not.toContain('wind');
	});
});

describe('the mountain', () => {
	it('scrapes once per metre of belly, and not while standing on the start line', () => {
		const world = createWorld(['me', 'you'], 31, 'slide');
		world.round.phase = 'playing';
		const me = world.penguins.find((p) => p.id === 'me');
		if (!me) throw new Error('roster');
		const from = { ...me.pos };
		const heard = listen(world, 180, () => new Map([['me', PLAY]]));

		const went = Math.hypot(me.pos.x - from.x, me.pos.z - from.z);
		const scrapes = heard.filter((c) => c === 'sled').length;
		// Gravity does the whole of this: a racer let go of on the slope is past the speed the
		// renderer puts the bird on its front at within the first second.
		expect(Math.hypot(me.vel.x, me.vel.z)).toBeGreaterThan(SLED_SPEED);
		expect(scrapes).toBeGreaterThan(0);
		// Fewer than one per metre, because the first metres were spent under the speed at which the
		// belly is on the ice at all.
		expect(scrapes).toBeLessThan(went / SCRAPE_METRES);
	});

	it('does not scrape on the flat', () => {
		// The same speed on an arena floe is a shove, not a sledge — `onTheBelly` is the mode saying
		// which, and without asking it every knockback in the game would hiss.
		const world = playing();
		const me = world.penguins.find((p) => p.id === 'me');
		if (!me) throw new Error('roster');
		const watcher = createCueWatcher();
		watcher.poll(world, 'me');
		for (let t = 0; t < 30; t++) {
			me.vel = { x: SLED_SPEED * 2, z: 0 };
			step(world, new Map());
			expect(watcher.poll(world, 'me')).not.toContain('sled');
		}
	});
});

describe('the countdown', () => {
	it('beats once per number on the screen', () => {
		// `Game.svelte` rounds the seconds UP for the digit, so the beat is derived from the same
		// expression: a sound landing anywhere else is a sound with nothing on screen to be the sound
		// OF, which is the one thing this file is not allowed to be.
		//
		// Polled by hand rather than through `listen`, which throws the first poll away: the first
		// digit is on screen before the first tick, and it is the one the baseline gate would eat.
		const world = createWorld(['me', 'you'], 5);
		const watcher = createCueWatcher();
		const heard: string[] = [...watcher.poll(world, 'me')];
		for (let t = 0; t < COUNTDOWN_TICKS + 30; t++) {
			step(world, new Map([['me', PLAY]]));
			heard.push(...watcher.poll(world, 'me'));
		}
		expect(heard.filter((c) => c === 'count')).toHaveLength(Math.ceil(COUNTDOWN_TICKS / TICK_RATE));
		expect(heard).toContain('go');
	});
});

describe('the round starting and ending', () => {
	it('says go when the countdown ends, once', () => {
		const world = createWorld(['me', 'you'], 5);
		const heard = listen(world, 200, () => new Map([['me', PLAY]]));
		expect(heard.filter((c) => c === 'go')).toHaveLength(1);
	});

	it('tells winning from losing, from the local player point of view', () => {
		const mine = playing();
		const watcher = createCueWatcher();
		watcher.poll(mine, 'me');
		mine.round.phase = 'over';
		mine.round.winner = 'me';
		expect(watcher.poll(mine, 'me')).toContain('win');

		const theirs = playing();
		const other = createCueWatcher();
		other.poll(theirs, 'me');
		theirs.round.phase = 'over';
		theirs.round.winner = 'you';
		expect(other.poll(theirs, 'me')).toContain('lose');
	});
});

describe('a client being corrected', () => {
	it('does not re-announce anything a replay steps through again', () => {
		// The reason cues are DERIVED rather than emitted. `net/predict.ts` rewinds to the host's
		// state and re-simulates up to a hundred ticks inside one frame; every jump and every hit in
		// them has already been heard, and an event list would play all of them a second time.
		//
		// It has to be ONE watcher across the whole thing — an earlier version of this test used the
		// `listen` helper for the second half, which builds its own, and so could not have failed.
		//
		// It also has to poll where the game polls: once per FRAME, in `draw`. A reconcile rewinds
		// and replays entirely inside one `advance` call, so the watcher never sees the rewound
		// world — only where the replay left it. That is the property being asserted.
		const world = playing();
		const watcher = createCueWatcher();
		watcher.poll(world, 'me');

		const inputs = new Map([['me', { ...PLAY, jump: true }]]);
		step(world, inputs);
		expect(watcher.poll(world, 'me')).toContain('jump');

		// Fly on for a few ticks, polled each frame as the game would.
		for (let t = 0; t < 6; t++) {
			step(world, new Map([['me', PLAY]]));
			watcher.poll(world, 'me');
		}
		const predicted = structuredClone(world);

		// The correction, in full: back to a snapshot ten ticks old and forward again over the same
		// inputs. Prediction was right, so it lands exactly where it already was.
		const snapshot = structuredClone(playing());
		Object.assign(world, snapshot);
		step(world, inputs);
		for (let t = 0; t < 6; t++) step(world, new Map([['me', PLAY]]));
		expect(world.penguins[0]?.height).toBeCloseTo(predicted.penguins[0]?.height ?? -1, 9);

		// And only NOW does the frame come round again. Nothing moved since the last look.
		expect(watcher.poll(world, 'me')).toEqual([]);
	});
});

describe('the claim at the top of the module', () => {
	// The docblock says "no clock, no randomness, no browser", and `sim/purity.test.ts` argues at
	// length that a comment saying so is worth nothing while a scan is worth something. That scan is
	// hardcoded to `sim/`, so this module was making the same promise with none of the enforcement.
	const source = readFileSync(new URL('./cues.ts', import.meta.url), 'utf-8')
		// Comments stripped, so the rules can be DISCUSSED above without tripping their own guard.
		.replace(/\/\*[\s\S]*?\*\//g, '')
		.replace(/(^|[^:])\/\/.*$/gm, '$1');

	it('reads no clock', () => {
		// A cue watcher that read a clock would fire differently on a slow phone, and — worse —
		// differently inside a replay, which is the one thing this module exists to survive.
		expect(source).not.toMatch(/Date\.now\s*\(/);
		expect(source).not.toMatch(/new\s+Date\s*\(/);
		expect(source).not.toMatch(/performance\.now\s*\(/);
	});

	it('uses no randomness and touches no browser global', () => {
		expect(source).not.toMatch(/Math\.random\s*\(/);
		expect(source).not.toMatch(/\bwindow\./);
		expect(source).not.toMatch(/\bdocument\./);
		expect(source).not.toMatch(/\bAudioContext\b/);
	});

	it('is the kind of check that can fail', () => {
		// Non-vacuousness, the way `purity.test.ts` proves it: feed the patterns what they exist to
		// catch. Without this a typo in a regex would make the scan pass for ever.
		expect(source.length).toBeGreaterThan(500);
		expect('const t = Date.now();').toMatch(/Date\.now\s*\(/);
		expect('const r = Math.random();').toMatch(/Math\.random\s*\(/);
	});
});
