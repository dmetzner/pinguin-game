# Accessibility and the audience

Answers: "what an audience of 8-12 year olds on a phone makes a requirement rather than polish"

## Accessibility and the audience

The audience is 8–12 on a phone, which changes what counts as a requirement rather than polish:

- **Landscape only.** Portrait is a framing problem, not a layout one — the camera frames the whole
  arena, so a tall screen pushes it back until a penguin is ~4% of the screen against ~13% in
  landscape. The rotate card is driven by a media query, not the Screen Orientation API, which iOS
  Safari does not implement.
- **A dead zone on the stick**, because a thumb resting on glass is never still, and a penguin that
  creeps while the player believes they are standing still is a death they cannot explain.
- **Full throw short of the rim**, because small thumbs do not reach the edge of a 56 px circle.
- **`pointercancel` handled as carefully as `pointerup`** — a system gesture or an incoming call
  fires only cancel, and a stick stuck at its last value walks the penguin off the edge on its own.
- No information carried by colour alone; every penguin carries its name over its head.
- `prefers-reduced-motion` stops the interface's animations. The scene keeps moving, because
  freezing it would be a blank screen.

