# 0005 — Peer-to-peer multiplayer, signalled through Supabase

**Date:** 2026-08-15 · **Status:** accepted, unimplemented (phase 3)

## Context

The budget is zero, and it is a hard zero: no game server, no monthly bill, nothing that falls over
when it is not paid for. Multiplayer is 2–6 players in one room for 60–90 seconds.

## Decision

- **WebRTC data channels between peers.** No game traffic touches a server.
- **Signalling via [Trystero](https://github.com/dmotz/trystero) using its Supabase strategy.**
  Trystero is MIT and about 10 KB; Supabase's free tier is far above what room setup needs, and it
  is already in use in the sibling repos.
- **Host-authoritative.** One peer runs the simulation and broadcasts snapshots; the others send
  inputs and predict their own penguin locally, reconciling against the host.
- **When the connection cannot be established, say so.** No relay fallback.

## Why host-authoritative rather than lockstep

Deterministic lockstep would be the natural fit for a simulation built as `sim/` is, and it is
tempting. It is rejected because a single dropped or late input frame stalls *everyone*, and the
network here is a school wifi with six children on it. Host-authority degrades instead: a peer with
a bad connection sees its own penguin rubber-band and nobody else's game stops.

Determinism is still worth what it cost. Client prediction requires that the client and host running
the same inputs from the same state agree — that is the same property, used for a different purpose.

Snapshots are small: per penguin, a position, a velocity, a height, a facing and a few flags —
around 20 bytes quantised, so six players at 20 Hz is roughly 2.4 KB/s.

## Why not the alternatives

- **Trystero over Nostr or BitTorrent trackers.** Genuinely zero infrastructure and no account at
  all. Rejected because those relays are public, uncontrolled, and go offline — a game that cannot
  be started because a stranger's relay is down is worse than one that needs a free-tier project.
- **A small WebSocket relay on a free tier.** More reliable than P2P and simpler to reason about,
  and it stays on the table if P2P failure rates turn out worse than expected. Rejected for now
  because it is something to operate and monitor, which "budget zero" was meant to avoid.

## The honest part: NAT traversal will fail for some players

WebRTC needs a TURN server when both peers are behind symmetric NAT or carrier-grade NAT, which is
common on mobile networks. **There is no free, reliable TURN service.** Expect roughly 10–20% of
connection attempts over mobile data to fail. On home wifi it is much better, which is where this
audience mostly plays.

The decision is to **fail honestly**: a child-legible message ("Klappt nicht — probiert's im
WLAN!") and an offer to let a different player host the room, since the failure is a property of the
pair rather than of either device.

Relaying game traffic through the signalling channel was considered and rejected. It would connect
everyone, at 150–400 ms — and a game about shoving someone off a tilting floe is not playable at
that latency. Shipping it would turn a clear failure into a confusing one.

## Consequences

- `connect-src` in the CSP gains exactly one entry, plus `wss:`. That will be the complete list of
  everything this game can talk to.
- The signalling project sees room codes and connection offers. It never sees gameplay, and it never
  sees a name, because names are generated client-side from a fixed list (`0004`).
- Solo play must keep working with the network off. That is invariant 5 and it is why phase 1
  (bots, combat, rounds) is deliberately finished before any of this is started.
