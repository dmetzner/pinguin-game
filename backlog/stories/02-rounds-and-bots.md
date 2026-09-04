# 02 — Rounds, bots and a winner

**Phase 1. DONE** — `sim/round.ts`, `sim/bot.ts`, `components/Game.svelte`, plus `round.test.ts`
(11) and `bot.test.ts` (9).

**One deliberate deviation.** The floe shrinks CONTINUOUSLY rather than shedding chunks, so the rim
stays a radius and never becomes a polygon. A chunk would mean rebuilding the floe mesh every twenty
seconds and a point-in-polygon test in the hot loop, for an effect a player reads identically — what
the mechanic has to do is take space away so a stalemate cannot last. Revisit if the ice ever needs
to break unevenly for its own sake. `SHRINK_START_TICKS` carries the argument.

**The spectator chunk was finished afterwards**, in `sim/spectate.ts` and `render/iceChunk.ts`: an
eliminated penguin now surfaces on its own piece of ice beside the arena, name tag back on, turned
to face the round. The spot is DERIVED from `phase` and `pos` rather than stored, so `Penguin` gains
no field and a phase-3 snapshot stays the size it is — and the slot is the one nearest to where the
penguin went in, so the eye follows it out of the water instead of hunting for it on the far side.

## What

A round that starts, ends and names a winner, played solo against bots. After this the game is
playable start to finish with no network.

## Done looks like

- Round lifecycle in the simulation: countdown → playing → over. `aliveCount` already exists.
- The floe shrinks — a chunk breaks off roughly every 20 s, so the rim check becomes a polygon test
  rather than a radius. `step.ts` has exactly one place that knows about the rim today; keep it that
  way.
- Eliminated players surface on a small ice chunk beside the arena and watch. Not a fail screen.
- Bots at three difficulties, easy by default. A bot returns an `InputFrame` — no second code path
  inside `step`.
- A results screen whose most prominent control is "nochmal", reachable in one tap.
- Tests: a round with one player ends immediately; the last penguin standing wins; two falling on
  the same tick is a draw rather than a crash; a bot never receives an input a thumb could not give.

## Known traps

- **Bots must not be perfect.** A bot that always walks uphill is unbeatable and no fun. Give them
  reaction delay and a deliberate error term — seeded, so a round stays replayable.
- **The shrinking floe interacts with WEIGHT_TILT**: a smaller floe means the same crowd offset is a
  larger fraction of the radius, so the endgame tilts harder for free. Probably good. Verify rather
  than assume.
- Watch the round length. `docs/DESIGN.md` says 60–90 s; a shrink rate that ends rounds in 30 s
  makes the customisation in phase 2 pointless because nobody sees their penguin.
