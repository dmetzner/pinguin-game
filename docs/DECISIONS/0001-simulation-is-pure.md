# 0001 — The simulation is pure, and a test enforces it

**Date:** 2026-08-15 · **Status:** accepted

## Context

The obvious way to build a small 3D web game is to put the state on the objects you are drawing: a
penguin's position is its `Object3D.position`, the game loop moves meshes, and the renderer and the
rules are the same code. It is the shortest path to something on screen.

## Decision

`src/lib/sim/` contains the entire game and imports nothing — not Three.js, not Svelte, not a clock,
not `Math.random()`. Time enters as a tick count; randomness enters as a seed. The renderer reads
that state and never writes to it. Input produces an `InputFrame` and nothing else.

`purity.test.ts` scans the directory for violations, and a second `describe` block feeds those same
regexes the violations they exist to catch, so the guard cannot quietly stop working.

## Why

Three things depend on it, and each fails differently:

1. **Testability.** Physics is the bug-prone layer and the one where "it feels wrong" is otherwise
   the only available bug report. Because the simulation is pure, "a penguin abandoned on the
   steepest slope keeps sliding" is an assertion. That specific test is how a bug where releasing
   the stick acted as a perfect brake — cancelling gravity exactly and making the whole tilt
   mechanic inert — was caught.
2. **Bots.** A bot produces the same `InputFrame` a thumb does. No second code path, no "AI mode"
   branch inside the step function.
3. **Multiplayer.** Host-authoritative simulation with client-side prediction requires that two
   machines running the same inputs from the same state reach the same result. One `Date.now()` in
   the wrong place makes that fail *intermittently*, which is the hardest class of networking bug
   there is, and it would be found in a playtest with children rather than in CI.

## What it costs

- The renderer keeps a parallel set of objects and copies transforms in every frame. That is a real
  cost in lines, and it is what buys the interpolation in `render/loop.ts`: because the previous
  tick's state is available separately, a 120 Hz display shows smooth motion instead of each tick
  twice.
- Anything genuinely needing wall-clock time — the ocean shader — lives in `render/`, and the two
  are deliberately not synchronised. The swell the player *feels* comes from the simulation; the
  waves they *see* are decoration.

## Consequence worth stating

`step()` mutates the world in place, which is the one exception to the immutability the rest of
`sim/` keeps. It runs sixty times a second and the snapshot the renderer interpolates against is
taken explicitly, which is a clearer seam than a copy nobody asked for. Nothing outside `step.ts`
writes to a `World`.
