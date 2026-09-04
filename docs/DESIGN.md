# Design

What this game is, for whom, and why each mechanic is shaped the way it is. The code implements
§1–§4 for one penguin; §5 onward is what phases 1–4 are built against.

## 1. The pitch

Up to six penguins on an ice floe in a rocking sea. The floe tilts, everyone slides, and snowballs,
shoves and jumps knock each other off balance. Last one still on the ice wins. A round is 60–90
seconds.

**Audience: 8–12, on a phone, in landscape.** That is not a demographic note, it is a constraint
that decides most of what follows — thumb size, reading load, round length, what "losing" is allowed
to feel like, and who may type what to whom.

## 2. The one-sentence design goal

> Every death must be something the player can explain to themselves in the second after it happens.

An eight-year-old who does not know why they lost stops playing. This is the test every mechanic
below is measured against, and it is why the camera never rotates, why the tilt lags visibly behind
the crowd, and why the rim is drawn where the rim actually is.

## 3. The floe

Three sources of tilt, layered, each doing a different job.

**The swell** is terrain. Two sine waves whose frequencies were chosen by searching for the pair
that never reproduces itself inside a 90-second round while still using every direction — 0.69 and
0.30 rad/s, a 9-second wave riding a 21-second one. It is deliberately survivable on its own: when
the swell alone was lethal during tuning, the game became a waiting contest in the middle, because
approaching anyone was suicide.

**The weight** is the mechanic. The floe tips toward wherever the crowd is standing, reaching its
full gradient only with everyone at the very rim, and it chases that target with about a second of
lag. Three penguins chasing one into a corner tip themselves in. Nothing in the code arranges this;
it is what a centre of mass does, and it is the best thing in the design.

The lag is not cosmetic. A hundred tonnes of ice has inertia, and more importantly the tilt has to
arrive a moment *after* the crowd commits, so a player who read it can already be moving.

**The shrinking** (phase 1) ends rounds. A chunk breaks off every ~20 seconds. Without it, six
careful players produce a stalemate; with it, the arena eventually forces a fight.

The two tilts are summed and then capped — capping them separately would let them stack past the
limit at exactly the moment the limit exists for.

## 4. Movement, and why ice is a budget

The stick does not set velocity. It asks for one, and gets a pull of at most `MOVE_GRIP` toward it
each tick.

That single choice is what makes ice feel like ice while keeping a sane top speed. In a plain drag
model those are the same dial: low friction gives a long glide *and* a top speed of twelve metres a
second. Separating "how much authority the stick has" from "how fast momentum decays" gives a
penguin that is responsive at walking pace and scrabbles helplessly at seven metres a second.

**Grip is scaled by how far the stick is pushed.** A penguin accelerates by pushing against the ice,
so not pushing means no force, and stopping is drag's job. The first version ignored this and braked
toward zero at full authority whenever the stick was centred — which cancelled gravity almost
exactly, made the floe's tilt completely harmless, and would have hollowed out the whole design.

**Tilt is the terrain; the shove is the kill.** Steering authority sits above the steepest downhill
acceleration the floe can produce, so tilt alone is never unrecoverable — a test asserts that
relationship directly. What kills is being knocked outward at 8 m/s with a 1.4-second drag time
constant, three metres from a rim that happens to be the low side.

**The camera is fixed.** It does not rotate with the floe and does not follow the player.

- A camera that rolls with a tilting horizon is a motion-sickness generator, and the audience is
  children on a small bright screen.
- A camera that follows one player hides the opponent about to shove them, which fails §2.
- Its height and field of view are chosen together so the top of the frame looks slightly *above*
  the waterline. Without that there is no horizon on screen, and a wobble needs a level line to
  wobble against.

## 5. Combat — phase 1

Three attacks, one effect. Everything knocks a penguin back and takes its controls away briefly;
they differ only in how much of each.

| Action | Stun | Knockback | Range |
|---|---|---|---|
| Snowball | ~1.2 s | small | ranged, auto-aimed within a forward cone |
| Shove (dash) | ~0.8 s | large | contact |
| Stomp (land a jump on someone) | ~1.0 s | very large | contact, from above |

One rule, three tools. A child learns the whole combat system by using any one of them.

**Stun must be unmissable**: the penguin spins, stars circle its head, a sound plays, the phone
buzzes. A player being carried toward the rim with no control has to understand *why* they cannot
steer, or §2 fails at the exact moment it matters most.

**Snowballs auto-aim** within a forward cone. Precise aiming with a second thumb on a phone is a
skill this audience does not have and should not need; the skill here is positioning and timing.

**Falling in is not a fail screen.** Splash, then the penguin surfaces on a small ice chunk beside
the arena and can watch and cheer with emotes. Rounds are short enough that waiting does not hurt,
and there is no losing screen to feel bad in front of.

## 6. Getting in — phase 1 and 2

**Tap once and you are playing**, against bots, within about two seconds. No account, no menu tree,
no mode select. Customisation is optional and lives behind the penguin, never in front of the game.

**The first run gets ~15 seconds of practice floe** — no opponents, one prompt at a time: walk,
jump, throw. Then straight into a round.

**Bots have real difficulty levels and the default is easy.** A bot produces the same `InputFrame`
a thumb does, so there is no separate AI code path.

**Names come from a generator and there is no chat** — `docs/DECISIONS/0004` argues this in full.

**Customisation is colours and hats**, all procedural: body, belly, beak and feet, plus a hat and a
scarf. Unlocked by playing, never bought. There is no currency and there will not be one.

## 7. Multiplayer — phase 3

Peer-to-peer, host-authoritative, 2–6 players, four-letter room codes and a share link.
`docs/DECISIONS/0005` covers the transport and is honest about the connections that will not
establish.

**Solo never depends on any of it.** Phase 1 is finished and playable offline before phase 3 starts.

## 8. What this game deliberately does not have

Not missing features — decisions:

- **No chat, no voice, no free text anywhere.** §6 and `0004`.
- **No accounts, no profiles, no friends list.** A room code is the whole social graph.
- **No purchases, no currency, no ads, no analytics.** The audience is children; the budget is zero;
  there is no server to run any of it on.
- **No leaderboards or ranks.** A nine-year-old who is bad at this should want another round.
- **No spectator griefing.** Eliminated players can cheer and nothing else.

## 9. Open questions

Honest ones, not rhetorical:

- **Does the feel test pass?** Phase 0 exists to answer it and it has not been played on a real
  phone by a real child yet. Everything after this depends on the answer.
- **Is 6.5 m the right arena for six players?** It was chosen for one penguin and a fixed camera.
  Six may need more room, and more room means a smaller penguin on screen — a real trade, not a
  number to nudge.
- **Is `WEIGHT_TILT` fun or infuriating with six?** The mechanic the design is proudest of is also
  the one most likely to feel unfair when four other people cause your death.
- **How much stun is too much?** 1.2 seconds is a long time to be unable to act when you are eight.
- **What actually happens on a school wifi with six phones?** Unknown until it is tried.
