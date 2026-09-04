# 06 — Pingu Royal

**Phase 4. Solo half DONE** — `sim/archipelago.ts` (+17 unit tests), `sim/royal.test.ts` (7),
`render/floeField.ts`, and edits across `sim/types.ts`, `sim/floe.ts`, `sim/step.ts`, `sim/round.ts`,
`sim/world.ts`, `sim/bot.ts`, `sim/constants.ts`, `render/scene.ts`, `render/penguin.ts`,
`components/Game.svelte` and the route. Two end-to-end tests.

**Thirty penguins on a sea of floes that sink one after another.** A button beside the game, never a
menu in front of it.

## Why it is an archipelago and not a bigger floe

The obvious version — one enormous disc, thirty penguins — fails for two reasons that are the game
itself rather than the hardware:

1. **The see-saw dies.** The floe tilts from where the weight is standing and one penguin's share of
   that is 1/N. At four your position moves the ice; at thirty the weight term averages to nothing
   and everyone is on a disc only the swell moves.
2. **The camera dies.** Holding contact density constant means radius = 7.6·√(N/4), so thirty
   penguins is a 21 m floe and a penguin at about 4% of screen height — the portrait framing the
   rotate card exists to refuse.

Several small floes keep both: three to a floe is a see-saw, the camera frames the floe you are
standing on, and nobody has to see all thirty at once — only the ones who can reach them. Then the
floes sink, one at a time, and that is the clock: a Royal is a forced migration inward that ends
with the survivors on the middle floe, which is the six-penguin round this game already is.

## What shipped

- **`sim/archipelago.ts`** — the sea, seeded and pure. Two rings: a middle floe at the origin that
  never sinks, up to six around it at one jump, and the rest hanging off those. Every gap is
  expressed against `JUMP_RANGE`, which is DERIVED from the jump constants and the walk speed, so
  tuning the jump moves every gap in the sea with it.
- **`world.floes` replaced `world.floe`** everywhere, and the classic round is simply an
  archipelago of one. There is no mode flag: `isRoyal(world)` asks how many floes there are, so
  nothing can set a field that disagrees with the world it describes.
- **Support is a lookup, not a radius test.** `floeUnder` answers "what am I standing on" for
  gravity and for the rim in the same breath, so a penguin cannot be tilted by ice it is not on or
  drowned on ice it is.
- **Bots that leave.** A bot commits two seconds before its ice starts going, runs for the
  longest-lived floe within a jump, and jumps at the rim rather than at a fixed radius.
- **`render/floeField.ts`** — a pool of floe meshes, one group each, carrying that floe's tilt. A
  sinking floe drops as well as shrinks, which is what makes it read as going under rather than as
  melting.
- **A camera that follows the ICE, not the player.** It frames the floe you are on and pans when you
  jump — `docs/DESIGN.md` §4 rejects a camera that chases a penguin, and this does not: the angle
  never changes, so "up on screen" stays the fixed fact the joystick and keyboard derive their signs
  from.

## Three traps this cost

1. **Small floes are not harder, they are impossible.** The first outer floes were 4.4–6.2 m. With
   every penguin standing perfectly still and no bots thinking at all, half the field was in the
   water inside ten seconds: the swell alone is a gradient of up to 0.15 and every constant in the
   game — grip, drag, walk speed — was tuned against the runway a 7.6 m disc gives from the spawn
   ring. Outer floes are 6.6–7.6 m now, and the sea gets its variety from where the floes are.
2. **Five to a floe burns the field before the ice matters.** Measured against the classic round:
   five players on one floe is a thirty-second fight, so thirty penguins over seven floes were down
   to five survivors before the first floe had begun to sink — the mode's whole clock never ran.
   Three to a floe, which is what `ROYAL_PER_FLOE` is, and it is why there are ten floes rather than
   seven.
3. **"Toward the middle" meant the middle of the SEA.** The bots' fallback direction was
   `-position`, which is the floe centre in the classic round and the centre of the archipelago in a
   Royal — every bot on an outer floe walking steadily off its own rim. It was found by a diagnostic
   that printed where each penguin fell, not by reading the code, and it was *not* the cause of the
   carnage that session was chasing (that was trap 1); both were true at once and the obvious one
   was the wrong one.

## What is NOT covered end to end, and why

The HUD's "Scholle bricht! 2.4s" is asserted by unit test (`breakWarning`) and by eye, not by
Playwright. An end-to-end version has to have the local penguin ALIVE and standing on doomed ice
twenty-five seconds into a round that nobody is steering, and it is in the water long before that:
three attempts at forty seconds each still failed, and the attempt cost enough machine time to shake
four unrelated tests loose. The claim it would prove — that a number bound in the markup reaches the
screen — is worth less than the flakiness it buys.

## What is missing

- **Multiplayer.** `net/snapshot.ts` sends one floe — a room plays the classic round. An
  archipelago over the wire is a wire-format change plus interest management (send the penguins on
  and around your floe, not all thirty), and it is the next slice.
- **Spectators.** Fixed, and it was not the visual flaw this list called it: beyond the twelfth
  eliminated penguin the renderer had no chunk, so the actor was never parented and stood at the
  world origin — a pile of motionless penguins in the middle of the finale. There is now one chunk
  per penguin in the biggest game, the ring's slot count grows with the sea, and anything that still
  cannot be placed is hidden rather than drawn somewhere arbitrary. Sideline throwing shipped too:
  out of the round is no longer out of the game.
- **Pacing.** A Royal currently runs 60–90 s, most of it decided in the first twenty. The bots fight
  as hard on the first floe as on the last; a timid opening (lower aggression until the ring starts
  sinking) is the obvious next lever, and it is a bot change rather than a map one.
- **The floe that cracks.** Splitting a floe in two mid-round instead of shrinking it — the best
  looking thing on the list, and it needs the renderer to draw a floe that is not a disc.
