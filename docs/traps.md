# Eighteen traps already paid for

Answers: "which bugs this codebase has already had, each of which read as correct in review"

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

