# 12 — Ice and Igloos

**Phase 5. 12a/12b/12c DONE (2026-08-21); only 12d (Deko) left, blocked on Der Laden (story 10d).**
Asked for on 2026-08-21: *"sometimes you
just earn ice — with ice you can build on your iglo, like a small house (similar to Animal Crossing),
bigger rooms, more rooms and so on. And later in the shops there will be deko stuff. From the style —
all should look cute."*

This is the progression. Story 10 gives a place to be; this gives a reason to come back tomorrow.

## The loop

Play a mode → earn **Eis** → spend it on your igloo → walk inside and see it. That is the whole
thing, and every part of it has to be visible on the island or it is a number in a HUD.

**Earning must not turn the games into work.** An eight-year-old who loses six rounds in a row still
has to end up with something, so Eis comes from *finishing*, with a bonus for winning — never from
winning alone. Rough shape, to be tuned against actual play:

| | Eis |
|---|---|
| finish a round | a little |
| win it | a lot more |
| first round of the day | a bonus |
| a chase survived to the shore | a bonus, because it is the mode with an end |

No timers, no energy, no daily-login mechanic that punishes a child for going to school. The bonus
is a gift, not a leash.

## The igloo

Animal Crossing's house, at a child's scale and built out of the primitives that are already there:

1. **One room** to start, and it is yours the moment the island is.
2. **Bigger** — the same room, wider. Cheap, and the first upgrade must be cheap enough to reach in
   one afternoon.
3. **More rooms** — a second dome off the first, then a third. An igloo is domes stuck together,
   which is the single luckiest fact about this whole feature: a dome is a `SphereGeometry` and a
   tunnel is a cylinder, so "more rooms" costs no new art.
4. **Deko** from the shop (story 10d): a rug, a lamp, a fish tank, a poster, a bed. Placed on a
   grid, rotated in 90° steps, no free positioning — a child placing furniture with a joystick needs
   snapping, and a grid is also what makes it storable in a few bytes.

Inside is a **separate framing**, not a separate world: the same follow camera, closer, with the
walls not drawn on the camera's side. Not a new mode — the island with a roof.

## What has to be decided before the first write

**The save format, and it gets a version from line one.** `storageKeys.ts` holds the rule: every key
under `floe.`, never edit an existing value, nothing persisted carries the product name. The sibling
repos' whole cautionary tale is data written before the shape settled.

```
floe.island.v1 = {
  eis: number,
  igloo: { rooms: [{ size, at }], deko: [{ id, cell, turn }] },
  owned: string[]           // deko and hats bought, by registry id
}
```

Rules: one key, one JSON blob, one version field. A read that does not understand the version
returns a fresh island rather than throwing — `storage.ts` already has the discipline that a store
which throws costs a hat and never the game.

**Eis is not simulation state.** A `World` is pure and replayable; a wallet is not. Nothing in `sim/`
may read the wallet, or a replay of the same seed stops producing the same round — and the failure
would be intermittent, which invariant 1 calls the worst way for a networking bug to break.

12a found the sharper version of that rule while building it: **a price is not a fact about a world
either.** This paragraph originally said the round would report what was earned as part of its
`Result`. It does not, and it must not — an `earned` number inside the pure module would give two
devices replaying one seed something to disagree about that has nothing to do with the ice, which is
the same category error as the wallet, one step smaller. What the round reports is what HAPPENED: it
ended, and who won. `lib/eis.ts` decides what that is worth, and credits it.

**And it must not become pay-to-win.** Deko is decoration and hats are hats. Nothing bought may
change a penguin's speed, grip, jump or snowball — the audience is 8–12 and the one child with no
Eis has to be able to win. This is a hard line, the same kind as "no free text".

## Cute, as a specification

"All should look cute" is the whole art direction and it deserves to be written down as constraints
rather than as a mood:

- **Big head, small body, wide base.** Nothing tapers to a point.
- **Two round black eyes and a tiny highlight in each.** No pupils that track, no eyebrows.
- **Everything rounded, everything bevelled.** Story 09's roundness pass is a prerequisite, not a
  parallel track.
- **Saturated but soft.** Pastel-with-conviction: the palette in `look.ts` is already close.
- **It bounces.** A cute thing is one that squashes when it lands and lags when it turns. Story 09's
  animation list is where most of "cute" actually comes from.
- **Faces on things.** An igloo with a round doorway and two small windows reads as a face, and that
  is not an accident in either reference game.

## Scope split

- **12a — Eis. DONE, 2026-08-21.** Earned in the four modes, shown on the island, persisted. No
  spending yet: a counter that goes up is already worth something to a child.

  **What it cost, and the two decisions worth reading before 12b.**

  `EIS_FOR_FINISHING = 3` and `EIS_FOR_WINNING = 7`, so a win is ten and a loss is three. The RATIO
  is the decision and not either value: a child who never wins earns at 30% of a winner's rate, which
  is enough that an afternoon of losing is visibly progress and not enough that winning stops being
  the point. `eis.test.ts` asserts that ratio against the two exported constants rather than against a
  copied 10, so raising the win bonus until losing stops mattering fails a test instead of passing
  quietly — the same shape as asserting the jump against `JUMP_APEX`. Three and seven rather than four
  and eleven because ten and three are numbers an eight-year-old adds up in their head. **For 12b:** at
  roughly ten rounds an afternoon that is 30–100 Eis, so a first igloo upgrade priced around 40 is
  "cheap enough to reach in one afternoon" as this story asks.

  **A price is not a fact about a world**, which is the rule above stated one step smaller. Nothing in
  `sim/` needed a new field: the round already reports the only two facts a payout needs — that it
  ended, and who won — and `lib/eis.ts` decides what that is worth. An `earned` number on a `Result`
  would have given two devices replaying one seed something to disagree about that has nothing to do
  with the ice, which is the same category error as keeping the wallet there.

  Two things this story asks for that 12a deliberately does NOT do, recorded here so the next person
  finds the reasoning rather than the gap:

  - **The first-round-of-the-day bonus.** It needs a clock and a stored date, it is the one part of
    this feature that cannot be tested without faking time, and — the argument that actually decides
    it — *a gift whose rule a child cannot see does not read as a gift*. It wants its own story, with
    the timezone change, the device whose clock is wrong, and midnight arriving mid-round thought
    about once rather than discovered three times.
  - **The chase bonus for reaching the shore.** Mostly already paid: reaching the shore in a chase IS
    winning it (`chase.ts` ends the mode when somebody arrives), so it collects the win bonus. A
    per-mode top-up would need a price list keyed by mode id outside `sim/modes/`, which is exactly
    the table story 10's registry refactor finished deleting.
- **12b — the igloo, outside. DONE, 2026-08-21.** `lib/igloo.ts`'s full ladder
  (`IGLOO_LADDER`/`priceOf`/`nextStep`/`planFor`/`buyNext`), `render/igloo.ts`, `Igloo.svelte`, and the
  "Bauen" door in the same slot the mode cards use. Went further than "the first two upgrades": all
  four rungs (Größer → Zweites Zimmer → Aussichtsturm → Drittes Zimmer, re-ordered from a silhouette
  measurement rather than shipped in the order first guessed) price out to 40/90/160/250 Eis from
  `priceOf`'s own formula, `(n+2)² × (EIS_FOR_FINISHING + EIS_FOR_WINNING)`.
- **12c — inside. DONE, 2026-08-21.** Not empty — the doorstep camera moves in
  (`IGLOO_VIEW`, `Game.svelte`'s `inside` state) and frames the domes actually owned. What it frames
  is bare, which is 12d's job, not this one's.
- **12d — Deko.** NOT DONE. `render/igloo.ts`'s own comments still describe it as future work: "a
  rug, a lamp, a fish tank, a poster, a bed, bought from a shop and placed on" a grid. Blocked on
  Der Laden opening (story 10's 10d, also not done) — there is nowhere to sell Deko from yet.
