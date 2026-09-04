/**
 * Pingu Royal: thirty penguins across a sea of floes that break one at a time.
 *
 * The sea is not a bigger arena — it is a dozen of the classic one, because the floe tilts from where
 * the weight is standing and one penguin's share of that is 1/N. See `sim/archipelago.ts`.
 */
import { layout } from '../archipelago';
import { COUNTDOWN_TICKS, ROYAL_MAX_TICKS, ROYAL_PLAYERS } from '../constants';
import { sinkTheRing } from '../ice';
import { spawnAcrossTheSea } from '../spawn';
import type { GameMode } from './mode';
import { drown, graceFade, lastStanding, nothing } from './policy';

export const ROYAL: GameMode = {
	id: 'royal',
	name: 'Royal',
	// `solo` decides the size of the SEA as well as the size of the crowd: `archipelago.layout` deals
	// one floe per `ROYAL_PER_FLOE` penguins, so changing it changes how long a Royal lasts.
	players: { min: 2, max: ROYAL_PLAYERS, solo: ROYAL_PLAYERS },

	floes: (seed, players) => layout(players, seed),
	spawn: spawnAcrossTheSea,
	opening: 'countdown',
	opensAfter: COUNTDOWN_TICKS,
	open: nothing,

	reshape: sinkTheRing,
	advance: nothing,
	settle: nothing,
	overboard: drown,
	attackStrength: graceFade,
	// A longer backstop than the classic round: this mode's own clock — the sinking ring — takes about
	// a hundred seconds to run, and a draw called before it has finished is a draw called early.
	ends: (world) => lastStanding(world, ROYAL_MAX_TICKS),

	standings: null,

	// No doors: the only zones in this game are the hub's, and a round is not a hub.
	doorUnder: null,
	isRound: true,

	framing: 'arena',
	portrait: false,
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
		who: '30 Pinguine',
		rules: '30 Pinguine · die Schollen brechen · spring rüber!',
		verdicts: {
			won: 'Du warst als Letzte:r auf dem Eis.',
			lost: 'Du bist ins Wasser gefallen.',
			theirs: (name) => `${name} bleibt auf dem Eis.`,
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
