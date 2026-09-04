import { describe, expect, it } from 'vitest';
import { zoneUnder } from '../sim/island';
import type { Penguin, World } from '../sim/types';
import { createWorld } from '../sim/world';
import { islanderAt } from './cast';
import { EMOTE_REPLIES, OWN_LINES, ZONE_LINES } from './lines';
import { createBoard, MISSIONS } from './missions';
import {
	type Conversation,
	createConversation,
	LINE_TICKS,
	TALK_RANGE,
	TALK_RANGE_EXIT
} from './talk';

const ME = 'me';

/** A solo island: the player and the whole cast, spawned round the zones exactly as the game does. */
function island(): World {
	return createWorld([ME, ...Array.from({ length: 8 }, (_, i) => `bot${i + 1}`)], 7, 'island');
}

function at(world: World, index: number): Penguin {
	const penguin = world.penguins[index];
	if (!penguin) throw new Error(`the island was built without penguin ${index}`);
	return penguin;
}

/**
 * Send every islander except the named ones out to sea, keeping the rest where they spawned.
 *
 * Needed because the spawn deals two penguins to some zones and they land a couple of metres apart —
 * which is the island working correctly and makes "who is the nearest islander" ambiguous in a test
 * about one of them. Nothing is stepped here, so a position off the map is just a position.
 */
function only(world: World, ...keep: number[]) {
	for (const [i, penguin] of world.penguins.entries()) {
		if (i === 0 || keep.includes(i)) continue;
		penguin.pos = { x: 500 + i * 10, z: 500 };
	}
}

/** Stand the player next to somebody, close enough to be talked to. */
function walkUpTo(world: World, penguin: Penguin) {
	at(world, 0).pos = { x: penguin.pos.x + TALK_RANGE * 0.5, z: penguin.pos.z };
}

/** Wait for the current line to run out, and take the next one. */
function next(world: World, talk: Conversation) {
	world.tick += LINE_TICKS;
	return talk.poll(world, ME);
}

/**
 * Walking up to a penguin and being talked to.
 *
 * The two properties worth defending are the ones a child would notice within a minute: what somebody
 * says fits where they are standing, and nobody says the same thing twice in a row. Everything else in
 * here is about the state machine not getting stuck — a conversation that survives the penguin walking
 * away is a bubble hanging over an empty square.
 *
 * `joker` and `granny` are used for the ordinary cases on purpose: neither owns a mission, so nothing
 * jumps the queue in front of the line being asserted.
 */
describe('talking to somebody', () => {
	it('says nothing when nobody is close', () => {
		const world = island();
		only(world);
		// A bubble with no penguin under it is worse than silence.
		expect(createConversation(1, createBoard()).poll(world, ME)).toBeNull();
	});

	it('opens with something about the place they are standing in', () => {
		// This is the island teaching itself. The rules of the classic round arrive from a penguin
		// standing on the jetty, in the seconds before a child walks into it, rather than from a
		// tutorial screen nobody reads.
		const world = island();
		const joker = at(world, 7);
		const zone = zoneUnder(joker);
		expect(zone).not.toBeNull();
		only(world, 7);
		walkUpTo(world, joker);

		const speech = createConversation(3, createBoard()).poll(world, ME);
		expect(speech?.speaker).toBe(islanderAt(7)?.name);
		expect(ZONE_LINES[zone?.id ?? '']).toContain(speech?.text);
	});

	it('follows the place with something of their own', () => {
		// Only zone lines is a museum audio guide; only own lines is eight strangers who never mention
		// the enormous mountain they are standing on. The alternation is what makes them people.
		const world = island();
		only(world, 7);
		walkUpTo(world, at(world, 7));
		const talk = createConversation(3, createBoard());
		talk.poll(world, ME);
		expect(OWN_LINES.joker).toContain(next(world, talk)?.text);
	});

	it('holds one line for its full four seconds', () => {
		// Polled from the readout at ~10 Hz, so without a threshold the bubble would re-roll forty
		// times a second and be unreadable.
		const world = island();
		only(world, 7);
		walkUpTo(world, at(world, 7));
		const talk = createConversation(5, createBoard());
		const first = talk.poll(world, ME);
		world.tick += LINE_TICKS - 1;
		expect(talk.poll(world, ME)?.text).toBe(first?.text);
		world.tick += 1;
		expect(talk.poll(world, ME)?.text).not.toBe(first?.text);
	});

	it('never says the same thing twice in a row', () => {
		// The failure this exists for is a two-line pool plus an unlucky seed, which reads as a broken
		// penguin. Driven long enough to cycle both pools several times over.
		const world = island();
		only(world, 8);
		walkUpTo(world, at(world, 8));
		const talk = createConversation(11, createBoard());
		let previous = talk.poll(world, ME)?.text;
		for (let i = 0; i < 40; i++) {
			const said = next(world, talk)?.text;
			expect(said).not.toBe(previous);
			previous = said;
		}
	});

	it('stops once the player has clearly walked away', () => {
		// Past `TALK_RANGE_EXIT` rather than `TALK_RANGE` itself — a hair over the strict range no
		// longer ends things at once, which is `TALK_RANGE_EXIT`'s whole job (see the constant and
		// "does not restart every tick" above). This asserts the other half still holds: leaving for
		// real, not just drifting past the inner line, ends the conversation rather than never.
		const world = island();
		const joker = at(world, 7);
		only(world, 7);
		walkUpTo(world, joker);
		const talk = createConversation(13, createBoard());
		expect(talk.poll(world, ME)).not.toBeNull();

		at(world, 0).pos = { x: joker.pos.x + TALK_RANGE_EXIT + 0.1, z: joker.pos.z };
		expect(talk.poll(world, ME)).toBeNull();
	});

	it('does not restart every tick while hovering right at the edge of TALK_RANGE', () => {
		// A wanderer stops and drifts near a landmark rather than sitting still (`sim/bot.ts`,
		// `bot: 'roam'`), and a player standing still is never perfectly still either — so two people
		// parked near the exact range boundary cross it constantly. Every crossing used to read as a
		// brand new arrival: `nearest` returned null for a tick, and the tick after that `arrived` was
		// true again, resetting `turn` and picking a fresh line — which is what "just bip bip bip
		// endless" (Daniel, 2026-08-22) actually was, since `cues.ts` fires a fresh `greet` on every
		// such arrival too.
		const world = island();
		const joker = at(world, 7);
		only(world, 7);
		const talk = createConversation(23, createBoard());

		walkUpTo(world, joker);
		const opened = talk.poll(world, ME);
		expect(opened).not.toBeNull();

		// Hover exactly astride TALK_RANGE for a few ticks, the way drifting on ice or a wandering
		// islander actually would — never far enough to be a real departure.
		for (const nudge of [0.05, -0.05, 0.05, -0.05, 0.05]) {
			at(world, 0).pos = { x: joker.pos.x + TALK_RANGE + nudge, z: joker.pos.z };
			const speech = talk.poll(world, ME);
			expect(speech?.by).toBe('joker');
			// Same line as when the conversation opened: a crossing must not read as a fresh arrival.
			expect(speech?.text).toBe(opened?.text);
		}
	});

	it('starts again from the place when you come back', () => {
		// Coming back has to be a fresh conversation rather than the middle of the old one: a child who
		// went to play a game and returned would otherwise be dropped into line seven.
		const world = island();
		const joker = at(world, 7);
		only(world, 7);
		walkUpTo(world, joker);
		const talk = createConversation(17, createBoard());
		talk.poll(world, ME);
		next(world, talk);

		at(world, 0).pos = { x: joker.pos.x + TALK_RANGE + 5, z: joker.pos.z };
		talk.poll(world, ME);
		walkUpTo(world, joker);
		expect(ZONE_LINES[zoneUnder(joker)?.id ?? '']).toContain(talk.poll(world, ME)?.text);
	});

	it('switches speaker at once when somebody closer turns up', () => {
		// Otherwise the bubble keeps the old name over the new penguin's head for up to four seconds.
		const world = island();
		const joker = at(world, 7);
		only(world, 7, 8);
		walkUpTo(world, joker);
		const talk = createConversation(19, createBoard());
		expect(talk.poll(world, ME)?.by).toBe('joker');

		const granny = at(world, 8);
		granny.pos = { x: at(world, 0).pos.x + 0.2, z: at(world, 0).pos.z };
		expect(talk.poll(world, ME)?.by).toBe('granny');
	});

	it('meets you on your own doorstep without advertising a game', () => {
		// `Mein Iglu` is the one zone with no round behind it (`Door.kind` is 'home'), which makes it the
		// one place where a line from another pool would be an outright lie — the button there says
		// "Bauen". Asserted rather than trusted because the igloo pool is the newest and the easiest to
		// leave half-wired: the same three derived assertions that caught the zone arriving would not
		// catch a neighbour who was handed the Rathausplatz's script.
		const world = island();
		const neighbour = at(world, 5);
		only(world, 5);
		expect(zoneUnder(neighbour)?.id).toBe('igloo');
		walkUpTo(world, neighbour);

		const talk = createConversation(53, createBoard());
		expect(ZONE_LINES.igloo).toContain(talk.poll(world, ME)?.text);
		expect(OWN_LINES.neighbour).toContain(next(world, talk)?.text);
	});

	it('tells a child that spending exists at all', () => {
		// The igloo engineer's finding: the whole feature is invisible because nothing on the island
		// says Eis can be SPENT. This pool is one of the two places that can say it, so at least one
		// line has to actually name the currency — a pool of pleasantries would pass every other test
		// in this file and fix nothing.
		expect(ZONE_LINES.igloo?.some((line) => line.includes('Eis'))).toBe(true);
	});

	it('will not be talked to mid-jump, in either direction', () => {
		// The same guard a door applies (`zoneUnder`), and for the same reason: a bubble over somebody
		// who is airborne reads as belonging to whoever is standing behind them.
		const world = island();
		const joker = at(world, 7);
		only(world, 7);
		walkUpTo(world, joker);
		const talk = createConversation(23, createBoard());

		joker.height = 1;
		expect(talk.poll(world, ME)).toBeNull();
		joker.height = 0;
		expect(talk.poll(world, ME)).not.toBeNull();
		at(world, 0).height = 1;
		expect(talk.poll(world, ME)).toBeNull();
	});
});

describe('answering an emote', () => {
	it('replies in words to the one thing a player can say', () => {
		// The whole two-way conversation this game allows: the player picks one of six fixed symbols
		// and the island answers with a line we wrote. Nothing the player supplied is ever echoed,
		// because there is nothing they can supply.
		const world = island();
		only(world, 7);
		walkUpTo(world, at(world, 7));
		const talk = createConversation(29, createBoard());
		talk.poll(world, ME);

		talk.sawEmote('heart');
		expect(EMOTE_REPLIES.heart).toContain(talk.poll(world, ME)?.text);
	});

	it('answers straight away rather than at the end of the current line', () => {
		// A reply that arrives after a joke about the weather is not a reply.
		const world = island();
		only(world, 7);
		walkUpTo(world, at(world, 7));
		const talk = createConversation(31, createBoard());
		const first = talk.poll(world, ME)?.text;
		talk.sawEmote('wave');
		world.tick += 1;
		const reply = talk.poll(world, ME)?.text;
		expect(reply).not.toBe(first);
		expect(EMOTE_REPLIES.wave).toContain(reply);
	});

	it('answers once, not for the rest of the conversation', () => {
		const world = island();
		only(world, 7);
		walkUpTo(world, at(world, 7));
		const talk = createConversation(37, createBoard());
		talk.poll(world, ME);
		talk.sawEmote('dance');
		talk.poll(world, ME);
		expect(EMOTE_REPLIES.dance).not.toContain(next(world, talk)?.text);
	});
});

describe('missions in a conversation', () => {
	const errand = MISSIONS.find((m) => m.by === 'racer');
	if (!errand) throw new Error('the racer stopped handing out errands');

	it('offers the errand before any small talk', () => {
		// A penguin with something to ask who opens with a joke is a mission a child never hears of.
		const world = island();
		only(world, 1);
		walkUpTo(world, at(world, 1));
		const speech = createConversation(41, createBoard()).poll(world, ME);
		expect(speech?.text).toBe(errand.ask);
		// The reward travels with the line, so the bubble cannot show a different mission from the one
		// being talked about.
		expect(speech?.mission?.reward).toBe(errand.reward);
	});

	it('goes back to ordinary talk once it has been asked', () => {
		// The reminder is an OPENER only. Repeating it every four seconds is the difference between a
		// penguin looking forward to something and a penguin going on about it.
		const world = island();
		only(world, 1);
		walkUpTo(world, at(world, 1));
		const talk = createConversation(43, createBoard());
		talk.poll(world, ME);
		const second = next(world, talk);
		expect(second?.text).not.toBe(errand.ask);
		expect(second?.text).not.toBe(errand.nag);
		expect(second?.mission).toBeNull();
	});

	it('hands the reward over when the player comes back with it', () => {
		const world = island();
		const racer = at(world, 1);
		only(world, 1);
		walkUpTo(world, racer);
		const board = createBoard();
		const talk = createConversation(47, board);
		talk.poll(world, ME);

		// Off to the Eisarena and back. `Game.svelte` reports the round; the walk back is the hand-in.
		board.report({ mode: errand.mode, finished: true, won: true });
		at(world, 0).pos = { x: racer.pos.x + TALK_RANGE + 5, z: racer.pos.z };
		talk.poll(world, ME);
		walkUpTo(world, racer);

		expect(talk.poll(world, ME)?.text).toBe(errand.done);
		expect(board.collect()).toBe(errand.reward);
	});
});
