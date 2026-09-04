# 0003 — Penguins are built from primitives in code

**Date:** 2026-08-15 · **Status:** accepted

## Context

The game needs a character. The budget is zero, so a commissioned or purchased model was never on
the table; the real choice was between a free asset pack (Kenney and Quaternius both publish CC0
low-poly animals) and generating the character in code.

## Decision

Build the penguin from spheres, a cone and a circle in `src/lib/render/penguin.ts`. Flat-shaded, low
poly, every colour a parameter.

## Why, beyond the price

**Customisation falls out for free, and it is a headline feature.** The design promises that a child
can colour their own penguin. With a modelled asset that is a texture pipeline or a material
override per variant; here it is three numbers in a `PenguinLook`, and a hat is a few more
primitives parented to the head. Phase 2 becomes a UI task rather than an art task.

**One consistent style, controlled entirely.** A free pack looks like the pack it came from, and
mixing two packs looks like mixing two packs. Everything here — penguin, floe, ocean — is generated,
so the style is one decision rather than a matching problem.

**Nothing to download.** No glTF, no texture atlas, no loader, no decoder, no loading screen, no
asset host, and no CSP entry for one. The whole character is a few kilobytes of JavaScript that was
already in the bundle.

**No licence surface.** CC0 is genuinely free, but it still means tracking provenance per asset, and
the sibling repos already carry a decision record about exactly that kind of bookkeeping.

## What it costs

- **No skeletal animation.** There is no rig, so there is no walk cycle. What exists instead is
  procedural: a waddle bob scaled by pace, a lean into the slide computed from velocity, and (in
  phase 1) a spin while stunned. For a chunky low-poly penguin seen from a fixed camera this reads
  well; for a humanoid it would not.
- **Modelling in code is slow to iterate.** Every proportion is a number in a file rather than
  something dragged in a viewport.
- **A ceiling on fidelity.** This will never look hand-modelled. It is a style, and the target
  audience is not comparing it to one.

## Notes for later

- Geometry is shared between penguins and only materials differ, so six penguins are six sets of
  four materials rather than six meshes.
- `PENGUIN_SCALE` exists because the primitives are modelled at a realistic 1.15 m and then scaled
  to a cartoon 1.7 m. Keeping the modelling numbers honest about real proportions, and scaling once
  at the end, means the character can be resized without re-deriving every offset.
- The first palette used a naturalistic near-black back (`0x2b3a55`). At the distance a fixed camera
  has to sit it rendered as a dark blob with no readable facing, and telling four apart at a glance
  matters more here than looking like a bird.
