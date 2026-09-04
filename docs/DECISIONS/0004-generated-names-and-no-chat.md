# 0004 — Generated names, and no chat at all

**Date:** 2026-08-15 · **Status:** accepted

## Context

The design calls for each penguin's name to float over its head, visible to everyone in the room.
The audience is 8–12. From phase 3 a room can contain strangers.

That combination is the entire decision: a name over a head, seen by children, chosen by an adult
who found the room, is a broadcast channel to minors regardless of what the field was called.

## Decision

1. **Names come from a curated generator.** Two word lists combined — `Flitzer Fips`,
   `Kapitän Knirps`, `Turbo-Trude` — with a shuffle button. Thousands of combinations, no free text.
2. **There is no chat, ever.** Not text, not voice. Communication is a fixed set of emotes.
3. Neither is behind a setting, and neither is a phase-4 "add a filter" item.

## Why the generator rather than filtered free text

Filtered free text was considered and rejected on three grounds:

- **Filters are trivially defeated** by any child motivated to defeat one, and the failure mode is
  that another child reads it.
- **The commoner problem is not profanity at all.** Children type their real first name, their
  school, their age. A filter is not looking for those and should not be — but a curated list makes
  them impossible rather than unlikely.
- **A filter creates a moderation surface**, and this project has nobody to moderate it and no
  budget to acquire one.

A third option — generator in public rooms, free text in rooms joined by a code from a friend — was
considered and rejected as well. It is defensible in principle, but it means two code paths, two
sets of rules to explain to a nine-year-old, and a "private room" guarantee that holds only as long
as nobody shares a code in a group chat.

## What it costs

Children want their own name over their own penguin, and this says no. The mitigation is to make
the generator something they *want* to use: a large space, genuinely funny combinations, an obvious
re-roll, and — from phase 2 — enough visual customisation that identity lives in the penguin rather
than in the label. Nintendo's approach, and it works.

## Consequences

- The name generator is a phase-2 deliverable and needs a German word list written by someone with
  an ear for what eight-year-olds find funny. It is not a technical task.
- An emote set is a phase-3 deliverable. Fixed, small, and impossible to combine into anything.
- No user-supplied string is ever rendered by this game, which also removes a whole class of
  injection concern from the peer-to-peer wire format before it exists.
