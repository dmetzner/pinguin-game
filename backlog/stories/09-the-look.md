# 09 — The Look

**Phase 5. MOSTLY DONE in the code, still unverified against a screen.** Asked for on 2026-08-21:
*"my main pain point right now is still the graphics.. i don't like them.. it should look more like
Animal Crossing from the quality and feel. Or super mario games."*

**Re-audited 2026-08-22, against the code rather than the earlier draft of this file, because the
earlier draft had drifted well behind what had actually shipped.** Item by item:

1. **Grounding — DONE.** `scene.ts` records a real, measured shadow-map attempt (2026-08-21): it
   renders, and was rejected anyway because the sun's own direction throws every shadow straight
   behind its own penguin, invisible to the camera — not the `ShaderMaterial` link failure the
   earlier draft of this file suspected. The fallback it names instead, baked contact AO, is built:
   `bake.ts`'s `mergePieces`/`bake` take a `Contact` and darken vertices near their own ground
   contact, and every major piece of dressing uses it — `floeField.ts` (soft dressing, hills,
   crags), `bergs.ts` (icebergs, keyed to their own waterline), `blocks.ts` (chase platforms),
   `igloo.ts` and `island.ts` (soft, crags). The sea lion additionally carries its own moving blob
   shadow (`seaLion.ts`), the same shape `penguin.ts` already used. Nothing found still floating.
2. **The character — DONE.** `penguin.ts`'s own header now states it plainly: it squashes on
   takeoff and stretches in the air (`SQUASH_SECONDS` et al.), it never stands perfectly still
   (blink, idle breathing), it rolls into its turns, and its hat has follow-through. The dust puff
   on landing exists (`createPuff`, pooled like `snowball.ts`). This section of the plan shipped in
   full.
3. **Roundness — DONE, deliberately not absolute.** `flatShading` is down from the "20+" this
   document originally counted to 13, and every remaining site is exactly the exception list this
   document itself asked for: ice (crags, bergs, the chute, chase blocks, ice chunks), the stun
   stars, and a few background/particle materials (snowballs, the dust puff, a shark fin, one
   gondola part) where faceted has no visible cost. The beak is a squashed sphere, not the four-sided
   cone this document complained about.
4. **Typography — DONE.** `Baloo 2` is self-hosted as `woff2` (`app.css`), on `--font-display`.
5. **Sky and water — DONE.** Clouds (`render/clouds.ts`), a foam collar keyed to the waterline
   (`floeField.ts`), and the sun/lighting numbers this document asked to have measured are measured
   and commented in `scene.ts`.

**What is NOT verified, because this pass — like the last one — had no connected browser:** whether
all of the above actually LOOKS like the brief, as opposed to being present and correctly built.
`docs/ART-DIRECTION.md` and this document's own closing section are unambiguous that a before/after
screenshot pair from a real device is the only valid proof of a visual claim, and none has been
taken since most of this list shipped. Treat the CODE as done and the LOOK as still open until
somebody with a screen confirms it — `npm run shots` catches "nothing rendered", not "does not read
as Animal Crossing".

## The diagnosis, before any code

Animal Crossing and Mario Odyssey do not look good because of shaders. They look good because of
five things, and this repo currently has one and a half of them.

1. **Colour variety in the frame.** Every Animal Crossing frame has green, a warm tone, a saturated
   blue and a piece of painted wood in it. PinguIsland's palette is `--ice #f4fbff`, `--sky
   #9fd8ef` and `--deep #0d3a5c` — three near-identical pale blues — and the subject is a white disc
   in blue water under a blue sky. Tone mapping already stopped that clipping to paper (`scene.ts`);
   what is left is not a rendering problem, it is the *subject*. **The single largest graphics
   improvement available is story 10: the first frame with grass, sand, a jetty and a red roof in it
   will look better than anything reachable on a bare floe.** That is why these two stories are
   numbered next to each other, and why half of this one is scheduled after the island exists.
2. **Grounding.** Only penguins have a shadow (one blob circle, `penguin.ts`). Mounds, rocks,
   icebergs, chase blocks and the sea lion all float. See below — this is the biggest thing that is
   fixable *today*, on the floe we already have.
3. **Shape language, committed to.** There are 20+ `flatShading: true` sites in `render/`. Faceted
   low-poly is a real style, and it is a *different* style from the one being asked for: AC has no
   visible facets, generous bevels, thick limbs, wide bases and no thin cones anywhere.
4. **Animation, which carries more of the "feel" than the renderer does.** Mario reads as Mario
   because of anticipation and squash. The gait is good (distance-driven, 2026-08-16); everything
   around it is missing.
5. **Typography.** `system-ui` is the loudest "this is a website" signal on the screen.

## What to do, in the order the screen improves fastest

### 1. Grounding (biggest fixable-today win)

**Retry the shadow map, with a suspect.** `scene.ts` records the attempt: a soft 1024 map on the
sun, ortho camera retargeted onto `setFocus`, and the result was a blank scene with no console
error — so it was abandoned as unobservable. The failure is untriaged, and the prime suspect is the
two hand-written `ShaderMaterial`s (the sky dome and the ocean). With `shadowMap.enabled` three
recompiles every program and injects the shadow chunks; a hand-written material that declares none
of the shadow uniforms and includes none of the `shadowmap_pars` chunks can fail to *link*, and a
link failure under SwiftShader is exactly "blank screen, nothing in the console".

The five-minute experiment: enable shadows with the sky and ocean temporarily swapped for
`MeshBasicMaterial`. If the scene renders, the cause is known and the fix is local (mark those two
materials as neither casting nor receiving, and stop three from patching them). If it is still
blank, shadow maps are genuinely off the table on this stack and the fallback below is the plan
rather than the consolation.

Budget if it works: ONE 1024 map, `PCFSoftShadowMap`, ortho box retargeted per `setFocus` so the
texels stay penguin-sized, `castShadow` on penguins/props only, `receiveShadow` on ground only.
Never on the sea.

**Fallback, and worth doing anyway: baked contact AO.** `bake.ts` already merges coloured pieces
into one vertex-coloured mesh. Darken every vertex within ~15 cm of its ground contact toward the
ground colour, at bake time. It costs nothing per frame, it survives on the oldest phone in the
audience, and a dark seam where a rock meets the snow is most of what "grounded" reads as. Plus one
shared blob per non-penguin prop, scaled and faded by height the way the penguin's already is.

### 2. The character (pure presentation, `penguin.ts` only, no sim change)

All of it is missing and all of it is cheap:

- **Squash on takeoff, stretch in the air, squash on landing.** The jump is the verb in two of four
  modes and the body is rigid through all of it.
- **A dust puff on landing** — the snowball pool pattern (`snowball.ts`, eight preallocated) is the
  shape to copy. Nothing allocated mid-round.
- **Hat follow-through.** A bobble that lags the head by two frames is the most Animal-Crossing
  thing on this list and it is four lines.
- **Blink, idle breathing, head-look toward travel.** Standing still currently means *perfectly*
  still.
- **Turn lean.** `TURN_RATE` smooths the drawn heading already; a roll into the turn is free from
  the same value.

### 3. Roundness

Commit to round. Draw-calls are the measured budget (209 a frame in a Royal, `CLAUDE.md`), not
vertices — segment counts are the one axis with room. Turn `flatShading` off for anything organic
and keep it only for ice cliffs and the stun stars, where faceted is the point. Replace the 4-sided
cones (beak, "you" marker, crown spikes) with rounded forms. Bevel the floe rim.

### 4. Typography

One self-hosted subset `woff2` — a rounded heavy display face (Baloo 2, Fredoka, Nunito ExtraBold)
— as `--font-display` on the countdown, the verdict, the buttons and the name tags. Self-hosted,
not Google-linked: this is an offline PWA with a service worker.

**The trap to write down before it is paid:** `nameTag.ts` bakes text into a canvas texture. A tag
drawn before the face has loaded bakes the *fallback* and looks correct in code forever. Await
`document.fonts.ready` (or rebake once) or this ships silently wrong.

### 5. Sky and water

- **Clouds.** Five to eight soft billboards from one canvas-drawn texture, fogged, drifting. A
  static sky is what makes a still frame look like a diagram; the gradient dome (already there) got
  half of this.
- **Sun disc + soft glow**, matched to the `DirectionalLight` direction that already exists in
  `polarDayLights`.
- **Water warmer and more saturated**, and a white foam band at every shore. `floeField.ts` already
  has a `foamMaterial` — verify what it currently draws before adding a second one.

### 6. What NOT to do

- **No bloom.** A scene made of white things blooms into mush, and it is a full extra pass.
- **No SSAO.** Mobile. Bake it (see 1).
- **No outlines.** Neither reference game uses them; they would read as Zelda: Wind Waker, which is
  a third style.
- **No `MeshStandardMaterial`.** `penguin.ts` already records why: PBR without an environment map
  is a duller Phong at several times the cost, and shipping an HDR is the asset
  `docs/DECISIONS/0003` exists to avoid.

## How each item is proved

A before/after screenshot pair, at the same seed, from a phone — Daniel's eyes, per the standing
rule that green tests have never been evidence for anything on the screen. Nothing on this list is
unit-testable, which is `CLAUDE.md`'s position on `render/` and not a gap.
