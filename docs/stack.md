# The stack, and why each piece is pinned the way it is

Answers: "which versions and adapters are chosen deliberately here, and what breaks if one moves?"

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

