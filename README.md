# PinguIsland

> ## ⚠️ THIS IS AN EXPERIMENT, NOT A PRODUCT
>
> **This repository exists to answer one question: how far can [Claude Code](https://claude.com/claude-code) get building a 3D browser game on its own?**
> Effectively all of the code, the tests, the design documents and the commit messages here were
> written by Claude (model: **Opus**), driven from a terminal. The human in the loop set the
> direction, played the result on a phone and said what felt wrong.
>
> **Is it playable?** Partly. Some of it is genuinely fun. Some of it is not.
>
> **Is it full of bugs?** **Yes.** Expect broken physics, wrong camera angles, modes that
> misbehave, and things that look finished in the source and are not on screen. `CLAUDE.md` lists
> eighteen traps that shipped and had to be found by a person playing it on a phone — a green test
> suite never caught one of them, and that is the most honest thing this repository has to say.
>
> Do not treat this as a reference for how to build a game, and do not treat the confident tone of
> the documentation below as a claim of quality — that tone is itself part of what the experiment
> produced.
>
> Read it as a specimen. MIT licensed, so do what you like with it.

A mobile web game for 8–12 year olds. You are a penguin on an ice floe in a rocking sea, and so are
up to five others. Snowballs, shoves and a well-aimed jump all knock a penguin off balance for a
moment — and a moment is all it takes when the ice is tilting. **Last one still standing wins.**

> **PinguIsland is an internal codename**, not necessarily what this is called on a home screen.
> Nothing persisted contains it: stored keys use the `floe.` namespace, and the name lives in
> `src/lib/brand.ts`. A rename is that file plus some copy, not a data migration. `brand.test.ts`
> enforces it.

Free to build and free to run: no assets are bought or licensed — every penguin, floe and wave is
generated in code — there is no backend, and multiplayer is peer-to-peer.

## Status

**The game opens onto an ISLAND now, and the four games are places on it. Offline, with no network
anywhere.**

You arrive in the Rathausplatz and walk. Stand in the square and thirty penguins play there; the
jetty east is the classic round; the mountain north has a cable car up to the slide; the cave south
is where the sea lion is. Each game pays you **Eis** for finishing — more for winning, but never
nothing for losing — and "Zur Insel" puts you back at the door you came in by.

A shrinking floe with three bots on it; thirty penguins across a sea of ice that sinks under them; a
chute down a mountain and whoever reaches the bottom first; and a sea lion coming up a line of
platforms behind you. Each is the same simulation in a different arrangement — there is no second
code path for any of them — and as of the island they are DATA rather than a string union: a mode is
a descriptor in `sim/modes/`, and adding the twenty-sixth is meant to be writing one. That refactor
happened at four modes on purpose, because it never gets cheaper.

The classic round is still the one the rest is built on: a countdown, a fight, a winner, and
"Nochmal" in one tap. Phase 0 answered whether skating on wobbling ice feels good; story 01 added the fighting;
story 02 added the round that makes it matter; story 03 made the penguin in it recognisably yours —
a colour, a hat and a name, remembered between visits. Phase 3 has started at the far end: the
netcode is built and proved against a simulated bad connection, and what it is still missing is a
real one. It makes a noise now, too.

| Area | State |
|---|---|
| Simulation | **Built.** Fixed 60 Hz, deterministic, pure. Ocean swell plus weight-based tilt, ice steering, drag, jumping, falling in, combat, and the round. 204 unit tests over the simulation alone, 433 across the suite. Two determinism tests: 400 scripted input frames replayed frame for frame, and a full 30-second round against three bots replayed exactly. |
| Renderer | **Built.** Procedural penguin, an irregular floe, a shader ocean and a gradient sky, a camera fitted by asking the projection matrix, a name tag over the head. No shadow maps — a blob shadow does the one job height-reading needs. Each penguin is an `Actor` that owns and disposes its own materials. The birds are smooth-shaded and lightly glossy while the ice keeps its facets; the sea has analytic normals, a fresnel sky term and a sun it can actually catch, and the sky carries the bright haze band that gives the floe a level line to rock against. The drawn floe now follows the simulation's radius as it shrinks — for the whole of phase 1 it did not, so the arena was quietly smaller than the ice on screen. **Your own penguin carries two markers**: an arrow bobbing over its name tag and a ring on the ice, one for when the birds are apart and one for when they are in a pile. The arrow's height was chosen against the screen, not in the source — at three metres it looked right in code and pointed at the penguin standing behind. **One WebGL context per page**: the customise sheet's turntable is drawn by this renderer into a corner of its own buffer and copied out before the frame is cleared, because a second context is a capped resource and the browser drops the oldest — which is the game's. |
| The opening | **Three seconds where nobody may hit anybody**, so a child can find their penguin before the fight starts — movement is live, because the ice tilts from the first tick and being unable to correct for it is the same death wearing a different hat. The protection then fades over a second rather than switching off: a rule that flips at one tick is one a networked client disagrees with, and an 8 m/s shove is a big disagreement. Bots hold a station through it and warm up over four seconds afterwards, because the first version had thirty of them commit at once the tick it expired. |
| Jumping | **Two of them.** One off the ice, and one flap in mid-air that is weaker and can be used once before landing. Crossing between floes was "quite challenging", and the reason was not distance — every gap is laid out against a single jump — but that a jump is a decision made once, on tilting ice, whose only feedback for being a tenth of a second wrong was drowning. Air control went up with it, and the gaps came down a little, deliberately by less than the flap is worth. The map is still built against the single jump, so nobody has to discover the second one to play. |
| Snowballs | **Jumpable.** A ball that passes under a penguin's feet misses, which is the counterplay a ranged attack needs in a game whose other two attacks both require closing the distance — and a thing an eight-year-old discovers by accident and then does on purpose forever. |
| Terrain | **Icebergs you can climb.** Some floes carry hills: real ground, with a height you stand on and a slope that feeds the same gravity term the floe's own tilt does, so the top of one is high ground that wants you off it rather than a camping spot. Their footprint is DERIVED from their height against `MOUND_MAX_SLOPE` — chosen freely, a hill is a wall that looks like a ramp, which is what the first draft built at a 0.97 gradient against 9.5 m/s² of grip. `moundsFor` is read by the simulation and by the renderer, so the iceberg drawn on the ice is the one you can walk up. Beyond the playable sea there is a skyline of big bergs: pure scenery, and the only scenery in the game — without it an archipelago has nothing to judge distance against and reads as a diorama. |
| Controls | **Built.** Floating joystick with a dead zone and full throw short of the rim, plus a jump button. Pointer events, so a mouse works for development. **A keyboard plays it too** — WASD or the arrows to steer, Space/J/K (or F/G) for Hüpf, Ball and Schubs — because holding a mouse button down to steer leaves no hand for anything else. Keys are read by physical `code`, so WASD is the same square on a QWERTZ board; diagonals are normalised so a desk player is not 1.41× faster; auto-repeat is dropped so a held key latches one action, not thirty a second; and losing the window releases everything, which is the desk version of `pointercancel`. The instructions name the keys on a machine with a real pointer, or from the first key anybody presses. The stick's vertical axis was INVERTED for the whole of phase 1 — pushing up walked the penguin toward the player — and the unit test asserted the bug rather than the screen; the expectation is now derived from where the camera stands (`render/camera.ts`). |
| Orientation | **Built.** Landscape only, with a rotate card in portrait that also makes the controls inert. Both halves asserted end to end. |
| Combat | **Built.** Circle collisions with impulses collected across every pair before any is applied, so the outcome cannot depend on array order. Snowball (1.2 s stun, small push), shove (0.8 s, large), stomp (1.0 s, largest) — one rule, three tools. Cooldowns live in the simulation, never in a disabled button. A stunned penguin loses its input and nothing else: it still slides, still collides, and still goes over the rim. |
| Bots and rounds | **Built.** Countdown → play → result, with a floe that shrinks from 7.6 m to 3.2 m so a stalemate cannot last. Bots at three difficulties (easy by default) that produce an `InputFrame` and nothing else — there is no "is this a bot" branch anywhere in the simulation. A draw when the last two go in together. Going in is not a fail screen: an eliminated penguin surfaces on its own chunk of ice beside the arena, name tag and all, and watches the rest of the round. "Nochmal" remounts the whole game from a fresh seed, so nothing from the last round can survive into the next. |
| Customisation and names | **Built.** Eight body colours ordered by measured WCAG luminance so the set survives being seen without hue, four beaks, five hats in six colours — 800 looks. Names come from two curated German word lists, 1156 combinations, re-rolled with a die; there is no text field and there will not be one (`docs/DECISIONS/0004`). Kept in localStorage under `floe.`, and a store that throws costs a hat rather than the game. **The sheet now shows the penguin while it is being made** — the real actor on a slow turntable, lit by the same three lights as the ice, so nothing in the picker can disagree with what lands on the floe; every choice used to be a bet settled only after "Fertig" restarted the round. On a landscape phone it sits in a column beside a picker that scrolls on its own. |
| Die Rutsche | **Solo built, and reworked once.** A banked chute of ice down a two-hundred-metre mountain, six penguins racing to the bottom. The first version was a flat ribbon you walked down and it was rejected on sight; what makes this one a slide is that the WALLS ARE GROUND. A chute's cross-section is flat down the middle, rises parabolically to a bank, and then flattens into a shelf along the top — and because `step.ts` already turns a rising surface into a force, a banked run needed no new physics at all, only a height function. `bankAt` is that function, and `render/chute.ts` samples the same one for the picture, so the wall you can see and the wall that holds you are the same wall. The shelf is a measurement: without it the ice ended exactly where the bank stopped rising, and a racer thrown up the wall went over the top of it — five of six, every seed. Falling off costs about two seconds and a shove back onto the course rather than the round, which took the field from nobody finishing to everybody finishing. The camera turns with the run and pitches relative to the SLOPE, and the stick turns with the camera, so "push up" is always "down the mountain" however far round the course has wandered. One segment in nine carries a BUMP to take off from, because the mode had a jump button and nothing to jump — and its width is forced to half a segment, since two discs hand a point over at the bisector and a bump still rising there would be a step in the ice at every boundary. |
| Die Flucht | **Solo built, and reworked once.** The route bends, rises and falls, and carries blocks of ice you have to jump — it ran dead straight at first because the camera did not turn, and the slide's rotating rig is what let it stop. Progress is measured along the ROUTE rather than down an axis: two racers equally far around a corner have quite different z, and the sea lion is a place on that same scale, so it would have eaten whoever took the outside of the bend. The blocks are `Mound`s, so the simulation needed nothing new; what makes one an obstacle rather than one of a Royal's hills is that its radius is chosen instead of derived, so gravity down its face beats the grip and it cannot be walked up. The sea lion runs at 97% of a walk on a thirteen-metre leash, which absorbs no mistakes at all — measured over eight seeds, every race is still won by somebody reaching the shore in about seventy seconds, with three to six of six alive.<br><br>**Originally.** A sea lion is coming up the line and the only way is forward: twenty-six platforms with real water between them, six penguins, and whoever reaches the shore wins. It is the only mode with something hunting the player, and it is the one that finally makes the jump the verb rather than a way to shed a bad tilt. The hunter is a PLACE rather than a pursuit — a distance along the course that advances every tick — which makes it readable at a glance, deterministic, replayable, and impossible to cheese by running in circles. Two numbers decide whether it works, and both are measured: its top speed is BELOW a walk, so a player who keeps running is never caught by arithmetic and what it eats is hesitation; and its leash only ever pulls it forward, so a strong field cannot leave the mode's own subject somewhere off the bottom of the screen. Snowballs and shoves stay live, unlike on the mountain. Three bugs it cost are in `backlog/stories/08-the-chase.md`, and all three read as jump bugs while being a bot's idle hop, a pile-up at a shared aim point, and a gap measured along the wrong axis. |
| Sharks | **In the water, in every mode.** Fins tracing slow circles beyond the ice, seeded from the round so both players in a room watch the same sea. Pure scenery and deliberately so — the water is already fatal, and what was missing was anything on screen that said why. A fin says it in a language an eight-year-old already speaks, and it says it before the mistake rather than after. |
| Pingu Royal | **Solo built, and the ice breaks.** A doomed floe now announces itself for three seconds — a crack opens along the exact line it will split on, the ice shudders underfoot, the HUD counts down in tenths and it creaks — and then it breaks in two: two half-size pieces that tip apart, drift, carry whoever is standing on them, and go under. `ROYAL_PIECE_FRACTION` is exactly one half so the pieces are born touching and the crack opens UNDER the player rather than leaving solid ground where the middle was. No two floes look alike either: a library of six islands, each with its own rim harmonics, thickness, snow drifts, meltwater pools, pressure ridge and rocks, cloned per floe — built once at mount, because a fragment appearing mid-break must not allocate a 44-segment cylinder in the frame the player needs to react in. Everything floats: each floe bobs on its own phase and the penguins standing on it bob with it.<br><br>**Solo built.** Thirty penguins across a sea of ten floes that sink one after another, one tap from the classic round and back. The sea is seeded and pure (`sim/archipelago.ts`): a middle floe that never sinks, a ring around it at one jump, and a second ring hanging off that — every gap derived from `JUMP_RANGE` rather than chosen, and asserted on a hundred seeds so no floe is ever one a penguin cannot leave in time. The camera frames the ice you are standing on and pans when you jump; bots leave a doomed floe two seconds before it starts going. Two numbers in it are measurements rather than tastes: outer floes are nearly full size, because at two-thirds size half the field drowned in ten seconds with nobody moving at all, and a floe carries three penguins, because five is a thirty-second fight and the sinking never got to matter. Multiplayer still plays the classic round — an archipelago over the wire is the next slice. |
| Die Insel | **Built, solo.** A 58 m island that is the front door: grass, a sand beach, a paved square ringed with bunting and benches, trees, flowers, a red-roofed pavilion, a shop, a jetty, a cave, and a mountain with a cable car on it. Five ZONES, and a zone is a place rather than a trigger — the same discipline that made the chase readable, where the hunter is a position and not a pursuit. Standing in one offers its game by name AND by what it is ("Royal · 30 Pinguine · die Schollen brechen · spring rüber!"); walking out makes the button cease to exist, so crossing the square on the way to the mountain cannot launch a thirty-penguin round by accident. **An island is a floe**: one big disc with the swell at zero and hand-placed hills, so `moundsFor` already guarantees the hill you can see is the hill you can climb, and walking up it needed no new physics. Nobody is eliminated here, nobody may attack anybody (the slide's own mechanism, not a new flag), and you cannot walk into the sea — a hub where a child drowns looking for the shop is a hub they stop exploring. The camera FOLLOWS here instead of framing the arena, which is the one thing the four games cannot have: a camera that follows a player hides the opponent about to shove them. |
| Eis | **Earned, shown, kept.** Three for finishing a game and seven more for winning it, so an afternoon of losing is still visibly progress — an eight-year-old who loses six rounds in a row must end up with something, and the test asserts the RATIO against both constants rather than the values, so raising the win bonus until losing stops mattering fails a test instead of passing quietly. It is NOT simulation state and never will be: a `World` is pure and replayable and a price is not a fact about a world, so the round reports that it ended and who won, and `lib/eis.ts` decides what that was worth. Nothing bought will ever change a penguin's speed, grip, jump or snowball — the child with no Eis has to be able to win, and that is a hard line of the same kind as "no free text". The igloo it pays for is `backlog/stories/12-ice-and-igloos.md`. |
| Multiplayer | **Half built.** The netcode is done and tested: quantised snapshots at 20 Hz, client-side prediction with replay, and a host that trusts inputs and never positions. A host and two clients play a real round over a simulated link with latency, jitter and 8% loss, and the worst the local penguin ever jumps is 1.2 cm. Room codes are four pronounceable letters with no lookalikes, and they seed the round, so every peer agrees on the arrangement before a byte is sent. A join that never connects gives up after eight seconds and says something a child can act on, which `docs/DECISIONS/0005` costed the whole feature on. There is a lobby: "Mit Freunden" between rounds opens a room, shows a code, lists who has arrived, and starts. Two tabs of one browser really do play a round together over a `BroadcastChannel` transport, asserted end to end — which proves the lobby, the roster, the session wiring and the screens, and proves nothing at all about NAT. A room does not hang when the host walks out: three seconds without a snapshot ends the round and says so in words a child can act on. What is missing is exactly one file behind `Transport` — Trystero over Supabase signalling — plus host migration. |
| The sidelines | **Built.** A penguin in the water is out of the round, not out of the game: from its chunk of ice it throws weak snowballs at whoever is nearest still on the ice. A third of the stun, a third of the shove and three seconds between throws — the sidelines have to be able to annoy somebody standing near the rim and must never be able to decide the round, which a crowd of the eliminated ganging up on whoever knocked them out would. A ball is weak because its THROWER is out, so there is no second piece of state to disagree with `phase` and nothing new goes over the wire. Once you are out the stick, Hüpf and Schubs are gone — a control that answers nothing is worse than a missing one — the Ball button grows, and the HUD says what it is for. The camera turns to the fight your snowballs can actually reach. |
| Sound | **Built.** Synthesised on the spot — no files, so a soundtrack costs a few hundred bytes of code instead of a megabyte on a school wifi. Cues are DERIVED by watching the world rather than emitted by it, which is what stops a client's hundred-tick replay from replaying a hundred ticks of noise. Nothing is ever carried by sound alone, and a mute button sits with the game and remembers. |
| Fullscreen | **Built.** Installed, the manifest asks for `display: fullscreen` and gets it with no code. In a tab the first touch on a touch screen requests it, because the API needs a gesture — and deliberately never on a mouse-driven window, where a page that goes fullscreen when you click it is a page nobody trusts. A button in the panel head covers coming back. iPhone Safari has no Fullscreen API at all, so there the home-screen install is the whole answer, and the game is laid out and tested without it either way. |
| PWA, offline | **Built.** Installable with a manifest generated from `brand.ts` (the name lives in one file, so it cannot go stale under a home-screen icon), icons drawn from the same primitives as the game and rasterised by `scripts/make-icons.mjs`, and a service worker that caches per build. Solo play needed no network before this and still showed the offline dinosaur; now it does not. An end-to-end test pulls the network and reloads. |

### Deployment

**Cloudflare Pages** — `.github/workflows/deploy.yml`, gated on CI, publishing the static build to
project `pingu` and therefore to **https://pingu.metzner.uk** (`pingu-edy.pages.dev` is the same
site). GitHub Pages was the original target and was dropped: the repository was private at the time
and Pages for a private repository needs a paid plan, while Cloudflare serves it on the free tier.

Served from a **domain root**, so the build carries no `BASE_PATH` — setting one would prefix every
path with `/pinguin-game` and 404 the whole application. `static/.nojekyll` is now inert (nothing
runs Jekyll here) and stays only so a move back to GitHub Pages needs no archaeology.

**One thing must be true before the first deploy succeeds**, and it cannot be done from a commit:
the repository needs the two Cloudflare secrets (Settings → Secrets and variables → Actions):

| Secret | Value |
|---|---|
| `CLOUDFLARE_API_TOKEN` | a token with Pages:Edit. An account-scoped token covers the project unchanged |
| `CLOUDFLARE_ACCOUNT_ID` | the account id, from Dashboard → Workers & Pages → sidebar |

The Cloudflare side is already in place: the Pages project, the custom domain and the proxied
`pingu` CNAME in the `metzner.uk` zone all exist. Nothing there needs doing per deploy.

## Running it

Node 24 — `nvm use` picks it up from `.nvmrc`.

```bash
npm ci
npm run dev          # then open the URL it prints, and make the window landscape
```

On a desktop the stick answers a mouse: press anywhere in the left half and drag.

```bash
npm test             # unit — the simulation, the netcode, the joystick maths and the word lists
npm run check        # svelte-check, strict
npm run lint         # biome + prettier
npm run test:e2e     # Playwright against a real production build
CI=1 npm run test:e2e   # the only run whose green means anything (forces a fresh build)
```

## The idea, in one section

**The floe tilts from two sources and they do different jobs.** The ocean swell is terrain — two
waves at frequencies chosen by search so the pattern never repeats inside a round, and deliberately
survivable on its own. The *weight* of the players is the mechanic: the floe tips toward wherever
the crowd is standing, with enough lag that a player who reads it can already be moving. Three
penguins chasing one into a corner tip themselves in, and nothing in the code has to arrange that.

**Ice is a steering budget, not low friction.** The stick asks for a velocity and gets a pull of at
most 9.5 m/s² toward it, so a penguin already sliding at 7 m/s needs about a second of scrabbling to
turn around while one at walking pace feels responsive. That decouples "how slippery" from "how
fast", which a plain drag model cannot: there, low friction and a sane top speed are the same dial.

**Tilt is the terrain; the shove is the kill.** Steering authority sits deliberately above the
steepest downhill acceleration the floe can produce, so tilt alone is never unrecoverable. What
kills you is being knocked outward at 8 m/s with a 1.4-second drag time constant, three metres from
a rim that happens to be the low side.

`docs/DESIGN.md` is the full design, including what phases 1–4 are meant to be.

## Decisions worth knowing before reading the code

Each of these is a file in `docs/DECISIONS/`:

- **The simulation is pure and framework-free**, and a test enforces it rather than a comment asking.
- **No physics engine.** The game is 2.5D — a position on a plane plus a jump height — so a
  general-purpose solver would cost bundle size and determinism to model collisions it does not have.
- **Penguins are built from primitives in code.** Zero budget made a bought model unavailable; what
  makes it a good outcome is that customisation becomes a few numbers rather than a mesh per variant.
- **Names come from a generator, and there is no chat.** The audience is 8–12.
- **Multiplayer is peer-to-peer with no game server**, signalled through Supabase, host-authoritative,
  and honest about the ~10–20% of mobile connections that will not establish without a TURN server.

## Licence

MIT — see `LICENSE`.
