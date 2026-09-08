# PinguIsland

Agent-facing conventions for the penguin game (`dmetzner/pinguin-game`). What it is and how to run
it: `README.md`.

**The name in `brand.ts` is a codename** — [brand-isolation](docs/brand-isolation.md).

## The gate

```bash
npm run check           # svelte-check, strict — the cheap one, before reporting done
npm run lint            # biome + prettier
npm test                # unit: sim, netcode, joystick maths, word lists
CI=1 npm run test:e2e   # the only e2e run whose green means anything
npm run shots           # a PNG per mode, asserted non-degenerate
```

## How changes land

**This repo is a playground/sandbox — the place to try things, not a product with users.** Quality
is deliberately secondary here; that is a decision, not neglect. Daniel's explicit call, made
2026-09-07.

**So this is the named exception to the estate-wide rule** in
`~/me/setup/docs/repo-governance.md`: no PR required, direct pushes to `main` are fine.

**One caveat: the site is publicly reachable at https://pingu.metzner.uk.** "Sandbox" means the bar
is low, not that nothing is checked — `npm run check` still exists and is cheap.

## The five invariants

Everything else is negotiable. These are not.

1. **`sim/` is pure.** No Three.js, no Svelte, no `Date.now()`, no `Math.random()`, no browser
   global; time is a tick count, randomness a seed, `purity.test.ts` scans it. Break it and replay,
   bots and phase 3 each fail differently — `docs/DECISIONS/0001`.
2. **The renderer reads the world and never writes to it.** Input produces an `InputFrame` and
   nothing else, or the simulation stops being the authority.
3. **Fixed 1/60 s ticks, decoupled from the display.** `render/loop.ts` is the only file that reads
   a clock; frames interpolate and never drive the physics, or the game differs on a 120 Hz phone.
4. **No free-text communication between players, ever.** Names from a curated generator, emotes
   from a fixed set. Not a feature to add later "with a filter" — `docs/DECISIONS/0004`.
5. **Nothing persisted contains the product name.** `brand.ts` is the only place it lives, keys use
   the `floe.` namespace, `brand.test.ts` scans `src/` — [brand-isolation](docs/brand-isolation.md).

## Stack

SvelteKit 2 + Svelte 5 (runes), TypeScript strict with `noUncheckedIndexedAccess`, Vite 8, Three.js
used directly, Tailwind 4 over tokens in `src/app.css`, `adapter-static`, Cloudflare Pages.
**Versions are pinned exactly — no carets**; `package.json` owns them, and the reasoning plus the
one `overrides` entry is in [stack](docs/stack.md).

- **Node has a CEILING as well as a floor** (`>=22.12 <25`): from Node 25 on it defines its own
  `localStorage` and Vitest never installs happy-dom's.
- **`fallback: '404.html'`, never `index.html`**, which overwrites the prerendered page.
- **No dark mode**: the scene is a bright polar day.

## Layout

`src/lib/` is `sim/` (the game, plus `modes/`), `render/`, `net/`, `input/`, `audio/`,
`components/`; `src/routes/` opens INTO a solo round rather than a menu, manifest prerendered from
`brand.ts`. The parts that are not guessable: **`net/transport.ts` is the networking seam**
(nothing else knows WebRTC), **`audio/` synthesises every noise** (no sound files),
**`Game.svelte` is ONE round** remounted per rematch, and **`storageKeys.ts` holds every persisted
key under `floe.`** — never edit an existing value. Every file:
[architecture](docs/architecture.md).

## Modes

**`sim/modes/` is the only place allowed to know which mode is which.** A mode is DATA — a
descriptor in a total `Record<Mode, GameMode>`; `step.ts` calls hooks rather than growing a switch,
and `guard.test.ts` fails any `=== 'classic'` outside it. **`World.mode` is STORED, never
derived.** A new minigame costs THREE FILES — [modes](docs/modes.md).

**`world.floes` is always an array** — the classic round is an archipelago of one and
`isRoyal(world)` asks how many; no mode flag. Royal: [pingu-royal](docs/pingu-royal.md).

## Gotchas

All read as correct in review; all were found by running it. The eighteen incidents:
[traps](docs/traps.md).

- **An overlap only eats taps while the covering element is painted LATER.** The joystick's zone is
  the left HALF of the screen; `stacking.test.ts` guards the order and the row's `z-10`.
- **An unlayered rule in `app.css` beats every layered Tailwind utility**, silently.
- **If a block never appears on the page, grep the BUILD for a string in it** — Svelte drops a
  branch whose guard is never assigned.
- **`{#key}` must wrap a COMPONENT, not markup**, or `onMount` never re-runs.
- **If the simulation has a number the player can lose to, grep the renderer for a reader of it.**
- **Anything drawn ABOVE something else is measured against the SCREEN** (the camera looks down 27°).
- **ONE WebGL context per page, and one audio device** — hence `drawInset`.
- **Anything parented to the ice goes at `thickness / 2`** — a cylinder's origin is its MIDDLE.
- **`toNonIndexed()` every piece before `mergeGeometries`** — a mismatch fails silently on screen.
- **Geometry that looks flat, dark or oddly transparent: check the WINDING first.**
- **An actor the field cannot place is HIDDEN** — `(0, 0)` unparented is the middle of the world.
- **If a new parameter has no visible effect, grep the CALL, not the definition.**
- **Assert a sign convention against the thing that DECIDES it** (`cameraPlacement()`), never prose.
- **`scene.ts`'s light intensities are measured against the screen; do not re-derive them.**
- **Work out which way an object faces the camera in its mode before detailing it** — the sea
  lion's face points away from the chase camera. **An iceberg is ~90% underwater**: wet band at
  the waterline, bulk below.
- **Draw calls, not the simulation, are where a frame goes** — one merged mesh per floe dressing
  and per penguin, no detail beyond `DETAIL_RANGE` ([performance](docs/performance.md)).

## Testing

Ship tests with the code: every new pure function in `sim/` gets them; no pixel is unit-tested.
Four rules ([testing](docs/testing.md)):

- **Never assert appearance; assert a geometric RELATION** — that a piece sits on the ground rather
  than in it, never a colour or a position art may move.
- **Assert the DERIVED value, not a copied number** (`JUMP_APEX`, `JUMP_AIRTIME` are exported for
  it).
- **Prove a new guard non-vacuous** by feeding it the violations it exists to catch, as
  `purity.test.ts` and `guard.test.ts` do.
- **The Playwright split by ORIENTATION is load-bearing** — portrait makes the controls inert.

## The audience

**8–12 on a phone, which makes these requirements rather than polish**
([audience](docs/audience.md)): landscape only, by media query rather than the Screen Orientation
API (no iOS Safari); a dead zone on the stick and full throw short of the rim, for small thumbs;
`pointercancel` handled as carefully as `pointerup`, or a stuck stick walks the penguin off the
edge; no information by colour alone; `prefers-reduced-motion` stopping the interface, not the
scene.

**`README.md` → Status is the one place that says what is built; do not restate it.**
`backlog/stories/` is next; the DONE ones record what each cost.

## More

| file (under `docs/`) | what it answers |
|---|---|
| [architecture](docs/architecture.md) | every file, and what it owns |
| [modes](docs/modes.md) | adding a minigame; why the registry |
| [pingu-royal](docs/pingu-royal.md) | thirty penguins on sinking floes |
| [traps](docs/traps.md) | the eighteen bugs behind the gotchas |
| [testing](docs/testing.md) | what is tested, what is not |
| [performance](docs/performance.md) | what a frame costs |
| [audience](docs/audience.md) | what 8–12 on a phone requires |
| [stack](docs/stack.md) | why each version is pinned |
| [brand-isolation](docs/brand-isolation.md) | why the name lives in one file |
| [DESIGN](docs/DESIGN.md), [ART-DIRECTION](docs/ART-DIRECTION.md), [DECISIONS/](docs/DECISIONS/) | the design later phases build against, the brief the screenshots are judged against, and the five decisions taken before the code |
