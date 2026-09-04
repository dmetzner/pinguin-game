# 07 — Die Rutsche

> **Reworked twice.** First after "the slide game is broken as fuck" — the flat, walked, fixed-camera
> ribbon became the banked chute you ride, described below. Then again after "the sliding game
> physics are super bad, unplayable" (2026-08-22), which is `## The second rework` near the bottom:
> a "gap" was a dead stop rather than a jump, a bump was too shallow to ever launch anyone, and the
> bank pushed harder than gravity did. All three were measured with a headless run and its printed
> telemetry rather than guessed at, because green tests had already been wrong about this mode twice.

**Phase 4. Solo DONE** — `sim/slide.ts` (+14 unit tests), `render/chute.ts`, and edits across
`sim/types.ts`, `sim/floe.ts`, `sim/round.ts`, `sim/world.ts`, `sim/bot.ts`, `sim/constants.ts`,
`render/scene.ts`, `render/floeField.ts`, `components/Game.svelte`, the route and `identity.ts`. Two
end-to-end tests.

**A chute of ice down a mountain, six penguins, first to the bottom wins.** The Mario 64 slide, which
is the other thing a penguin does.

## Why it was small

Almost none of it is new machinery, and that is the point of the invariants paying off:

- Gravity already comes from a floe's GRADIENT (`step.ts`), so ice with a permanent tilt IS a slide.
- A penguin already falls when there is no floe under it (`archipelago.floeUnder`), so the edge of
  the run needs no walls and no new rule.
- The camera already frames whichever floe the local penguin is standing on, so it follows a racer
  down a mountain without knowing what a mountain is.

So the course is a chain of overlapping discs with a tilt, and the mode is forty lines of geometry
plus an ending.

## What is genuinely new

- **A race ends when somebody ARRIVES.** Every other mode ends when one penguin is left; a slide
  that waited for that would keep going after the winner had crossed, with the winner standing at
  the bottom watching.
- **`World.mode`.** Which game it is used to be DERIVED — one floe meant the classic round, several
  meant a Royal — and that was better while it held, because a derived fact cannot disagree with
  what it describes. A mountain is also several floes. The mode is stored now, and `round.isRoyal`
  is the one place that asks.
- **`Floe.anchored`, `tilt`, `altitude`.** Ice that is bolted to a hill: it does not bob, does not
  feel the swell, keeps the tilt it was built with, and sits lower than the ice above it.
- **`render/chute.ts`** — the discs are the physics; the picture is one merged ribbon with a raised
  lip down each side. Drawn as discs it looked like forty pancakes hanging in the air.

## Four numbers, all of them measured rather than chosen

1. **`SLIDE_GRADE`, against the DRAG the mode uses.** A run settles at `G · gradient / drag`. At the
   first value, 0.3 over the sea's `ICE_DRAG`, that is 4 m/s — slower than walking on the flat, a
   mountain you could stroll down. The chute has its own drag now (`SLIDE_DRAG`) and settles at
   12 m/s, which is fast enough that a corner arrives as an event.
2. **The camera turns, so the course does not have to be straight.** ~~`SLIDE_MAX_BEARING`~~ is gone.
   It existed because the camera was fixed and both the joystick and the keyboard derive
   up-on-screen from where it stands, so a course that wandered round to face the viewer inverted
   every control. Clamping the mountain to suit the camera was the wrong end: the camera follows the
   run's bearing now and the stick is rotated by the same angle.
3. **No attacks at all on the mountain** (`round.attackStrength` returns 0). With the shove live,
   half the field was in the sea within a second of the opening grace lifting and the winner was
   whoever happened not to be touched. Contact still separates — bumping is racing.
4. **The bots re-aim EVERY tick.** The rest of the game deliberately holds a stale intent for up to
   `reactionTicks`, which is what makes a bot beatable; at 8 m/s a 14-tick-old aim is two metres out
   of date, and they left the course on every bend.

## The rework, and the one idea in it

**The walls are GROUND.** That is the whole design. A chute's cross-section is flat down the middle,
rises parabolically to `SLIDE_BANK_HEIGHT`, and then flattens into a shelf along the top of the wall
— and because `step.ts` already turns a rising surface into a force that pushes a penguin down it
(that is how the icebergs in story 05 work), a banked run needed no new physics at all. It needed a
height function. `bankAt` is that function, `render/chute.ts` samples the same one for the picture,
and the wall you can see is therefore the wall that holds you.

Four things that were measured rather than chosen:

1. **The shelf along the top of the bank.** Without it the wall stopped rising exactly where the ice
   stopped, so a racer thrown up the bank left the course from the top of it — five of six, every
   seed. Being thrown up a wall has to put you ON the wall, still sliding, with a way back down.
2. **A fall costs `SLIDE_RECOVER_TICKS` (about two seconds), not the round.** Elimination on a
   mountain that is trying to throw you off is a race where nobody finishes, and that is literally
   what happened: 6/6 in the water. With a recovery it is 6/6 finishing, 33.5 s, the pack within five
   segments of each other.
3. **The camera turns with the run and pitches relative to the SLOPE.** The rig's 27° is measured
   over a flat sea; a chute descends at 26°, so the same rig on the mountain sat almost exactly
   parallel to the ice and a degree the wrong way put it UNDERNEATH, looking up at the underside.
   The course is free to wander now that the camera follows it, and the stick is rotated by the same
   bearing so "push up" is always "down the mountain".
4. **An open side keeps a LOW wall** (`SLIDE_OPEN_WALL`), on the outside of a bend. No wall at all is
   a cliff a racer is over before they saw it; a lip is a hazard they can feel arriving.

## The graphics pass, and the one thing it could not do

Tone mapping is in (`render/scene.ts`): ACES with a measured exposure. It is the single biggest
change to how this game looks, and the reason is that a polar day is a scene made almost entirely of
white things lit brightly — with the default linear mapping, snow, ice, a bank, a mountain flank and
a penguin's belly all clip to the same pure white, so nothing in the picture has a shape.

SHADOW MAPS are the obvious next step and are NOT in. They were built properly — a soft 1024 map on
the sun, its orthographic camera retargeted onto whatever `setFocus` was framing so the texels stayed
the size of a penguin rather than of a mountain — and the result was a blank scene: sky, HUD, and
nothing else, with no console error anywhere, while the same build with one flag off rendered
perfectly. The only renderer available here is software GL, so this may well be a limitation of that
rather than of the code, and a real phone may be fine. It is the first thing to try again on a
device, and the second is a `MeshStandardMaterial` pass with a procedurally generated environment
map. Neither should be shipped on a screenshot from this machine alone.

## What is missing

- **Multiplayer**, like Royal: the netcode sends one floe.
- **The camera when you fall.** It stays over the floe you fell from rather than following the race
  you are now watching.

## The second rework: "the physics are super bad", diagnosed rather than guessed (2026-08-22)

Bumps and gaps had landed since the section above was written — and both were broken, in ways that
read as correct in the source and were only found by stepping a real run headlessly at seed
20260821 and printing the telemetry, because Daniel had been told "fixed" twice already without
being shown the numbers.

1. **A "gap" was a wall, not a jump.** `step.ts` only computes height when there is ground BEFORE and
   AFTER a step (`groundBefore !== null && groundAfter !== null`); over open air `groundAfter` is
   null, the block is skipped, a penguin never becomes airborne, and the rim check takes it at the
   lip on the same tick. At every speed tried — 8.3 m/s and 11.2 m/s at the same two gaps — the
   result was a dead stop, not a jump. `SLIDE_GAP_EVERY` was 17, so this happened at segments 17, 34
   and 51 on **every single run**: three enforced 1.8 s stops (`SLIDE_RECOVER_TICKS`), 5.5 s total,
   at the same three places every time. **Fix: `SLIDE_GAP_EVERY = 0`**, off rather than tuned — making
   a real gap requires height to go negative over open air, which is a change to how a penguin leaves
   the ground, not a number, and belongs in a future pass.
2. **A bump was too shallow to ever launch anyone.** `step.ts` gives a penguin air only when the
   surface falls away FASTER than its own gradient. A half-cosine bump's steepest slope is
   `h·π / 2·reach`; at the old `SLIDE_BUMP_HEIGHT = 0.5` over a forced half-segment reach that is
   0.224 against a `SLIDE_GRADE` of 0.5 — never enough. Measured over full runs: 1–2% airborne, all
   of it the banks. **Fix: `SLIDE_BUMP_HEIGHT` is derived from the grade** (`2·reach·grade/π`, ×1.15
   headroom, capped at `SLIDE_BANK_HEIGHT` so a bump can never read as taller than the walls holding
   the run in) rather than chosen — a bump this course's own spacing can beat is a bump that launches,
   guaranteed by the arithmetic rather than hoped for. The break-even (1.11 m) is already above
   `JUMP_APEX` (0.85 m) at this spacing, so "launches" and "stays under a normal jump's height" turned
   out to be mutually exclusive here — the mode now picks launching.
3. **The bank was a spring, not a wall.** At `SLIDE_BANK_HEIGHT = 2.4` over a 0.35-radius rise, the
   cross-section's steepest gradient was 2.26 — pushing a racer 3.9 m off-centre sideways at 22 m/s²
   against 4.9 m/s² of downhill pull. A run bounced between 5.6 and 12.1 m/s the whole way down. **Fix:
   `SLIDE_BANK_HEIGHT = 1.8` over a wider 0.4 rise**, which holds a racer in at a gradient close to the
   one gravity is already giving them rather than one that overwhelms it.
4. **The course outran its own top speed.** `SLIDE_SEGMENTS = 60` was sized against the terminal
   speed on a straight (12.3 m/s), which a course made of bends never sustains — measured average
   under full-forward input was closer to 9 m/s, and sixty segments took 50 s rather than the
   "about forty seconds" the number was chosen for. **Fix: `SLIDE_SEGMENTS = 45`**, which is the
   run the actual average speed produces.

Verified rather than asserted: three headless runs (no input, full-forward, forward-plus-weave) at
the fixed seed, before and after, with the tick-by-tick telemetry printed rather than summarised.
Before: forced dead stops at three fixed segments in every run, 1–2% airborne the whole way down,
bank oscillation between 5.6 and 12.1 m/s. After: zero forced stops, 7–11% airborne (the bumps doing
their job), the same run finishing in 40–49 s depending on how it is driven. `slide.test.ts`'s two
affected assertions were rewritten to derive from the new constants rather than restate the old
numbers, and a third — "carries bumps you can take off from, and none you can hit" — was renamed and
rebuilt around the fact that a bump which beats this course's fall line and a bump under jump height
cannot both be true at this spacing; the mode picks launching and caps at the bank height instead.

**What is still a tuning pass rather than a bug:** whether 40–49 s is the right length for the
audience, whether the bank's 1.8 m height still feels too grabby or now too loose on a real phone,
and a working gap (the geometry change noted above) if the course ever wants one back. All three
need a thumb, not a headless run — the diagnosis above is as far as measurement alone can take it.
