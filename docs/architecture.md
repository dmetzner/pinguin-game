# Architecture — every file and what it is responsible for

Answers: "where does a thing live in src/, and what is each module allowed to know?"

## Architecture

```
src/
  app.css                design tokens, `.overlay`, the rotate card, reduced-motion
  lib/
    brand.ts             the ONLY place the product name lives
    fullscreen.ts        getting the browser out of the way. One pure decision, the rest best-effort.
    identity.ts          this player's name and look, and whether the sound is off. ONE reader.
    look.ts              the palette, the hats, and coercion that clamps a stored look rather than throwing
    names.ts             two curated German word lists. The ONLY source of a player-visible name.
    storageKeys.ts       every persisted key, all under `floe.`. Never edit an existing value.
    storage.ts           guarded read/write; a store that throws costs a hat, never the game
    sim/                 THE GAME. Pure, deterministic, framework-free.
      types.ts           every shape. Imports nothing.
      constants.ts       every tunable number, each with what it trades against
      rng.ts             seeded mulberry32; `Math.random()` is banned in here
      vec.ts             XZ-plane helpers, all allocating, none mutating
      floe.ts            swell + weight → the gradient everyone feels, PER floe
      archipelago.ts     the sea when it has more than one floe in it: the seeded layout, "what am I
                         standing on", JUMP_RANGE (which every gap is derived from), and the HILLS —
                         `moundsFor` is read by the simulation AND by the renderer, so an iceberg you
                         can see is exactly the one you can climb
      combat.ts          collisions, snowballs, stun. Impulses collected THEN applied. A SIDELINE
                         throw is weak because its thrower is `out` — never a flag on the ball
      round.ts           countdown → play → result; the shrinking floe; the sinking ring; who won.
                         `isRoyal` asks the SEA how many floes it has — there is no mode flag
      chase.ts           Die Flucht: a route of platforms with holes in it, and a sea lion coming up it.
                         The hunter is a PLACE (`World.hunterAt`), not a pursuit — readable, replayable
                         and impossible to cheese by circling. Its top speed is under `WALK_SPEED` on
                         purpose: what it eats is hesitation, never a player who keeps running. The
                         route BENDS, rises and falls, and carries blocks you must jump — so `along`
                         (distance down the polyline) is the scale everything uses, never an axis
      slide.ts           the mountain: a chute of tilted discs, and the race down it. Almost no new
                         machinery — gravity already comes from a floe's gradient
      spectate.ts        where the eliminated watch from, and how far out the ring sits (outside the
                         whole archipelago in a Royal). Derived, never stored — no new field.
      bot.ts             an opponent, which is a thing that returns an InputFrame
      step.ts            one tick: round, floe, steer/gravity/drag/jump/rim, contact, end
      world.ts           the only construction path
    audio/cues.ts        what just happened, DERIVED by watching the world. Pure; survives a replay.
    audio/sound.ts       every noise, synthesised. No files. ONE device per page, unlocked by
                         the first touch anywhere, and it owns the mute.
    input/joystick.ts    thumb pixels → InputFrame. Pure; the component owns the events.
    input/actions.ts     the three buttons; latches a press and hands out a FRESH frame per tick
    input/keyboard.ts    the same steering and the same three actions from a keyboard. Physical
                         `code`, so WASD is a square of keys on QWERTZ too; diagonals normalised
    render/              everything you can see; reads the world, never writes
      scene.ts           the floe, the sea, the sky, the lights and the camera fit. Exposes VERBS
                         (addActor/setFloes/setFocus/setSpectators/setTime/render/drawInset), never
                         the objects. `polarDayLights` is the one definition of the light everything
                         in this game stands in.
      camera.ts          where the camera stands, as arithmetic and no three import. It is what
                         decides which way is UP ON SCREEN, so `input/joystick.ts` derives its sign
                         from it instead of describing it in prose.
      chute.ts           the slide, drawn as ONE ribbon with a lip down each side, plus the flanks of
                         the mountain it is cut into. The discs are the physics; drawn literally they
                         look like pancakes hanging in the air
      blocks.ts          the ice you have to jump in a chase. They are `Mound`s in the simulation; a
                         floe's hills are drawn from its island VARIANT and cloned, which is what
                         keeps a Royal affordable and has no room for a per-platform shape
      seaLion.ts         the thing in the chase, drawn at `hunterAt`. The WAKE is the rule made
                         visible — you can always see the white line even when the animal is behind ice
      sharks.ts          fins circling in the water. Pure scenery, like `bergs.ts`: the sea is fatal in
                         every mode and looked like a calm blue plane
      bake.ts            coloured shapes → one mesh with vertex colours. Object count is what a frame
                         costs; `uv` and the INDEX are the two attributes that make a merge fail
      floeField.ts       every floe drawn, one group each carrying its own tilt. A LIBRARY of six
                         islands built at mount and cloned per floe — ice breaks mid-round, and
                         building a cylinder in that frame hitches exactly when the player must react.
                         Also the crack, the shudder, the tip and `floeOffsetY`, which the PENGUINS
                         read too or they hover while their ice goes down
      penguin.ts         the character, plus the Actor that keeps one on screen and disposes it.
                         `mine` adds the two "that one is you" markers — arrow over the tag, ring on
                         the ice. The arrow's HEIGHT is a screen measurement: three metres up reads
                         as a label on the penguin standing behind
      preview.ts         the turntable in "Mein Pinguin". Borrows the GAME's renderer for a corner of
                         its buffer and copies it into a 2D canvas — ONE WebGL context per page
      snowball.ts        a fixed pool of eight; nothing is allocated mid-round
      iceChunk.ts        a pool of six chunks OUTSIDE the tilting group — separate ice on the
                         same sea. A spectator is PARENTED into its chunk so it bobs with it.
      nameTag.ts         canvas-texture sprite over the head
      loop.ts            fixed-timestep accumulator; the ONLY clock in the app
    net/                 phase 3. Nothing here touches WebRTC; `transport.ts` is the whole seam.
      snapshot.ts        the host's world as a thing that can be sent. Penguins BY INDEX, never by id.
      protocol.ts        the wire. Hot messages quantised by hand, cold ones JSON. `decode` never throws.
      predict.ts         step now, be corrected later. LEAD_TICKS is why any of it works.
      session.ts         createHost / createClient. The host trusts an input and never a position.
                         `lost` is how a client notices a host that stopped — silence is not an event.
      transport.ts       four methods. Trystero goes behind this; so does the loopback.
      loopback.ts        a network made of nothing, with latency, jitter and seeded loss. For tests.
      roomCode.ts        four letters an eight-year-old can shout. CVCV, no lookalikes, seeds the round.
      lobby.ts           who is in the room, and the honest message when nobody answers.
      broadcast.ts       a Transport between two TABS. Not the multiplayer; the way to test it.
    components/
      Joystick.svelte    the left thumb
      Customise.svelte   "Mein Pinguin" — swatches, hat chips, and a die. One tap aside, zero to skip.
      Room.svelte        the code, who is here, and "Los!". Hands Game a roster and a session factory.
      Game.svelte        ONE round: sim + renderer + controls + result. Remounted for a rematch,
                         so nothing from the last round can survive into the next. `opposition`
                         is bots or a room; it never learns whether it holds a host or a client.
  routes/+page.svelte    opens INTO a solo round, never into a menu. A rematch counter and the
                         one screen that asks "start a game or join one".
  routes/manifest.webmanifest/+server.ts
                         the PWA manifest, prerendered from `brand.ts` — a static copy in `static/`
                         would be the product name in a second place, under a home-screen icon.
  service-worker.ts      cache per build, claim on activate. Offline was already true of the code.
```

