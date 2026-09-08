# Pingu Royal

Answers: "what thirty penguins on a sea of sinking floes required, and which numbers are measurements rather than choices"

## Pingu Royal

Thirty penguins across a sea of floes that sink one at a time — `backlog/stories/06-pingu-royal.md`
has the design, the measurements and what is still missing. Three things to know before touching it:

- **`world.floes` is always an array** and the classic round is an archipelago of one. There is no
  mode flag anywhere; `isRoyal(world)` asks how many floes there are.
- **Floe size is a MEASUREMENT.** Outer floes are 6.6–7.6 m because at 4.4–6.2 m half the field
  drowned in ten seconds with nobody moving at all — the swell is a gradient of 0.15 and every
  constant in `sim/` was tuned against the runway a 7.6 m disc gives.
- **Nobody may hit anybody for the first three seconds**, and the protection FADES over the second
  after that (`round.attackStrength`). The fade is not politeness: a rule that flips at one tick is a
  rule a client running `LEAD_TICKS` ahead disagrees with, and an 8 m/s shove is a big thing to
  disagree about — `session.test.ts` measured 0.69 m of correction and refused it.
- **A penguin has two jumps.** One off the ice and one flap in mid-air (`AIR_JUMPS`), because
  crossing a gap was a decision made once, at a moment, on tilting ice — and the only feedback for
  mistiming it by a tenth of a second was drowning. The map is still laid out against the SINGLE
  jump: a child who never finds the flap can cross every gap in the sea.
- **Hills are real ground, and their width comes from their height.** `MOUND_MAX_SLOPE` is the
  constraint — gravity down a slope is `G · gradient` against `MOVE_GRIP` of push, so a hill whose
  footprint is chosen freely is a wall that looks like a ramp. Pick the height, derive the radius.
- **Density decides the pace.** Five to a floe is a thirty-second fight, so a Royal deals one floe
  per THREE penguins. Changing `ROYAL_PER_FLOE` changes how long a Royal lasts, not how crowded it
  looks.
- **Ice breaks, it does not melt.** A doomed floe warns for three seconds — crack, shudder, HUD
  countdown, creak — and then splits into two half-radius pieces that drift apart, tip and go under
  carrying whoever is standing on them. `ROYAL_PIECE_FRACTION` is exactly 0.5 for a reason: at a half
  the pieces are born touching, so the crack opens under the player rather than leaving solid ground
  where the middle used to be.

