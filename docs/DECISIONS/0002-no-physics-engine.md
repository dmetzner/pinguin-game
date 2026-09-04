# 0002 — No physics engine

**Date:** 2026-08-15 · **Status:** accepted

## Context

The game is penguins sliding on a tilting ice floe, shoving each other off. That is the vocabulary
of a rigid-body physics engine, and the reflex is to reach for Rapier or cannon-es.

## Decision

Write the physics by hand, in about 120 lines, in `src/lib/sim/`.

## Why

**The game is not 3D.** A penguin has a position on a plane and a height above it. There is no
orientation beyond a facing angle, no stacking, no rotation under collision, no shape more complex
than a circle, and no contact manifold anywhere. A general-purpose solver would be modelling
degrees of freedom the design does not have.

**Determinism is a requirement, not a preference.** Invariant 1 exists because phase 3 needs the
host and every client to reach the same world from the same inputs, and because a test has to be
able to replay a round. General engines are not deterministic across platforms — they use
accumulating solver iterations, and some expose a fixed-point mode precisely because the float path
is not reproducible. Making one deterministic is a project; not needing it to be is free.

**Feel is the entire product, and feel is tuning.** The single most important number in this game is
`MOVE_GRIP` — the rate at which the stick may pull velocity toward what it asked for — and it is not
a concept an engine exposes. Ice that is slippery but has a sane top speed is *not* a friction
coefficient; in a drag model those are the same dial and you cannot have both. Expressing it took
four lines. Expressing it through an engine's constraint solver would have taken a fight.

**Size.** Rapier's WASM build is several hundred kilobytes before anything else, on a game whose
audience is a school wifi and a hand-me-down Android.

## What this costs

Everything an engine would have given free has to be written when it is needed:

- **Penguin-penguin collision** (phase 1) — circle against circle with an impulse. Easy.
- **The shrinking floe** (phase 1) — the rim check becomes a polygon test rather than a radius.
  Still easy; the current `length(pos) > radius` is deliberately the only place that knows.
- **Snowball flight** (phase 1) — a parabola with the same integrator the jump already uses.

None of these needs a solver. If something later does — a genuinely rigid stack of objects, ropes,
articulated anything — this decision should be revisited rather than worked around. Nothing in
`docs/DESIGN.md` currently heads that way.

## Alternatives considered

- **Rapier (WASM).** Fastest and best-maintained. Rejected on determinism and size, above.
- **cannon-es.** Pure JS, small, unmaintained since 2023. Rejected on determinism and on adopting an
  unmaintained dependency for the load-bearing part of the product.
- **An engine for collision only, hand-rolled movement.** The worst of both: the dependency's size
  and the hand-rolled code's surface, for circle-circle overlap that is one line of arithmetic.
