import { describe, expect, it } from 'vitest';
import { BEAK_COLOURS, BODY_COLOURS, HAT_COLOURS, HATS } from '../look';
import { MAX_NAME_LENGTH } from '../names';
import { ISLAND_ZONES, zoneAt } from '../sim/island';
import { createWorld } from '../sim/world';
import { ISLANDERS, islanderAt, islanderById } from './cast';

/**
 * The cast, and the one thing about it that can silently go wrong.
 *
 * Everything else here is an integrity check on eight rows of data. The test that earns its place is
 * the SPAWN alignment: `cast.ts` is written in the order `sim/island.spawnOnTheIsland` deals penguins
 * round the zones, and nothing in the type system says so. Re-order `ISLAND_ZONES` and the shopkeeper
 * opens the game standing in the sea lion's cave, which reads as a content bug and is a layout one.
 */
describe('the islanders', () => {
	it('gives every character a distinct name from the generator', () => {
		// Distinct because two identical tags in one scene is the failure `names.ts` exists to prevent,
		// and it is worse for a hub than for a round: these are the eight a child learns by name.
		const names = ISLANDERS.map((one) => one.name);
		expect(new Set(names).size).toBe(names.length);
		for (const name of names) {
			expect(name.length).toBeGreaterThan(0);
			// The tag over the head is a canvas texture sized to the text. A character whose seed
			// happened to draw a long pairing would crowd the penguin it labels.
			expect(name.length).toBeLessThanOrEqual(MAX_NAME_LENGTH);
		}
	});

	it('gives every character a distinct id', () => {
		// The id is a key the mission board and the line pools both use, so a duplicate would give two
		// penguins one voice.
		expect(new Set(ISLANDERS.map((one) => one.id)).size).toBe(ISLANDERS.length);
	});

	it('spends the whole body palette before repeating a colour', () => {
		// The body colour is how a child tells two penguins apart at a distance where no tag is
		// readable — `look.ts` measured that palette for exactly that, including without hue. There are
		// eight colours and the cast is longer, so a repeat is arithmetic rather than carelessness; what
		// would be carelessness is repeating one while a colour nobody wears is still on the shelf.
		const bodies = ISLANDERS.map((one) => one.look.body);
		expect(new Set(bodies).size).toBe(Math.min(ISLANDERS.length, BODY_COLOURS.length));
	});

	it('never gives two neighbours the same colour, or anybody the same outfit', () => {
		// The two halves that make a repeated body harmless: the pair who share one live at opposite
		// ends of the island, and no two characters are the same penguin from head to hat.
		const outfits = ISLANDERS.map((one) => JSON.stringify(one.look));
		expect(new Set(outfits).size).toBe(ISLANDERS.length);
		for (const one of ISLANDERS) {
			const twins = ISLANDERS.filter((other) => other.look.body === one.look.body);
			expect(new Set(twins.map((twin) => twin.home)).size).toBe(twins.length);
		}
	});

	it('dresses everybody in a look the palette actually has', () => {
		// An out-of-range index is coerced by `resolveLook` rather than thrown, so the failure mode is
		// a penguin quietly wearing the wrong colour forever. Checked here instead.
		for (const { look } of ISLANDERS) {
			expect(look.body).toBeLessThan(BODY_COLOURS.length);
			expect(look.beak).toBeLessThan(BEAK_COLOURS.length);
			expect(look.hatColour).toBeLessThan(HAT_COLOURS.length);
			expect(HATS).toContain(look.hat);
		}
	});

	it('gives everybody a home that is a real place on the island', () => {
		const zones = ISLAND_ZONES.map((zone) => zone.id);
		for (const one of ISLANDERS) expect(zones).toContain(one.home);
	});

	it('leaves no zone on the island unattended', () => {
		// Five zones, eight characters: an unattended zone is a place a child walks to and finds
		// nobody, which is the one thing a hub cannot afford at the door to a game they have not
		// played yet — the zone lines are where the rules come from.
		const homes = new Set(ISLANDERS.map((one) => one.home));
		for (const zone of ISLAND_ZONES) expect(homes).toContain(zone.id);
	});

	it('starts each of them at the place they are written for', () => {
		// The alignment, asserted against the REAL spawn rather than against the comment that claims
		// it. `[me, ...bots]` is how `Game.svelte` builds a solo roster, so index 0 is the player and
		// the cast starts at 1. The roster is long enough to reach EVERY character, including the ones
		// a nine-penguin solo island does not deal out — an unreachable character is still a character
		// that has to be standing in the right place the day a room is big enough to show it.
		const ids = ['me', ...ISLANDERS.map((_, i) => `bot${i + 1}`)];
		const world = createWorld(ids, 4242, 'island');
		for (const [i, penguin] of world.penguins.entries()) {
			const who = islanderAt(i);
			if (!who) continue;
			expect(zoneAt(penguin.pos)?.id).toBe(who.home);
		}
	});

	it('has nobody at index 0, because index 0 is the player', () => {
		// The off-by-one this file is most likely to grow. If it ever slips, the child's own penguin
		// gets a character's name and look, and the character it stole them from is the one who
		// disappears — a bug that looks like a missing NPC and is not.
		expect(islanderAt(0)).toBeNull();
		expect(islanderAt(-1)).toBeNull();
		expect(islanderAt(1)?.id).toBe(ISLANDERS[0]?.id);
	});

	it('runs out rather than inventing somebody', () => {
		// A world with more penguins than the cast has characters gets ordinary wanderers for the rest.
		// Making one up per call would give a child somebody who is different every time they pass.
		expect(islanderAt(ISLANDERS.length)).not.toBeNull();
		expect(islanderAt(ISLANDERS.length + 1)).toBeNull();
	});

	it('looks up an unknown id instead of throwing', () => {
		expect(islanderById('walrus')).toBeNull();
		expect(islanderById(ISLANDERS[0]?.id ?? '')).not.toBeNull();
	});
});
