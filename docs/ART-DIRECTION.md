# Art direction

What "cute" means here, as constraints rather than as a mood. Asked for on 2026-08-21: *"it should
look more like Animal Crossing from the quality and feel. Or super mario games."* And: *"all should
look cute."*

This file exists because that brief will be handed to many different people and agents, and a mood
board cannot be checked. Everything below can be.

## The five things that actually make those games look like those games

Neither reference game looks good because of shaders. In order of how much they contribute:

1. **Colour variety in the frame.** Every Animal Crossing frame contains green, a warm tone, a
   saturated blue and a piece of painted wood. A frame made of three pale blues has nothing for the
   eye to hold, however well it is lit. This is why the island (story 10) is also the art fix.
2. **Grounding.** Everything sits ON something. A contact shadow or a dark seam where an object
   meets the ground is what stops a scene reading as decals floating on a plane.
3. **One committed shape language.** Round, bevelled, thick, wide-based, nothing tapering to a
   point. Faceted low-poly is a real style and it is a *different* one; mixing them reads as
   unfinished rather than as either.
4. **Animation.** Squash on landing, stretch in the air, follow-through on anything hanging off a
   body, and idle life when nothing is happening. This is most of what "Mario feel" is, and it is
   cheaper than any rendering change.
5. **Weight in the interface.** Chunky saturated buttons with a real shadow, a rounded heavy
   typeface. A thin ring on frosted glass is a website.

## Hard rules

- **No sharp points on anything a child is meant to like.** A four-sided cone is the least cute
  shape available. Beaks, snouts and hats get rounded ends.
- **Big head, small body, wide base.** For every character, not just the penguins.
- **Two round eyes with a highlight in each.** No tracking pupils, no eyebrows, no mouth lines
  unless the mouth does something.
- **Saturated, with warmth in the light.** Pastel with conviction, never washed out. If a frame
  looks hazy, suspect the fog before the palette.
- **Nothing communicates by colour alone** — that is an accessibility requirement from
  `CLAUDE.md`, and it survives every art decision.
- **Everything procedural.** No downloaded models, no image textures, no environment maps —
  `docs/DECISIONS/0003`. The one exception is a self-hosted font file.
- **Draw calls are the budget, not vertices.** 209 a frame in a Royal, measured. Segment counts are
  nearly free; object counts are not. Merge with `render/bake.ts` and clone from a library.

## How an art change is proved

`render/` is not unit-tested and that is deliberate — nothing there is meaningfully testable without
a GPU. So:

1. `npm run shots` writes a PNG per mode into `shots/` at a fixed seed, and asserts the frame is not
   degenerate: how many distinct coarse colours it contains, and how much of it the commonest one
   occupies. That catches the failure mode this stack actually has — a blank or near-blank scene with
   nothing in the console, which is how the first shadow-map attempt failed.
2. **Somebody looks at the picture.** Green tests have never been evidence about a screen in this
   repo: four of the fifteen traps in `CLAUDE.md` were a frame that was wrong while the source read
   as correct — a mountain wound inside out, decoration buried inside the ice, a marker labelling the
   penguin behind it, an arena that never shrank on screen.

Both, in that order. Neither alone.
