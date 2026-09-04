# 04 — Peer-to-peer multiplayer

**Phase 3. IN PROGRESS.** The netcode is built and tested; the transport and the lobby are not.

**Built** — `net/snapshot.ts`, `net/protocol.ts`, `net/predict.ts`, `net/session.ts`,
`net/transport.ts`, `net/loopback.ts`, `net/roomCode.ts`, `net/lobby.ts`, plus `protocol.test.ts`
(6), `session.test.ts` (10), `roomCode.test.ts` (12) and `lobby.test.ts` (10). A host and two clients
run a real round over a simulated link with latency, jitter and loss, in one process, in under a
second. Every number below is measured by those tests rather than argued for.

**The lobby and the screens are built too**, and PROVED: `net/broadcast.ts` is a `Transport` over
BroadcastChannel, so two tabs of one browser open a room, agree a roster, start, and play a round
together — with an e2e test that drives the guest at the rim until the HOST's world says somebody
went in, which nothing a client draws for itself could fake. That is not the multiplayer the design
is for and the test says so: no NAT, no loss, no latency. It proves everything ABOVE the network.

**A room no longer hangs when the host leaves.** A client has nothing to notice it WITH — no
snapshot is not an event — so `HOST_GONE_TICKS` (three seconds, against a snapshot every three
ticks) ends the round and says so, and a host that closes properly says goodbye so nobody sits out
the timeout for a departure already announced. On the host's side a departed player simply gets
`NO_INPUT` for ever: their penguin stops steering, slides, and the shrinking floe resolves it by
exactly the rule that resolves everybody else.

**Not built:** Trystero and the Supabase signalling behind `Transport`, and host MIGRATION — the
round ends cleanly rather than moving to a new host. That is one file and one decision now. It needs
a Supabase project — a free tier, but an account somebody has to create.

**Two bugs the two-tab run found, both invisible in review.** `Game.svelte` and `Room.svelte` each
read the player's name from storage with a DIFFERENT fallback, so a player who had never opened
"Mein Pinguin" joined a room under one name and played under another — and every such player joined
under the same one, because a fixed fallback is fixed on every device. `identity.ts` is now the only
reader, and it generates once and keeps it. And the local penguin drew its name and look from
storage even inside a room, so a player the lobby had RENAMED was the only device that still called
them the old name — including in the tag over their own head. The roster is the authority now, for
the local penguin as much as for anybody else.

**What it cost, and the one thing that was nearly left out.** A client has to run AHEAD of the host,
and it is easy to miss because a client at the host's own tick number looks right in every diagram.
It is not: an input produced for tick T arrives a round trip later, the host has already stepped
past T, and the only thing it can do is throw the input away. The player pushes the stick and
nothing happens — the exact failure prediction exists to prevent. `LEAD_TICKS` is that fix and
`INPUT_WINDOW` on the host is sized against it.

**The room.** Codes are consonant–vowel–consonant–vowel, so every one is a pronounceable nonsense
word a child can shout across a table rather than four letters to be spelled out. The alphabet drops
what looks alike on a screen (I, O, Q, Y) and what sounds alike aloud (C against K, V against F),
which leaves 2595 codes after the handful that spell something are removed. `normaliseRoomCode`
forgives lower case, spaces and the digits a child types after misreading a letter — but only in the
position where that letter could have been, because guessing across the whole string would drop
somebody into the wrong room. The seed comes from the code, so every peer agrees on the arrangement
before a byte is sent.

**Two bugs the tests caught, both silent.** The code generator originally SKIPPED past blocked codes
arithmetically, which sent two different seeds to the same room. And the welcome was sent exactly
once: a client whose copy was dropped sat in `connecting` until it timed out, which reads to a child
as "the code did not work" when they were already in. The host now answers a repeated hello from a
peer already in the roster, so the pair retries until one round trip gets through.

**Measured, on a link with 50 ms each way, 33 ms of jitter and 8% loss:** the local penguin's worst
correction is 1.2 cm, which is the snapshot quantisation and not error at all — `INPUT_BACKLOG`
re-sends the last four frames with every message, so a hole needs four consecutive drops. Torn
harder, at 45% loss, the worst correction is 14 cm: still less than a penguin is wide. A snapshot
for six players is 137 bytes, or 2.7 KB/s at 20 Hz, against the ~2.4 KB/s `DECISIONS/0005` costed
the feature on.

## What

Two to six phones in one room, over WebRTC, with no game server.
`docs/DECISIONS/0005` is the design.

## Done looks like

- Trystero over Supabase signalling. Four-letter room codes plus a share link.
- Host-authoritative: the host steps the world and broadcasts snapshots ~20 Hz; clients send inputs
  and predict their own penguin, reconciling against the host.
- The host migrates or the round ends cleanly when the host leaves. It must not hang.
- A connection that cannot be established says so in words a nine-year-old can act on, and offers to
  let someone else host.
- Tested with two real browser contexts end to end, not against a fake.

## Known traps

- **`purity.test.ts` is the safety net for the whole phase.** If prediction and the host disagree,
  suspect an unseeded value in `sim/` before anything else.
- **Never trust a client's position, only its inputs.** The host simulates.
- **Interpolate remote penguins, predict only your own.** Predicting everyone produces rubber-banding
  in exchanges, which is where it is least forgivable.
- **Test with real latency and packet loss**, not on localhost. Localhost proves nothing here.
- Expect ~10–20% of mobile-data connections to fail outright. That is designed for, not a bug —
  but measure the real rate and record it, because it decides whether the rejected relay fallback
  needs revisiting.
