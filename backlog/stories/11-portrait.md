# 11 — Portrait

**Phase 5. Island, slide and chase DONE (2026-08-22); classic and Royal still behind the rotate
card, as this document recommended for v1.** Asked for on 2026-08-21: _"the game should also work
in vertical mode? most prefer playing like this on a phone."_

He is right about the audience and the rotate card is right about the camera. Both, at once — which
is why the answer is per-mode rather than a stylesheet change.

**What shipped, against the "Recommendation for v1" below.** The registry plumbing this document
called for — a `framing` and a `portrait` field per mode, read by the renderer and the rotate card —
was already in place (it shipped with the island). `slide.ts` and `chase.ts` now carry
`portrait: true` too: both use `framing: 'bearing'`, a fixed-distance camera that turns with the run
rather than fitting an arena, so the narrow-FOV problem that makes `classic`/`royal` unplayable in
portrait never enters the picture, and the tall screen axis helps rather than hurts (more of the
course ahead, more of the sea lion behind). No pitch or distance tweak was needed in the end — the
existing numbers read fine at the narrow aspect. Verified with e2e coverage (mirroring the island's
own "no card, a stick that answers" test) and a handful of manual screenshots partway into a run.
**Not verified on a real phone yet** — see the closing section below, which still holds: green tests
have never been evidence about a control axis in this repo, and portrait is the shape that section
warns about.

Still not built, and still deliberately deferred to the fallback this document names: the
follow-camera-plus-radar (or off-screen indicators) `classic`/`royal` would need, since their
`framing: 'arena'` genuinely cannot be fixed by a camera change alone.

## Why the rotate card exists, re-derived rather than quoted

`app.css` claims portrait puts a penguin at ~4% of the screen against ~13% in landscape, measured at
390×844. The arithmetic holds: the camera fits the whole arena (`solveDistance` in `scene.ts` binary-
searches the distance until every rim sample projects inside the frustum), and in portrait the
_horizontal_ field of view is the narrow one. A 6.5 m-radius floe is 13 m of width to fit; at a 58°
vertical FOV and a 0.46 aspect the horizontal FOV is about 29°, so the camera stands roughly 2.2×
further back than in landscape. A 1.7 m penguin at that distance is a few percent of the frame.

**No LAYOUT CSS fixes this, and neither does a steeper pitch** — the constraint is width, and width does
not care how far over the arena the camera leans. Portrait is only reachable by changing the camera
_policy_, and the policy is not the same in all four modes.

## The transform that changes the whole story (2026-08-21)

Everything below this line was written on the assumption that portrait's constraint is unfixable
without changing camera policy. **That assumption is wrong, and the correction reframes the story.**

A rotated container is `width: 100vh; height: 100vw`, and **`transform` does not change
`clientWidth`/`clientHeight`** — so the canvas hands the camera a LANDSCAPE aspect. `solveDistance`
then fits the arena exactly as it does on a real landscape phone: a penguin at ~13% of the frame
rather than ~4%. The constraint was never portrait as such; it was **the aspect ratio the camera is
given**, and a transform changes that without touching camera policy, the framing registry, or a
single simulation constant.

So the sentence above is true of layout CSS — flexbox, media queries, breakpoints — and false of a
transform. Rotating the content is therefore **not a nudge to get the phone turned. It is a portrait
play mode for all four arena modes**, reached without the follow-camera-plus-radar feature this story
costs it at, and it obsoletes most of what follows.

**Which raises the stakes on the one real objection rather than lowering them.** If the rotated state
is transitional, a stick that is 90° wrong is a two-second annoyance. If the game is genuinely
playable in it, a wrong axis is **trap 7 shipped** — and trap 7 cost a phase of "the controls feel
off" plus a floe that felt random because every correction near the rim was a shove over it.

The surface is smaller than it first appears: `clientX`/`clientY` are read in exactly one place
(`input/joystick.ts` via `Joystick.svelte`), nothing in the tree calls `getBoundingClientRect`, and
the drawn stick indicators are now `fixed` rather than `absolute`, so their coordinates already mean
viewport coordinates.

**The spec, so nobody re-derives it:**

- **One source for the angle, two readers.** A single value (0 or 90) in one module. The component
  applies it as the container's `transform` AND passes it to the joystick, which rotates its pointer
  delta by the same amount before producing a stick vector. **Never a CSS constant plus a TypeScript
  constant** — that is trap 7's actual lesson (assert against the thing that decides, never a copy of
  it) and trap 15's shape.
- **The delta rotation is pure**, belongs in `input/joystick.ts`, and its test derives the expectation
  from the angle rather than writing a number — exactly how `joystick.test.ts` was fixed to derive
  from `cameraPlacement()`.
- **`env(safe-area-inset-*)` stops naming the edges it is used for.** `safe-b` would pad the wrong
  physical side and put the thumb controls under the home indicator. That remap lives in `app.css`.
- **The Playwright portrait project's contract inverts** — it exists to prove the controls are inert,
  and this makes them live.
- **Budget: one session for the code and a separate one with a real phone.** Green tests have never
  been evidence about a control axis in this repo, and this is the single worst thing to be wrong
  about.

Not built. Deliberately not built overnight, because the piece that decides whether it is correct is
a thumb.

## Mode by mode

**Slide and Chase: portrait is BETTER, and cheap.** Both already have a moving focus and a rotating
rig (`place(camera, distance, focus, bearing, descent)`). The interesting axis in both is
forward-down-the-course, which is the _tall_ axis on a portrait screen — a chase in portrait shows
more of what is ahead of you and more of the sea lion behind. Cost: a pitch tweak and a distance
tweak. This is the cheapest real win in the story.

**The island (story 10): portrait-native.** A hub has no arena to fit. A follow camera at a fixed
distance is the right camera regardless of orientation, and this is where most phone-time will be
spent.

**Klassisch and Royal: portrait costs a HUD.** The arena fit is load-bearing — `docs/DESIGN.md` §4
argues that a camera which follows a player hides the opponent about to shove them, and trap 8 in
`CLAUDE.md` is the whole lesson about players losing to something they could not see. Two ways out:

- **Follow camera plus off-screen indicators and a radar.** Shippable, and it is a real feature to
  design and build, not a flag. Whatever it costs, "the rim you fell off was off-screen" must not
  come back.
- **A smaller arena in portrait.** _Rejected._ Floe size is a simulation number and a measurement
  (6.6–7.6 m outer floes, because at 4.4–6.2 m half the field drowned in ten seconds), and in
  multiplayer two players on differently-shaped screens must be standing on the same floe. A
  simulation constant may never depend on the display.

**Recommendation for v1:** portrait for the island, the slide and the chase; the rotate card stays
for the two arena modes. Honest, already-built for the fallback, and it makes the phone's natural
orientation the _default_ place the game lives.

## Where the policy belongs

In the mode registry (story 10, section 4): a `framing` and a `portrait` field per mode. One list,
read by the renderer and by the rotate card. The alternative — a media query in `app.css` plus a
condition in `Game.svelte` plus a branch in `scene.ts` — is trap 15 waiting to happen, where a
parameter is accepted in three places and dropped in one.

## The controls have to be re-laid-out, and this is where the traps are

The joystick's touch zone is **the whole left HALF of the screen** and it comes late in the DOM.
That is a sane rule in landscape and a bad one in portrait, where the left half of a narrow column
is most of the play area. Rework: joystick in the bottom-left _quadrant_, actions bottom-right.

Then re-audit the overlap, because this exact class of bug has been paid for **four times** — traps
4, 12 and the two `app.css` notes about the result panel covering the mute button. Every overlay,
every top-row button and the result panel gets checked against the new geometry, in portrait, on the
narrowest screen. `z-10` on the row is the fix that worked; it is not automatically still correct
when the row is somewhere else.

Also: `--portrait` in `app.css` is a _customise-sheet_ variable name (the penguin turntable's box),
and the customise sheet's two-column layout is switched on `@media (orientation: landscape)`. Adding
real portrait support means that name and that query both need a second look — a variable called
`--portrait` that has nothing to do with portrait mode is a five-minute confusion every time.

## What the test suite has to do differently

The Playwright projects are split by **orientation as well as size**, and `CLAUDE.md` calls that
split load-bearing: _"portrait deliberately makes the controls inert, so a portrait project running
the gameplay tests fails on the feature working correctly."_ That inverts. The portrait project
stops being a test that the game refuses to play and becomes a test that it plays — for the island,
the slide and the chase — while still asserting the rotate card for the arena modes.

That is a suite change, and it needs `CI=1` to mean anything (`reuseExistingServer: !process.env.CI`
— a local green may have been served by a preview built before the change).
