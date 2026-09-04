# PinguIsland

Agent-facing conventions for the penguin game. For what it is and how to run it, see `README.md`;
this file is about how the code is organised and which defaults to keep when touching it.

Repo: `dmetzner/pinguin-game`. **The name in `brand.ts` is a codename** — see "Brand isolation".

## The five invariants

Everything else is negotiable. These are not.

1. **`src/lib/sim/` is pure.** No Three.js, no Svelte, no `Date.now()`, no `Math.random()`, no
   browser global. Time enters as a tick count; randomness enters as a seed. Three separate things
   depend on it and each fails differently when it slips: tests stop being able to replay a round,
   bots need a second code path, and phase 3 breaks _intermittently_ — the worst way for a
   networking bug to break. `purity.test.ts` scans the directory, and proves its own regexes
   non-vacuous by feeding them the violations they exist to catch.
2. **The renderer reads the world and never writes to it.** Input produces an `InputFrame` and
   nothing else. The moment `render/` can nudge a position, the simulation stops being the authority
   and host/client agreement stops being possible.
3. **The simulation advances in fixed 1/60 s ticks, decoupled from the display.** `render/loop.ts`
   is the only file that reads a clock. Frames interpolate between the two most recent ticks; they
   never drive the physics. A variable timestep would make the game different on a 120 Hz phone.
4. **No free-text communication between players, ever.** The audience is 8–12. Names come from a
   curated generator, emotes from a fixed set. This is not a feature to be added later "with a
   filter" — see `docs/DECISIONS/0004`.
5. **Nothing persisted contains the product name.** See below.

## Brand isolation

`src/lib/brand.ts` is the only place the name lives. Persisted keys use the domain-descriptive
`floe.` namespace. `brand.test.ts` enforces it by scanning `src/`.

A sibling project carries the cautionary tale: its repository, its codename and every one of its
localStorage keys still disagree, because the keys were written before the name settled and renaming
them later would have stranded real users' data behind a key nothing reads. The cost of getting this
right on day one is one file and one test.

## Stack

- **SvelteKit 2 + Svelte 5 (runes)**, TypeScript strict with `noUncheckedIndexedAccess`, Vite 8.
  **Versions are pinned exactly** — no carets. One `overrides` entry (`cookie`), whose necessity was
  re-verified here rather than copied: removing it resolves `cookie@0.6.0` and three advisories.
- **Node `>=22.12 <25`** — a ceiling as well as a floor, inherited from the sibling repos. From
  Node 25 on, Node defines its own `localStorage` and Vitest never installs happy-dom's, so any
  DOM test dies pointing at the setup file rather than at Node. This suite runs in the `node`
  environment and does not hit it _yet_; the ceiling is declared so the first DOM test does not
  discover it the hard way. `.nvmrc` pins 24.
- **Three.js**, used directly. No react-three-fiber, no scene graph abstraction, no physics engine —
  `docs/DECISIONS/0002` argues the last one at length.
- **Tailwind 4** for the handful of HUD elements, over tokens in `src/app.css`. No dark mode: the
  scene is a bright polar day and a dark HUD over it would be less legible, not more.
- **adapter-static** with `fallback: '404.html'`, never `index.html` — that overwrites the
  prerendered page with the SPA shell, which the sibling repos shipped and documented after the fact.

## Architecture

```
src/
  app.css                design tokens, `.overlay`, the rotate card, reduced-motion
  lib/
    brand.ts             the ONLY place the product name lives
    fullscreen.ts        getting the browser out of the way. One pure decision, the rest best-effort.
    identity.ts          this player's name and look, and whether the sound is off. ONE reader.
    look.ts              the palette, the hats, and coercion that clamps a stored look rather than throwing
    names.ts             two curated German word lists. The ONLY source of a player-visible name.
    storageKeys.ts       every persisted key, all under `floe.`. Never edit an existing value.
    storage.ts           guarded read/write; a store that throws costs a hat, never the game
    sim/                 THE GAME. Pure, deterministic, framework-free.
      types.ts           every shape. Imports nothing.
      constants.ts       every tunable number, each with what it trades against
      rng.ts             seeded mulberry32; `Math.random()` is banned in here
      vec.ts             XZ-plane helpers, all allocating, none mutating
      floe.ts            swell + weight → the gradient everyone feels, PER floe
      archipelago.ts     the sea when it has more than one floe in it: the seeded layout, "what am I
                         standing on", JUMP_RANGE (which every gap is derived from), and the HILLS —
                         `moundsFor` is read by the simulation AND by the renderer, so an iceberg you
                         can see is exactly the one you can climb
      combat.ts          collisions, snowballs, stun. Impulses collected THEN applied. A SIDELINE
                         throw is weak because its thrower is `out` — never a flag on the ball
      round.ts           countdown → play → result; the shrinking floe; the sinking ring; who won.
                         `isRoyal` asks the SEA how many floes it has — there is no mode flag
      chase.ts           Die Flucht: a route of platforms with holes in it, and a sea lion coming up it.
                         The hunter is a PLACE (`World.hunterAt`), not a pursuit — readable, replayable
                         and impossible to cheese by circling. Its top speed is under `WALK_SPEED` on
                         purpose: what it eats is hesitation, never a player who keeps running. The
                         route BENDS, rises and falls, and carries blocks you must jump — so `along`
                         (distance down the polyline) is the scale everything uses, never an axis
      slide.ts           the mountain: a chute of tilted discs, and the race down it. Almost no new
                         machinery — gravity already comes from a floe's gradient
      spectate.ts        where the eliminated watch from, and how far out the ring sits (outside the
                         whole archipelago in a Royal). Derived, never stored — no new field.
      bot.ts             an opponent, which is a thing that returns an InputFrame
      step.ts            one tick: round, floe, steer/gravity/drag/jump/rim, contact, end
      world.ts           the only construction path
    audio/cues.ts        what just happened, DERIVED by watching the world. Pure; survives a replay.
    audio/sound.ts       every noise, synthesised. No files. ONE device per page, unlocked by
                         the first touch anywhere, and it owns the mute.
    input/joystick.ts    thumb pixels → InputFrame. Pure; the component owns the events.
    input/actions.ts     the three buttons; latches a press and hands out a FRESH frame per tick
    input/keyboard.ts    the same steering and the same three actions from a keyboard. Physical
                         `code`, so WASD is a square of keys on QWERTZ too; diagonals normalised
    render/              everything you can see; reads the world, never writes
      scene.ts           the floe, the sea, the sky, the lights and the camera fit. Exposes VERBS
                         (addActor/setFloes/setFocus/setSpectators/setTime/render/drawInset), never
                         the objects. `polarDayLights` is the one definition of the light everything
                         in this game stands in.
      camera.ts          where the camera stands, as arithmetic and no three import. It is what
                         decides which way is UP ON SCREEN, so `input/joystick.ts` derives its sign
                         from it instead of describing it in prose.
      chute.ts           the slide, drawn as ONE ribbon with a lip down each side, plus the flanks of
                         the mountain it is cut into. The discs are the physics; drawn literally they
                         look like pancakes hanging in the air
      blocks.ts          the ice you have to jump in a chase. They are `Mound`s in the simulation; a
                         floe's hills are drawn from its island VARIANT and cloned, which is what
                         keeps a Royal affordable and has no room for a per-platform shape
      seaLion.ts         the thing in the chase, drawn at `hunterAt`. The WAKE is the rule made
                         visible — you can always see the white line even when the animal is behind ice
      sharks.ts          fins circling in the water. Pure scenery, like `bergs.ts`: the sea is fatal in
                         every mode and looked like a calm blue plane
      bake.ts            coloured shapes → one mesh with vertex colours. Object count is what a frame
                         costs; `uv` and the INDEX are the two attributes that make a merge fail
      floeField.ts       every floe drawn, one group each carrying its own tilt. A LIBRARY of six
                         islands built at mount and cloned per floe — ice breaks mid-round, and
                         building a cylinder in that frame hitches exactly when the player must react.
                         Also the crack, the shudder, the tip and `floeOffsetY`, which the PENGUINS
                         read too or they hover while their ice goes down
      penguin.ts         the character, plus the Actor that keeps one on screen and disposes it.
                         `mine` adds the two "that one is you" markers — arrow over the tag, ring on
                         the ice. The arrow's HEIGHT is a screen measurement: three metres up reads
                         as a label on the penguin standing behind
      preview.ts         the turntable in "Mein Pinguin". Borrows the GAME's renderer for a corner of
                         its buffer and copies it into a 2D canvas — ONE WebGL context per page
      snowball.ts        a fixed pool of eight; nothing is allocated mid-round
      iceChunk.ts        a pool of six chunks OUTSIDE the tilting group — separate ice on the
                         same sea. A spectator is PARENTED into its chunk so it bobs with it.
      nameTag.ts         canvas-texture sprite over the head
      loop.ts            fixed-timestep accumulator; the ONLY clock in the app
    net/                 phase 3. Nothing here touches WebRTC; `transport.ts` is the whole seam.
      snapshot.ts        the host's world as a thing that can be sent. Penguins BY INDEX, never by id.
      protocol.ts        the wire. Hot messages quantised by hand, cold ones JSON. `decode` never throws.
      predict.ts         step now, be corrected later. LEAD_TICKS is why any of it works.
      session.ts         createHost / createClient. The host trusts an input and never a position.
                         `lost` is how a client notices a host that stopped — silence is not an event.
      transport.ts       four methods. Trystero goes behind this; so does the loopback.
      loopback.ts        a network made of nothing, with latency, jitter and seeded loss. For tests.
      roomCode.ts        four letters an eight-year-old can shout. CVCV, no lookalikes, seeds the round.
      lobby.ts           who is in the room, and the honest message when nobody answers.
      broadcast.ts       a Transport between two TABS. Not the multiplayer; the way to test it.
    components/
      Joystick.svelte    the left thumb
      Customise.svelte   "Mein Pinguin" — swatches, hat chips, and a die. One tap aside, zero to skip.
      Room.svelte        the code, who is here, and "Los!". Hands Game a roster and a session factory.
      Game.svelte        ONE round: sim + renderer + controls + result. Remounted for a rematch,
                         so nothing from the last round can survive into the next. `opposition`
                         is bots or a room; it never learns whether it holds a host or a client.
  routes/+page.svelte    opens INTO a solo round, never into a menu. A rematch counter and the
                         one screen that asks "start a game or join one".
  routes/manifest.webmanifest/+server.ts
                         the PWA manifest, prerendered from `brand.ts` — a static copy in `static/`
                         would be the product name in a second place, under a home-screen icon.
  service-worker.ts      cache per build, claim on activate. Offline was already true of the code.
```

## Testing

Ship tests with the code. The norm, not optional.

- **The simulation** → Vitest, colocated. This is the bug-prone layer and it is fully unit-testable
  precisely because of invariant 1. Any new pure function ships with tests.
- **The renderer** → no PIXEL is unit-tested, and that has not changed: nothing about how something
  LOOKS is testable without a GPU, and the honest check there is `e2e/`, `npm run shots`, and a person
  looking at the screen. What IS testable, and what turned out to be worth testing, is **where one
  number is relative to another** — a claim about geometry rather than about appearance. In one day
  that class of test caught four real defects that no screenshot showed: decoration buried inside a
  floe, a snow drift 2.8 m across placed by its centre and hanging 11% past the ice, a prop sunk into
  the island, and an igloo's snow apron flaring ten centimetres outside the collision circle that
  describes the building. The last two are trap 8's family — geometry drawn past the rule the player
  can lose to.

  The line to hold: **a test that would go red because something got PRETTIER is a test that will be
  deleted in a month.** Assert that a piece sits on the ground rather than inside it, that nothing
  hangs off the rim, that a footprint matches the obstacle declared for it — never a colour, a count
  of objects, or a position art is free to move. And these guards must be fed the violation they exist
  to catch, like every other guard here: `floeField.test.ts` and `igloo.test.ts` both do it.

- **Flows** → Playwright against a real production build, three projects split by ORIENTATION as
  well as size. That split is load-bearing: portrait deliberately makes the controls inert, so a
  portrait project running the gameplay tests fails on the feature working correctly.

**Write the assertion so the failure explains itself.** The convention is that a test comment names
the specific way the thing breaks — "letting go was a perfect brake, so tilt was harmless", not
"tests steering".

**Assert the DERIVED value, not a copied number.** `JUMP_APEX` and `JUMP_AIRTIME` are exported and
the jump test asserts against them, so a constant and the comment beside it cannot drift. That is
how the pair claiming a 0.75 m apex while delivering 0.38 m was caught.

**Verify a new guard is non-vacuous.** `purity.test.ts` has a whole `describe` block that feeds its
own regexes the violations they exist to catch, plus a check that the directory it scans is not
empty. A `.not.toMatch` against a pattern that matches nothing passes forever.

**Look at the screen, with a harness.** `npm run shots` builds production, drives one round per mode
at a fixed seed, writes a PNG per mode into `shots/` (gitignored) — and asserts the frame is not
degenerate: how many distinct coarse colours it contains, and how much of it the commonest one
occupies. That second half is the point. The failure mode this stack actually has is a blank or
near-blank scene with NOTHING in the console (the first shadow-map attempt, and a torn file read
mid-edit), and a colour-bucket count catches it in one assertion. It is not a pixel-diff and must
not become one: art changes every frame legitimately, so the thresholds are set far below any real
frame and exist to catch "nothing rendered", never to police art direction. Four of the traps above
were a frame that was wrong while the source read as correct; this is how that gets cheaper to find.
`docs/ART-DIRECTION.md` is the brief the pictures are judged against.

**Prove an e2e result with `CI=1`.** `reuseExistingServer: !process.env.CI` means a local run may be
served by a preview built before your change. `CI=1 npx playwright test` forces a fresh build; that
is the only run whose green means anything.

## The modes, and the registry that holds them

`World.mode` is STORED, never derived. It used to be derived — one floe meant the classic round,
several meant a Royal — which was better while it held, because a derived fact cannot disagree with
what it describes. A mountain is also several floes; that is what ended it. The same argument is why
`GameMode.isRound` is a named boolean rather than being inferred from a round phase: a phase field
standing in for a semantic one is trap 7's shape.

**`src/lib/sim/modes/` is the only place allowed to know which mode is which.** A mode is DATA — a
descriptor carrying its name, its player count, how a world is built, its slice of a tick, how it
ends, its attack strength, its framing policy, and whether it has doors you can leave through.
`step.ts` stays the one tick and calls hooks; it does not grow a switch. Three things enforce it:

- `MODES` is a total `Record<Mode, GameMode>`, so a literal added to the union without a descriptor
  is a COMPILE error rather than an `undefined` at the first tick.
- `modes/guard.test.ts` scans `src/` for `=== 'classic'`-shaped comparisons and fails on any outside
  that directory — in the same spirit as `purity.test.ts` and `brand.test.ts`, including proving
  itself non-vacuous. If that scan's allow-list shrinks, check it still covers something.
- `resolveMode` is the one place an unknown id degrades instead of throwing, and it has three real
  callers: a stored preference written by an older build, a query string typed by a child, and a
  `welcome` from a device running a build this one has never seen. A client meeting a newer minigame
  plays the classic round; it does not die.

The reason for all of it: the owner wants twenty to thirty minigames eventually. At four, a string
union with switches across thirty files was survivable; at twenty-five it is not, and the refactor
never gets cheaper than it was at four. Adding the twenty-sixth is meant to be: write a descriptor,
add its id to `Mode`, list it in the registry.

**What a new minigame costs, measured rather than hoped: THREE FILES.** Verified by adding a sixth
literal to `Mode` with no descriptor and reading what `svelte-check` said — one error, in one file.

1. `sim/types.ts` — one literal on the `Mode` union.
2. `sim/modes/<name>.ts` — the descriptor. New file.
3. `sim/modes/registry.ts` — one import, one line in `MODES`, optionally one in `MODE_CYCLE`.

Nothing in `render/`, `components/`, `routes/`, `audio/`, `net/` or `input/`, and the new mode
inherits four tests written against `ALL_MODES` for free: it builds a world that ticks, everybody
spawns on ice, it ends only if it says it is a round, and its player count contains its own solo game.
The one caveat, and the island is the proof of it: a mode needing a behaviour none of the existing
tags covers also adds a value to `Framing`, `Scenery` or `BotStyle` **plus one branch where that enum
is consumed** — `Game.svelte` for the first two, `bot.ts` for the third. That is one branch per new
KIND of mode, never per mode; a sixth arena game costs three files and nothing else. Before the
registry it was five files minimum and up to thirty comparisons across five directories, enforced by
nothing.

The island is the fifth and it is not like the other four: nobody is eliminated, nothing shrinks,
nobody wins, nobody may attack anybody, and you cannot walk into the sea. It is deliberately NOT on
`MODE_CYCLE` — it is the place the games are reached FROM, so offering it as a fifth thing to cycle
past would be the menu that cycle exists to avoid.

Die Flucht is the only one with something hunting the player. Two numbers decide
whether it works: the hunter's top speed, which is BELOW `WALK_SPEED` so a running player is never
caught by arithmetic, and its leash, which only ever pulls it forward so a strong field cannot leave
the mode's own subject off the bottom of the screen. `backlog/stories/08-the-chase.md` records the
three bugs it cost, all of which read as jump bugs and none of which were.

The slide carries BUMPS now, one segment in nine. It had a jump button and nothing to jump: banks,
gaps and open sides are all reasons to steer, so the one control a child presses for the pleasure of
it did nothing for forty seconds at a time. A bump needed no new physics — `step.ts` already turns a
surface falling away faster than its own gradient into air — but its half-width is forced to HALF A
SEGMENT, because consecutive discs hand a point over at the bisector and a bump still rising there is
a step in the ice at every boundary.

The slide is a race, and three rules fall out of that rather than out of taste: it ends when somebody
ARRIVES, nobody may attack anybody on it (`round.attackStrength` is zero there — with the shove live
half the field was in the sea in the first second), and the course may not bend more than
`SLIDE_MAX_BEARING` from straight downhill, because the camera does not rotate and every control
derives up-on-screen from where it stands.

## Pingu Royal

Thirty penguins across a sea of floes that sink one at a time — `backlog/stories/06-pingu-royal.md`
has the design, the measurements and what is still missing. Three things to know before touching it:

- **`world.floes` is always an array** and the classic round is an archipelago of one. There is no
  mode flag anywhere; `isRoyal(world)` asks how many floes there are.
- **Floe size is a MEASUREMENT.** Outer floes are 6.6–7.6 m because at 4.4–6.2 m half the field
  drowned in ten seconds with nobody moving at all — the swell is a gradient of 0.15 and every
  constant in `sim/` was tuned against the runway a 7.6 m disc gives.
- **Nobody may hit anybody for the first three seconds**, and the protection FADES over the second
  after that (`round.attackStrength`). The fade is not politeness: a rule that flips at one tick is a
  rule a client running `LEAD_TICKS` ahead disagrees with, and an 8 m/s shove is a big thing to
  disagree about — `session.test.ts` measured 0.69 m of correction and refused it.
- **A penguin has two jumps.** One off the ice and one flap in mid-air (`AIR_JUMPS`), because
  crossing a gap was a decision made once, at a moment, on tilting ice — and the only feedback for
  mistiming it by a tenth of a second was drowning. The map is still laid out against the SINGLE
  jump: a child who never finds the flap can cross every gap in the sea.
- **Hills are real ground, and their width comes from their height.** `MOUND_MAX_SLOPE` is the
  constraint — gravity down a slope is `G · gradient` against `MOVE_GRIP` of push, so a hill whose
  footprint is chosen freely is a wall that looks like a ramp. Pick the height, derive the radius.
- **Density decides the pace.** Five to a floe is a thirty-second fight, so a Royal deals one floe
  per THREE penguins. Changing `ROYAL_PER_FLOE` changes how long a Royal lasts, not how crowded it
  looks.
- **Ice breaks, it does not melt.** A doomed floe warns for three seconds — crack, shudder, HUD
  countdown, creak — and then splits into two half-radius pieces that drift apart, tip and go under
  carrying whoever is standing on them. `ROYAL_PIECE_FRACTION` is exactly 0.5 for a reason: at a half
  the pieces are born touching, so the crack opens under the player rather than leaving solid ground
  where the middle used to be.

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

## Eighteen traps already paid for

All eighteen were found by RUNNING the thing — most by looking at the screen, the rest by an
end-to-end test — and every one of them reads as correct in review. Traps 7 and 8 were found by
Daniel playing it on a phone, which is the only instrument that finds that kind:

1. **Steering used the full grip budget regardless of stick deflection.** An untouched stick
   therefore requested a velocity of zero and _braked_ toward it at 9.5 m/s², which cancelled
   gravity almost exactly. Letting go was a perfect brake, the floe's tilt was harmless, and the
   entire design rests on tilt not being harmless. Grip is now scaled by stick deflection.
2. **The camera fit treated the near and far rims as symmetric.** They are not — the near rim is far
   closer to the camera and projects much further down the screen — so the near edge was cropped
   clean off the bottom. `fitCamera` now binary-searches the distance and asks the projection matrix
   whether every rim sample is inside the frustum, which removes the whole class of error.
3. **The dash ADDED its speed to whatever the penguin already had.** Measured on screen at 11.8 m/s,
   which on ice is a ~16 m stopping distance on a 6.5 m floe: the shove threw its own user into the
   sea more reliably than its target. It now SETS the velocity and carries extra drag for the length
   of the move, so it is a lunge that plants. Every combat number is a first draft — `docs/DESIGN.md`
   §9 lists which ones are most likely wrong.
4. **The "Nochmal" button was unreachable.** The joystick covers the left half of the screen and
   came after the result panel in the DOM, so it swallowed every tap on the one control that screen
   exists for. The controls are now unmounted once a round is over — the simulation ignores input
   then anyway, so a live stick was a lie as well as an obstacle.
5. **Svelte deleted a whole screen because nothing ever assigned the flag guarding it.** The
   "Das Spiel ist weg" panel was written, typechecked and committed to source, and was simply not in
   the bundle: `hostGone` was declared `$state(false)` and the one line that set it never landed, so
   the compiler proved the branch unreachable and dropped it. Nothing warned. If a block does not
   appear on the page, grep the BUILD for a string inside it before debugging anything else.

6. **A rematch repainted instead of restarting.** `{#key}` around MARKUP re-creates the DOM but not
   the component instance, so `onMount` never ran again and the fresh canvas was attached to
   nothing. It looked exactly like a frozen game. The key has to wrap a COMPONENT — hence
   `Game.svelte`.

7. **The stick's vertical axis was inverted, and the unit test defended it.** Pushing up walked the
   penguin toward the player for the whole of phase 1. The source comment reasoned about the axes
   twice, flipped and unflipped, and concluded "screen-up is +z"; `joystick.test.ts` then asserted
   exactly that. Both were prose about geometry. The expectation is now DERIVED from
   `cameraPlacement()` — move the camera and the test changes its mind — and this is the shape to
   copy for any other sign convention: assert against the thing that decides it, never against a
   sentence describing it. It cost a session's worth of "the controls feel off", plus a floe that
   felt random because every correction near the rim was a shove over it.

8. **The drawn floe did not shrink.** `round.ts` shrank `world.floe.radius`, `step.ts` took anyone
   past it, `snapshot.ts` even sent it over the wire — and the renderer had no verb for it, so the
   ice stayed drawn at full size for the whole round. Players fell into the sea while standing on
   ice everyone could see: rule 2 of `docs/DESIGN.md` (every death is explainable in the second
   after it happens) failing as completely as it can. If the simulation has a number the player can
   lose to, grep the renderer for a reader of it.

9. **A marker three metres over a penguin labelled the penguin behind it.** The "that one is you"
   arrow was placed clear above the name tag in the source, and the camera looks down at 27°: a
   metre of height is a third of a penguin of screen offset UP the frame, so over a near penguin the
   arrow landed on top of the ones standing further away. It reads as correct in code and points at
   the wrong bird on screen. Anything drawn ABOVE something else has to be measured against the
   screen, at the near rim as well as the far one.

10. **A second WebGL context took the game's away.** The customise preview began as its own
    `WebGLRenderer` on its own canvas — one line, and the obvious shape. Contexts are capped
    process-wide and the browser drops the OLDEST when it runs out, which is the game's: the symptom
    was never a broken preview but a frozen game behind a picker that worked perfectly, HUD stuck on
    its initial values. Five parallel Playwright pages reproduced it every run; a phone with a few
    tabs open is the same machine with a smaller cap. The preview now borrows the game's renderer for
    a corner of its buffer (`SceneHandles.drawInset`) and copies it into a 2D canvas. One page, one
    context — the same rule `audio/sound.ts` already follows for the sound device.

11. **Decoration buried inside the ice.** Snow drifts, meltwater and rocks were placed at y ≈ 0 in
    the slab's local space — and a `CylinderGeometry`'s origin is its MIDDLE, so every one of them
    sat half a metre inside the floe. They rendered perfectly, cost their triangles, and were
    invisible; the floes looked exactly as blank as before the work. Anything parented to the ice
    goes at `thickness / 2`. (The white-on-white half of the same session: pure white drifts on pure
    white ice are also invisible. The ice is faintly blue now so that things on it have a shape.)

12. **A wider button in the top row went dead.** The joystick's zone is the whole left HALF of the
    screen and it comes later in the DOM, so anything in the top-right row that reaches past the
    middle is covered by an invisible control that eats the tap. On a 568 px screen the row does
    reach past the middle — it grew a two-line mode switch — and "Mein Pinguin" became visible,
    pressable and dead. That is trap 4 for the FOURTH time, in a place nobody was looking, and the
    fix is a `z-10` on the row rather than another lesson about DOM order.

13. **Seventeen dead penguins standing in the middle of a Royal.** A spectator is parented into its
    chunk of ice and then positioned at `(0, 0)` — the chunk's own origin. An actor the chunk field
    could NOT place is never parented, and for it that same `(0, 0)` is the middle of the world. The
    pool held twelve and a Royal puts twenty-nine in the water, so the rest stood motionless on the
    middle floe, in the middle of the finale, for the rest of every round. Two fixes, because either
    alone would have left the trap armed: one chunk per penguin in the biggest game there is, and
    `update` HIDES anybody it still cannot place instead of leaving them wherever the maths put them.
    The slot count in `spectate.ts` grows with the sea for the same reason.

14. **A whole mountain drawn inside out.** `render/chute.ts` builds the run as quads, and every one
    of them was wound the wrong way round: the deck's normal pointed at the sea floor, so three
    culled it, and the screen showed the SKIRTS underneath through the hole where the ice should
    have been. It did not read as a missing surface — it read as a dark grey mountain, which is why
    it survived several looks and two rounds of "the slide is broken". Winding decides the front
    FACE and `computeVertexNormals` takes the light from the same place, so a reversed quad is a
    surface that is both invisible and unlit rather than a shading nit. If hand-built geometry looks
    flat, dark, or oddly transparent, check the winding before anything else.

15. **A parameter accepted and dropped, twice in one call chain.** `setFocus` grew `bearing` and
    `descent`, typed them, documented them — and still called `place(camera, distance, focus)` with
    three arguments. `Game.svelte` meanwhile declared `let bearing = 0`, rotated the STICK by it,
    and never assigned it. Both compile: an unused parameter is legal and a variable that is only
    ever read is legal. The camera simply never turned, through three rebuilds and three rounds of
    screenshots, while every part of the feature looked present in the source. TypeScript cannot see
    an argument you did not pass; if a new parameter has no visible effect, grep the CALL rather than
    re-reading the definition. Trap 5 is the same shape and this one cost as much.

16. **Every iceberg in the game was floating in the air.** Bergs are built from primitives and each
    primitive carries its own origin, so the group was positioned against the wrong one: on screen
    there was open water visible UNDERNEATH a berg, and the smaller ones read as folded paper boats
    sitting on the surface rather than masses sitting in it. It survived because a berg is scenery —
    nobody stands on one, nothing collides with one, no test could fail — and because "white ice
    against blue water" looks approximately right in a thumbnail. It is trap 11's family (decoration
    placed against the wrong origin) in the one place where the object is too big to miss and too
    unimportant to check. An iceberg is ~90% underwater; if it does not have a wet band at the
    waterline and bulk continuing below it, it is drawn wrong.

17. **A face the camera can never see.** The sea lion was given eyes, a muzzle, whiskers and a mouth,
    and none of it was ever on screen — not because of a bug, but because of geometry. The chase
    camera sits behind the player, the hunter is behind the player (that is the entire mode), and the
    hunter faces forward at its prey, so its face points AWAY from the camera by construction. Two
    rounds of modelling went into a surface the player's eye cannot reach. Before detailing any
    object, work out which way it is presented to the camera in the mode it lives in: the fix here
    was not on the animal at all but a 25-35 degree side offset on the rig, which is also what turns
    the gap between hunter and prey from a foreshortened distance into a readable one.

18. **An unlayered rule silently killed every `absolute` in the app.** `app.css` sets
    `position: relative` on `.action`, unlayered; Tailwind 4 emits `absolute` inside
    `@layer utilities`; and **an unlayered declaration beats a layered one regardless of where either
    sits in the file.** So every `absolute`, `top-*` and `inset-*` written on a button was dead, the
    three-button triangle laid out in NORMAL FLOW instead, and a 96 px circle beside a 176 px bar
    wrapped onto three rows and pushed the third button off the bottom of a 568x320 screen.
    `.sideline-ball`'s `inset: auto 0 0 auto` had never run either, so the spectator's Ball button had
    been growing in the wrong corner for as long as the class existed.

    Two things make this worth a trap of its own. It is **invisible to arithmetic** — every clearance
    measured correctly, for a layout that was not running, and remeasuring found the same fiction
    twice. And the file's own comment reasoning that "`.mode-switch` comes after `.action` on purpose"
    is sound between two UNLAYERED rules and cannot work against a layered utility, so the source
    reads as though somebody had already thought about the cascade here.

    What found it was a SCREENSHOT: the buttons stacked in DOM order, which flow layout is the only
    thing that produces. If a position, a `z-index` or an inset appears to have no effect, check
    whether the class you are fighting is unlayered before re-reading the geometry.

**A correction to traps 4 and 12, made on 2026-08-22, because the fact they rest on has changed.**
Both are recorded as "the joystick's zone is the whole left half AND IT COMES LATER IN THE DOM", and
the second clause is the load-bearing half. It is **no longer true of the action buttons**: in
`Game.svelte` the top-right row is at ~1384, `<Joystick>` at ~1692 and the dash at ~1859, every
element there has `z-index: auto`, so paint order is document order and the triangle wins the tap
however far the zone reaches. The row is still before the zone, which is exactly why it keeps its
`z-10`.

The lesson, in one line: **an overlap is only a trap 4 while the covering element is painted later —
check the render order before the geometry, because the geometry will be right and irrelevant.** A
32 px overlap was measured correctly (after first being measured as the whole button), and the
conclusion had simply stopped following. It was caught by reverting the fix and noticing the test for
it still passed.

Two things came out of it worth keeping. `src/stacking.test.ts` now asserts that order AND its
consequence in both directions, so reordering markup — the most innocent-looking edit there is —
fails a test rather than a child's thumb. And the near-miss is instructive on its own: a _comment_
naming `action-dash` 150 lines above the button made the first scan read the dash as coming first and
inverted the answer, so that comment is now one of the guard's own test cases.

One more is worth knowing about because it is _not_ a bug: three's lighting does not map intensity to
output the way "a Lambert surface facing the sky receives intensity × colour" suggests. The three
intensities in `scene.ts` are **measured** against the screen, and the comment there records the two
wrong values and what each looked like. Do not re-derive them.

## Accessibility and the audience

The audience is 8–12 on a phone, which changes what counts as a requirement rather than polish:

- **Landscape only.** Portrait is a framing problem, not a layout one — the camera frames the whole
  arena, so a tall screen pushes it back until a penguin is ~4% of the screen against ~13% in
  landscape. The rotate card is driven by a media query, not the Screen Orientation API, which iOS
  Safari does not implement.
- **A dead zone on the stick**, because a thumb resting on glass is never still, and a penguin that
  creeps while the player believes they are standing still is a death they cannot explain.
- **Full throw short of the rim**, because small thumbs do not reach the edge of a 56 px circle.
- **`pointercancel` handled as carefully as `pointerup`** — a system gesture or an incoming call
  fires only cancel, and a stick stuck at its last value walks the penguin off the edge on its own.
- No information carried by colour alone; every penguin carries its name over its head.
- `prefers-reduced-motion` stops the interface's animations. The scene keeps moving, because
  freezing it would be a blank screen.

## Status

`README.md` → Status is the single place that says what is built; do not restate it here or anywhere
else — this paragraph used to carry its own copy and it went stale the moment customisation shipped.
`docs/DESIGN.md` is the design the later phases are built against, and `backlog/stories/` is what is
next: the stories marked DONE record what each one actually cost, which is the part worth reading
before starting the one after it.
