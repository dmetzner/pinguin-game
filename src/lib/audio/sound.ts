/**
 * Every noise this game makes, synthesised on the spot.
 *
 * No files, and that is the same decision as the penguins: zero budget rules out a licensed sound
 * pack, and what makes it a good outcome rather than a constraint is that a whole soundtrack is a
 * few hundred bytes of code instead of a megabyte of downloads on a school wifi. `docs/DECISIONS`
 * 0003 made the argument for the models; it holds identically here.
 *
 * Two rules this file keeps, both of them about children on phones:
 *
 * 1. **Nothing is ever carried by sound alone.** Every cue here has something on screen already —
 *    stars for a stun, a splash, the count in the HUD. Sound is confirmation, never information, so
 *    a muted phone, a broken speaker, or a deaf player loses nothing but the fun.
 * 2. **It starts silent until it is allowed to make a noise.** Every mobile browser blocks audio
 *    until a gesture, and an `AudioContext` built before one is a suspended context that never
 *    recovers unless somebody resumes it. `resume()` is called from the first touch.
 *
 * ## And the part that is art direction rather than plumbing
 *
 * `docs/ART-DIRECTION.md` is a brief for the picture, and the same brief decides what this file may
 * sound like: round, bevelled, warm, saturated, nothing tapering to a point. The audio equivalents
 * are not a metaphor — they are four techniques, and the first version of this file used none of
 * them, which is why a game that looks like Animal Crossing sounded like a multimeter.
 *
 *  * **A raw oscillator is the four-sided cone of sound.** A `square` or `sawtooth` straight into
 *    the output carries every harmonic up to Nyquist; that thin electric buzz is what "clinical"
 *    IS. Every pitched voice here goes through a lowpass whose corner is a MULTIPLE of the note
 *    rather than a frequency, so a low thud and a high sparkle are equally round.
 *  * **The envelope is most of the object.** A linear attack of a few milliseconds and a decay that
 *    closes the filter as it fades reads as something being struck. The same pitch with no shape is
 *    a signal, and a game full of signals reads as a diagnostic tool.
 *  * **Wood is FM, and it is cheap.** A sine carrier with a sine modulator a few multiples up, and
 *    the modulation dying in thirty milliseconds, is a marimba. Two oscillators, and it is the
 *    single biggest step from "beep" toward the toy-box tone these games are made of.
 *  * **Everything is in tune with everything else.** Pitches are MIDI notes on one pentatonic scale
 *    (see `NOTE`), which is why a jump landing over the top of a win arpeggio is a chord rather than
 *    a clash. The first version had a 900 Hz snap, a 78 Hz growl and a 320→660 Hz sweep, all
 *    unrelated: individually defensible, together an accident.
 *
 * Two more, about a set of sounds rather than about one:
 *
 *  * **Nothing is ever the same twice.** Repeats are detuned a little and the noise buffer is read
 *    from a fresh offset each time, both from a seeded generator. Identical repeats are how a
 *    synthesised game gives itself away — and two identical noise bursts a few milliseconds apart
 *    are literally the same samples, so they sum coherently into a click instead of layering.
 *  * **The bus is compressed and soft-clipped.** A Royal finale can start six sounds inside a
 *    hundred milliseconds; without this that is digital clipping, which is the harshest noise a
 *    phone can make. With it, a pile-up leans on the ceiling and gets quieter instead of nastier.
 */
import { isMuted, setMuted } from '../identity';
import { createRng } from '../sim/rng';
import type { Cue } from './cues';

/**
 * How loud the whole thing is, against 1.0 clipping. Deliberately low; this plays under a game.
 *
 * Lower than it looks, because the soft ceiling below has a makeup gain built into its shape: a
 * `tanh` curve normalised at its knee multiplies quiet signals by about 1.4 on the way past. The
 * two numbers belong together — raising one and not the other is either a quiet game or a saturated
 * one. This is the one number in the file nobody can check without a phone in a room with children
 * in it, so it is deliberately on the safe side of loud.
 */
const MASTER_GAIN = 0.45;

/**
 * How far ahead of "now" anything is scheduled, in seconds.
 *
 * Web Audio starts a node scheduled in the past immediately and without its envelope's first
 * milliseconds, which is a click on the front of the sound. Five milliseconds is inaudible as delay
 * and is the whole of the fix.
 */
const LOOKAHEAD = 0.005;

/**
 * Every note this game plays, as MIDI numbers. All of them are C major pentatonic.
 *
 * A table of names rather than of frequencies, because the point is what these pitches have in
 * common: they are the same five notes in different octaves, and a pentatonic scale contains no
 * interval that can sound like a mistake. That matters when the thing deciding what plays at the
 * same time as what is a game with thirty penguins in it.
 */
const NOTE = {
	G2: 43,
	C3: 48,
	D3: 50,
	E3: 52,
	G3: 55,
	A3: 57,
	C4: 60,
	E4: 64,
	G4: 67,
	A4: 69,
	C5: 72,
	E5: 76,
	G5: 79,
	A5: 81,
	C6: 84,
	E6: 88,
	G6: 91
} as const;

/** A MIDI note as hertz. */
function hz(midi: number): number {
	return 440 * 2 ** ((midi - 69) / 12);
}

export interface Sound {
	/** Play everything in this list, subject to mute and to each sound's own spacing. */
	play(cues: readonly Cue[]): void;
	/**
	 * A noise the INTERFACE made, which is not a thing that happened in the world.
	 *
	 * Separate from `play` on purpose. A `Cue` is derived by watching the simulation (`cues.ts`
	 * explains why that is the only arrangement that survives a client's replay), and a button being
	 * pressed is not in the simulation at all. Mixing the two would put a cue in the union that no
	 * watcher can ever produce, and the next person would go looking for the world state behind it.
	 */
	ui(cue: UiCue): void;
	/** Is the sound off? The module owns this, and persists it. */
	readonly muted: boolean;
	/** Turn it off or on, and remember which. */
	toggle(): void;
}

/** Noises the interface makes. See `Sound.ui`. */
export type UiCue =
	/** A chunky button, pressed. */
	| 'tap'
	/** Eis, earned. */
	| 'eis'
	/**
	 * One syllable of somebody talking.
	 *
	 * Here rather than in `cues.ts` because a LINE is not a fact about the world: `npc/talk.ts` keeps
	 * its own state, picks from a pool with its own seed, and a watcher comparing two worlds cannot
	 * see that the words changed. What the world does know is that somebody came close enough to
	 * speak, and that is `greet` — this is the voice underneath the words themselves.
	 */
	| 'talk';

/**
 * A silent implementation, for when there is no Web Audio at all.
 *
 * A locked-down tablet or an old browser gets a game with no sound rather than an exception on the
 * way to the first frame — the same rule `storage.ts` follows for a `localStorage` that throws.
 *
 * It reports `muted: true` and a `toggle` that does nothing, which is the honest answer to "is
 * anything going to come out of this": no, and pressing the button will not change that.
 */
const DEAF: Sound = { play() {}, ui() {}, muted: true, toggle() {} };

/**
 * The one sound device for the page.
 *
 * A singleton, and that is a correction rather than a convenience. It was built per round, inside
 * `Game.svelte`'s `onMount` — but a rematch destroys and remounts that component by design, so
 * every "Nochmal" closed an `AudioContext` and opened another, threw away the retrigger history,
 * and had to be handed the mute again through a constructor argument. An audio device is a property
 * of the page, not of a round.
 */
let shared: Sound | null = null;

/** The page's sound, built the first time anything asks for it. */
export function getSound(): Sound {
	shared ??= createSound();
	return shared;
}

/**
 * One sound, and the shortest gap allowed between two of it.
 *
 * The gap is per sound rather than one number for all of them, and that is a bug fix rather than
 * tidying. It was a flat 60 ms, which is right for a footstep and absurd for the splash: sixteen
 * copies of a 450 ms wash can be in the air at once, and in a Royal — where the whole field drowns
 * in a few seconds — that is exactly what happened. As a rule of thumb the gap is about a third of
 * the sound's own length, and never shorter than the ear can separate.
 */
interface Voice {
	readonly hold: number;
	play(at: number): void;
}

function createSound(): Sound {
	const Ctor =
		globalThis.AudioContext ??
		(globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
	if (!Ctor) return DEAF;

	let context: AudioContext;
	try {
		context = new Ctor();
	} catch {
		return DEAF;
	}

	let muted = isMuted();

	/**
	 * Unlock on the first touch anywhere, once.
	 *
	 * Here rather than in a component, because "browsers gate audio behind a gesture" is a fact
	 * about audio and not about the game screen. It was a `pointerdown` handler on `Game.svelte`'s
	 * root, which meant a suppressed a11y warning, a listener re-attached on every rematch, and —
	 * the actual gap — silence for anyone whose first touch landed on the room screen or the start
	 * screen instead, since both are rendered outside `Game`.
	 *
	 * Capture, so a control that stops propagation cannot swallow it. `once`, so it costs one
	 * listener for the life of the page.
	 */
	const unlock = () => {
		if (!muted && context.state === 'suspended') void context.resume().catch(() => {});
	};
	globalThis.addEventListener?.('pointerdown', unlock, { capture: true, passive: true });

	// ---------------------------------------------------------------------------
	// The bus
	// ---------------------------------------------------------------------------

	const master = context.createGain();
	master.gain.value = MASTER_GAIN;
	master.connect(context.destination);

	/**
	 * A gentle limiter, as a curve.
	 *
	 * `tanh` is the shape of every analogue thing that ever ran out of headroom: linear where it
	 * matters, bending over near the top, and it cannot produce a sample outside ±1 whatever is fed
	 * to it. Above the knee it adds harmonics of what is already there, which is why a pile-up sounds
	 * like a loud pile-up rather than like the digital tearing that hard clipping gives.
	 */
	const ceiling = context.createWaveShaper();
	const KNEE = 1.2;
	const curve = new Float32Array(1024);
	for (let i = 0; i < curve.length; i++) {
		const x = (i / (curve.length - 1)) * 2 - 1;
		curve[i] = Math.tanh(x * KNEE) / Math.tanh(KNEE);
	}
	ceiling.curve = curve;
	ceiling.connect(master);

	/**
	 * And a compressor in front of it, which is what stops the loud things from burying the quiet
	 * ones.
	 *
	 * The brief calls this "level and balance" and it is only half a matter of choosing gains: the
	 * problem is dynamic. A crack is meant to be ten times a footstep, and it is — until three of
	 * them and a scrum happen together, at which point the sum is over the ceiling and everything
	 * inside it turns to mush. A slow release means a big event dips the whole soundtrack for a fifth
	 * of a second and lets it back up, which is the effect a mix engineer would ask for here.
	 *
	 * The threshold is HIGH on purpose, and this is the part that is easy to get backwards. Every
	 * cue's gains below are a deliberate hierarchy — a footstep at a twentieth of the ice breaking —
	 * and a compressor that starts working on single sounds flattens exactly that: at −13 dB and 3.5
	 * to 1 the loudest thing in the game came out under three times the quietest, which is the "one
	 * cue drowning the others" complaint arrived at from the opposite direction. At −6 and 2.5 to 1
	 * it leaves single events alone and only leans on a pile-up, which is the whole job.
	 */
	const glue = context.createDynamicsCompressor();
	glue.threshold.value = -6;
	glue.knee.value = 10;
	glue.ratio.value = 2.5;
	glue.attack.value = 0.005;
	glue.release.value = 0.22;
	glue.connect(ceiling);

	/** Everything plays into here. */
	const bus = context.createGain();
	bus.connect(glue);

	/**
	 * The air a sound is heard in: two taps, no feedback.
	 *
	 * Dry synthesis is the other half of "clinical" — a sound with no space around it is a sound
	 * happening inside the phone rather than out on the ice. Two darkened echoes at 27 and 58 ms are
	 * enough for the ear to place a sound outdoors, and they are deliberately NOT a feedback loop: a
	 * delay feeding itself is a reverb tail on a good day and a metallic ring on a phone speaker,
	 * and there is nobody here to tune it by ear on twenty devices. Bounded, cheap, built once.
	 *
	 * Voices ask for it by amount (`air`), so a bell can sit further back than a footstep.
	 */
	const airSend = context.createGain();
	const airDamp = context.createBiquadFilter();
	airDamp.type = 'lowpass';
	airDamp.frequency.value = 2400;
	airSend.connect(airDamp);
	for (const [seconds, level] of [
		[0.027, 0.5],
		[0.058, 0.26]
	] as const) {
		const tap = context.createDelay(0.1);
		tap.delayTime.value = seconds;
		const trim = context.createGain();
		trim.gain.value = level;
		airDamp.connect(tap).connect(trim).connect(glue);
	}

	/**
	 * One buffer of white noise, read from a different place every time.
	 *
	 * Two seconds rather than the half it was, and the extra is not for the longest sound — it is so
	 * that every burst can start at its own offset. Two bursts of the SAME samples a few
	 * milliseconds apart are correlated: they do not layer, they add up into one louder, comb-filtered
	 * spike with a click on the front, which is what a flap and a throw on the same tick used to do.
	 *
	 * Seeded from `sim/rng.ts` rather than `Math.random()`, and rather than a second PRNG written
	 * out here — the reason for a deterministic stream is the same reason the simulation has one, so
	 * it should be the same generator.
	 */
	const NOISE_SECONDS = 2;
	const noise = (() => {
		const frames = Math.floor(context.sampleRate * NOISE_SECONDS);
		const buffer = context.createBuffer(1, frames, context.sampleRate);
		const data = buffer.getChannelData(0);
		const rng = createRng(0x9e3779b9);
		for (let i = 0; i < frames; i++) data[i] = rng.next() * 2 - 1;
		return buffer;
	})();

	/** The wobble on everything: a little detune, a little offset, a little timing. */
	const jitter = createRng(0x51ed2701);
	/** −1..1, for anything that wants to be a bit off. */
	const wobble = () => jitter.next() * 2 - 1;

	// ---------------------------------------------------------------------------
	// The three ways this game makes a sound
	// ---------------------------------------------------------------------------

	/**
	 * A pitched voice: an oscillator through a lowpass that closes as the note decays.
	 *
	 * `bright` is in HARMONICS rather than hertz, which is what makes one number right for a growl
	 * at 39 Hz and a sparkle at 1319 Hz: six harmonics is the same warmth at both ends, where a
	 * fixed 800 Hz corner is a muffled bell and a buzzing growl.
	 */
	function pluck(o: {
		at: number;
		midi: number;
		secs: number;
		gain: number;
		/** Default `triangle`: a sine with a little edge, which is most of the game's voice. */
		type?: OscillatorType;
		/** Semitones to glide to, over the first part of the note. The shape of a bloop. */
		glide?: number;
		/** Where the lowpass starts, as a multiple of the note. */
		bright?: number;
		/** Resonance. Under 1 for anything soft; 2–3 to make a filter sweep audible as a voice. */
		q?: number;
		/** Seconds of attack. Longer than a few ms is a swell rather than a hit. */
		attack?: number;
		/** How much of it goes out into the air. */
		air?: number;
		/** Cents of detune on a doubled copy, for warmth. Costs a second oscillator. */
		wide?: number;
		/** Hertz of vibrato RATE. Its depth is 2.2% of the note, so one number works in any octave. */
		vibrato?: number;
		/** Hertz of amplitude wobble. At 25–30 Hz this is roughness, and roughness is what a throat has. */
		rough?: number;
	}) {
		const f = hz(o.midi);
		const secs = o.secs;
		const attack = o.attack ?? 0.005;
		const bright = o.bright ?? 6;

		// Two oscillators through one envelope are twice the amplitude, so a doubled voice asks for
		// less: `wide` is meant to change the colour of a note and not how loud it is.
		const level = o.wide ? o.gain * 0.6 : o.gain;

		const env = context.createGain();
		env.gain.setValueAtTime(0, o.at);
		env.gain.linearRampToValueAtTime(level, o.at + attack);
		// Exponential from a value that is already positive, so there is no ramp-from-zero to trip
		// over: `exponentialRamp` cannot leave 0, and setting it there throws in Safari rather than
		// being ignored.
		env.gain.exponentialRampToValueAtTime(0.0001, o.at + secs);

		const filter = context.createBiquadFilter();
		filter.type = 'lowpass';
		filter.Q.value = o.q ?? 0.9;
		filter.frequency.setValueAtTime(Math.min(f * bright, 16000), o.at);
		filter.frequency.exponentialRampToValueAtTime(Math.max(f * 1.2, 90), o.at + secs);

		for (const cents of o.wide ? [-o.wide, o.wide] : [0]) {
			const osc = context.createOscillator();
			osc.type = o.type ?? 'triangle';
			osc.detune.value = cents + wobble() * 14;
			osc.frequency.setValueAtTime(f, o.at);
			if (o.glide) {
				osc.frequency.exponentialRampToValueAtTime(hz(o.midi + o.glide), o.at + secs * 0.55);
			}
			if (o.vibrato) {
				const lfo = context.createOscillator();
				const depth = context.createGain();
				lfo.frequency.value = o.vibrato;
				// Onto the FREQUENCY, in hertz, and derived from the note: the same automation on
				// `detune` would be cents, where 2.2 is a shrug at the top of the scale and nothing at
				// all at the bottom. Modulation adds to whatever the parameter is already doing, so
				// this rides on top of the glide rather than replacing it.
				depth.gain.value = f * 0.022;
				lfo.connect(depth).connect(osc.frequency);
				lfo.start(o.at);
				lfo.stop(o.at + secs);
			}
			osc.connect(filter);
			osc.start(o.at);
			osc.stop(o.at + secs + 0.02);
		}

		if (o.rough) {
			const lfo = context.createOscillator();
			const depth = context.createGain();
			lfo.type = 'triangle';
			lfo.frequency.value = o.rough;
			depth.gain.value = level * 0.45;
			lfo.connect(depth).connect(env.gain);
			lfo.start(o.at);
			lfo.stop(o.at + secs);
		}

		filter.connect(env);
		out(env, level, o.air);
	}

	/**
	 * A wooden knock: two sines, one modulating the other's pitch.
	 *
	 * The whole trick is that the modulation dies long before the note does — a burst of inharmonic
	 * partials at the front and a clean sine behind it, which is what a struck wooden bar is. This
	 * is the toy-box sound the art direction is asking for and it costs three nodes.
	 */
	function wood(o: {
		at: number;
		midi: number;
		secs: number;
		gain: number;
		/** The modulator's pitch, as a multiple of the note. Non-integers are more wood, less bell. */
		ratio?: number;
		/** How hard it is struck, as multiples of the note in pitch deviation. */
		index?: number;
		air?: number;
	}) {
		const f = hz(o.midi);
		const carrier = context.createOscillator();
		carrier.type = 'sine';
		carrier.detune.value = wobble() * 10;
		carrier.frequency.value = f;

		const mod = context.createOscillator();
		mod.type = 'sine';
		mod.frequency.value = f * (o.ratio ?? 3.4);
		const index = context.createGain();
		index.gain.setValueAtTime(f * (o.index ?? 2), o.at);
		index.gain.exponentialRampToValueAtTime(f * 0.02, o.at + o.secs * 0.3);
		mod.connect(index).connect(carrier.frequency);

		const env = context.createGain();
		env.gain.setValueAtTime(0, o.at);
		env.gain.linearRampToValueAtTime(o.gain, o.at + 0.003);
		env.gain.exponentialRampToValueAtTime(0.0001, o.at + o.secs);

		carrier.connect(env);
		mod.start(o.at);
		mod.stop(o.at + o.secs + 0.02);
		carrier.start(o.at);
		carrier.stop(o.at + o.secs + 0.02);
		out(env, o.gain, o.air);
	}

	/** A burst of the noise buffer through a filter: everything percussive, wet, or made of air. */
	function puff(o: {
		at: number;
		secs: number;
		gain: number;
		/** Where the filter starts and where it ends, in hertz. Down is a hit; up is a swell. */
		from: number;
		to: number;
		type?: BiquadFilterType;
		q?: number;
		/** A highpass in front, for anything that must not carry any weight. */
		above?: number;
		attack?: number;
		air?: number;
	}) {
		const source = context.createBufferSource();
		source.buffer = noise;

		const filter = context.createBiquadFilter();
		filter.type = o.type ?? 'lowpass';
		filter.Q.value = o.q ?? 0.8;
		filter.frequency.setValueAtTime(o.from, o.at);
		filter.frequency.exponentialRampToValueAtTime(o.to, o.at + o.secs);

		const env = context.createGain();
		env.gain.setValueAtTime(0, o.at);
		env.gain.linearRampToValueAtTime(o.gain, o.at + (o.attack ?? 0.004));
		env.gain.exponentialRampToValueAtTime(0.0001, o.at + o.secs);

		let head: AudioNode = source;
		if (o.above) {
			const high = context.createBiquadFilter();
			high.type = 'highpass';
			high.frequency.value = o.above;
			head = source.connect(high);
		}
		head.connect(filter).connect(env);
		// Its own place in the buffer, so no two bursts are the same samples. See `noise`.
		source.start(o.at, jitter.next() * Math.max(0, NOISE_SECONDS - o.secs - 0.05));
		source.stop(o.at + o.secs + 0.02);
		out(env, o.gain, o.air);
	}

	/** Into the bus, and into the air by however much this voice asked for. */
	function out(env: GainNode, gain: number, air?: number) {
		env.connect(bus);
		if (!air) return;
		const send = context.createGain();
		send.gain.value = air * gain;
		env.connect(send).connect(airSend);
	}

	/**
	 * Eis, as a noise: three tiny bells up the scale.
	 *
	 * Shared by winning and losing, because Eis is paid for FINISHING (`lib/eis.ts` argues the
	 * ratio) and a child who came last still watches the number go up. Quieter after a loss, so it
	 * reads as a consolation rather than as a fanfare for coming fourth.
	 */
	function sparkle(at: number, gain: number) {
		for (const [i, midi] of [NOTE.C6, NOTE.E6, NOTE.G6].entries()) {
			pluck({
				at: at + i * 0.05,
				midi,
				secs: 0.22,
				gain: gain * (1 - i * 0.16),
				type: 'sine',
				bright: 8,
				air: 0.5
			});
		}
	}

	// ---------------------------------------------------------------------------
	// The whole soundtrack
	// ---------------------------------------------------------------------------

	/**
	 * Every cue, as the noise it makes.
	 *
	 * A total `Record` rather than a `switch`, for the reason `sim/modes/registry.ts` gives for
	 * `MODES`: a cue added to the union without a sound is then a compile error rather than a silent
	 * nothing at the moment it first happens. The old switch had no default and no complaint.
	 *
	 * Each one is shaped against what it has to be heard THROUGH: a phone speaker held at arm's
	 * length in a room with other children in it. That means short, mid-range and percussive — a
	 * long low rumble is inaudible on a speaker that size and the only thing it achieves is masking
	 * the next sound. The GAINS below are a hierarchy, not a set of preferences: a footstep is a
	 * twentieth of the ice breaking, because that is the difference between the two events.
	 */
	const SOUNDS: Record<Cue, Voice> = {
		jump: {
			hold: 0.08,
			play(at) {
				// Up, because it goes up — and a wooden knock underneath it, which is the difference
				// between a penguin pushing off the ice and a sine wave changing pitch.
				pluck({ at, midi: NOTE.C5, glide: 7, secs: 0.16, gain: 0.2, bright: 5, air: 0.2 });
				wood({ at, midi: NOTE.C4, secs: 0.11, gain: 0.16, ratio: 3, index: 1.6 });
				puff({ at, secs: 0.06, gain: 0.07, from: 1600, to: 500 });
			}
		},
		flap: {
			hold: 0.12,
			play(at) {
				// Two quick beats of air: a penguin's wings are not wings, and this should sound like
				// effort rather than like flight. Softer than the jump it rescues, and shorter, so a
				// player hears it as a second chance and not as a second launch.
				puff({ at, secs: 0.075, gain: 0.15, from: 1700, to: 650, type: 'bandpass', q: 1.1 });
				puff({
					at: at + 0.085,
					secs: 0.07,
					gain: 0.12,
					from: 1500,
					to: 600,
					type: 'bandpass',
					q: 1.1
				});
				pluck({ at, midi: NOTE.E5, glide: 5, secs: 0.11, gain: 0.1, type: 'sine', air: 0.2 });
			}
		},
		land: {
			hold: 0.07,
			play(at) {
				// The squash, as a noise: a soft body arriving, and a note that goes DOWN — the only
				// difference between landing and taking off that a child needs.
				puff({ at, secs: 0.1, gain: 0.16, from: 800, to: 190 });
				pluck({ at, midi: NOTE.G4, glide: -5, secs: 0.1, gain: 0.1, type: 'sine', bright: 4 });
			}
		},
		stepGrass: {
			hold: 0.11,
			play(at) {
				// Grass: almost nothing. A soft brush and a hint of ground under it, at a twentieth of
				// the loudest thing in the game — a footstep you notice is a footstep that is too loud.
				puff({ at, secs: 0.055, gain: 0.075, from: 1100, to: 300, type: 'bandpass', q: 0.9 });
				wood({ at, midi: NOTE.C3, secs: 0.05, gain: 0.045, ratio: 2.2, index: 1 });
			}
		},
		stepSand: {
			hold: 0.11,
			play(at) {
				// Sand is the same footstep with the body taken out and the top left in, which is what
				// makes the last two metres of the island audibly the beach.
				puff({
					at,
					secs: 0.05,
					gain: 0.075,
					from: 3000,
					to: 1300,
					type: 'bandpass',
					q: 1.1,
					above: 700
				});
			}
		},
		sled: {
			hold: 0.05,
			play(at) {
				// One metre of ice going past, and the RATE is the speed (`cues.ts`): these arrive
				// eleven a second at full pelt and three at a crawl, so the mountain gets faster
				// without a number anywhere describing how fast it is.
				puff({
					at,
					secs: 0.13,
					gain: 0.11,
					from: 1500 + wobble() * 300,
					to: 800,
					type: 'bandpass',
					q: 1.5
				});
			}
		},
		throw: {
			hold: 0.1,
			play(at) {
				// A soft whoosh with no pitch: a snowball is not a projectile weapon and must not
				// sound like one.
				puff({ at, secs: 0.17, gain: 0.17, from: 2400, to: 800, type: 'bandpass', q: 1.2 });
			}
		},
		dash: {
			hold: 0.14,
			play(at) {
				// Scraped ice — lower and grittier than the throw, because it is a body moving. The saw
				// is behind a lowpass with some resonance on it, which is a scrape; the same saw
				// without one is a wasp.
				puff({ at, secs: 0.22, gain: 0.24, from: 1400, to: 320 });
				pluck({
					at,
					midi: NOTE.E3,
					glide: -7,
					secs: 0.18,
					gain: 0.1,
					type: 'sawtooth',
					bright: 3,
					q: 1.6
				});
			}
		},
		hit: {
			hold: 0.09,
			play(at) {
				// The one sound that says the fight is happening, and it is a BONK: a hard wooden
				// knock, a soft body under it, and a note falling away. Nothing sharp — being hit in
				// this game is funny, and a sound with an edge on it would make it a fight.
				wood({ at, midi: NOTE.E3, secs: 0.2, gain: 0.34, ratio: 2.4, index: 3, air: 0.15 });
				puff({ at, secs: 0.12, gain: 0.3, from: 900, to: 180 });
				pluck({ at, midi: NOTE.C3, glide: -5, secs: 0.16, gain: 0.16, type: 'sine', bright: 4 });
			}
		},
		splash: {
			hold: 0.16,
			play(at) {
				// Long and wet, and the only sound in the set allowed to be. Going in is the event the
				// whole game is about, so it gets three layers: the surface breaking, the water
				// closing, and two bubbles coming back up.
				puff({
					at,
					secs: 0.11,
					gain: 0.3,
					from: 3800,
					to: 1400,
					type: 'bandpass',
					q: 0.9,
					above: 500
				});
				puff({ at: at + 0.02, secs: 0.42, gain: 0.36, from: 4200, to: 420, air: 0.25 });
				pluck({ at: at + 0.02, midi: NOTE.A4, glide: -19, secs: 0.3, gain: 0.12, type: 'sine' });
				for (const [i, delay] of [0.17, 0.28].entries()) {
					pluck({
						at: at + delay,
						midi: NOTE.C4 + i * 4,
						glide: 5,
						secs: 0.1,
						gain: 0.055,
						type: 'sine',
						bright: 3,
						air: 0.4
					});
				}
			}
		},
		count: {
			hold: 0.3,
			play(at) {
				// One wooden tick per digit on the screen. Deliberately the same note each time: a
				// countdown that rises is a countdown that promises something, and what follows this
				// one is `go`.
				wood({ at, midi: NOTE.E4, secs: 0.18, gain: 0.2, ratio: 4, index: 1.6, air: 0.35 });
			}
		},
		go: {
			hold: 0.3,
			play(at) {
				// Two rising notes. A whistle, not a fanfare — it happens every round.
				pluck({ at, midi: NOTE.A4, secs: 0.1, gain: 0.26, wide: 7, air: 0.3 });
				wood({ at, midi: NOTE.A3, secs: 0.12, gain: 0.14, ratio: 3, index: 1.4 });
				pluck({
					at: at + 0.11,
					midi: NOTE.E5,
					secs: 0.24,
					gain: 0.3,
					wide: 7,
					vibrato: 5.5,
					air: 0.35
				});
			}
		},
		win: {
			hold: 0.5,
			play(at) {
				// A little arpeggio, on wood rather than on beeps. Short enough that "Nochmal" is never
				// waiting on it.
				for (const [i, midi] of [NOTE.C5, NOTE.E5, NOTE.G5, NOTE.C6].entries()) {
					wood({
						at: at + i * 0.075,
						midi,
						secs: 0.32,
						gain: 0.3,
						ratio: 4,
						index: 1.5,
						air: 0.4
					});
				}
				sparkle(at + 0.3, 0.13);
			}
		},
		lose: {
			hold: 0.5,
			play(at) {
				// Down, and gentle. Losing happens to somebody every round and this is a game for
				// eight-year-olds: a sad trombone is a punishment, and there is nothing to punish. The
				// Eis still lands, quietly, because it was still earned.
				pluck({ at, midi: NOTE.G4, secs: 0.26, gain: 0.2, wide: 6, air: 0.35 });
				wood({ at: at + 0.13, midi: NOTE.E4, secs: 0.36, gain: 0.18, ratio: 3.4, index: 1.3 });
				sparkle(at + 0.34, 0.075);
			}
		},
		creak: {
			hold: 0.5,
			play(at) {
				// The ice under YOU starting to give: a slow groan with a wobble in it, the one sound
				// in the set that is meant to arrive before the thing it is about. Quiet, because it
				// is followed three seconds later by the loud one — and because a child who is being
				// warned should feel warned, not startled.
				pluck({
					at,
					midi: NOTE.G2,
					glide: -3,
					secs: 0.55,
					gain: 0.17,
					type: 'sawtooth',
					bright: 4.5,
					q: 2.2,
					attack: 0.06,
					vibrato: 6.5,
					air: 0.3
				});
				pluck({
					at: at + 0.07,
					midi: NOTE.D3,
					glide: -2,
					secs: 0.42,
					gain: 0.075,
					bright: 3,
					attack: 0.05,
					vibrato: 5
				});
				puff({ at, secs: 0.4, gain: 0.06, from: 700, to: 220, attack: 0.12 });
			}
		},
		crack: {
			hold: 0.22,
			play(at) {
				// Ice breaking, and the loudest thing in the game. Four layers, because it is four
				// things at once: a snap off the top, wood splitting, the mass of it going down, and
				// the water coming in after. Bright at the front so it cuts through a scrum on a phone
				// speaker.
				puff({
					at,
					secs: 0.07,
					gain: 0.42,
					from: 9000,
					to: 2600,
					above: 1200,
					attack: 0.001
				});
				wood({ at, midi: NOTE.A4, secs: 0.2, gain: 0.3, ratio: 5.1, index: 4.5, air: 0.2 });
				// The mass of it. Kept shallow and modest on purpose: a sine sweeping to 65 Hz is
				// inaudible on a phone and still leans on the compressor, so it would duck the three
				// layers above it to pay for something only headphones can hear.
				pluck({ at, midi: NOTE.G2, glide: -3, secs: 0.36, gain: 0.2, type: 'sine', bright: 3 });
				puff({ at: at + 0.05, secs: 0.42, gain: 0.28, from: 3200, to: 400, air: 0.3 });
			}
		},
		growl: {
			hold: 0.6,
			play(at) {
				// Low, long and rough: the one sound in the set that is a THREAT rather than an event.
				// The roughness is the point — a throat is an oscillator that wobbles at about
				// twenty-eight hertz, and two clean detuned saws without that read as a machine, which
				// is exactly what the first version of this sounded like.
				//
				// An OCTAVE above where it started life, and that is the phone speaker rather than
				// taste: the first version growled at 78 Hz through a filter three harmonics up, which
				// is a shape a 12 mm driver cannot move air at. What reads as low on a phone is
				// energy between 200 and 800 Hz with a rough edge on it, and this puts it there.
				pluck({
					at,
					midi: NOTE.G2,
					glide: -2,
					secs: 0.55,
					gain: 0.28,
					type: 'sawtooth',
					bright: 7,
					q: 3,
					attack: 0.03,
					rough: 27,
					air: 0.25
				});
				pluck({
					at: at + 0.04,
					midi: NOTE.G3,
					glide: -3,
					secs: 0.42,
					gain: 0.1,
					type: 'sawtooth',
					bright: 4,
					q: 2,
					attack: 0.04,
					rough: 31
				});
				puff({ at: at + 0.1, secs: 0.32, gain: 0.1, from: 800, to: 200, attack: 0.04 });
			}
		},
		huff: {
			hold: 0.6,
			play(at) {
				// A breath, and nothing else. It is behind the player and it is not news — it is the
				// reason they are running.
				puff({
					at,
					secs: 0.16,
					gain: 0.11,
					from: 900,
					to: 380,
					type: 'bandpass',
					q: 1.3,
					attack: 0.02,
					air: 0.3
				});
				pluck({ at, midi: NOTE.C3, glide: -2, secs: 0.14, gain: 0.09, type: 'sine', bright: 3 });
			}
		},
		door: {
			hold: 0.4,
			play(at) {
				// "You can go in." Two notes UP, on wood, with air around them — the friendliest thing
				// the game says, because what arrives with it is the biggest button on the island and
				// the only way a child gets into a game at all. It is also why this is not a UI blip: a
				// blip is a control acknowledging a press, and nothing was pressed. Something opened.
				wood({ at, midi: NOTE.E5, secs: 0.24, gain: 0.2, ratio: 4, index: 1.4, air: 0.45 });
				wood({
					at: at + 0.09,
					midi: NOTE.A5,
					secs: 0.3,
					gain: 0.18,
					ratio: 4,
					index: 1.2,
					air: 0.5
				});
			}
		},
		arrive: {
			hold: 0.4,
			play(at) {
				// The same wood, one note, no rise, and quieter: "you are somewhere" without the promise
				// that you can go in. A place with nothing behind it raises no button, and the sound has
				// to agree with the screen about that.
				wood({ at, midi: NOTE.C5, secs: 0.26, gain: 0.14, ratio: 4, index: 1.2, air: 0.5 });
			}
		},
		greet: {
			hold: 0.5,
			play(at) {
				// A voice, not a chime: two quick bloops with the pitch sliding inside each one, which
				// is the whole trick behind the way the games this one is aimed at make their people
				// talk. Mid-register and close, so it cannot be mistaken for the bird — that one is
				// high, thin, wobbling and a long way off.
				pluck({ at, midi: NOTE.C5, glide: 4, secs: 0.09, gain: 0.13, type: 'sine', air: 0.3 });
				pluck({
					at: at + 0.11,
					midi: NOTE.E5,
					glide: -3,
					secs: 0.1,
					gain: 0.11,
					type: 'sine',
					air: 0.3
				});
			}
		},
		wave: {
			hold: 1.4,
			play(at) {
				// The sea on the beach: a slow swell in and a slower one out. `attack` is what makes it
				// a wave rather than a burst of static — a wash that starts instantly is a hiss.
				puff({
					at,
					secs: 0.95,
					gain: 0.11 + wobble() * 0.02,
					from: 1000,
					to: 190,
					attack: 0.3,
					air: 0.3
				});
			}
		},
		bird: {
			hold: 2,
			play(at) {
				// Two chirps, high and quiet and a long way off. The one sound in the game that is
				// there purely so the island is not silent.
				pluck({
					at,
					midi: NOTE.E6,
					glide: 3,
					secs: 0.09,
					gain: 0.075,
					type: 'sine',
					vibrato: 24,
					air: 0.6
				});
				pluck({
					at: at + 0.13,
					midi: NOTE.G6,
					glide: -2,
					secs: 0.08,
					gain: 0.055,
					type: 'sine',
					vibrato: 20,
					air: 0.6
				});
			}
		},
		wind: {
			hold: 1.6,
			play(at) {
				// Air going past, on a course. Two bands so it moves: the low one is the body and the
				// high one is what makes it feel fast.
				puff({ at, secs: 1.3, gain: 0.13, from: 620, to: 300, attack: 0.45, air: 0.25 });
				puff({
					at: at + 0.2,
					secs: 0.9,
					gain: 0.045,
					from: 1800,
					to: 1100,
					type: 'bandpass',
					q: 0.7,
					attack: 0.35
				});
			}
		}
	};

	/** The interface's own noises. See `Sound.ui`. */
	const UI: Record<UiCue, Voice> = {
		tap: {
			hold: 0.05,
			play(at) {
				// A chunky button needs a chunky sound: one wooden tap, no pitch movement, no tail.
				wood({ at, midi: NOTE.A4, secs: 0.09, gain: 0.18, ratio: 2.6, index: 1.2, air: 0.25 });
			}
		},
		eis: {
			hold: 0.12,
			play(at) {
				wood({ at, midi: NOTE.C5, secs: 0.2, gain: 0.18, ratio: 4, index: 1.4, air: 0.4 });
				sparkle(at + 0.04, 0.16);
			}
		},
		talk: {
			// Short, because a voice is a rate rather than a sound: called once per line it is a
			// punctuation mark, and called every few characters of a bubble that types itself out it is
			// somebody speaking. Whoever owns the bubble decides which, and the guard here is set for
			// the fast case.
			hold: 0.045,
			play(at) {
				// A syllable, and a different one every time — the pitch is drawn from the scale rather
				// than fixed, which is the difference between talking and a modem. Same shape as
				// `greet`, since it is the same mouth.
				const scale = [NOTE.C5, NOTE.E5, NOTE.G5, NOTE.A5];
				const midi = scale[Math.floor(jitter.next() * scale.length)] ?? NOTE.E5;
				pluck({
					at,
					midi,
					glide: wobble() > 0 ? 2 : -2,
					secs: 0.07,
					gain: 0.1,
					type: 'sine',
					bright: 5,
					air: 0.25
				});
			}
		}
	};

	/** When each sound was last heard, so `hold` can be enforced. */
	const lastAt = new Map<Cue | UiCue, number>();

	/**
	 * Play one, if it is not too soon after the last one of the same kind.
	 *
	 * The few milliseconds of jitter are the last part of "never the same twice": two cues in one
	 * frame are scheduled on the same sample otherwise, and simultaneous attacks sum into one
	 * transient instead of reading as two things happening.
	 */
	function fire(key: Cue | UiCue, voice: Voice, now: number) {
		if (now - (lastAt.get(key) ?? -Infinity) < voice.hold) return;
		lastAt.set(key, now);
		try {
			voice.play(now + LOOKAHEAD + jitter.next() * 0.004);
		} catch {
			// A noise that throws costs a noise, never the game — the same bargain `storage.ts` makes
			// for a store that misbehaves, and it matters more here: this is called from inside
			// `render/loop.ts`'s draw, so an exception escaping would not break the sound, it would
			// stop the frame loop and freeze the game behind a picture that looks fine. Web Audio
			// throws for reasons that depend on the device (a browser that runs out of voices, a
			// parameter one implementation accepts and another does not), which is exactly the class of
			// failure that must not reach a child's phone as a hang.
		}
	}

	/** One interface noise, as a function, so `toggle` can use it without depending on how it was called. */
	const playUi = (cue: UiCue) => {
		if (muted || context.state !== 'running') return;
		fire(cue, UI[cue], context.currentTime);
	};

	return {
		get muted() {
			return muted;
		},

		toggle() {
			muted = !muted;
			setMuted(muted);
			// Unmuting is itself a gesture, so it is also the moment a context suspended since page
			// load is allowed to start.
			unlock();
			// And it answers for itself. The button has an icon on it, so this is confirmation rather
			// than information — but "did that work?" is a question a child should not have to hold a
			// phone to their ear to answer, and the only honest reply to it is a noise.
			if (!muted) playUi('tap');
		},

		play(cues) {
			if (muted || cues.length === 0 || context.state !== 'running') return;
			const now = context.currentTime;
			for (const cue of cues) fire(cue, SOUNDS[cue], now);
		},

		ui: playUi
	};
}
