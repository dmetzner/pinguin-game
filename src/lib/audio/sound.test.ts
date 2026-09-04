/**
 * Proof that every sound in the game is actually a sound.
 *
 * `render/` is deliberately not unit-tested because nothing in it means anything without a GPU, and
 * the temptation is to file audio under the same exemption. It does not belong there: what a cue
 * SOUNDS like needs a person and a phone speaker, but whether it schedules anything at all, and
 * whether it asks Web Audio for something Web Audio refuses, are facts a stub can settle.
 *
 * Two things make this worth its length. The first is that `fire` swallows exceptions on purpose —
 * a noise that throws must not stop the frame loop it is called from — so without a test a
 * completely silent cue is indistinguishable from a working one. The second is that the parameters
 * below are exactly where Web Audio is strict and quiet about it: an exponential ramp to zero throws
 * in Safari and is ignored in Chrome, a buffer offset past the end of the buffer plays nothing, and
 * a filter cutoff over Nyquist behaves differently per browser. The stub enforces all three, which
 * is more than either browser does.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { Cue } from './cues';
import type { UiCue } from './sound';

/** The rate the stub pretends to run at, which is what decides where Nyquist is. */
const SAMPLE_RATE = 48000;

/** How many nodes and how many scheduled sources the last sound built. */
let nodes = 0;
let sources = 0;
/**
 * Everything the stub objected to, as well as thrown.
 *
 * Both, and that is the point of this list. `fire` catches — deliberately, so a bad noise cannot
 * stop the frame loop — so a thrown error never reaches the test and `not.toThrow()` would pass for
 * a cue that fails on its first parameter. What is asserted is that nothing objected at all.
 */
let problems: string[] = [];

function refuse(why: string): never {
	problems.push(why);
	throw new Error(why);
}

/** A parameter that checks what is asked of it, rather than merely remembering it. */
function param(name: string, value = 0) {
	const when = (at: number) => {
		if (!Number.isFinite(at) || at < 0) refuse(`${name}: scheduled at ${at}`);
		return at;
	};
	const level = (to: number) => {
		if (!Number.isFinite(to)) refuse(`${name}: value ${to}`);
		// A cutoff above half the sample rate is not a bright sound, it is undefined behaviour: what
		// happens above Nyquist is per-implementation, so a filter aimed there is a sound that is
		// different on a different phone.
		if (name.endsWith('.frequency') && to > SAMPLE_RATE / 2) refuse(`${name}: ${to} Hz`);
		return to;
	};
	return {
		value,
		setValueAtTime(to: number, at: number) {
			when(at);
			return level(to);
		},
		linearRampToValueAtTime(to: number, at: number) {
			when(at);
			return level(to);
		},
		exponentialRampToValueAtTime(to: number, at: number) {
			when(at);
			// The one Web Audio rule that is a hard error rather than a surprise: an exponential ramp
			// can neither reach nor leave zero, and Safari throws where Chrome shrugs.
			if (to === 0) refuse(`${name}: exponential ramp to zero`);
			return level(to);
		}
	};
}

function node(kind: string) {
	nodes++;
	const self = {
		kind,
		type: '',
		curve: null as Float32Array | null,
		buffer: null as { duration: number } | null,
		gain: param(`${kind}.gain`),
		frequency: param(`${kind}.frequency`, 350),
		detune: param(`${kind}.detune`),
		Q: param(`${kind}.Q`, 1),
		delayTime: param(`${kind}.delayTime`),
		threshold: param('threshold'),
		knee: param('knee'),
		ratio: param('ratio'),
		attack: param('attack'),
		release: param('release'),
		connect: (to: unknown) => to,
		start(at = 0, offset = 0) {
			sources++;
			if (!Number.isFinite(at) || at < 0) refuse(`${kind}: start at ${at}`);
			// A source started past the end of its own buffer is silence that looks like a sound.
			if (self.buffer && (offset < 0 || offset >= self.buffer.duration)) {
				refuse(`${kind}: offset ${offset} of ${self.buffer.duration}s`);
			}
		},
		stop(at = 0) {
			if (!Number.isFinite(at) || at < 0) refuse(`${kind}: stop at ${at}`);
		}
	};
	return self;
}

/** The audio clock, which is the only clock this module has. Tests move it by hand. */
let clock = 1;

class FakeContext {
	state = 'running';
	sampleRate = SAMPLE_RATE;
	get currentTime() {
		return clock;
	}
	destination = node('destination');
	createGain = () => node('gain');
	createOscillator = () => node('oscillator');
	createBiquadFilter = () => node('filter');
	createDelay = () => node('delay');
	createWaveShaper = () => node('shaper');
	createDynamicsCompressor = () => node('compressor');
	createBufferSource = () => node('source');
	createBuffer(_channels: number, frames: number, rate: number) {
		const data = new Float32Array(frames);
		return { duration: frames / rate, getChannelData: () => data };
	}
}

/**
 * Every cue there is.
 *
 * Written out rather than derived, because a union of string literals with a docblock on each member
 * is the right shape for `Cue` and there is no way to enumerate one at runtime. `total` below is
 * what stops the list from going stale: a cue added to the union and not to this array is a
 * COMPILE error here, which is the same trick `MODES` uses to make a mode without a descriptor one.
 */
const EVERY_CUE = [
	'jump',
	'flap',
	'land',
	'stepGrass',
	'stepSand',
	'sled',
	'throw',
	'dash',
	'hit',
	'splash',
	'count',
	'go',
	'win',
	'lose',
	'creak',
	'crack',
	'growl',
	'huff',
	'door',
	'arrive',
	'greet',
	'wave',
	'bird',
	'wind'
] as const satisfies readonly Cue[];

/** And every noise the interface can ask for. Total the same way, for the same reason. */
const EVERY_UI = ['tap', 'eis', 'talk'] as const satisfies readonly UiCue[];

type MissingUi = Exclude<UiCue, (typeof EVERY_UI)[number]>;
/** If this stops being `true`, the interface noise named in the error is missing from `EVERY_UI`. */
const totalUi: MissingUi extends never ? true : MissingUi = true;

type Missing = Exclude<Cue, (typeof EVERY_CUE)[number]>;
/** If this stops being `true`, the cue named in the error is missing from `EVERY_CUE`. */
const total: Missing extends never ? true : Missing = true;

// biome-ignore lint/suspicious/noExplicitAny: the stub is deliberately the smallest thing that answers the questions above
(globalThis as any).AudioContext = FakeContext;
const { getSound } = await import('./sound');

const sound = getSound();
if (sound.muted) sound.toggle();

beforeEach(() => {
	nodes = 0;
	sources = 0;
	problems = [];
});

describe('the sound device', () => {
	it('was built at all', () => {
		// Non-vacuousness for everything below: with no `AudioContext` the module returns its deaf
		// implementation, which reports `muted: true` and would make every "did not throw" pass.
		expect(total).toBe(true);
		expect(totalUi).toBe(true);
		expect(sound.muted).toBe(false);
	});

	it('makes a noise for every cue there is, and asks Web Audio for nothing it would refuse', () => {
		for (const cue of EVERY_CUE) {
			nodes = 0;
			sources = 0;
			problems = [];
			sound.play([cue]);
			expect(problems, cue).toEqual([]);
			expect(nodes, `${cue} built no nodes`).toBeGreaterThan(0);
			expect(sources, `${cue} started nothing`).toBeGreaterThan(0);
		}
	});

	it('is a test that can fail', () => {
		// Non-vacuousness, the way `purity.test.ts` proves it: the checks above are worth something
		// only if the stub actually objects to the two things browsers actually refuse.
		const p = param('proof');
		expect(() => p.exponentialRampToValueAtTime(0, 1)).toThrow();
		expect(() => p.setValueAtTime(1, -1)).toThrow();
		expect(() => param('proof.frequency').setValueAtTime(SAMPLE_RATE, 1)).toThrow();
		expect(problems).toHaveLength(3);
	});

	it('makes a noise for every interface cue too', () => {
		// `tap` is live behind the mute button; `eis` and `talk` are waiting on one call each from the
		// screens that own them. Asserted here so the day somebody wires one up, the only thing that
		// can be wrong is where it is called from.
		for (const cue of EVERY_UI) {
			nodes = 0;
			sources = 0;
			problems = [];
			clock += 1;
			sound.ui(cue);
			expect(problems, cue).toEqual([]);
			expect(sources, `${cue} started nothing`).toBeGreaterThan(0);
		}
	});

	it('refuses to play the same sound twice inside its own spacing', () => {
		// The machine-gun guard. The old one was a flat 60 ms for everything, which let sixteen copies
		// of a 450 ms splash into the air at once — a Royal finale, exactly.
		sound.play(['splash']);
		const first = sources;
		sound.play(['splash']);
		expect(sources).toBe(first);
	});

	it('and plays it again once the gap has passed', () => {
		// The other half of that pair: a guard that refused for ever would pass the test above.
		sound.play(['hit']);
		const first = sources;
		clock += 1;
		sound.play(['hit']);
		expect(sources).toBeGreaterThan(first);
	});

	it('makes no noise at all while muted', () => {
		sound.toggle();
		expect(sound.muted).toBe(true);
		nodes = 0;
		sources = 0;
		sound.play(['crack', 'splash', 'win']);
		sound.ui('tap');
		sound.ui('talk');
		expect(nodes).toBe(0);
	});

	it('and answers for itself when it comes back on', () => {
		// "Did that work?" is a question a child should not have to hold a phone to their ear to
		// answer. The icon on the button is the visible half; this is the audible one.
		expect(sound.muted).toBe(true);
		nodes = 0;
		sources = 0;
		clock += 1;
		sound.toggle();
		expect(sound.muted).toBe(false);
		expect(sources).toBeGreaterThan(0);
	});
});
