/**
 * Every tunable number in the simulation, with the reasoning that produced it.
 *
 * These are not arbitrary: the feel of this game is almost entirely decided here, and a number
 * changed without understanding what it trades against is how "it used to feel good" happens. Each
 * constant below says what it competes with. Values are SI — metres, seconds, radians.
 */

/** Fixed simulation rate. The renderer runs at whatever the display gives it and interpolates. */
export const TICK_RATE = 60;
export const DT = 1 / TICK_RATE;

/** Gravity. Real, because the jump arc reads wrong at anything else and kids notice floatiness. */
export const G = 9.81;

// ---------------------------------------------------------------------------
// The floe
// ---------------------------------------------------------------------------

/**
 * Floe radius in metres.
 *
 * Two things fight over this number and the second one only showed up on screen. At WALK_SPEED it
 * takes ~1.8 s to cross a radius, which is long enough that positioning is a decision and short
 * enough that a knockback from the centre can still reach the rim; bigger makes the game safe and
 * slow. But the arena is also framed whole by a fixed camera, so its radius sets how large a 1.7 m
 * penguin can possibly appear — and the first build used 9 m, which put the player's own penguin at
 * 6% of the screen height. It was legible to someone who knew where to look and to nobody else.
 *
 * 7.6 m is about eleven penguins across. It was 6.5 (nine across) and went up after the first real
 * play session: "seems too hard / random currently who wins" (Daniel, 2026-08-16). Two things were
 * making that true at once and they are worth keeping apart, because only one of them is this
 * number. The stick was INVERTED — pushing up walked the penguin toward the player — so every
 * correction near the rim was a shove over it, and that is fixed in `input/joystick.ts` rather than
 * here. What is left is genuine: four penguins on a nine-penguin disc that then loses a third of
 * its width leaves so little room that the last thirty seconds decide themselves.
 *
 * The cost is paid on screen and it is why this is 7.6 and not 9. Screen size goes as 1/distance
 * and the camera's distance goes with the radius, so the player's own penguin drops from ~13% of
 * screen height to ~11%. 9 m was measured at 6%, and that build was legible to someone who knew
 * where to look and to nobody else.
 */
export const FLOE_RADIUS = 7.6;

/**
 * Peak gradient contributed by the ocean swell, roughly 6°.
 *
 * Deliberately survivable on its own — see MOVE_GRIP. The swell is the terrain the fight happens on,
 * not the thing that kills you. When it alone was lethal (0.3 during tuning) the game became a
 * waiting contest in the middle, because approaching anyone was suicide.
 */
export const SWELL_AMPLITUDE = 0.105;

/**
 * The two swell frequencies, in radians per second. Not picked by ear — searched for.
 *
 * A single sine is a metronome the player memorises in three rounds, and two that share a factor
 * confine the tilt to one diagonal so the safe spot is the same every round. What is wanted is a
 * pair that never reproduces itself inside a 90-second round and uses every direction on the way.
 *
 * Both properties were measured across the plausible range (0.40–0.70 against 0.25–0.70) and scored:
 * worst near-repeat over every period from 1 to 60 s, and how evenly the tilt direction covers eight
 * sectors. This pair is best on both — its closest repeat still differs by 0.74 × amplitude, against
 * 0.38 × for the hand-picked 0.55/0.38 it replaced, which came back around every 33.5 s.
 *
 * It also reads as the most like real water: a 9.1 s wave riding a 20.9 s swell, rather than two
 * waves of nearly the same length beating against each other.
 */
export const SWELL_FREQ_X = 0.69;
export const SWELL_FREQ_Z = 0.3;

/**
 * How hard the floe tips toward the crowd, as a gradient at full one-sided load.
 *
 * This is the mechanic the whole design rests on: three players chasing one into a corner tip
 * themselves in. Too low and nobody notices; too high and standing still anywhere but dead centre
 * is a death sentence, which punishes exactly the timid eight-year-old the game is for.
 */
export const WEIGHT_TILT = 0.13;

/**
 * How fast the weight component chases its target, per second.
 *
 * Lag is not cosmetic. Without it the floe answers a footstep instantly, which both looks wrong
 * (a hundred tonnes of ice has inertia) and removes the read: you want the tilt to arrive a moment
 * AFTER the crowd commits, so a player who saw it coming can already be moving the other way.
 */
export const WEIGHT_TILT_RATE = 0.9;

/** Hard cap on the combined gradient, ~13°. Stops swell and weight from stacking into the absurd. */
export const MAX_SLOPE = 0.23;

// ---------------------------------------------------------------------------
// Skating
// ---------------------------------------------------------------------------

/** The speed a penguin asks for at full stick. Not a cap on actual speed — a knockback exceeds it. */
export const WALK_SPEED = 3.6;

/**
 * Steering authority in m/s², and the single most important number in the file.
 *
 * It is what makes ice feel like ice. Velocity is not set from the stick; the stick pulls velocity
 * toward the requested one by at most MOVE_GRIP·dt each tick. So a penguin already sliding at 7 m/s
 * needs about a second of scrabbling to turn around, while one at walking pace feels responsive.
 * This decouples "how slippery" from "how fast", which a plain drag model cannot do: there, low
 * friction and a sane top speed are the same dial and you cannot have both.
 *
 * It sits well above the steepest downhill acceleration (G · MAX_SLOPE ≈ 2.3 m/s²) on purpose. Tilt
 * alone must never be unrecoverable; tilt plus a knockback, or tilt plus being stunned, is the kill.
 */
export const MOVE_GRIP = 9.5;

/**
 * Steering while airborne, as a fraction of MOVE_GRIP. Enough to correct, not enough to cheat.
 *
 * Raised from 0.28 alongside the second jump, and for the same reason: a jump aimed at the next floe
 * was a decision that could not be adjusted once made, on a surface that had tilted underneath the
 * decision. Nearly half of the grip is still less than half — a penguin in the air is committed,
 * just no longer helpless.
 */
export const AIR_CONTROL = 0.45;

/**
 * Linear drag per second. Low, because this is ice.
 *
 * The time constant is ~1.4 s, which is what makes a shove genuinely dangerous later: knocked
 * outward at 8 m/s you travel about 5 m before you can meaningfully fight it, and the floe is 9 m
 * across. Raise this and every collision in phase 1 stops mattering.
 */
export const ICE_DRAG = 0.72;

// ---------------------------------------------------------------------------
// Jumping
// ---------------------------------------------------------------------------

/**
 * Take-off speed and jump gravity, solved together rather than picked separately.
 *
 * The two targets are an apex of ~0.85 m — a penguin stands about 1.1 m, and clearing three
 * quarters of another one's height is what makes a stomp legible from a fixed camera — and ~0.75 s
 * of airtime, long enough for an eight-year-old to aim at a moving target and short enough that
 * jumping can never be a way to sit out a bad tilt.
 *
 * From `apex = v²/2g` and `airtime = 2v/g`: v = 4.55, g = 12.2, giving 0.848 m and 0.746 s.
 *
 * The first version of this pair was written the other way round — numbers first, comment after —
 * and claimed a 0.75 m apex while delivering 0.38 m. The jump test asserted the comment, which is
 * why the discrepancy surfaced at all.
 */
export const JUMP_SPEED = 4.55;

/**
 * Gravity applied to the jump arc, deliberately stronger than G.
 *
 * A physically honest arc feels floaty in a game where the whole ground is already moving.
 */
export const JUMP_GRAVITY = 12.2;

/** Derived, for tests and for the renderer's shadow: metres at the top of the arc. */
export const JUMP_APEX = (JUMP_SPEED * JUMP_SPEED) / (2 * JUMP_GRAVITY);

/** Derived: seconds from take-off to landing. */
export const JUMP_AIRTIME = (2 * JUMP_SPEED) / JUMP_GRAVITY;

/**
 * The second jump, in mid-air — and why a penguin gets one.
 *
 * Crossing a gap between floes was "quite challenging" (Daniel, 2026-08-17), and the reason is not
 * the distance: every gap in the sea is laid out against `JUMP_RANGE` and fits inside one jump. It
 * is that a single jump is a decision made once, at a moment, on ice that is tilting — mistime it by
 * a tenth of a second and the only feedback is drowning. A second jump turns that into a mistake
 * with a recovery, which is the difference between a game an eight-year-old learns and one they
 * stop playing.
 *
 * Weaker than the first — it is a flap, not a launch — and there is exactly ONE. Two would make the
 * rim optional, and the rim is the game.
 */
export const AIR_JUMPS = 1;
export const AIR_JUMP_SPEED = 3.9;

/** Derived: how high the flap adds, from wherever it is used. */
export const AIR_JUMP_APEX = (AIR_JUMP_SPEED * AIR_JUMP_SPEED) / (2 * JUMP_GRAVITY);

/**
 * Derived: the longest a penguin can stay in the air, using the flap at the top of the first jump.
 *
 * Rise to the first apex, flap, rise again, then fall the whole way from the top of both. The map is
 * NOT laid out against this — `sim/archipelago.ts` uses the single-jump range, so a child who never
 * discovers the second jump can still cross every gap in the sea. This is the margin, not the plan.
 */
export const DOUBLE_JUMP_AIRTIME =
	JUMP_AIRTIME / 2 +
	AIR_JUMP_SPEED / JUMP_GRAVITY +
	Math.sqrt((2 * (JUMP_APEX + AIR_JUMP_APEX)) / JUMP_GRAVITY);

// ---------------------------------------------------------------------------
// Going in the water
// ---------------------------------------------------------------------------

/**
 * How far past the rim the centre of a penguin gets before it is committed to falling.
 *
 * Slightly generous: the visual rim is where the ice ends, and a player whose toes are over it
 * should get the fright and the chance, not the splash. Being stricter than the art tested badly —
 * it reads as the game cheating.
 */
export const RIM_GRACE = 0.35;

/** Ticks between crossing the rim and being `out`. 0.9 s: enough for the splash to be a moment. */
export const FALL_TICKS = 54;

/** How fast a falling penguin drops, m/s. Not G — it looks better slightly slowed. */
export const FALL_SPEED = 5.5;

// ---------------------------------------------------------------------------
// Bodies
// ---------------------------------------------------------------------------

/**
 * Collision radius of a penguin, metres. Matched to the drawn body rather than guessed.
 *
 * The renderer models a 0.34 m torso and scales the whole character by 1.48, so half a metre is
 * what a player actually sees. A collision radius smaller than the art produces hits that look
 * like misses; larger produces the reverse, and the reverse is worse — being shoved by someone who
 * visibly did not touch you is the kind of death rule 2 of `docs/DESIGN.md` exists to forbid.
 */
export const PENGUIN_RADIUS = 0.5;

/** Squared, for the collision test — see `distanceSq` in `vec.ts`. */
export const CONTACT_RADIUS_SQ = (PENGUIN_RADIUS * 2) ** 2;

/**
 * How tall a penguin stands, metres. The simulation's number, and the renderer's too.
 *
 * It lives in `sim/` rather than in `render/penguin.ts` because the SIMULATION needs it — a
 * snowball has to know what it can fly over — and `sim/` may not import `render/`. The renderer
 * imports it back the other way, which is allowed, so the drawn body and the hitbox cannot drift.
 * They did: this number was written out as a bare `1.7` in the snowball test while `render/` derived
 * 1.702 from its own scale factor, and phase 2's customisation is exactly what would have parted them.
 */
export const PENGUIN_HEIGHT = 1.7;

/**
 * Vertical gap, metres, above which two penguins are not touching — and a stomp becomes possible.
 *
 * Expressed against JUMP_APEX rather than picked: at 0.55 against an apex of 0.85 a jumper clears an
 * opponent for roughly the top third of the arc. That window IS the counterplay to the dash, so it
 * moves whenever the jump is retuned, and writing it as a bare number in the collision loop hid that
 * completely.
 */
export const STOMP_HEIGHT_GAP = 0.55;

/**
 * How much of the closing speed survives a penguin-to-penguin bump, 0..1.
 *
 * Not a real restitution coefficient — two penguins are not billiard balls — but the same idea. Low
 * enough that an accidental brush is a nudge rather than a launch, because ORDINARY contact happens
 * constantly on a floe this size and it must not read as an attack. The attacks below deliver their
 * own knockback on top of this and are an order of magnitude stronger.
 */
export const BUMP_RESTITUTION = 0.45;

/**
 * Extra separation speed applied to any overlap, m/s.
 *
 * Without it two penguins pressed together by a slope come to rest overlapping and jitter, because
 * position correction alone fights gravity every tick and never wins. A small constant push means
 * "touching" resolves to "adjacent" and stays there.
 */
export const BUMP_SEPARATION_SPEED = 0.9;

// ---------------------------------------------------------------------------
// Losing control
// ---------------------------------------------------------------------------

/**
 * Stun durations in ticks, and the knockback that comes with each.
 *
 * ONE rule, three tools — see `docs/DESIGN.md` §5. Everything knocks a penguin back and takes its
 * controls away; the three differ only in how much of each, so a child who learns any one of them
 * has learned the whole combat system.
 *
 * The ordering is deliberate and is the balance: the ranged attack stuns LONGEST but pushes least,
 * so it sets a victim up; the contact attacks push hardest but recover soonest, so they finish. A
 * snowball that both stunned longest and pushed hardest would make closing the distance pointless.
 *
 * 1.2 s is a long time to be unable to act when you are eight, and `docs/DESIGN.md` §9 lists it as
 * an open question rather than a settled number. It is the first thing to try shortening if the
 * game reads as unfair in a playtest.
 */
export const SNOWBALL_STUN_TICKS = 72;
export const SNOWBALL_KNOCKBACK = 3.5;

/**
 * What a snowball thrown from the SIDELINES does, and why it is a fraction of the real one.
 *
 * A penguin that has gone in the water climbs onto a chunk of ice and can throw from there. It is
 * the answer to the one thing elimination still cost this audience — an eight-year-old out at forty
 * seconds had a nice view and nothing to do — and in a Royal it is twenty-nine children instead of
 * three.
 *
 * Weaker on purpose, and by enough to be obvious: a third of the stun and a third of the shove. The
 * sidelines must be able to ANNOY somebody standing near the rim, and must never be able to decide
 * the round — a crowd of the eliminated ganging up on whoever knocked them out would be the least
 * fair ending this game could have. The long cooldown is the other half of that: three seconds
 * between throws, against six-tenths for a player on the ice.
 */
export const SIDELINE_STUN_TICKS = 24;
export const SIDELINE_KNOCKBACK = 1.2;
export const SIDELINE_THROW_COOLDOWN_TICKS = 180;

/**
 * How far a sideline snowball reaches, metres.
 *
 * Further than a player's own throw, because it is thrown from OUTSIDE the arena and still has to
 * land inside it — the chunks sit a little beyond the widest rim there is. It is not a better
 * weapon for being longer: everything it does when it lands is a third of the real thing.
 */
export const SIDELINE_RANGE = 18;

export const SHOVE_STUN_TICKS = 48;
export const SHOVE_KNOCKBACK = 8;

export const STOMP_STUN_TICKS = 60;
export const STOMP_KNOCKBACK = 10;

/**
 * How fast a stomped-on penguin's attacker bounces back up, m/s.
 *
 * A stomp has to end with the jumper airborne again rather than standing on top of a victim, or a
 * held jump button becomes a permanent lock on whoever is underneath.
 */
export const STOMP_BOUNCE = 3.2;

// ---------------------------------------------------------------------------
// The shove
// ---------------------------------------------------------------------------

/**
 * A dash SETS the velocity to this, along the facing. It does not add to it.
 *
 * Adding was the first version and it was unusable — measured on screen at 11.8 m/s, which on ice
 * with a 1.4 s drag time constant is a 16 m brake on a 6.5 m floe. The shove killed its own user
 * more reliably than its target. Setting also makes the move predictable: a dash is the same lunge
 * whether you were standing still or already sprinting, so a player can learn its reach.
 */
export const DASH_SPEED = 10;

/**
 * Total ticks a dash lasts, 0.67 s, during which DASH_DRAG applies.
 *
 * The dash is a committed lunge that plants, not a launch. With the extra drag it covers about
 * 2.3 m — roughly four penguin widths, enough to close a gap someone left open and not enough to
 * cross the arena — and ends with the dasher nearly stationary rather than sailing past the rim.
 */
export const DASH_TICKS = 40;

/**
 * Ticks at the START of a dash during which contact delivers a shove rather than a bump.
 *
 * Shorter than the dash itself, so the tail of the move is recovery you are committed to. That gap
 * is the counterplay: someone who dodges the first fifth of a second gets a free approach on a
 * player who cannot yet turn.
 */
export const DASH_HOT_TICKS = 13;

/**
 * Extra drag while dashing, per second, on top of ICE_DRAG.
 *
 * This is what turns a launch into a lunge. Claws dug into ice, in effect — and it is the reason
 * the dash can be fast enough to be worth using without being a way to throw yourself in the sea.
 */
export const DASH_DRAG = 4;

/**
 * Ticks before another dash is allowed. 1.5 s.
 *
 * In the SIMULATION and not in the button, which matters twice over: a cooldown enforced by a
 * disabled control is no cooldown at all once inputs arrive from the network in phase 3, and a bot
 * would need its own copy of the rule.
 */
export const DASH_COOLDOWN_TICKS = 90;

// ---------------------------------------------------------------------------
// Snowballs
// ---------------------------------------------------------------------------

/**
 * How far off dead-ahead the aim assist will look, radians (±35°), and how far.
 *
 * Precise aiming with a second thumb is a skill this audience does not have and should not need —
 * the skill in this game is positioning and timing. A cone rather than a full circle so that facing
 * still means something: you cannot hit someone behind you, and turning to face a threat is a real
 * action with a real cost on ice.
 */
export const AIM_CONE = 0.61;
export const AIM_RANGE = 11;

export const SNOWBALL_SPEED = 13;
/** Metres above the ice a snowball leaves from — roughly a penguin's flipper. */
export const SNOWBALL_SPAWN_HEIGHT = 0.95;
/** Gentler than G so the arc is long and readable rather than a mortar shot. */
export const SNOWBALL_GRAVITY = 7.5;
export const SNOWBALL_RADIUS = 0.3;

/**
 * Upward speed a snowball leaves with, m/s — SOLVED from AIM_RANGE, not chosen.
 *
 * Without any lift the ball left flat from 0.95 m and hit the ice after 0.50 s: a range of 6.5 m,
 * against an aim assist that happily locked on to targets 11 m away. The ranged attack silently
 * could not reach two thirds of what it aimed at, and nothing in the code said so — the arc just
 * ended in the ice.
 *
 * Derived rather than tuned, so the two cannot drift: from `0 = SPAWN_HEIGHT + v·T − ½·g·T²` with
 * `T = AIM_RANGE / SNOWBALL_SPEED`. A hand-fitted 2.05 came out a millimetre short of the range it
 * was fitted to, which is exactly the drift this removes. Retune AIM_RANGE and the arc follows.
 */
const SNOWBALL_FLIGHT_TIME = AIM_RANGE / SNOWBALL_SPEED;
export const SNOWBALL_LIFT =
	(0.5 * SNOWBALL_GRAVITY * SNOWBALL_FLIGHT_TIME ** 2 - SNOWBALL_SPAWN_HEIGHT) /
	SNOWBALL_FLIGHT_TIME;

/** Derived: seconds a snowball stays up, from the quadratic above. */
export const SNOWBALL_AIRTIME =
	(SNOWBALL_LIFT + Math.sqrt(SNOWBALL_LIFT ** 2 + 2 * SNOWBALL_GRAVITY * SNOWBALL_SPAWN_HEIGHT)) /
	SNOWBALL_GRAVITY;

/** Derived: how far a snowball actually reaches, metres. Should sit within a metre of AIM_RANGE. */
export const SNOWBALL_RANGE = SNOWBALL_SPEED * SNOWBALL_AIRTIME;

/**
 * Ticks before a snowball gives up.
 *
 * A BACKSTOP, not the normal end — a ball lands after about 51 ticks, so this only fires for one
 * thrown off the edge of the world by a knockback mid-flight. It was 90 with a comment claiming
 * "1.5 s at 13 m/s is about 19 m", which was wrong twice over: the ball fell out of the air in 30
 * ticks, so the limit was unreachable and the range was a third of the figure quoted.
 */
export const SNOWBALL_LIFETIME_TICKS = 75;
export const THROW_COOLDOWN_TICKS = 36;

// ---------------------------------------------------------------------------
// The round
// ---------------------------------------------------------------------------

/**
 * Ticks of countdown before anyone may move. Two seconds.
 *
 * Long enough to read where everyone else spawned and short enough that a rematch is instant. The
 * floe already wobbles during it, which is the point — the first thing a player should learn is
 * that the ground moves whether or not they do.
 */
export const COUNTDOWN_TICKS = 120;

/**
 * Hard ceiling on a round. 100 seconds.
 *
 * `docs/DESIGN.md` says 60–90 s, and the shrinking floe is what actually ends rounds. This exists
 * so that a pathological round — two cautious players circling a large floe — still finishes, and
 * so a test can assert termination without simulating forever.
 */
export const ROUND_MAX_TICKS = 6000;

/**
 * How long nobody may attack anybody, once a round starts. Three seconds.
 *
 * The countdown already stops the world for two, and it turns out that is not the same thing: the
 * moment it ends, thirty penguins start shoving, and a child who was still working out which one is
 * theirs is in the water before they have moved (Daniel, 2026-08-17). This window lets everyone
 * SKATE — find themselves, find the rim, find a direction — while snowballs, shoves and stomps do
 * nothing at all.
 *
 * Movement is deliberately live rather than frozen: the floe is tilting from the first tick and
 * being unable to correct for it would be the "died before I could do anything" this fixes, wearing
 * a different hat.
 */
export const ROUND_GRACE_TICKS = 180;

/**
 * How long the protection takes to FADE once the grace is over. One second.
 *
 * A cliff would be simpler and is wrong twice. On the wire it is a rule that changes behaviour at
 * one exact tick, and a client predicts `LEAD_TICKS` ahead of the host — so at the boundary one side
 * applies an 8 m/s shove the other does not, and the correction is most of a metre. `session.test.ts`
 * measured 0.69 m and refused it, which is the whole reason this constant exists.
 *
 * It is also better as a game: protection that thins out over a second reads as the round starting,
 * where protection that switches off reads as being ambushed by a rule.
 */
export const ROUND_GRACE_FADE_TICKS = 60;

/** Ticks the result stays on screen before a rematch is offered. One second, to let it land. */
export const ROUND_OVER_TICKS = 60;

/**
 * When the ice starts going, and how fast.
 *
 * The floe shrinks continuously rather than shedding discrete chunks. That is a DEVIATION from
 * story 02 as written and it is deliberate: a chunk means the rim stops being a radius and becomes
 * a polygon, which costs a rebuilt mesh every twenty seconds and a point-in-polygon test in the
 * hot loop — for an effect a player reads identically. What the mechanic has to do is take space
 * away so a stalemate cannot last, and a shrinking radius does exactly that. Revisit if the ice
 * ever needs to break unevenly for its own sake.
 *
 * Numbers, and they are the third set: nothing happens for the first 18 s, then the radius loses
 * 0.16 m/s. There are 4.4 m to give up between FLOE_RADIUS and FLOE_MIN_RADIUS, so the floor
 * arrives after ~27.5 s of shrinking — about 45 s into the round, plus the countdown, which is
 * inside the 60–90 s `docs/DESIGN.md` asks for.
 *
 * The grace period went from 15 s to 18 s with the bigger floe (2026-08-16), so the opening still
 * has the same shape: long enough to find your feet and pick a fight, before the ice starts
 * deciding things for everyone.
 *
 * The first attempt used 0.34 m/s with a comment claiming "about 26 s of shrinking", which had
 * conflated the shrinking time with the total elapsed: at that rate the ice actually went in 11.5 s
 * and the floor arrived at 26 s of play, giving rounds of 30–45 s against the 60–90 s
 * `docs/DESIGN.md` asks for. `round.test.ts` asserts the pace against the derived value rather than
 * against either number, so the two cannot disagree again.
 */
export const SHRINK_START_TICKS = 1080;
export const SHRINK_RATE = 0.16;

/**
 * The smallest the floe gets, metres.
 *
 * Five penguin diameters, up from four (2.6 m) on 2026-08-16 for the same reason the floe itself
 * grew: at four there was no room to dodge, so the winner was whoever happened to be standing in
 * the middle — a coin toss rather than an ending. The endgame still closes in; it now closes on a
 * disc two penguins can still move around each other on.
 */
export const FLOE_MIN_RADIUS = 3.2;

/** Derived: ticks of play before the floe reaches its floor. What a round is paced against. */
export const SHRINK_DONE_TICKS =
	SHRINK_START_TICKS + ((FLOE_RADIUS - FLOE_MIN_RADIUS) / SHRINK_RATE) * TICK_RATE;

// ---------------------------------------------------------------------------
// The slide
// ---------------------------------------------------------------------------

/**
 * The mountain.
 *
 * The first version of this was a flat ribbon you STEERED along: a penguin walking down a tilted
 * corridor at eight metres a second, with a decorative lip at the sides and certain death a metre
 * to the left. It played like a hallway and read as one ("not even remotely close", Daniel,
 * 2026-08-17), and every number below is a correction to a specific part of that.
 *
 * What it is now: a carved chute with BANKED walls that hold you in, that you slide down on your
 * belly rather than skate along, where the danger is the places the wall is missing rather than the
 * whole run being a knife edge.
 */

/**
 * The fall line, as a gradient.
 *
 * A run settles at `G · gradient / drag`, and the drag on a slide is `SLIDE_DRAG` rather than the
 * sea's `ICE_DRAG` — a penguin on its belly on a chute is not a penguin standing on a floe. At 0.5
 * against 0.4 that is 12.3 m/s, about 44 km/h, which is the speed at which a bend has to be planned
 * for a segment in advance.
 */
export const SLIDE_GRADE = 0.5;

/**
 * How much speed a slide keeps, per second, against the sea's `ICE_DRAG` of 0.72.
 *
 * This is the difference between sliding and skating, and it is most of why the first version felt
 * like walking downhill: it used the sea's drag, so the run settled at eight metres a second and
 * arrived there in half a second. At 0.4 the acceleration is long and the top speed is high enough
 * that the course, rather than the penguin, decides what happens next.
 */
export const SLIDE_DRAG = 0.4;

/**
 * How much of `MOVE_GRIP` a penguin has on the chute.
 *
 * You do not push off a slide, you lean on it. Two thirds is enough to cross the run in about a
 * second at speed — which is what taking a line means — and not enough to stop, turn round, or hold
 * still against the fall line. On the sea it stays at full: the two surfaces are different things.
 */
export const SLIDE_GRIP = 0.66;

/** How wide the chute is, in metres. Three penguins abreast, and wide enough to have a line. */
export const SLIDE_WIDTH = 5.2;

/**
 * How high the banked walls rise at the edge of the run, in metres.
 *
 * The walls are GROUND, not scenery: they are a `groundHeight` that rises toward the rim, so the
 * same gravity term that pulls a penguin off an iceberg pushes it back down into the middle of the
 * chute. That is what makes the run something you ride rather than a ledge you balance on, and it
 * is why falling off is now something the COURSE offers you — at the gaps and where a wall is
 * missing — rather than something that happens whenever you stop concentrating.
 *
 * **1.8 rather than 2.4, because a wall is a FORCE and this one was bigger than the mountain.** The
 * cross-section's steepest gradient is `2·h / (span·radius)`, and at 2.4 m over a 0.35 span that is
 * 2.26 — so a racer 3.9 m off the centreline was pushed sideways at 22 m/s² while the fall line was
 * pulling them downhill at 4.9. A parabola is a spring, so what that produces is not a wall you lean
 * on but an oscillation you cannot damp: the measured run bounced between 5.6 and 12.1 m/s the whole
 * way down, which is what "the physics are super bad" describes. Wider and lower, the same wall still
 * holds a racer in — it is the reason nobody goes over the rim any more — at a gradient closer to the
 * one they are already fighting. `bankAt` carries the matching span.
 */
export const SLIDE_BANK_HEIGHT = 1.8;

/**
 * How long the run is, and how far apart the discs that make it are.
 *
 * **Forty-five, measured rather than reasoned.** Sixty was chosen as "420 m, about forty seconds at
 * the speed above" — and the speed above is the terminal speed on a STRAIGHT, which a course made of
 * straights and bends never sustains. A racer holding the stick forward at seed 20260821 averages
 * about 9 m/s across the whole run, not 12.3, because every bend spends some of the fall line on
 * turning; sixty segments measured 50 seconds.
 *
 * Forty-five is 315 m, which is 35 seconds at the speed the run actually produces. That is the number
 * that matters: it is a race an eight-year-old loses and immediately asks to run again, where fifty
 * seconds of the same corners is one where they put the phone down half way.
 */
export const SLIDE_SEGMENTS = 45;
export const SLIDE_SEGMENT_STEP = 7;

/**
 * How far the mountain drops per segment, metres. DERIVED, and it has to be.
 *
 * It used to be 3.4 with the comment "presentation only", and that sentence was the bug: the drop
 * lived in `Floe.altitude`, which only the renderer read, while `groundHeight` answered with the
 * banked cross-section alone. So the simulation's mountain was a staircase of flat discs and the
 * drawn one was a smooth ramp — the penguin hung in the air above the ribbon for most of a segment
 * and then dropped a whole storey when `floeUnder` picked the next disc. On screen that is a bird
 * floating and falling at random, which is exactly what it looked like.
 *
 * The ground falls along the run now (`archipelago.groundHeight`), at the gradient that produces
 * the gravity, so the two cannot disagree — and a segment's altitude is where that fall has got to
 * by the time it reaches the next one. Typed independently, the two would differ by a tenth of a
 * metre every seven, and a penguin would step off a lip at every disc boundary for the whole run.
 */
export const SLIDE_DROP_PER_SEGMENT = SLIDE_GRADE * SLIDE_SEGMENT_STEP;

/**
 * The shape of the course, as the lengths of the things it is made of.
 *
 * A course is straights and bends rather than a random walk. The random walk was the other half of
 * why the first version was a corridor: it wandered continuously, so there was never a moment of
 * "here comes a corner" — just a hallway that was always very slightly turning.
 */
export const SLIDE_STRAIGHT_MIN = 4;
export const SLIDE_STRAIGHT_MAX = 9;
export const SLIDE_BEND_MIN = 4;
export const SLIDE_BEND_MAX = 8;
/** How sharply a bend turns, radians per segment. At 0.16 a long bend is a genuine hairpin. */
export const SLIDE_BEND_RATE = 0.16;

/**
 * The two things that can go wrong on a run, and how often the course offers them.
 *
 * A GAP is a missing segment: at 12 m/s a penguin clears seven metres of nothing without doing
 * anything at all, so a gap is only dangerous if you have lost your speed — which is exactly the
 * punishment for taking the previous bend badly. An OPEN side is a bend with no wall on the outside,
 * which is the one place the mountain can actually throw you off.
 */
/**
 * **Zero, which means OFF, and this is the record of why.**
 *
 * The comment above describes a gap that has never once existed. `step.ts` only computes a height
 * when there is ground before AND after the step (`groundBefore !== null && groundAfter !== null`),
 * so a penguin sliding onto seven metres of nothing never becomes airborne at all — it is simply
 * standing over no ice, and the rim check takes it on that same tick. The claim "at full speed a
 * penguin clears seven metres of nothing without doing anything" was never true in the code at any
 * speed: measured at seed 20260821, a racer arrived at the first gap at 8.3 m/s and at the third at
 * 11.2 m/s and fell into both.
 *
 * What that produced was three DEAD STOPS per run, at segments 17, 34 and 51, in every run and at
 * every speed — `SLIDE_RECOVER_TICKS` is 110, so 5.5 of the 52 seconds were spent sitting still at
 * exactly the same three places. That is the whole of "the sliding game is unplayable" (Daniel, twice
 * — 2026-08-21 and 2026-08-22).
 *
 * A gap is turned OFF rather than tuned, because making one work is a change to how a penguin leaves
 * the ground and not a change to a number: it needs height to be allowed to go negative over open
 * air, so that falling INTO a hole and flying OVER it are different outcomes, and that is the same
 * arithmetic every rim in the game is judged by. `backlog/stories/14-the-mountain.md` has the
 * analysis. Until then the mountain's hazards are the ones that do work: the bends, the banks, the
 * open sides and the bumps.
 */
export const SLIDE_GAP_EVERY = 0;
export const SLIDE_OPEN_EVERY = 11;

/**
 * How much wall is left on the open side of a bend, as a fraction of the full bank.
 *
 * Not zero. With no wall at all the outside of the first bend took the ENTIRE field — six of six, at
 * the same corner, every seed — because that is exactly where the speed puts you and there was
 * nothing there. At a third of the height it is a lip you go over if you carry too much into the
 * corner and stay on if you took a line, which is the difference between a hazard and a trapdoor.
 */
export const SLIDE_OPEN_WALL = 0.32;

/**
 * What it costs to go off the mountain, in ticks of sitting still.
 *
 * You do not DROWN on the slide. Everywhere else in this game leaving the ice ends your round, and on
 * a forty-second race that rule threw five racers out of six inside twenty seconds — a mode where
 * most players watch most of it. So a racer who goes over the edge is put back on the last ice they
 * touched, standing still, having lost about two seconds and all of their speed to everyone who
 * stayed on.
 *
 * That is the whole difference between a hazard and a trapdoor, and it is what makes the gaps and the
 * open bends worth putting there at all.
 */
export const SLIDE_RECOVER_TICKS = 110;

/** How many race, counting the player. Six is a full room, and the chute fits about three abreast. */
export const SLIDE_RACERS = 6;

// ---------------------------------------------------------------------------
// Pingu Royal
// ---------------------------------------------------------------------------

/**
 * Thirty penguins, and why they are not on one floe.
 *
 * The see-saw is the reason, not the frame rate. Tilt comes from where the weight stands and one
 * penguin's share of it is 1/N, so a crowd cancels itself out and everybody ends up on a disc that
 * only the swell moves. Five or six to a floe is where a player's own position still visibly tips
 * the ice — the number the classic round was tuned at — so Royal keeps that and multiplies the
 * floes instead. See `sim/archipelago.ts`.
 */
export const ROYAL_PLAYERS = 30;

/**
 * Penguins per floe at the start. What decides how many floes a Royal deals.
 *
 * Three, and it is a measurement rather than a taste: five to a floe is a thirty-second fight — the
 * classic round with five players is exactly that — so thirty penguins over seven floes were down to
 * five survivors before the first floe had begun to sink, and the mode's whole clock never got to
 * run. At three, a floe's fight outlasts the ice under it, which is the point.
 */
export const ROYAL_PER_FLOE = 3;

/**
 * How big an outer floe is, metres. Nearly the classic 7.6, and that is a MEASUREMENT.
 *
 * The first draft made them 4.4–6.2 m, on the reasoning that an outer floe is a place you pass
 * through and a smaller one is livelier. What it actually produced: with every penguin standing
 * perfectly still and no bots thinking at all, half the field was in the water inside ten seconds.
 * The swell alone is a gradient of up to 0.15, and every constant in this file — MOVE_GRIP, the
 * drag, the walk speed — was tuned against the runway a 7.6 m disc gives you from the spawn ring.
 * Halve the runway and standing up stops being possible, which is not difficulty, it is a different
 * game with the same numbers.
 *
 * So an outer floe is a classic floe give or take a metre, and the archipelago gets its variety
 * from where the floes are rather than from how survivable they are.
 */
export const ROYAL_FLOE_MIN_RADIUS = 6.6;
export const ROYAL_FLOE_MAX_RADIUS = 7.6;

/**
 * Open water between the middle floe and its ring, metres, plus a seeded spread.
 *
 * Both are held against `JUMP_RANGE` (2.69 m at the current jump), not chosen freely: a gap wider
 * than a jump is a floe nobody can leave, which in a game whose floes sink is a death sentence
 * handed out by the map. `archipelago.test.ts` checks a hundred seeds rather than trusting the
 * arithmetic here.
 *
 * The gap between NEIGHBOURING outer floes is much wider — around 5 m on a ring of six — and that
 * is left as it falls out: it is too far to walk-jump and just about reachable out of a dash, which
 * makes the shortcut a thing a good player discovers rather than a route the map hands them.
 *
 * Both numbers came down (1.55/0.55 → 1.35/0.45) when the second jump went in, and deliberately by
 * less than the flap is worth: crossing was "quite challenging" (Daniel, 2026-08-17), and the answer
 * is mostly a better jump rather than a smaller sea. A gap you can almost always make is still a gap
 * you have to aim at.
 */
export const ROYAL_GAP = 1.35;
export const ROYAL_GAP_JITTER = 0.45;

/**
 * When the sea starts taking floes, and how often it takes the next one.
 *
 * This is Royal's clock and its whole shape: the first 25 seconds are an ordinary fight, then the
 * ring goes under one floe at a time and everybody it was carrying has to be somewhere else. Six
 * outer floes at twelve seconds apart puts the last one under at about 1:37, so a Royal lands near
 * the two minutes it was asked for — with the pressure arriving in steps a child can see coming
 * rather than as a timer nobody reads.
 */
export const ROYAL_SINK_FIRST_TICKS = 1500;
export const ROYAL_SINK_INTERVAL_TICKS = 720;

/**
 * The ice does not melt, it BREAKS — and how long you get to notice.
 *
 * A floe that shrank quietly was the clearest thing in the mode to miss: it happens at the rim,
 * where nobody is looking, and by the time a child notices the ice is smaller they are already
 * standing on the last of it. So a doomed floe now announces itself and then splits in two.
 *
 * `ROYAL_WARN_TICKS` is the announcement: five seconds in which a crack opens along the line the
 * floe is about to break on, the ice shudders, and the HUD says so in words.
 *
 * It was three, which is two strides and a jump — and that is only enough if you happen to be
 * standing near the right rim. A floe is up to fifteen metres across and a penguin walks at 3.6 m/s,
 * so crossing one takes four seconds before any reaction time at all: three seconds meant the ice
 * decided who lived by where they were standing when it started. Five is enough to cross the widest
 * floe in the sea from anywhere on it, which is the bar — react quickly and you get off.
 *
 * `ROYAL_PIECE_SINK_TICKS` is what a fragment gets afterwards: seven seconds of tipping and
 * drifting before it is gone. Two of them, drifting apart at `ROYAL_PIECE_DRIFT`, is what turns one
 * safe floe into two crowded ones and then into open water.
 */
export const ROYAL_WARN_TICKS = 300;
export const ROYAL_PIECE_SINK_TICKS = 420;
/**
 * How wide each half is, against the floe it came from — and how far from its middle it sits.
 *
 * One number for both, and that is what makes a break look like a break: at exactly a half, the two
 * pieces are born TOUCHING at the parent's centre and then drift apart, so the crack opens under
 * whoever is standing on it. Any larger and the halves overlap, which means the middle of a floe
 * that has just split in two is still solid ground — the one place it must not be.
 *
 * It also costs space, which is the point of the whole clock: two half-radius discs are half the
 * area of the one they came from.
 */
export const ROYAL_PIECE_FRACTION = 0.5;
/** How fast the halves separate, m/s. Slow enough to jump between them for the first few seconds. */
export const ROYAL_PIECE_DRIFT = 0.34;

/**
 * How tall an iceberg on a floe is, in metres.
 *
 * A penguin is 1.7 m drawn, and a hill has to be worth climbing without being a wall: at 0.6–1.1 m
 * you can see over it, be shoved off it, and jump onto it from flat ice — the jump apex is 0.85 m —
 * but only just, which is what makes getting up there a small piece of skill rather than a walk.
 *
 * They are real ground, not scenery: the slope of a hill goes into the same gravity term the floe's
 * own tilt does, so standing on top of one is standing on something that wants you off it. That is
 * the whole appeal — high ground you cannot merely occupy.
 */
export const MOUND_MIN_HEIGHT = 0.9;
export const MOUND_MAX_HEIGHT = 1.5;

/**
 * The steepest a hill's side may be, as a gradient — and it is what decides how WIDE they are.
 *
 * `MOVE_GRIP` is 9.5 m/s² and gravity down a slope is `G · gradient`, so at 0.97 a penguin pushing
 * uphill at full authority is fighting 9.5 m/s² with 9.5 m/s²: the hill is a wall that happens to
 * look like a ramp. The first draft's hills were exactly that steep, because their height was chosen
 * and their width was not.
 *
 * At 0.6 the climb costs about 5.9 m/s² — comfortably inside the grip, so walking up works and
 * stopping half way slides you back down. That is what "climbable" has to mean here, and it is why
 * `moundsFor` derives the footprint from the height rather than picking both.
 *
 * A cosine bump is steepest half way up, at `h·π / 2r`, so `r ≥ h·π / (2·MOUND_MAX_SLOPE)`.
 */
export const MOUND_MAX_SLOPE = 0.6;

/** Kept for the classic endgame and for anything that still shrinks rather than breaking. */
export const ROYAL_SINK_TICKS = 360;

/**
 * When the middle floe starts shrinking, and the backstop for the whole thing.
 *
 * The middle never sinks — a Royal whose last ice disappeared would drown everybody and call it a
 * draw — but it does close in, at the classic `SHRINK_RATE`, once the ring is gone. The cap is 150
 * seconds against an expected two minutes: it exists so a pathological Royal terminates, not as a
 * pace.
 */
export const ROYAL_MIDDLE_SHRINK_TICKS =
	ROYAL_SINK_FIRST_TICKS + 6 * ROYAL_SINK_INTERVAL_TICKS + ROYAL_SINK_TICKS;
export const ROYAL_MAX_TICKS = 9000;

// ---------------------------------------------------------------------------
// Bots
// ---------------------------------------------------------------------------

/**
 * How often a bot re-decides, in ticks, per difficulty.
 *
 * A bot that re-evaluates every tick is frame-perfect and unbeatable — it starts walking uphill the
 * instant the gradient turns, which no thumb can match. Reaction delay is most of what makes a
 * difficulty level, and the easy setting is the default because the audience is eight.
 */
export const BOT_REACTION_TICKS = { easy: 30, normal: 14, hard: 7 } as const;

/**
 * How long before its ice breaks a bot decides to leave, in ticks.
 *
 * Exactly `ROYAL_WARN_TICKS`: a bot leaves when the CRACK APPEARS, which is the same moment the
 * player sees it and the same moment the HUD starts counting down. Two seconds — the first value —
 * was chosen when the warning was three, and it meant bots watched the ice crack for a second and
 * then tried to cross a fifteen-metre floe in two: a dozen of them went in together on the first
 * break, which is the map killing the field rather than a game happening.
 *
 * The same lead for every difficulty, because drowning on schedule is not a skill setting. What
 * difficulty changes is how well a bot fights while it is still standing on something.
 */
export const BOT_ESCAPE_LEAD_TICKS = ROYAL_WARN_TICKS;

/**
 * How long a bot takes to work itself up to full aggression once the grace lifts. Four seconds.
 *
 * Without it the grace merely postpones the carnage: at the tick attacks become legal, thirty bots
 * with full dash cooldowns all commit at once, and two thirds of the field is in the water within
 * three seconds of the whistle. A ramp turns that into an opening — a few early scuffles, then the
 * round finding its shape — which is also what a room full of children actually does.
 */
export const BOT_WARMUP_TICKS = 240;

/**
 * How far a bot's aim and steering wander, in radians, per difficulty.
 *
 * A deliberate error term, seeded from the world so a round stays replayable. Without it a bot
 * walks the exact shortest path to its goal, which reads as machinery rather than as a player.
 */
export const BOT_WANDER = { easy: 0.75, normal: 0.38, hard: 0.14 } as const;

/**
 * How readily a bot attacks, 0..1, per difficulty.
 *
 * An easy bot mostly minds its own footing and occasionally throws something. A hard one closes.
 */
export const BOT_AGGRESSION = { easy: 0.3, normal: 0.62, hard: 0.9 } as const;

/**
 * How close a bot gets before it shoves, metres.
 *
 * Slightly beyond the dash's reach (~2.3 m), so it commits from a distance it can actually cover.
 */
export const BOT_SHOVE_RANGE = 2.6;

/**
 * Fraction of the radius past which a bot abandons what it was doing and heads for the middle.
 *
 * Self-preservation has to outrank aggression or bots dive off the edge chasing people, which looks
 * broken rather than easy.
 */
export const BOT_DANGER_FRACTION = 0.66;

/**
 * The ring an eliminated penguin climbs out onto, metres from the middle.
 *
 * Just outside the STARTING rim rather than outside the current one, and that is the whole trick:
 * the camera is fitted once, to `FLOE_RADIUS * 1.08`, so this ring is the only band of water that is
 * guaranteed on screen for the entire round. Placed relative to the shrinking rim instead, the first
 * eliminations of a round would land outside the frame — which is the failure the chunk exists to
 * prevent, since a spectator nobody can see is the fail screen with extra steps.
 *
 * The 5% is what is left between those two walls, and it was 2% until the screen said otherwise: an
 * elimination before the floe starts shrinking then put the chunk so close to a full-size rim that
 * the spectator read as standing ON the floe, which is worse than being absent — it looks like the
 * game forgot to remove them.
 */
export const SURFACE_RADIUS = FLOE_RADIUS * 1.05;

/**
 * How many places there are on that ring.
 *
 * A penguin surfaces at the slot NEAREST to where it went in, so the eye follows it out of the
 * water, and takes the next one round when that slot is occupied. Twelve is the smallest count that
 * keeps a full room's six chunks from touching at `SURFACE_RADIUS`: the arc between neighbours is
 * 3.47 m against a chunk 1.9 m across.
 */
export const SPECTATOR_SLOTS = 12;

/**
 * How often the run carries a bump, and how high it is.
 *
 * The slide had a jump button and nothing to jump: every other feature of the mountain — the banks,
 * the gaps, the open sides — is a reason to STEER, so the one control a child presses for the
 * pleasure of it did nothing for forty seconds at a time.
 *
 * **And at half a metre it still did nothing, for a reason that is arithmetic rather than taste.**
 * `step.ts` gives a penguin air when the surface falls away FASTER than its own gradient, so a bump
 * launches nobody unless its steepest slope beats the fall line it sits on. A half-cosine's steepest
 * point is `h·π / 2·reach`, the reach is forced to half a segment (see `bankAt`), and half a metre
 * over 3.5 m is 0.224 against a `SLIDE_GRADE` of 0.5 — less than half of what it takes. Measured over
 * a full run the racer was airborne for 1–2% of its ticks, and every one of those was the bank.
 *
 * So the height is DERIVED from the grade now, not chosen: `SLIDE_GRADE · 2 · reach / π` is exactly
 * the bump that matches the fall line, and anything above it is air. 1.15 of it is a crest that
 * throws a racer carrying speed and merely bounces one who has lost it — which is the same "bill for
 * the bend before it" the gaps were supposed to be, delivered by geometry that works.
 *
 * That break-even is 1.11 m on this course's own reach, which is already above `JUMP_APEX` (0.85 m):
 * a bump built to clear the fall line at THIS spacing is necessarily taller than a normal jump, so
 * "a bump you ride over" and "a bump that launches" cannot both be true of the same number here. The
 * mode picks launching — a crest with nothing to jump was the complaint — and caps at
 * `SLIDE_BANK_HEIGHT` instead, so a bump can never read as taller than the walls that hold the run in.
 *
 * Every ninth segment, so it is an event rather than a texture — about one every five seconds.
 */
export const SLIDE_BUMP_EVERY = 9;
export const SLIDE_BUMP_HEIGHT = Math.min(
	((SLIDE_GRADE * 2 * (SLIDE_SEGMENT_STEP / 2)) / Math.PI) * 1.15,
	SLIDE_BANK_HEIGHT
);

// --- Die Flucht ------------------------------------------------------------------------------
//
// The chase. `sim/chase.ts` argues the design; these are the numbers it is built from, and the two
// that decide whether the mode works at all are the hunter's top speed and its leash.

/**
 * How many platforms the course is, and how big one gets.
 *
 * Twenty-six at three to four and a half metres, plus the gaps, is about two hundred metres of
 * route — a minute of running at `WALK_SPEED`, which is the length a round in this game wants
 * (`docs/DESIGN.md` §3). Smaller platforms than a floe on purpose: a chase is a sequence of
 * landings, and a wide disc turns each one into a place you can stand and think.
 */
export const CHASE_PLATFORMS = 26;
export const CHASE_MIN_RADIUS = 3;
export const CHASE_MAX_RADIUS = 4.6;

/** How far the shore is, side to side, in metres. Wide, so arriving is not a jump you can miss. */
export const CHASE_SHORE_RADIUS = 7.5;

/**
 * How big the platform everybody starts on is, in metres.
 *
 * As wide as a floe, and for a reason that cost an afternoon: six penguins spawned across a
 * three-metre platform OVERLAP, and `combat.resolveCollisions` then separates them — correctly, and
 * hard. They left the start line at nine metres a second, which is two and a half times a walk, and
 * a jump at that speed clears the next platform ENTIRELY and lands in the water beyond it. Half the
 * field drowned at the second gap in every seed, and every part of it looked like a jump bug.
 */
export const CHASE_START_RADIUS = 6.5;

/**
 * How the route BENDS: how many platforms a straight or a corner runs for, and how hard it turns.
 *
 * It used to wander sideways in a straight corridor, because the camera did not rotate and "away
 * from the sea lion" had to stay the same direction on screen. The slide has since grown a rig that
 * turns with the run and a stick that turns with the rig, so a chase can be a real course: somewhere
 * to build speed, then a corner arriving.
 *
 * The rate is per platform rather than per metre, and 0.19 rad over a four-to-seven platform corner
 * is 45–75° — enough that the far end is genuinely out of sight, gentle enough that the camera's
 * chase never lags into a sideways view of the route.
 */
export const CHASE_STRAIGHT_MIN = 3;
export const CHASE_STRAIGHT_MAX = 6;
export const CHASE_BEND_MIN = 4;
export const CHASE_BEND_MAX = 7;
export const CHASE_BEND_RATE = 0.19;

/**
 * How far the route may climb or drop from one platform to the next, in metres.
 *
 * The RISE is the one that has to be careful: `JUMP_APEX` is 0.85 m, and a step you cannot get onto
 * is a wall — which in the middle of a chase is the end of the round rather than an obstacle. Half
 * of the apex leaves room for a mistimed jump. A DROP can be bigger, because falling is free, and
 * landing lower is the reward for taking the line that costs less.
 */
export const CHASE_MAX_RISE = 0.42;
export const CHASE_MAX_DROP = 0.9;

/**
 * How high above the water the route is allowed to get, in metres.
 *
 * The floor of the range is the water itself: the sea is a fixed plane and a platform is a slab
 * whose top sits on it, so a route that wandered downwards would put its ice under the surface. Two
 * and a half metres up is three good steps of climb — enough that the run visibly rises and falls,
 * little enough that the camera never loses the platform ahead behind the one underfoot.
 */
export const CHASE_MAX_HEIGHT = 2.5;

/**
 * The blocks of ice you have to jump, and how often one appears.
 *
 * A `Mound`, so the simulation needs nothing new — `groundHeight` and `groundSlope` read a floe's
 * own mounds and `step.ts` turns rising ground into a force. What makes it an OBSTACLE rather than
 * one of a Royal's hills is that its radius is chosen directly instead of derived from its height
 * against `MOUND_MAX_SLOPE`: at 0.72 m over 0.85 m of radius the steepest gradient is 1.33, and
 * gravity down that (13 m/s²) beats `MOVE_GRIP` (9.5), so it cannot be walked up. It is under
 * `JUMP_APEX`, so it can always be jumped.
 */
export const CHASE_BLOCK_EVERY = 4;
export const CHASE_BLOCK_HEIGHT = 0.72;
export const CHASE_BLOCK_RADIUS = 0.85;

/**
 * How fast the sea lion goes, in metres a second, at the start and at the top of its ramp.
 *
 * The top is 97% of `WALK_SPEED`, and that ceiling is the single most important number in the mode.
 * ABOVE a walk, the hunter eventually eats everybody however well they played and the round is a
 * countdown with penguins in it. Below it, a racer who keeps running can never be caught by
 * arithmetic alone.
 *
 * It was 88%, which left a twelve percent margin — enough that a fall, a missed jump and a block
 * taken badly could all be absorbed, and the sea lion spent most rounds as scenery. At 97% the
 * margin is three percent: perfect running still escapes, and ONE mistake is very nearly fatal,
 * which is what a chase is supposed to feel like. The stun after a fall is the real cost — two
 * seconds standing still is seven metres given away to something three metres behind you.
 */
export const CHASE_HUNTER_START = WALK_SPEED * 0.62;
export const CHASE_HUNTER_TOP = WALK_SPEED * 0.97;

/** How long the ramp takes. Forty seconds: slow enough that the first jumps are not panicked. */
export const CHASE_HUNTER_RAMP_TICKS = 40 * TICK_RATE;

/**
 * How far behind the LAST surviving penguin the sea lion is allowed to fall, in metres.
 *
 * Only ever pulls it forward. A field that all runs well would otherwise leave it somewhere off the
 * bottom of the screen, and thirty seconds of jogging with nothing behind you is not a chase — it is
 * a walk with a story attached. Thirteen metres is under two platforms: close enough that it is in
 * frame whenever the camera looks back down the run, and close enough that the racer at the back of
 * the field is always the one about to be eaten.
 */
export const CHASE_HUNTER_LEASH = 13;

/**
 * How far behind the start line the sea lion begins, in metres.
 *
 * Behind rather than on it: the countdown freezes everybody, and a hunter that started level would
 * eat the whole field before anyone was allowed to move. Far enough back to be visible from the
 * start line, because the first thing this mode has to say is what it is about — and MEASURED
 * against where the camera stands, not chosen: the rig sits about eleven metres behind the penguin
 * it is framing, so at nine the sea lion started on the lens, a brown wall across the bottom third
 * of the screen with the game behind it.
 */
export const CHASE_HUNTER_HEADSTART = 17;

/**
 * How far in front of itself a fleeing bot looks for ice, in metres.
 *
 * SHORT, and that is the whole of it: this distance is spent flying over ice you were already
 * standing on. A jump covers `WALK_SPEED · JUMP_AIRTIME` ≈ 2.7 m and the widest gap on a course is
 * 1.9, so the margin is 0.8 m — and the first value here was 1.6, which spent twice the margin
 * before the rim and drowned five bots out of six in the first ten seconds of every seed. Half a
 * metre is three ticks of reaction at walking pace and puts the take-off on the edge, which is where
 * a jump is supposed to happen.
 */
export const BOT_LEAP_LOOKAHEAD = 0.45;

/** Six, like the slide. A chase wants a pack to be part of, not a crowd to be lost in. */
export const CHASE_RACERS = 6;
