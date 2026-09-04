# 10 — The Island

**Phase 5. MOSTLY BUILT (2026-08-21/22), against the scope split below:**

- **10a — the island, solo.** DONE. `sim/island.ts`, `render/island.ts`; walking, five zones, the
  mountain visible from the square, doors that launch a mode and a `hubWorld` that stands the player
  back where they left.
- **10b — the mode registry.** DONE, and further than this document asked: `sim/modes/{registry,
  mode,policy,...}.ts`, one descriptor per mode, `guard.test.ts` scanning for a mode-id comparison
  outside that directory. Read `CLAUDE.md`'s "The modes, and the registry that holds them" for the
  version that shipped.
- **10c — other penguins.** Bots wandering DONE (`bot.ts`'s `'roam'` style, retuned 2026-08-22 —
  see below). Real ones over `net/`: NOT DONE, multiplayer is still unwired. The "challenge card" this
  section proposed was superseded by something bigger: `npc/talk.ts` — proximity conversation with a
  hand-written cast (`npc/cast.ts`), authored lines (`npc/lines.ts`) and a mission board
  (`npc/missions.ts`), wired into `Game.svelte` 2026-08-22. NPCs talk; the player answers with an
  emote — the picker UI for that is the one piece still missing (see story 09/12's open list).
- **10d — Der Laden.** NOT DONE. The building exists and says "Öffnet bald" honestly; `Customise.svelte`
  has not moved into it.
- **10e — gifts.** NOT DONE. Correctly blocked on 10d per this document's own order.
- **10f — the island's own art pass.** PARTIAL. The mountain now reads as a landmark (haze, height,
  something that moves past it — commits `b445507`, `2a47af9`) and the shore is visible from a
  distance; the rest of story 09's art pass is still open.

**2026-08-22 correction to 10c's roam behaviour**, found the same day Daniel called it out: a
wanderer's request magnitude reached `min(1, away/ROAM_ARRIVED)`, which is 1 — full stick, the
player's own top speed — for nearly the whole of every walk, not just its last few centimetres. Eight
background penguins at the player's own speed reads as traffic, not a town. `ROAM_PACE = 0.55` caps
it and `ROAM_IDLE_MIN/MAX` widened from 3–9 s to 5–14 s, so a wanderer now visibly either stands or
moves slowly, never both fast and constant.

Original ask, 2026-08-21: *"we need it to be open world... an island like
Animal Crossing where we can run around, meet friends, (later get gifts), challenge for gifts. On
the different sides of the island are the games. Like a Rathausplatz where the big Royal mode is to
enter. Somewhere a mountain with a gondola up top where you join the slide race. Or one where you go
on missions to steal from the Super-Robbe and then play the game to run away from it. Also changing
your design could be inside a mode shop."* And: *"in the future we need way more mini games... like
Super Mario Party — 20-30 mini games, but focus on the ones we have."*

This is the story that turns four modes into a game. It is also not one story — the scope split at
the bottom is the important part of this file.

## Why this is the right next thing

Three reasons, and only the first one is the obvious one.

1. **It is what a child does with a game.** Four modes reached from a mode switch button is a menu.
   An island you walk out onto, with a mountain you can see from the square, is a place.
2. **It is the graphics fix.** Story 09 argues it at length: the polar palette is three pale blues
   and the subject is a white disc. Grass, sand, wood, a red roof and a gondola cable put colour in
   the frame, and no amount of shader work on an ice floe gets there.
3. **It is portrait's only route in.** Story 11: the arena-fit camera is what makes portrait
   unshippable, and a hub has no arena to fit. The island is portrait-native.

## What it reuses, which is again nearly everything

- **An island is a floe.** `sim/archipelago.ts` lays out discs from a seed and answers "what am I
  standing on"; `sim/floe.ts` gives the gradient; `moundsFor` gives hills that the simulation and
  the renderer agree about. An island is one disc of ~50–70 m with the swell amplitude at zero and
  hand-placed mounds. **Walking up a hill already works, and `MOUND_MAX_SLOPE` already guarantees
  every hill is climbable rather than a wall that looks like a ramp.**
- **Steering, gait, the stick, the keyboard, the camera rig, the name tags, the sound** — all of it
  is mode-agnostic already.
- **Zones are places, not triggers.** `chase.ts` already established the pattern that matters here:
  the hunter is a PLACE (`World.hunterAt`), not a pursuit. A portal is the same shape — a position
  and a radius, checked in `step.ts`, readable and replayable.
- **Other penguins on the island are `net/`.** `snapshot.ts` sends penguins BY INDEX and the host
  trusts inputs and never positions. A hub with no combat is an *easier* prediction problem than a
  round is, not a harder one.

## What is genuinely new

### 1. Roaming is a phase, not a round

`round.ts` is countdown → play → result. The island has none of those: nobody is eliminated, nothing
shrinks, nobody wins. Either `round.phase` gains `'roam'` or the island bypasses `round` entirely.
Prefer the phase — `attackStrength` is already a function of the round and on the island it is zero
forever, which is the same mechanism the slide already uses to forbid shoving.

### 2. The zones

| Zone | Where | Leads to |
|---|---|---|
| **Rathausplatz** | centre | Pingu Royal — the 30-penguin game, entered by standing in the square |
| **Eisarena** | a jetty east | Klassisch — after challenging a penguin you met |
| **Der Berg + Gondel** | north, visible from everywhere | Die Rutschpartie |
| **Robbenhöhle / Steg** | south | Die Flucht — steal from the Super-Robbe, *then* run |
| **Der Laden** | off the square | the shop, which is where "Mein Pinguin" moves to |

The mountain being *visible from the square* is worth building deliberately: it is the one thing
that tells a child there is somewhere else to go, and the fog constants already have a mountain
variant (`MOUNTAIN_FOG_NEAR/FAR`).

### 3. Challenging somebody, without words

Invariant 4 is absolute: no free text, ever. A challenge is therefore a fixed interaction — walk up
to a penguin, press the action button, they get a yes/no card. That fits the three-button control
scheme without a new control, and it is the same emote-from-a-fixed-set discipline
`docs/DECISIONS/0004` already argues.

### 4. The mode registry — do this BEFORE minigame number five

`Mode` is a four-member string union (`sim/types.ts:127`) and the four literals are referenced
across **thirty non-test files**. At twenty-five minigames that is not maintainable, and it never
gets cheaper to fix than it is at four.

```
sim/modes/registry.ts

interface GameMode {
  id: string;                       // sent on the wire as a string; decode never throws on unknown
  name: string;                     // player-visible, German, from the same discipline as names.ts
  players: { min: number; max: number };
  build(seed: number, roster: Roster): World;
  advance(world: World, inputs: InputFrame[]): void;   // the mode's own slice of a tick
  ended(world: World): Result | null;
  attackStrength(world: World): number;
  framing: 'arena' | 'follow' | 'bearing';             // ← story 11's policy lives HERE
  portrait: boolean;                                   // ← and so does this
}
```

Rules that make it worth the refactor:

- `step.ts` stays the one tick and calls the mode's hooks. It does not grow a switch.
- **Nothing outside `sim/modes/` may compare a mode id.** Enforced by a test that scans `src/` for
  `=== 'classic'`-shaped comparisons — the same shape as `purity.test.ts` and `brand.test.ts`,
  including the part where the guard proves itself non-vacuous by being fed the violations it exists
  to catch.
- `protocol.ts` sends the id as a string and `decode` falls back rather than throwing, so a client
  on an older build meets an unknown minigame and says so instead of dying.
- The registry is also what the island reads to place a portal, and what the shop reads to price a
  hat. One list, not five.

**Twenty to thirty minigames is a content problem once this exists and an architecture problem
until it does.** The four we have get better first (story 09), the fifth waits for the registry.

### 5. Save data, and the thing to be careful about

Gifts and an economy mean persisted state, and `storageKeys.ts` is the file with the rule: every key
under `floe.`, never edit an existing value, nothing persisted carries the product name. Version the
island save from the first write — the sibling repos' cautionary tale is exactly about data written
before the shape settled. **v1 persists nothing but position and look.**

## Scope split — playable at every step

- **10a — the island, solo.** Terrain, roam phase, follow camera, walking, five zone signs you can
  stand in. Each portal launches an existing mode and returns to the island. This is the whole
  feature at its smallest and it is worth shipping alone.
- **10b — the mode registry.** The refactor above. No new behaviour, ~30 files, one new guard test.
- **10c — other penguins.** Bots wandering the island first (a bot is a thing that returns an
  `InputFrame`, and "wander" is the easiest target it has ever had), then real ones over `net/`.
  Then the challenge card.
- **10d — Der Laden.** `Customise.svelte` moves into a building. The turntable already borrows the
  game's renderer for a corner of its buffer (`drawInset`) — one WebGL context per page, and the
  shop must not be where that rule is broken.
- **10e — gifts.** Needs the save format decided. Not before 10d.
- **10f — the island's own art pass.** The second half of story 09, once there is something on the
  island to light.

## The honest concern

An open world plus twenty-five minigames is months of work for a 14.5k-line repo. What makes it
survivable is that 10a is *small* and every step after it leaves a playable game. What would kill it
is building the world and the registry and the shop and the economy before any of it is walked
around on a phone.
