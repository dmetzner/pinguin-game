/**
 * Klassisch: four penguins, one floe, and the ice runs out.
 *
 * The round every number in this game was tuned against. Everything else in `sim/modes/` is a
 * rearrangement of it.
 */
import { singleFloe } from '../archipelago';
import { COUNTDOWN_TICKS, ROUND_MAX_TICKS } from '../constants';
import { shrinkTheOneFloe } from '../ice';
import { spawnOnOneFloe } from '../spawn';
import type { GameMode } from './mode';
import { drown, graceFade, lastStanding, nothing } from './policy';

export const CLASSIC: GameMode = {
	id: 'classic',
	name: 'Klassisch',
	// Descriptive, and nothing enforces it yet: `min` is the smallest field this mode is a GAME with
	// (one penguin alone on a floe has nothing to do), `solo` is what a single-player round fills it
	// with, and `max` is what the arena holds before the see-saw stops being readable.
	players: { min: 2, max: 8, solo: 4 },

	floes: () => singleFloe(),
	spawn: spawnOnOneFloe,
	opening: 'countdown',
	opensAfter: COUNTDOWN_TICKS,
	open: nothing,

	reshape: shrinkTheOneFloe,
	advance: nothing,
	settle: nothing,
	overboard: drown,
	attackStrength: graceFade,
	ends: (world) => lastStanding(world, ROUND_MAX_TICKS),

	standings: null,

	// No doors: the only zones in this game are the hub's, and a round is not a hub.
	doorUnder: null,
	isRound: true,

	framing: 'arena',
	portrait: false,
	// Fit the arena, whatever size it is this second — the floe shrinks all round, and the camera
	// following it is what makes the ice running out something the player can see.
	view: null,
	lift: 0,
	scenery: 'arena',
	courseHeading: null,
	onTheBelly: false,
	sidelines: true,
	throwing: true,
	dashing: true,
	bot: 'arena',
	// Nowhere to wander to: an arena is one place, and a course is somewhere you are going anyway.
	landmarks: null,
	hunted: false,

	copy: {
		who: '4 Pinguine',
		// The one mode that needs no explaining: a child who opens the app is already in it.
		rules: null,
		verdicts: {
			won: 'Du warst als Letzte:r auf der Scholle.',
			lost: 'Du bist ins Wasser gefallen.',
			theirs: (name) => `${name} bleibt auf der Scholle.`,
			nobody: 'Alle im Wasser!',
			none: 'Niemand gewinnt — das gibt es.'
		},
		outOfIt: {
			headline: 'Du bist draußen',
			hint: 'Wirf Schneebälle von deiner Eisscholle!'
		},
		dash: { label: 'Schubs', aria: 'Schubsen' }
	}
};
