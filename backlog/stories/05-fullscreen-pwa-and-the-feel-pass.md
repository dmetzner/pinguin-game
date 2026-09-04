# 05 — Fullscreen, the PWA, and the pass Daniel's first play session asked for

**Phase 2 (the PWA half) plus corrections. DONE** — `lib/fullscreen.ts` (+4 unit tests),
`routes/manifest.webmanifest/+server.ts`, `service-worker.ts`, `scripts/make-icons.mjs`,
`render/camera.ts`, and edits across `render/penguin.ts`, `render/scene.ts`, `sim/constants.ts` and
`components/Game.svelte`. Six new end-to-end tests.

**It started as "make it fullscreen and a PWA" and turned into a bug hunt**, because the same
session was the first time the game had been played on a real phone. Two of the things it found had
been shipped, reviewed and covered by a passing test.

## What shipped

**Fullscreen, in the two ways that exist.** Installed, the manifest asks for `display: fullscreen`
and gets it with no code at all. In a tab, the first touch requests it — the API needs a gesture —
and only on a touch screen: a page that goes fullscreen because you clicked in it is a page nobody
trusts, and that rule is also what keeps `npm run dev` and the Playwright suite in an ordinary
window. iPhone Safari has no Fullscreen API, so there the home-screen install is the whole answer
and the game is laid out and tested without it either way. A button in the panel head covers coming
back after the system gesture, and hides itself where it could do nothing.

**Installable and offline.** The manifest is a prerendered ROUTE rather than a file in `static/`,
because it carries the product name and `brand.ts` is the only place that is allowed to live —
otherwise the copy that goes stale on a rename is the one under a child's home-screen icon. Icons
are drawn from the same primitives the game is made of and rasterised by a script that uses the
Playwright Chromium this repository already installs, so there is no native image dependency. The
service worker caches per build and claims open pages.

**The controls, the ice, and what the round says.**

- The stick's vertical axis was **inverted**, and had been for the whole of phase 1.
- The drawn floe **never shrank**, so the arena was quietly smaller than the ice on screen.
- The floe went from 6.5 m to 7.6 m and its floor from 2.6 m to 3.2 m, with the grace period at
  18 s — the endgame was decided by whoever stood in the middle.
- The penguins **walk** now: the gait is driven by distance travelled, not by the clock, so the legs
  turn over with the ground and wind down while a penguin keeps sliding. The drawn heading chases
  the simulation's rather than snapping to it.
- Better graphics, within `docs/DECISIONS/0003`: smooth-shaded glossy birds against ice that keeps
  its facets, a gradient sky with a haze band on the horizon, and a sea with analytic normals, a
  fresnel term and a sun it can catch.
- The instructions leave the screen while a round is playing; a loss says **Verloren** rather than
  naming the winner and leaving the child to work it out; and the winner is named by their NAME.

## Four traps this cost

1. **`bot2 gewinnt`.** `world.round.winner` is a penguin id, and the result screen printed it
   verbatim — about a penguin that had been wearing a generated German name over its head for the
   whole round.
2. **A unit test that defended a bug.** The inverted stick had a test asserting exactly the wrong
   sign, because both the test and the source comment reasoned about axes in prose. The expectation
   now comes from `cameraPlacement()`: move the camera, and the test changes its mind.
3. **A zero-byte file disabled the whole offline story.** `cache.addAll` is all-or-nothing and a
   failed install is discarded entirely, so the 404 on `static/.nojekyll` — a leftover from GitHub
   Pages that most static servers refuse to serve — left the game with no service worker at all and
   no symptom other than the dinosaur still appearing. `build` is now added all-or-nothing and
   `files` one at a time.
4. **A longer round outran the test timeout.** Playwright's default is 30 s and a full round now
   takes up to a minute — which is the pace the design asks for, so the timeout moved rather than
   the game.

## Still open

- The **difficulty picker**. Bots are `easy` and nothing chooses otherwise; `createBot` has taken
  the level since story 02.
- **Install prompt.** Nothing catches `beforeinstallprompt`, so installing is whatever the browser
  offers on its own. Worth doing only once somebody other than Daniel is playing it.
- **A sound for the gait.** Footsteps are the obvious cue now that there are steps to hear, and
  `audio/cues.ts` derives cues by watching the world, so it would be one more derived cue rather
  than an emitter.
