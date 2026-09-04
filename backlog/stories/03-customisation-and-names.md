# 03 — Customisation and the name generator

**Phase 2. DONE** — `lib/look.ts`, `lib/names.ts`, `lib/storageKeys.ts`, `lib/storage.ts`,
`components/Customise.svelte`, plus `look.test.ts` (13) and `storage.test.ts` (8) and one e2e that
takes a colour, a hat and a re-rolled name through a reload.

**Two deliberate deviations.** No scarf, and no unlocks. The scarf is a mesh the renderer does not
have and it buys a fifth axis on a set that already offers 800 looks; the unlocks are worse than
absent — "hats unlocked by playing" turns the first round into a means to an end, and this audience
opens the app to play, not to earn. Both stay in the backlog rather than in the code. Everything
else in "done looks like" shipped.

**Two traps this cost.** The body palette shipped with two luminance collisions (violet/cornflower
and coral/magenta, 0.008 apart) — the "vary lightness, not just hue" note above was written and then
not actually held, and only a test that measures WCAG luminance over every pair caught it. And
"Schnorchel Schnuppe" was 19 characters against an 18-character name tag: the check has to run over
every combination in both lists, not over a sample, because the pair that breaks is the one nobody
would think to try.

## What

A child makes their penguin theirs, in under thirty seconds, and never has to.

## Done looks like

- Colour choice for body, belly and beak/feet, plus a hat and a scarf, all procedural — the
  renderer already takes a `PenguinLook`.
- A German name generator: two curated word lists, thousands of combinations, an obvious re-roll.
  No free text — `docs/DECISIONS/0004`.
- Stored in localStorage under the `floe.` namespace. `brand.test.ts` and the storage-key test
  enforce the naming.
- Hats unlocked by playing. No currency, ever.
- Reachable from the main screen in one tap and skippable in zero.

## Known traps

- **The word lists are the deliverable, not the generator.** A generator over a mediocre list
  produces mediocre names and children will resent being unable to type their own. This needs
  someone with an ear for what an eight-year-old finds funny, and it is not a coding task.
- Colours must stay distinguishable from six penguins at once at arena distance, including for the
  common colour-vision deficiencies. Vary lightness, not just hue.
- Never edit an existing storage key's value — that strands whatever is already saved under it.
