# Decision records

One file per decision that would otherwise be re-litigated, or — more usually — silently undone by
someone who could not see why it was made.

The bar for adding one: **a future contributor could reasonably do the opposite, and the reason not
to is not visible from the code.** "We use Tailwind" is not a decision record. "The physics is
hand-written because a general engine is not deterministic across platforms and phase 3 needs it to
be" is.

Each record says what was decided, why, **what it costs**, and what was considered instead. The cost
section is the one that matters most: a record that only lists advantages is advocacy, and it will
not help the person deciding whether the decision still holds.

| # | Decision |
|---|---|
| [0001](0001-simulation-is-pure.md) | The simulation is pure, and a test enforces it |
| [0002](0002-no-physics-engine.md) | No physics engine |
| [0003](0003-procedural-penguins.md) | Penguins are built from primitives in code |
| [0004](0004-generated-names-and-no-chat.md) | Generated names, and no chat at all |
| [0005](0005-peer-to-peer-multiplayer.md) | Peer-to-peer multiplayer, signalled through Supabase |
