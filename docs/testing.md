# Testing

Answers: "what is tested here, what deliberately is not, and how a test is written so its failure explains itself"

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

