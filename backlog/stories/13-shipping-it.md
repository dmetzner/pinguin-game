# 13 — Shipping it: an app, a landing page, and money

**Phase 6. IN PROGRESS.** Asked for on 2026-08-21: _"we should already consider making it also an
app / add donation link / now free, later i would say people can buy special cosmetics and stuff /
we need also for this game landing pages, info and so on."_

**Live at `https://pingu.metzner.uk`** (Cloudflare Pages project `pingu`), deployed 2026-08-22 from
a verified tree (unit suite, typecheck and lint all green) rather than through the GitHub Actions
gate `deploy.yml` describes — that workflow is still the one CI trusts long-term; this was a
same-day manual deploy with `CLOUDFLARE_API_TOKEN` on the device, done because Daniel asked for it
live rather than waiting on a CI run.

Done: the landing page (§3, rewritten below — the decision it argued against is the one Daniel then
asked for), `/impressum` and `/datenschutz` (new). Not done: the app id decision, the Capacitor
wrapper, the donation link, paid cosmetics — all four are exactly as this document left them.

Four separate things. One of them contains a decision that **cannot be undone after the first
release**, so it is first.

## 1. The app id is permanent, and it must not carry the codename

A sibling project wraps its static build with Capacitor for Android — `@capacitor/{core,cli,android}`,
a `webDir`, a reverse-domain `appId`, plus an `android/` directory, a release script and a WebView
`backgroundColor` set so the frame between splash and first paint does not flash white. The same
shape works here against `build/`, and there is nothing to invent.

**But that app id is safe for that project in a way its equivalent is NOT safe for this one.** Its
id carries the real, permanent name of the game. **The name in `src/lib/brand.ts` is a
CODENAME** — `CLAUDE.md`'s brand-isolation section says so in its first line — and an Android
`applicationId` is **immutable once published**. You cannot rename a package on Play; you can only
publish a second app and abandon the first, taking its installs, reviews and rating with it.

So publishing `uk.metzner.<codename>` would bake a placeholder into the one identifier that can never
be changed. That is exactly the mistake a sibling project is the cautionary tale for: its repository
name, its codename and every one of its localStorage keys still disagree, because the keys were
written before the name settled.

**Use the domain-descriptive namespace that already exists.** Persisted keys are `floe.` for precisely
this reason, and `brand.test.ts` enforces it. `uk.metzner.floe` costs nothing today and survives any
rename. The visible app name comes from `brand.ts` and can change freely; the id cannot.

The same logic applies to anything else that is written once and read for ever: the Play listing's
package, an iOS bundle id, a Cloudflare project name, a store URL slug.

## 2. Money, and the fact that the audience is children

This is the part that needs care rather than code. The audience is **8–12**, and that changes what is
allowed as well as what is decent:

- **Cosmetics-only is already this project's rule, and it was written before money was mentioned.**
  `backlog/stories/12-ice-and-igloos.md`: _nothing bought may change a penguin's speed, grip, jump or
  snowball — the child with no Eis has to be able to win._ Paid cosmetics are consistent with that.
  Anything that sells an advantage breaks a hard line, not a preference.
- **A donation link and a purchase flow are for PARENTS, not for children.** Google Play's
  families policy and Apple's kids-category rules both constrain what may be shown to a child and
  what may take a payment; a donate button beside a green "Los!" is aimed at exactly the wrong person.
  Put it behind the same door as the pre-alpha notice — a profile or an "Über" screen a child does not
  pass through to play — and word it to an adult.
- **No ads. Ever.** Not a policy question, a product one: an ad in a game for eight-year-olds is a
  stranger talking to them.
- **The CSP is `connect-src: 'self'` and lists no third party** (`svelte.config.js`), deliberately, and
  `docs/DECISIONS/0005` costed the whole multiplayer feature on keeping the list of things this game
  can talk to short. A payment SDK is a third party with script access; a donation LINK that navigates
  away is not. Prefer the link.
- Nothing about money may be persisted with the product name in the key, and nothing may make solo
  play require the network — invariants 5 and the offline promise both survive this.

## 3. The landing page, and the promise this section argued must not break

**This section originally rejected a splash page at `/` with a "Play" button on it, in these words:
"That is the two-second promise gone." Daniel asked for exactly that on 2026-08-22**, once the game
was live at a real domain rather than staying on a laptop, specifically so nobody starts "blindly" —
without having seen a Play button and the links a public site now needs. That is his call to make
against his own earlier argument, and it is recorded here rather than quietly edited away, the same
way `/info`'s own top comment now says so.

What shipped keeps as much of the original promise as the new requirement allows:

- **A separate prerendered route for reading** (`/info`, linked from the landing screen and the
  profile sheet) — this half of the section was right and is unchanged. `/impressum` and
  `/datenschutz` joined it the same day, sharing one layout (`routes/(docs)/+layout.svelte`) so a fix
  to the scroll or the typography lands on all three instead of drifting between copies.
- **The gate at `/` is a button and three small links, nothing to READ** — `routes/+page.svelte`,
  `data-testid="landing"`. It costs one screen, once: `storageKeys.landingSeen` is written the
  moment "Los geht's!" is pressed, so a returning visitor — which is who most sessions are — still
  gets the original two-second promise exactly as before. `e2e/landing.spec.ts` is the new coverage;
  `e2e/game.spec.ts`'s `skipLanding` helper is what keeps the other ~150 assertions testing what they
  were already testing rather than this screen.
- **A `?mode=` or `?seed=` link still counts as having pressed through**, unconditionally — every
  deep-linked test in this codebase, `npm run shots`, and anybody who has to look at one mode twenty
  times in a row depends on landing exactly where the link points.
- `/impressum` needs a real name, postal address and contact — `OPERATOR_NAME`, `OPERATOR_ADDRESS`,
  `OPERATOR_EMAIL` in that file are placeholders and the file's own comment says so at the top. No
  page here may invent them; that is Daniel's information to give or withhold.

adapter-static prerenders every route, so this costs no server. Note `fallback: '404.html'` and NOT
`index.html` — the sibling repos shipped that mistake and documented it afterwards.

## 4. What an app buys that the PWA does not

Worth being honest about, because the PWA already does more than people expect: it installs, it runs
fullscreen, it works offline, and the manifest already asks for landscape — which is the one context a
browser will honour that, and therefore probably the real answer to _"my friends are too stupid to
rotate their phone"_.

What the wrapper adds: a Play listing people can find, an icon that arrives without anybody being told
to "add to home screen", a splash screen, and orientation locking that does not depend on the browser.
What it costs: a store account, a release process, review latency on every update, and a second
artifact that can drift from the web build.

## Order

1. **The app id decision**, now, before anything is published. It is one line and it is irreversible.
2. Landing/info route, since it is static and needed for a store listing anyway.
3. The Capacitor wrapper, in the shape above — `capacitor.config.ts`, `android/`, a release
   script, and the WebView background colour set to the sky so the first frame does not flash white.
4. Donation link, parent-facing, behind the same door as the pre-alpha notice.
5. Paid cosmetics — LAST, and only once the igloo and the shop exist to sell into. There is nothing to
   buy yet.
