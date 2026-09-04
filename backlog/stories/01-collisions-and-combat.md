# 01 — Collisions and combat

**Phase 1. DONE** — see `src/lib/sim/combat.ts` and `combat.test.ts` (31 tests).

What it cost that this file did not predict: the dash had to SET velocity rather than add it. Adding
measured 11.8 m/s on screen, a ~16 m stopping distance on a 6.5 m floe, so the shove was more lethal
to its user than to its target. It now carries extra drag for the length of the move. Also split
into two windows — the move lasts 0.67 s but only shoves for its first 0.22 s, and that gap is the
counterplay.

## What

Penguins collide with each other, and the three attacks from `docs/DESIGN.md` §5 exist: snowball,
shove, stomp. All three do the same thing in different amounts — knockback plus a brief loss of
control.

## Done looks like

- Circle-circle collision between penguins with a symmetric impulse; no overlap, no jitter when two
  penguins rest against each other.
- A `stunTicks` field on `Penguin`. While stunned, `InputFrame` is ignored entirely — the penguin
  keeps its momentum and its collisions and loses only its steering.
- Snowballs as simulated objects: spawn, parabola, expire, hit. Auto-aimed within a forward cone.
- Shove: a short dash with a cooldown; contact during it applies a large knockback.
- Stomp: landing a jump while overlapping another penguin. The jumper bounces off rather than
  landing on the ice, so it does not chain into an infinite hold-down.
- Unit tests for every one of the above, including the ones that are easy to get subtly wrong:
  impulse symmetry, that a stunned penguin still slides, that stun expires exactly on schedule,
  that a snowball cannot hit its thrower, and that two simultaneous stomps resolve the same way in
  either evaluation order.

## Known traps

- **Evaluation order.** Six penguins resolved in array order gives the first one an advantage in any
  simultaneous exchange. Collect impulses across all pairs first, then apply — otherwise the host
  and a predicting client disagree the moment they iterate differently, and it will read as lag.
- **Stun must not stop the rim check.** Being carried off the edge while unable to act is the
  intended outcome, not a bug to guard against.
- **Cooldowns belong in the simulation, not the UI.** A cooldown enforced only by a disabled button
  is a cooldown a modified client does not have — and, more immediately, one that breaks the moment
  input arrives from the network instead of from a thumb.
- Keep `render/` out of it. The stars-and-spinning is a reaction to `stunTicks`, not a cause.
