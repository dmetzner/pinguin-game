/**
 * Die Rutschpartie: a chute of tilted ice, and the race down it.
 *
 * Almost no machinery of its own — gravity already comes from a floe's gradient, so ice with a
 * permanent tilt IS a slide (`sim/slide.ts`).
 */
import { COUNTDOWN_TICKS, ROUND_MAX_TICKS, SLIDE_GRADE } from '../constants';
import { hasFinished, segmentHeading, slideCourse, standings } from '../slide';
import { spawnOnTheStartLine } from '../spawn';
import type { GameMode } from './mode';
import {
	firstToArrive,
	noAttacks,
	nothing,
	recoverOnTheCourse,
	shrinkTheStartLine
} from './policy';

export const SLIDE: GameMode = {
	id: 'slide',
	name: 'Rutsche',
	players: { min: 1, max: 8, solo: 6 },

	floes: (seed) => slideCourse(seed),
	spawn: spawnOnTheStartLine,
	opening: 'countdown',
	opensAfter: COUNTDOWN_TICKS,
	open: nothing,

	// Inherited, and wrong. See `shrinkTheStartLine`.
	reshape: shrinkTheStartLine,
	advance: nothing,
	// Going over the edge costs you TIME rather than your round: see `SLIDE_RECOVER_TICKS`.
	settle: nothing,
	overboard: recoverOnTheCourse,
	attackStrength: noAttacks,
	ends: (world) => firstToArrive(world, hasFinished, ROUND_MAX_TICKS),

	standings,

	// No doors: the only zones in this game are the hub's, and a round is not a hub.
	doorUnder: null,
	isRound: true,

	framing: 'bearing',
	// The camera stands a fixed number of metres behind the racer and turns with the run — never an
	// arena fit — so the constraint that makes `classic`/`royal` unshippable in portrait (a narrow
	// horizontal FOV pushing the fit camera back) does not apply here. And the interesting axis, the
	// run stretching away downhill, is the TALL one on a portrait screen: `backlog/stories/11-portrait.md`
	// calls this the cheapest real win in the story, for that reason.
	portrait: true,
	// Not the segment's own radius: a chute is five metres across and fitting the camera to that puts
	// it two metres from the penguin's back, where the corner ahead is off the top of the screen. This
	// shows the racer and about two segments of run below them — the next bend, and enough of the one
	// after it to commit to a line. Thirteen was the first try and put everybody at ant size.
	view: 5.2,
	// 0.62 of the grade puts the camera about 14° above the run: behind the racer rather than over
	// them, with the ice receding to a horizon, which is where a racing game puts its camera and why.
	// The whole grade overshot to 20° — a bird's-eye view of a penguin, and nothing looks fast from
	// directly above. Lower was better still until the local penguin fell off the bottom of the frame.
	lift: SLIDE_GRADE * 0.62,
	scenery: 'chute',
	// From the segment's own tilt, which IS the fall line.
	courseHeading: (_world, floe) => segmentHeading(floe),
	// On the mountain a penguin travels on its belly. Everywhere else it walks.
	onTheBelly: true,
	sidelines: false,
	// No fighting on the mountain, so no Ball button: it would be visible, pressable and dead. The
	// jump stays, because jumping a bump is half of how you take a corner.
	throwing: false,
	// Zack stays: it shoves nobody here, but it still SETS the velocity, so it is a boost down the
	// hill rather than an attack — the whole reason `copy.dash` below calls it "Anschieben".
	dashing: true,
	bot: 'downhill',
	// Nowhere to wander to: an arena is one place, and a course is somewhere you are going anyway.
	landmarks: null,
	hunted: false,

	copy: {
		who: 'Wettrennen',
		rules: 'Rutsch runter · bleib auf dem Eis · wer zuerst unten ist, gewinnt',
		verdicts: {
			won: 'Du warst als Erste:r unten.',
			lost: 'Jemand war schneller.',
			theirs: (name) => `${name} ist zuerst angekommen.`,
			nobody: 'Alle im Wasser!',
			none: 'Niemand kommt unten an — das gibt es.'
		},
		outOfIt: {
			headline: 'Runtergefallen!',
			hint: 'Gleich noch mal — wer kommt unten an?'
		},
		// It shoves nobody here, but it still SETS the velocity — so it is a boost down the hill rather
		// than an attack, and it is labelled as one.
		dash: { label: 'Zack!', aria: 'Anschieben' }
	}
};
