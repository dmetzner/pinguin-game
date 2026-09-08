# Brand isolation

Answers: "why is the product name in exactly one file, and what happens if it leaks?"

## Brand isolation

`src/lib/brand.ts` is the only place the name lives. Persisted keys use the domain-descriptive
`floe.` namespace. `brand.test.ts` enforces it by scanning `src/`.

A sibling project carries the cautionary tale: its repository, its codename and every one of its
localStorage keys still disagree, because the keys were written before the name settled and renaming
them later would have stranded real users' data behind a key nothing reads. The cost of getting this
right on day one is one file and one test.

