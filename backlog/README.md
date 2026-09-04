# Backlog

One file per piece of work, numbered, in `stories/`. A story says what is wanted and why, what
"done" looks like, and anything already known that will bite — not how to implement it.

The phases are sequential on purpose and the order is a decision rather than a plan:

| Phase | What | Why it is in this position |
|---|---|---|
| 0 | The feel test | **Built.** Answers the one question every other phase depends on. |
| 1 | Combat, bots, rounds | Makes it a game. Fully playable offline before any networking exists. |
| 2 | Customisation, names, sound, PWA | Makes it *theirs*. Cheap once phase 1 is stable. |
| 3 | Peer-to-peer multiplayer | The hardest and least certain part, deliberately last. |
| 4 | Polish, balancing, playtesting with actual children | The only phase that can tell you the truth. |

Nothing in phase 3 starts until phase 1 is finished, because solo play must work with the network
off (invariant 5) and because networking a game whose rules are still moving is how you get two
problems at once.
