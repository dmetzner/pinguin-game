# The modes, and the registry that holds them

Answers: "how a minigame is added, and why src/lib/sim/modes/ is the only place that knows which mode is which"

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

