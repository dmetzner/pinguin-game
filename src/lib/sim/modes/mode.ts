/**
 * What a minigame IS, as a type.
 *
 * `Mode` used to be a four-member string union and its four literals were compared in about thirty
 * non-test files: `world.ts` chose a sea, `round.ts` chose an ending and an attack rule, `step.ts`
 * chose what the rim does, `bot.ts` chose a behaviour, `cues.ts` chose a sound, and the UI chose a
 * camera and six labels. The owner has asked for twenty to thirty minigames. At twenty-five, thirty
 * switch statements is not a codebase anybody can add the twenty-sixth to.
 *
 * So a mode is a DESCRIPTOR, and the rule that makes the refactor worth doing is
 * `modes/guard.test.ts`: nothing outside this directory may compare a mode id. Everything a caller
 * used to learn by comparing, it now asks the descriptor.
 *
 * The interface below is deliberately larger than the sketch in `backlog/stories/10-the-island.md`,
 * and every member on it earns its place by replacing a comparison that was already in the tree —
 * see the note on each one. Nothing speculative: there is no `score`, no `teams`, no `rounds`, and
 * the day a minigame needs one it can have one.
 */
import type { Floe, Mode, Penguin, RoundPhase, Vec2, World } from '../types';

/** A round that has finished, and who won it. `winner` is null for a draw. */
export interface Ending {
	readonly winner: string | null;
}

/**
 * How the camera is aimed. Story 11's portrait policy lives here.
 *
 *  * `arena` — fit the whole floe on screen. This is what makes portrait unshippable: the camera
 *    frames the arena, so a tall screen pushes it back until a penguin is ~4% of the screen.
 *  * `bearing` — the rig turns to follow a course, the lens widens with speed, and the HUD counts
 *    places instead of survivors. `Game.svelte` calls this `racing` and derives six things from it.
 *  * `follow` — sit behind the player at a fixed distance. No arena to fit, which is why the island
 *    is the first mode that can be played on a tall screen.
 */
export type Framing = 'arena' | 'bearing' | 'follow';

/**
 * How a bot plays this mode.
 *
 * A style, shared between modes, rather than a mode id — which is the whole point. `bot.ts` still
 * has one branch per style, but a twenty-sixth minigame declares an existing style and adds no code
 * to it.
 */
export type BotStyle = 'arena' | 'downhill' | 'flee' | 'roam';

/**
 * A place a wandering penguin might decide to go, and how much room there is to stand in it.
 *
 * The radius is not decoration. Five bots that all walked to the exact middle of the Rathausplatz
 * would arrive inside each other, and `combat.resolveCollisions` separates bodies whether or not the
 * mode allows an attack — so they would jitter against each other for as long as they stood there.
 * `bot.ts` picks its own spot inside the radius, which is the same fix `awayFromTheHunter` needed
 * when six bots aiming at one point on a three-metre platform drowned the field at the gap after it.
 */
export interface Landmark {
	readonly at: Vec2;
	readonly radius: number;
}

/**
 * Which set of scenery a mode is played in.
 *
 * `Framing` says where the camera stands; this says what the renderer has to BUILD, and the two are
 * not the same question — the slide and the chase are framed alike and are a chute and a route of
 * platforms respectively. Modes that share a value share the code, which is the point: a sixth
 * minigame played in an arena says `arena` and `Game.svelte` does not change.
 *
 * `hub` is the odd one, and what makes it a kind of its own rather than a large arena is that its
 * ground is ONE anchored piece of terrain that is PERMANENT. Every other surface in this game is on a
 * clock — the classic floe shrinks, a Royal's ring breaks and goes under, a chute segment is left
 * behind — and all of that machinery is what an arena's drawing exists to carry: the crack, the
 * shudder, the tip, the bob, the shrinking radius. A hub needs none of it, so it is CHEAPER to draw
 * than the ice it replaces rather than dearer, and it has room for the grass, sand, wood and red roof
 * story 09 is asking for.
 *
 * **It is called `hub` and not `island` for two reasons, and the first one is a booby trap somebody
 * should not have to find twice.** `Mode` has a member spelled `island` and `modes/guard.test.ts`
 * builds its pattern out of the register's ids — so the perfectly honest line
 * `spec.scenery === 'island'` matches the scan and fails it, a false positive on a differently-typed
 * literal that happens to share a spelling. The right answer to that is to rename the colliding
 * literal rather than to teach the regex about types: a guard that had to know which union a string
 * belongs to would stop being a scan and start being a type checker, badly. The second reason is that
 * it is simply the better name — "island" names the specific place, "hub" names the kind of ground,
 * which is what a `Scenery` union is for, and the second hub will not be an island.
 *
 * It is declared here rather than inferred in `render/scene.ts` from "a single 58 m floe", for two
 * reasons that are both already written down: that is the derived-fact-that-can-disagree pattern
 * `World.mode` was changed away from when a mountain turned out to be several floes too, and it would
 * put mode knowledge inside `render/`, which invariant 2 forbids.
 */
export type Scenery = 'arena' | 'chute' | 'route' | 'hub';

/**
 * A way into something else, standing on the ground where you can walk into it.
 *
 * The hub's zones are the only ones so far (`sim/island.ts`), and they are PLACES rather than
 * triggers for the reason `chase.ts` established: the hunter is a position, not a pursuit, and that is
 * what makes it readable, replayable, and impossible to get stuck in. A door is the same shape — a
 * point, a radius, and what is on the other side — so there is no "entered" event to miss and no
 * "left" event to leak.
 */
export interface Door {
	/** Stable, and never player-visible. Persisted state may key on it, so treat it as a wire value. */
	readonly id: string;
	/** Player-visible, German, from the same curated discipline as `names.ts`. */
	readonly name: string;
	/**
	 * What KIND of thing is on the other side: a minigame, the shop, or the player's own home.
	 *
	 * Mirrors `island.ZoneDestination['kind']` rather than importing it, so this file keeps importing
	 * nothing but `sim/types` — and if the two ever part company the mapping in `modes/island.ts` is a
	 * compile error rather than a surprise.
	 *
	 * It exists so a component never writes `doorHere.id === 'igloo'`. An id is a name; a kind is a
	 * decision, and decisions belong to the descriptor. Same rule as a mode id, one level down.
	 */
	readonly kind: 'mode' | 'shop' | 'home';
	/**
	 * The minigame on the other side, or null for a door that is not built yet.
	 *
	 * Null is not an oversight, it is the point: it lets Der Laden be a PLACE on the island — a
	 * building with a sign you can stand in front of — before it is a screen (story 10d). A door that
	 * named a mode this build cannot play would be a button that is visible, pressable and dead, which
	 * is trap 4's shape and has been paid for four times in this repo. `null` is what the UI reads to
	 * show the place and no prompt.
	 */
	readonly opens: Mode | null;
}

/**
 * Everything a mode says to the player, in German.
 *
 * On the descriptor rather than in a table beside the component, because a table beside the component
 * is a second list to remember: the whole justification for this directory is that adding a minigame
 * is one file. TypeScript makes that stick — a mode cannot be registered without answering all of it.
 *
 * The one cost, stated so nobody has to rediscover it: the day this game is translated, these strings
 * have to leave `sim/`. `lib/names.ts` is the precedent that argues they should already be in `lib/`,
 * and moving this one field group there is mechanical if that day comes. It is not a purity violation
 * in the sense `purity.test.ts` polices — a string is not a framework, a clock or a browser global.
 */
export interface ModeCopy {
	/** Who is in it, under the name on the mode button. "4 Pinguine", "Wettrennen". */
	readonly who: string;
	/**
	 * What this game IS, in one line, for the start screen and the countdown.
	 *
	 * Null for the mode that needs no explaining. A child who pressed "Royal" without knowing what it
	 * meant finds out here rather than by drowning.
	 */
	readonly rules: string | null;
	/**
	 * What the result screen says, which is a different sentence in every mode.
	 *
	 * "Du warst als Letzte:r auf der Scholle" is true of the classic round and of a Royal, is simply
	 * wrong about a race — where the winner arrived first and nobody was last on anything — and is
	 * wrong about a chase, where losing means something ate you. This is the screen a child reads most
	 * carefully, at the moment they most want it to make sense.
	 */
	readonly verdicts: {
		readonly won: string;
		readonly lost: string;
		readonly theirs: (name: string) => string;
		/** Everybody went in on the same tick. */
		readonly nobody: string;
		/** The backstop ran out with nobody having won. */
		readonly none: string;
	};
	/**
	 * What a penguin who is out of it is told, and what it can still do.
	 *
	 * The hint is the whole point of the sidelines: a child who has just gone in the water has to be
	 * told, in the second it happens, that the Ball button still does something — or, where it does
	 * not, that another round is coming.
	 */
	readonly outOfIt: { readonly headline: string; readonly hint: string };
	/** The third button. It shoves in most modes and pushes you downhill in one, so it is labelled per mode. */
	readonly dash: { readonly label: string; readonly aria: string };
}

export interface GameMode {
	/**
	 * The id, and it goes on the wire as a string (`net/protocol.ts`).
	 *
	 * Typed as `Mode` rather than `string` so that `MODES` in `registry.ts` is a total record: adding
	 * a literal to the union without writing a descriptor is a compile error, which is the one place
	 * a registry can be forgotten.
	 */
	readonly id: Mode;
	/** Player-visible, German, from the same curated discipline as `names.ts`. */
	readonly name: string;
	/**
	 * How many penguins this mode is for, and how many a solo game fills it with.
	 *
	 * `solo` replaces the count `Game.svelte` derived from the mode — thirty for a Royal, six on the
	 * mountain, four in the classic round. In a Royal it decides the size of the SEA as well as the
	 * size of the crowd (`archipelago.layout` deals one floe per three penguins).
	 */
	readonly players: { readonly min: number; readonly max: number; readonly solo: number };

	// --- building one ---------------------------------------------------------

	/** The ice this mode is played on. Seeded: the same seed is the same arrangement, on every device. */
	floes(seed: number, players: number): Floe[];
	/** Where everybody starts, on the ice this mode just built. */
	spawn(ids: readonly string[], floes: readonly Floe[], seed: number): Penguin[];
	/**
	 * The phase a fresh round opens in.
	 *
	 * `countdown` wherever a round is a round. The island opens straight into `playing`, which is how
	 * "roaming is a phase, not a round" is expressed without a fourth `RoundPhase`: a new phase would
	 * mean a new index on the wire and a change to `inputIsFrozen` and `motionIsFrozen`, which every
	 * mode reads — and what roaming needs is exactly what `playing` already means (controls live,
	 * physics live). What it does NOT need is an ending, and that is `ends`.
	 */
	readonly opening: RoundPhase;
	/**
	 * Ticks between the world existing and the controls waking up.
	 *
	 * `COUNTDOWN_TICKS` — three seconds — everywhere today, and per-mode because a countdown and a RIDE
	 * are the same phase seen from two ends. `opening: 'countdown'` already means "the world exists, the
	 * controls are dead, something is about to happen", which is exactly a gondola climbing a mountain,
	 * so the ride is a picture drawn over a countdown and the simulation needs to know nothing about
	 * it. The only thing it needs is that the mountain's beat can be longer than three seconds, because
	 * a ride that lasts three seconds is not a ride.
	 *
	 * **It is NOT the no-hitting grace, and the two cannot drift into each other.** `round.attackStrength`
	 * fades in over `ROUND_GRACE_FADE_TICKS` *after play begins*, and it is safe from this field
	 * structurally rather than by luck: `stepRound` zeroes `round.ticks` at the transition, so the grace
	 * counts from the whistle and never from the world. Lengthening a countdown moves when the controls
	 * wake up and moves nothing about when anybody may be hit. That pairing was measured at 0.69 m of
	 * client correction and refused (`session.test.ts`), and it stays refused.
	 *
	 * Inert for a mode that opens straight into `playing` — nothing counts down to a place.
	 */
	readonly opensAfter: number;
	/** Anything else a fresh world needs. The chase's hunter headstart is the only one so far. */
	open(world: World): void;

	// --- one tick ------------------------------------------------------------

	/**
	 * What this mode does to the ICE, once per tick, while playing.
	 *
	 * Called from `stepRound` and therefore BEFORE anybody moves, because the rim check downstream has
	 * to run against this tick's radius rather than the previous one.
	 */
	reshape(world: World): void;
	/**
	 * The mode's own moving parts: after the ice, before the penguins.
	 *
	 * Before the penguins on purpose. A hunter that advanced afterwards would be judging this tick's
	 * positions against last tick's danger, which is half a metre of lie at walking pace and always in
	 * the player's favour — right up to the frame where it is not.
	 */
	advance(world: World): void;
	/**
	 * Let the world settle, AFTER everybody has moved and after bodies have been separated.
	 *
	 * The slot exists because `step.ts` already states the principle and this is the same case: contact
	 * and projectiles resolve after everyone has moved, "against the positions this tick actually
	 * produced. Resolving them first would judge overlaps that no longer exist." A wall resolved BEFORE
	 * the move is a wall a dash gets 17 cm inside — measured, by the test that now forbids it.
	 *
	 * Last of the three, so a wall beats a penguin: `resolveCollisions` can push somebody into a
	 * building, and if the building went first that push would be the final word.
	 */
	settle(world: World): void;

	/**
	 * What happens to a penguin who has run out of ice.
	 *
	 * The rim rule, per mode, and the reason the island can forbid drowning without weakening it
	 * anywhere else: `step.ts` has exactly one rim check and it asks the mode. Two modes answer with
	 * the water, two with the time it costs to climb back on, and the island with the beach.
	 */
	overboard(world: World, p: Penguin): void;
	/** How hard anybody may hit anybody, 0..1. Everything that stuns scales by it. */
	attackStrength(world: World): number;
	/** Is it over, and who won? Null while it is still going. */
	ends(world: World): Ending | null;

	/**
	 * Everybody still in it, in the order they are winning — or null where the mode counts survivors
	 * instead of places.
	 *
	 * A race has places, not survivors. `slide.standings` orders by how far down the mountain each
	 * racer is and `chase.fleeing` by how far along the route, which is the same question asked of two
	 * different arrangements of the same floes. Both are deliberately coarse, so two racers trading
	 * centimetres do not make the number on the HUD flicker.
	 */
	readonly standings: ((world: World) => Penguin[]) | null;

	// --- what the outside needs to know --------------------------------------

	/**
	 * The door this penguin is standing in, or null — and null for a mode that has no doors at all.
	 *
	 * A function on the descriptor rather than `Game.svelte` importing `sim/island.ts`, because the
	 * component must not learn WHICH mode has zones in it. `spec.doorUnder !== null` is the one fact
	 * the UI needs to know it is in a hub, and it gets there with no id comparison anywhere. Same
	 * idiom as `courseHeading` and `standings`: a capability the mode either has or does not.
	 *
	 * A penguin that is not on its feet is in no door — falling into one would be a door that opens
	 * because you were pushed.
	 */
	readonly doorUnder: ((world: World, p: Penguin) => Door | null) | null;

	/**
	 * Is this a ROUND — something that starts, ends and names a winner — or a place you are simply in?
	 *
	 * **Deliberately NOT derived from `opening === 'playing'`, and that is the whole reason it exists.**
	 * A phase value standing in for a semantic one is a class of error this codebase has already paid
	 * for twice: trap 7 was a sign convention that was prose about geometry defended by a unit test
	 * asserting the prose, and `World.mode` is STORED rather than derived from the floe count because
	 * "a derived fact cannot disagree with what it describes" held right up until a mountain turned out
	 * to be several floes too. A named boolean cannot disagree with what it describes. The two happen
	 * to coincide today; nothing should make them the same field.
	 *
	 * Three things follow from it, all of them in the UI and none of them expressible any other way:
	 *
	 *  * **No "Los geht's!" gate.** There is nothing to start, so nothing to hold behind a button.
	 *  * **No body count in the HUD.** "Noch N auf dem Eis" counts down to a winner; in a hub it is a
	 *    number that never moves.
	 *  * **No result screen.** `ends` returns null for ever, so a rematch button would be an offer of
	 *    another go at something that has not finished.
	 */
	readonly isRound: boolean;

	/** See `Framing`. */
	readonly framing: Framing;
	/** Is this mode playable on a tall screen? Only a mode with no arena to fit can be. */
	readonly portrait: boolean;
	/**
	 * How much the camera frames, in metres — or null to fit the floe the player is standing on.
	 *
	 * Null is the classic answer and it is why `arena` framing exists: fit the arena, whatever size it
	 * is this second. A course cannot be framed that way, because a chute is five metres across and a
	 * camera fitted to that is two metres behind the penguin's back with the corner ahead off the top
	 * of the screen.
	 */
	readonly view: number | null;
	/**
	 * How far the camera climbs above its usual angle, as a gradient. Zero on the flat.
	 *
	 * The rig sits 27° above horizontal over a FLAT sea (`render/camera.ts`), so on ice that descends
	 * at 26.6° it is four tenths of a degree above the surface — which is how it ended up underneath
	 * the run looking at its belly. This is the correction, and it is a gradient rather than an angle
	 * because that is what `setFocus` takes.
	 */
	readonly lift: number;
	/** See `Scenery`. */
	readonly scenery: Scenery;
	/**
	 * Which way the course runs at this floe, or null for a mode that is not a course.
	 *
	 * The camera rig turns to it. Two implementations because a chute segment has a fall line to read
	 * and a chase platform is flat and has only its neighbours — same question, two arrangements.
	 */
	readonly courseHeading: ((world: World, floe: Floe) => Vec2) | null;
	/** Does a penguin travel on its belly here? It does on the mountain and nowhere else. */
	readonly onTheBelly: boolean;
	/**
	 * Is there anywhere to watch from once you are out?
	 *
	 * The watching ring is a circle around an ARENA (`sim/spectate.ts`). A course is two hundred metres
	 * long with no middle, so the ring would be a vast circle of ice with nothing inside it: a racer
	 * who falls off is simply gone until the race ends, and the renderer hides them rather than leaving
	 * them floating where they went in.
	 */
	readonly sidelines: boolean;
	/**
	 * Are there snowballs in this mode at all?
	 *
	 * False where `attackStrength` is always zero, and the two have to agree: a Ball button in a mode
	 * that cannot stun anybody is a button that is visible, pressable and dead, which is trap 4 for the
	 * fifth time.
	 */
	readonly throwing: boolean;
	/**
	 * Is there a shove-and-lunge in this mode at all?
	 *
	 * False only on the island: `attackStrength` is already zero there, so a dash could not shove
	 * anybody, and a burst of speed toward whoever is nearest is a strange thing to offer in a town
	 * with nobody to race. The button stayed on screen doing nothing until this field existed — the
	 * same shape as `throwing`, and the same fifth trap, for a sixth control.
	 */
	readonly dashing: boolean;
	/** See `BotStyle`. */
	readonly bot: BotStyle;
	/**
	 * Places worth walking to, or null for a mode nobody wanders in.
	 *
	 * What makes a town a town is that somebody else is crossing it, and what makes that legible rather
	 * than broken is that they are going SOMEWHERE. This is the list of somewheres, and it is on the
	 * descriptor rather than imported from `sim/island.ts` by `bot.ts` for the usual reason: a bot must
	 * not learn which mode is a hub. `bot: 'roam'` plus this list is the whole of what a wanderer needs,
	 * so the second hub gets roaming penguins without a line changing in `bot.ts`.
	 */
	readonly landmarks: readonly Landmark[] | null;
	/**
	 * Is something hunting the player?
	 *
	 * `World.hunterAt` is meaningless in a mode where nothing is, so the growl in `audio/cues.ts`, the
	 * sea lion in the renderer and the two danger numbers on the HUD all need to know whether to look
	 * at it.
	 */
	readonly hunted: boolean;
	/** See `ModeCopy`. */
	readonly copy: ModeCopy;
}
