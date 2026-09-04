/**
 * Die Flucht: a route of platforms with holes in it, and a sea lion coming up it.
 *
 * The only mode with something hunting the player, and the hunter is a PLACE
 * (`World.hunterAt`) rather than a pursuit — readable, replayable, and impossible to cheese by
 * circling. See `sim/chase.ts`.
 */
import {
	advanceHunter,
	alongCourse,
	chaseCourse,
	courseHeading,
	fleeing,
	hasEscaped,
	isCaught
} from '../chase';
import {
	CHASE_HUNTER_HEADSTART,
	CHASE_RACERS,
	COUNTDOWN_TICKS,
	DT,
	ROUND_MAX_TICKS
} from '../constants';
import { spawnOnTheStartLine } from '../spawn';
import type { World } from '../types';
import { ZERO } from '../vec';
import type { GameMode } from './mode';
import {
	firstToArrive,
	graceFade,
	nothing,
	recoverOnTheCourse,
	shrinkTheStartLine
} from './policy';

/**
 * Advance the sea lion, and eat whoever is behind it.
 *
 * Being caught is elimination, and it goes through `phase = 'falling'` — the same road as drowning.
 * That is not laziness: what happens next is a penguin disappearing under the water and surfacing on
 * a chunk of ice to watch the rest of the round, which is exactly what being eaten should look like,
 * and it means the sidelines, the spectator ring, the camera and the sound all already know what to
 * do with it.
 */
function advanceTheHunter(world: World): void {
	// Frozen with everybody else during the countdown, and stopped once the round is over. A rule that
	// kept running while the players were held would be a rule that decided the round before it
	// started.
	if (world.round.phase !== 'playing') return;

	const running = world.penguins.filter((p) => p.phase === 'skating');
	if (running.length === 0) return;

	let hindmost = Infinity;
	for (const p of running) hindmost = Math.min(hindmost, alongCourse(world.floes, p.pos));
	world.hunterAt = advanceHunter(world.hunterAt, hindmost, world.round.ticks, DT);

	for (const p of running) {
		if (!isCaught(world, p)) continue;
		p.phase = 'falling';
		p.fallTicks = 0;
		p.vel = ZERO;
	}
}

export const CHASE: GameMode = {
	id: 'chase',
	name: 'Flucht',
	// One penguin alone is still a game here: the thing behind you does not need a rival to be
	// frightening, which is the only mode in this game that is true of.
	players: { min: 1, max: 8, solo: CHASE_RACERS },

	floes: (seed) => chaseCourse(seed),
	spawn: spawnOnTheStartLine,
	opening: 'countdown',
	opensAfter: COUNTDOWN_TICKS,
	// Behind the start line rather than on it, so the first thing a player sees is the thing they are
	// running from — and so nobody is eaten during the countdown, when they cannot move.
	open: (world) => {
		world.hunterAt = -CHASE_HUNTER_HEADSTART;
	},

	// Inherited, and wrong. See `shrinkTheStartLine`.
	reshape: shrinkTheStartLine,
	advance: advanceTheHunter,
	// A fall costs exactly the ground the sea lion makes up while you climb out — which the player can
	// SEE arriving, and which is a far better rule than drowning.
	settle: nothing,
	overboard: recoverOnTheCourse,
	// Snowballs and shoves work normally. Knocking a rival into the water while something is eating
	// its way up the line is the meanest thing in this game and it should absolutely stay.
	attackStrength: graceFade,
	ends: (world) => firstToArrive(world, hasEscaped, ROUND_MAX_TICKS),

	standings: fleeing,

	// No doors: the only zones in this game are the hub's, and a round is not a hub.
	doorUnder: null,
	isRound: true,

	framing: 'bearing',
	// Same reasoning as `slide.ts`: a fixed-distance, turning camera rather than an arena fit, and the
	// tall portrait axis is the one pointed down the route — more of what is ahead and more of the sea
	// lion behind, per `backlog/stories/11-portrait.md`.
	portrait: true,
	// Wider than a platform on purpose: what a player has to see is the NEXT one and the thing behind
	// them, and a camera fitted to the three-metre disc under their feet shows neither.
	view: 11,
	// The route rises and falls but it is not a mountain: the rig's usual angle is the right one.
	lift: 0,
	scenery: 'route',
	// From the PAIR of platforms, because a chase platform is flat and has no fall line to read.
	courseHeading: (world, floe) => courseHeading(world.floes, world.floes.indexOf(floe)),
	onTheBelly: false,
	// A chase is a line two hundred metres long with no middle to watch from. Eaten is eaten.
	sidelines: false,
	throwing: true,
	dashing: true,
	bot: 'flee',
	// Nowhere to wander to: an arena is one place, and a course is somewhere you are going anyway.
	landmarks: null,
	hunted: true,

	copy: {
		who: 'Seelöwe!',
		rules: 'Ein Seelöwe kommt · spring von Scholle zu Scholle · wer ans Ufer kommt, gewinnt',
		verdicts: {
			won: 'Du hast es ans Ufer geschafft.',
			lost: 'Der Seelöwe hat dich erwischt.',
			theirs: (name) => `${name} ist entkommen.`,
			nobody: 'Alle gefressen!',
			none: 'Der Seelöwe hat alle erwischt.'
		},
		outOfIt: {
			headline: 'Gefressen!',
			hint: 'Gleich noch mal — wer kommt ans Ufer?'
		},
		dash: { label: 'Schubs', aria: 'Schubsen' }
	}
};
