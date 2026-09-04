/**
 * The guard for trap 18: an unlayered rule in `app.css` silently beating a Tailwind utility.
 *
 * `.action` carried `position: relative` for a day. It needed it for nothing, and what it did was
 * disable every Tailwind positioning utility written on a button anywhere in the app — `.absolute`
 * lives in `@layer utilities`, `app.css` is unlayered, and an **unlayered declaration beats a
 * layered one whatever the specificity and whatever the source order.** So the three-button triangle
 * laid out in normal flow, and `.sideline-ball`'s re-anchor was zero offsets on a relatively
 * positioned box, which is a shift of exactly nothing.
 *
 * Both read as correct. Both compiled. Neither was catchable by measuring, because every clearance
 * in the button audit measured correctly — for a layout that was not running.
 *
 * ## Why this is a test and not `@layer components`
 *
 * Wrapping `app.css` in `@layer components` is the obvious fix and it inverts the bug instead of
 * removing it. `node_modules/tailwindcss/index.css` opens with `@layer theme, base, components,
 * utilities;` — components is declared BEFORE utilities, so utilities WIN over anything in that
 * layer. Every deliberate override in `app.css` would then lose, silently, and the ones that would
 * lose are the trap-4 guards: the readout's tighter padding, the row's tighter padding, the result
 * panel's shorter button, the spectator ball's larger label, and the portrait stick zone that is the
 * only thing keeping the dash button out from under the joystick. Same failure mode, opposite
 * direction, and this time it would take the guards with it.
 *
 * So the rule is not "never win against a utility" — it is **"win on purpose, and say so"**. The
 * allow-list below is that sentence, written down once per rule.
 *
 * ## What it scans for
 *
 * The properties whose failure is INVISIBLE. A dead `width` or a dead `padding` shows up on the
 * screen the moment anybody looks; a dead `position` looks like a layout somebody chose, which is
 * exactly why this one survived a screenshot review and a full geometry audit. Sizes and spacing are
 * deliberately not scanned — a guard that flags forty harmless rules is a guard somebody deletes.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const SHEET = 'src/app.css';

/**
 * The properties an unlayered rule may not declare without a reason on the list below.
 *
 * `inset[a-z-]*` covers `inset`, `inset-block`, `inset-inline` and their `-start`/`-end` forms. The
 * pattern anchors on the start of a declaration, which is what keeps `env(safe-area-inset-right)` —
 * a VALUE, in the middle of a `calc()` — from reading as a property.
 *
 * `flex-direction` and `flex-wrap` are in the set because their failures are the quietest of the
 * lot: a dead `flex-direction: row` leaves a sheet stacked, which looks like a layout somebody chose
 * for a narrow screen, and a dead `flex-wrap: wrap` lets a row overflow its own plaque instead of
 * folding. Both have a Tailwind utility form (`flex-col`, `flex-wrap`) that the markup uses
 * elsewhere, so both are exactly the fight this file has already lost once.
 *
 * `visibility` is here on a technicality worth stating, because a dead `visibility: hidden` leaves
 * things VISIBLE, which sounds like the loud kind of failure. It is not: the one use of it in this
 * file suppresses the interface behind the rotate card, in portrait, in an arena mode — a state that
 * took a photograph at 390×844 to find the first time and that no test asserts the appearance of.
 * The criterion for this list is "would anybody notice", not "is something drawn".
 */
const INVISIBLE_WHEN_DEAD =
	/(?:^|;)\s*(position|top|right|bottom|left|inset[a-z-]*|display|visibility|float|clear|z-index|order|flex-direction|flex-wrap|flex-flow)\s*:/;

/**
 * Every unlayered rule in `app.css` that is allowed to declare one of those, and why it is safe.
 *
 * "Safe" means one of two things, and each entry says which:
 *  * **uncontested** — no element carrying this class is also given a Tailwind utility for the same
 *    property, so there is no conflict for the cascade to settle wrongly. This is most of them.
 *  * **on purpose** — there IS a utility and this rule is meant to beat it. Those are the ones that
 *    `@layer components` would break, and they are named here so that trade-off stays visible.
 *
 * An entry that stops matching has to be DELETED (see the staleness test), so this list can only
 * get shorter unless somebody adds a rule and a reason together.
 */
const ALLOWED: Record<string, string> = {
	body: 'uncontested — `body` carries no classes at all, so no utility can be competing with it',
	'.overlay':
		'uncontested — every `.overlay` in the markup is `class="overlay p-6"` or bare; none is positioned by a utility',
	'.rotate-hint': 'uncontested — the card carries this one class and nothing else',
	'.mode-switch':
		'uncontested — `display: flex` and `flex-direction: column` on a button that no utility gives either to. NOTE: this rule sits after `.action` in the file and the file used to claim that ordering was load-bearing. It is not, and it never was: `.action` declares no `display`, and source order would not settle a fight with a LAYERED utility even if it did. Kept adjacent for reading, not for the cascade',
	'.customise-body':
		'WINS ON PURPOSE — the markup says `flex-col` and this says `flex-direction: row` in landscape, which is the whole two-column sheet. Nobody had written that down: it is the oldest deliberate override in the file and the one whose failure would be quietest, since a stacked sheet on a phone looks like a choice',
	'.result-actions':
		'WINS ON PURPOSE — nothing competes today, but `flex-wrap: wrap` here is what keeps the two result buttons inside their own plaque on a 320 px screen, and a `flex-nowrap` added to that row would undo it silently',
	".stick-zone, [role='application']":
		'WINS ON PURPOSE — beats the `inset-y-0 left-0 w-1/2` on the joystick root, and it is the most dangerous override in the file: without it the zone is half the screen and the dash button is underneath it in portrait. `top: auto` is load-bearing, not decoration — see the comment there',
	'.result-note':
		'uncontested — `display: none` on a short screen; the markup gives these lines no display utility',
	'.rotate-glyph':
		'uncontested — the markup gives it `mx-auto mb-6 h-24 w-14` and no positioning utility. The `position: relative` is for the home bar and is deliberately explicit rather than relying on the animated `transform` to establish a containing block, which would be correct only by coincidence',
	'.rotate-glyph::before':
		'uncontested by construction — a pseudo-element cannot carry a class, so no Tailwind utility can ever reach it. Listed rather than excluded from the scan, because "pseudo-elements are always safe" is a rule somebody would have to re-derive',
	'.stage:has(> .rotate-hint) > :not(canvas, .rotate-hint)':
		'uncontested, and the most consequential rule in the file — it is what stops the whole interface being drawn, and dead, behind the rotate card. Nothing in the markup sets `visibility` on any of those elements. If `:has()` is unsupported the rule is dropped and the behaviour is what shipped before it, which is why this is safe to rely on rather than merely allowed'
};

/** A style rule, and whether the cascade is on its side. */
interface Rule {
	selector: string;
	decls: string;
	/** Inside any `@layer`, at any depth. A layered rule loses to utilities and is not this test's business. */
	layered: boolean;
}

/** Drop `/* … *\/` before anything else, so a commented-out `position:` cannot fail the build. */
function stripComments(css: string): string {
	return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/**
 * Read the block that starts at `open`, and hand back its text plus the index after its `}`.
 *
 * Brace-counting, with quoted strings skipped — `url('…')` and `'Baloo 2'` contain no braces today
 * and this is one line of insurance against the first one that does.
 */
function block(css: string, open: number): { text: string; end: number } {
	let depth = 0;
	let quote: string | null = null;
	for (let i = open; i < css.length; i++) {
		const ch = css[i];
		if (quote) {
			if (ch === quote) quote = null;
			continue;
		}
		if (ch === '"' || ch === "'") quote = ch;
		else if (ch === '{') depth++;
		else if (ch === '}') {
			depth--;
			if (depth === 0) return { text: css.slice(open + 1, i), end: i + 1 };
		}
	}
	throw new Error(`unbalanced braces in ${SHEET} from index ${open}`);
}

/** Every style rule in the sheet, flattened out of whatever at-rules wrap it. */
function walk(css: string, layered: boolean, out: Rule[] = []): Rule[] {
	let prelude = '';
	let i = 0;
	while (i < css.length) {
		const ch = css[i];
		if (ch === '{') {
			const { text, end } = block(css, i);
			const at = prelude.trim();
			if (at.startsWith('@')) {
				const name = at.split(/[\s({]/)[0];
				// `@font-face` and `@keyframes` hold descriptors and stops, not selectors and not a
				// cascade this test has anything to say about.
				if (name !== '@font-face' && name !== '@keyframes') {
					walk(text, layered || name === '@layer', out);
				}
			} else {
				out.push({ selector: at.replace(/\s+/g, ' '), decls: text, layered });
			}
			i = end;
			prelude = '';
		} else if (ch === ';') {
			// An at-STATEMENT rather than a block: `@import`, or `@layer a, b, c;`.
			prelude = '';
			i++;
		} else {
			prelude += ch;
			i++;
		}
	}
	return out;
}

function offenders(css: string): string[] {
	return walk(stripComments(css), false)
		.filter((r) => !r.layered && INVISIBLE_WHEN_DEAD.test(r.decls))
		.map((r) => r.selector);
}

describe('app.css cannot silently beat a Tailwind utility on layout', () => {
	const css = readFileSync(SHEET, 'utf8');

	it('declares no invisible-when-dead property without a reason on the list', () => {
		const unexplained = [...new Set(offenders(css))].filter((sel) => !(sel in ALLOWED));
		expect(
			unexplained,
			`these unlayered rules in ${SHEET} set a property that a Tailwind utility might also set,\n` +
				'and a dead `position`/`inset`/`display` looks like a layout somebody chose:\n  ' +
				`${unexplained.join('\n  ')}\n` +
				'Either move the property onto the markup (the wrapper div pattern), or add the selector ' +
				'to ALLOWED with a sentence saying whether it is uncontested or wins on purpose.'
		).toEqual([]);
	});

	it('and the reasons list shrinks when a rule goes, rather than rotting', () => {
		// Same shape as `wiring.test.ts`: an entry that no longer describes anything has to be
		// deleted, so the list cannot become a permanent excuse for whatever is added under it.
		const live = new Set(offenders(css));
		const stale = Object.keys(ALLOWED).filter((sel) => !live.has(sel));
		expect(
			stale,
			`no rule matches these any more — delete them from ALLOWED:\n  ${stale.join('\n  ')}`
		).toEqual([]);
	});

	it('rests on a layer order that Tailwind itself declares, not on a sentence about it', () => {
		// The whole reasoning above is "components is declared before utilities, so utilities win".
		// That is Tailwind's statement, not ours, and it is one line of its entry stylesheet. Assert
		// it rather than describing it: the day upstream reorders those four names, this test says so
		// instead of the interface quietly changing shape. (Trap 7's lesson — assert against the
		// thing that decides, never against prose describing it.)
		const upstream = readFileSync('node_modules/tailwindcss/index.css', 'utf8');
		const order = /@layer\s+([a-z,\s]+);/.exec(upstream)?.[1];
		expect(order, 'Tailwind no longer opens with a @layer statement').toBeTruthy();
		const names = (order as string).split(',').map((n) => n.trim());
		expect(names).toContain('components');
		expect(names).toContain('utilities');
		expect(
			names.indexOf('components'),
			'utilities no longer beat components — `@layer components` may now be the right fix for ' +
				'app.css, and the reasoning in this file needs rewriting rather than patching'
		).toBeLessThan(names.indexOf('utilities'));
	});

	describe('the scanner catches what it exists to catch', () => {
		// A `.not.toMatch` against a pattern that matches nothing passes forever. Every guard in this
		// repo feeds itself the violation it is for; this is that block.

		it('flags the exact rule that cost the triangle', () => {
			expect(offenders('.action { pointer-events: auto; position: relative; }')).toEqual([
				'.action'
			]);
		});

		it('flags a dead inset, which is the half of `.sideline-ball` that never ran', () => {
			expect(offenders('.sideline-ball { inset: auto 0 0 auto; width: 6rem; }')).toEqual([
				'.sideline-ball'
			]);
		});

		it('flags a dead flex-direction, which is what a stacked customise sheet looks like', () => {
			// The property was added to the pattern after `.customise-body` turned out to be an
			// undocumented deliberate override. A pattern extended without being fed its own violation
			// is a pattern that might match nothing.
			expect(offenders('.customise-body { flex-direction: row; }')).toEqual(['.customise-body']);
		});

		it('flags a dead flex-wrap, which is a row overflowing its own plaque', () => {
			expect(offenders('.result-actions { flex-wrap: wrap; }')).toEqual(['.result-actions']);
		});

		it('flags a dead visibility, which is a whole interface reappearing behind a card', () => {
			expect(offenders('.stage > * { visibility: hidden; }')).toEqual(['.stage > *']);
		});

		it('flags a rule on a pseudo-element, rather than assuming those are always safe', () => {
			expect(offenders('.thing::before { position: absolute; }')).toEqual(['.thing::before']);
		});

		it('flags one nested inside a media query, because that is where half this file lives', () => {
			expect(offenders('@media (orientation: portrait) { .thing { z-index: 3; } }')).toEqual([
				'.thing'
			]);
		});

		it('does NOT flag a layered rule, since a layered rule loses to utilities anyway', () => {
			expect(offenders('@layer components { .action { position: relative; } }')).toEqual([]);
		});

		it('does not mistake a value for a property', () => {
			// `env(safe-area-inset-right)` inside a `calc()` is the live case: the stick zone's width.
			expect(
				offenders(
					'.stick-zone { width: calc(100% - 12rem - max(1rem, env(safe-area-inset-right))); }'
				)
			).toEqual([]);
		});

		it('does not read a commented-out property as a live one', () => {
			expect(offenders('.action { /* position: relative; */ color: red; }')).toEqual([]);
		});

		it('ignores keyframe stops, which look like selectors and are not', () => {
			expect(offenders('@keyframes tip { 0% { display: none; } }')).toEqual([]);
		});
	});

	it('scans a whole stylesheet rather than nothing at all', () => {
		// The other half of non-vacuous: a parser that returned an empty list would pass every
		// assertion above. `app.css` is ~40 rules; twenty-five is a floor well under that and well
		// over anything a broken walk would produce.
		const all = walk(stripComments(css), false);
		expect(all.length).toBeGreaterThan(25);
		// And it found the rules that make up the interface, not just the easy top-level ones.
		const selectors = all.map((r) => r.selector);
		expect(selectors).toContain('.action');
		expect(selectors).toContain('.panel');
		// This one only exists inside `@media (orientation: portrait)`, so seeing it proves the walk
		// descends into at-rules instead of skipping them.
		expect(selectors).toContain('.hud-stack');
	});
});
