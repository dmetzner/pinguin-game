# 08 — Die Flucht

**Phase 4. Solo DONE** — `sim/chase.ts` (+15 unit tests), `render/seaLion.ts`, `render/sharks.ts`,
and edits across `sim/types.ts`, `sim/constants.ts`, `sim/world.ts`, `sim/step.ts`, `sim/round.ts`,
`sim/bot.ts`, `render/scene.ts`, `components/Game.svelte`, the route and `identity.ts`. One
end-to-end test.

Asked for on 2026-08-17: *"running away from a monster with
other penguins — the monster is this big sea lion. Should be like a platform jump-and-run game, also
with snowballs. Who can escape through a jungle in ice, jump over empty spaces with sharks."*

**A sea lion is coming, the ice runs out behind you, and the only way is forward.** Six penguins on a
chain of floes with holes in it, a `Seelöwe` closing from behind, and sharks in the water between.
Last one still ahead of it wins — or first one to the open sea, whichever the tuning says is better.

## Why this one is worth building

The three modes that exist are all about *staying* somewhere: on the floe, on the last floe, on the
course. This one is about *leaving*, and it is the only one with a thing in it that is actively
hunting the player. For an eight-year-old that is a different emotion entirely, and it is the one
that makes a game something you tell somebody else about.

It also finally uses the jump for what the jump is for. In the classic round jumping is a way to
shed a bad tilt; in a Royal it crosses a gap once a minute. Here it is the verb.

## What it reuses, which is nearly everything

- **A course is an archipelago in a line.** `sim/archipelago.ts` already lays out floes from a seed
  and answers "what am I standing on"; a chase course is the same generator with a direction and a
  gap pattern. Every gap derived from `JUMP_RANGE`, as everywhere else.
- **The gaps already kill.** A penguin over open water falls in — no new rule, and the sharks are
  what the water finally looks like.
- **Snowballs already exist.** They are what you throw at the penguin ahead of you, which is the
  meanest and most fun thing in the game, and they should NOT hurt the sea lion — a monster you can
  fight is not a monster you run from.
- **Bots already produce an `InputFrame`.** A fleeing bot is a bot whose target is "the far end".

## What is genuinely new

1. **The hunter.** One extra thing in the world, and it must be as pure as everything else: a
   position, a speed, and a rule for advancing. It is NOT a penguin — it has no input, no stun, no
   look — so it is `world.hunter`, not a seventh entry in `world.penguins`.
2. **A line you must stay ahead of.** The readable version of a chase is Mario's rising lava: the
   danger is a *place*, not a pursuit AI. The sea lion is drawn at that place. It never
   out-accelerates a penguin who keeps moving, and it never falls behind far enough to be forgotten
   — its speed is a function of the leader's progress, not of the clock, or the fast player finishes
   in silence and the slow one is eaten in the first ten seconds.
3. **Sharks.** In the gaps, circling. Mostly scenery — the water is already fatal — but they are what
   tells a child *why* it is fatal, and a fin is readable at a glance where blue water is not.
4. **A course that ends.** Every other mode ends when a person is decided. This one has a shoreline.

## What it cost, and the three things that were not in the design

All three were found by running it, and all three read as correct in review:

1. **The bots' idle hop drowned them.** A bot hops at random 2% of ticks — decoration, and what stops
   it reading as a thing on rails. A hop plus the mid-air flap is a metre and a half of airtime with
   air control, which on a 7.6 m floe is nothing and on a 3 m platform is three metres of drift into
   open water. Five of six drowned in the first ten seconds, none of them anywhere near a gap. Where
   the jump is a TOOL it must not also be a tic.
2. **Six penguins aiming at one point.** A fleeing bot went for the centre of the next platform, so
   the whole field arrived on the same spot, overlapped, and `combat.resolveCollisions` separated
   them — correctly, and hard enough to launch them at nine metres a second. A jump at that speed
   clears the next platform ENTIRELY, so a pile-up at one gap drowned the field at the gap after it,
   and every symptom pointed at the jump. Each bot now keeps its own lane across the route. The start
   line had the same problem in a worse place, and is now as wide as a floe.
3. **A gap is a distance between rims, so it has to be spent on the line between the centres.** The
   first layout stepped z by the gap and then jittered x sideways, which made the real hole wider
   than the one that had been budgeted — by as much as the jitter. Every gap was derived from the
   jump, the course looked right, and half the holes were uncrossable.

## Measured, on the built game

- **The course is 236 m.** Twenty-six platforms at about nine metres of centre-to-centre spacing. At
  `WALK_SPEED` that is a sixty-second escape if nothing goes wrong, and nothing going wrong is not
  the usual case.
- **A straight-line runner reaches first place in four seconds.** The bots are beatable by simply
  holding the stick forward, which is the difficulty this game aims at by default — but it is the
  first number to look at if the mode reads as too easy on a phone.
- **The sea lion starts 17 m back**, which is a measurement against the CAMERA rather than a choice:
  the rig sits about eleven metres behind the penguin it is framing, and at nine the animal began the
  round on the lens — a brown wall across the bottom third of the screen with the game behind it.

## Open questions, to settle with a phone in hand

- **Does the sea lion catch anyone, or just the stragglers?** If it eliminates, a child who is bad at
  jumping is out in fifteen seconds — the exact failure `docs/DESIGN.md` §2 warns about. A stun and a
  shove forward might be better than elimination.
- **Is it a race or a survival?** "First to the shore" and "last one still running" are different
  games and the course wants to be built differently for each.
- **Does the ice ahead need hazards at all?** The chase may already be enough. Add nothing until the
  chase alone has been played.

## The second pass, after playing it

*"the race game is kina linear ... more curves, also up and down and so on — make it more fun. Also
the sea lion should have a speed to really catch most runners if they make a mistake so we need
hindernisse to jump over and stuff."* (2026-08-18)

Four changes, and the first one paid for the other three:

1. **The route BENDS.** It ran dead straight for one reason — the camera did not rotate, so "away
   from the sea lion" had to stay the same direction on screen — and the slide has since grown a rig
   that turns with the run and a stick that turns with the rig. The chase borrows both, and the
   course is straights and corners like the mountain.
2. **Progress is measured along the ROUTE.** `-pos.z` was exact while the line was straight and
   became a lie the moment it bent: two racers equally far around a corner have quite different z,
   and the hunter is a place on that same scale, so it would have eaten whoever took the outside of
   the bend. Every floe now carries `along`, the distance a racer has travelled to reach it.
3. **It rises and falls.** Bounded above the water rather than only per step — the sea is a fixed
   plane and a platform is a slab whose top sits on it, so a route that wandered downwards would put
   its ice under the surface. A step UP is bounded well under `JUMP_APEX`, because a rise you cannot
   get onto is a wall, and a wall in the middle of a chase is the end of the round.
4. **Blocks of ice to jump.** They are `Mound`s, so the simulation needed nothing at all — but what
   makes one an OBSTACLE rather than one of a Royal's hills is that its radius is chosen directly
   instead of derived from its height against `MOUND_MAX_SLOPE`: gravity down its steepest face beats
   `MOVE_GRIP`, so it cannot be walked up, and it is under `JUMP_APEX`, so it can always be jumped.

And the sea lion went from 88% of a walk to 97%, with its leash cut from 22 m to 13. The old margin
absorbed a fall, a missed jump and a block taken badly; the new one absorbs none of them. Measured
over eight seeds with the game's own easy bots: every race is still won by somebody reaching the
shore, in about seventy seconds, with three to six of the six still alive. It eats stragglers, which
is what it is for.

**The blocks were invisible for an hour.** They rendered perfectly, in the right place, at the right
size — in near-white, on near-white ice, seen from above. It is the same white-on-white that made the
first floe decorations vanish, and the fix was the same: tint the thing rather than trust the shape.

## The next slice: playing it with somebody

All three of the newer modes are solo, and the netcode sends ONE floe (`net/snapshot.ts`). That is
the thing worth building next, and it is smaller than it looks, because every one of these seas is
DERIVED from the seed: `layout(seed)`, `slideCourse(seed)`, `chaseCourse(seed)`. A client can build
the whole course itself from four letters. What actually has to go over the wire is the part that
changes — a floe's current radius, its sink tick, its drift and break angle, and in a chase the one
number `hunterAt` — plus the mode, once, cold.

So the shape is: send the mode with the room, let both ends build the sea, and quantise the handful
of per-tick fields alongside the penguins. The prediction and correction machinery is unchanged,
because none of it knows what a floe is.

## Sharks in the other modes

Asked for in the same breath: *"the scholle game could also get some random sharks swimming
around"*. That is separate, smaller and worth doing first — pure scenery in `render/`, no simulation
change at all, and it makes the sea around the classic floe stop being an empty blue plane. A fin
tracing a slow circle at a distance the camera can see, seeded so both players in a room see the
same sea.
