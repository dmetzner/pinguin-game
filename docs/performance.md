# Performance, and where it actually goes

Answers: "what a frame actually costs in a Royal, measured rather than guessed"

## Performance, and where it actually goes

Measured rather than guessed, on 2026-08-17, with thirty penguins on ten floes:

- **The simulation is 3% of a 60 Hz frame** (50 µs a tick, against 9 µs for the classic four). It is
  not where the time goes, and optimising it would be optimising the wrong thing.
- **Draw calls are.** Royal was ~435 a frame; it is 209 now. Two changes did it: every floe's
  dressing — drifts, meltwater, ridge, rocks, icebergs — is ONE merged mesh with vertex colours, and
  each penguin's rigid parts (torso, belly, head, face, eyes, beak) are another. Both are built once
  and cloned or shared.
- **Distance decides detail.** Beyond `DETAIL_RANGE` an actor gets position and heading only: no
  gait, no lean, no waddle, no name tag. Two thirds of a Royal is somewhere else in the sea.
- `mergeGeometries` refuses a set whose attributes disagree, and three's primitives do: an
  icosahedron is non-indexed where a cylinder is indexed. `toNonIndexed()` on every piece, or the
  merge fails loudly in the console and silently on screen.

