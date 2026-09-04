/**
 * Which of two overlapping controls gets the tap — asserted, because it is currently decided by
 * MARKUP ORDER and nothing said so.
 *
 * Traps 4 and 12 are both the same sentence: *the joystick's zone is the whole left half of the
 * screen AND IT COMES LATER IN THE DOM*, so anything under it is visible, looks pressable, and is
 * dead. That sentence has been quoted in five fixes. **It is no longer true of the action buttons.**
 * The triangle now sits after `<Joystick>` in `Game.svelte`, every element involved has `z-index:
 * auto`, and paint order among equals is document order — so the buttons win a tap on overlap, and
 * they win it without a `z-index` anywhere in that box.
 *
 * That was found the hard way and it is worth recording how, because the process is the point. A
 * portrait geometry audit measured a 32 px overlap between the stick's zone and the dash button and
 * concluded trap 4 had happened a sixth time. The arithmetic was right twice over — the overlap is
 * real, and an earlier version of the same claim had it as 80 px, which was wrong — and the
 * CONCLUSION did not follow from it, because the fact that turns an overlap into a dead control had
 * changed underneath. It took reverting the fix and watching the test still pass to see it.
 *
 * So the triangle's reachability rests on one line being above another line, silently, in a 2000-line
 * component that four people edited in one night. `cascade.test.ts` cannot see it: that guard reads
 * the stylesheet, and this is a fact about the markup. Hence this file.
 *
 * It asserts the order AND the consequence of the order, in both directions:
 *
 *  * The top-right row comes BEFORE the zone, so it is painted first and loses a tap to it — which
 *    is why it carries `z-10`, and why that class is load-bearing rather than tidiness. Trap 12.
 *  * The dash comes AFTER the zone, so it needs nothing. If anybody moves the triangle above
 *    `<Joystick>` — reordering markup is the most innocent-looking edit there is — the dash's left
 *    32 px go under an invisible control on a portrait screen and this test says so.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const COMPONENT = 'src/lib/components/Game.svelte';

/**
 * The three markers, and why each is the string it is.
 *
 * Every one of them is a class this stylesheet pass owns or a component tag, rather than a Tailwind
 * utility: `absolute` and `z-10` appear dozens of times in that file and would match the wrong tag
 * the first time somebody added a control.
 */
const MARKERS = {
	row: 'class="top-row',
	zone: '<Joystick',
	dash: 'class="action action-dash'
} as const;

/**
 * Strip Svelte comments before looking for anything.
 *
 * Not defensive — necessary, and it caught this test's own author. `Game.svelte` documents the three
 * thumb buttons in a comment that names `.action-dash` a hundred and fifty lines above the button
 * itself, so an unstripped scan reads the dash as coming BEFORE the triangle it is inside and gets
 * the answer to this file's only question wrong.
 */
function stripComments(src: string): string {
	// Replaced with spaces rather than removed, so every surviving index still points at the same
	// character it did in the file and a failure message can be read against the real line numbers.
	return src.replace(/<!--[\s\S]*?-->/g, (m) => ' '.repeat(m.length));
}

/** Where each marker first appears in the markup, comments excluded. `-1` if it is gone. */
function positions(src: string): Record<keyof typeof MARKERS, number> {
	const clean = stripComments(src);
	return {
		row: clean.indexOf(MARKERS.row),
		zone: clean.indexOf(MARKERS.zone),
		dash: clean.indexOf(MARKERS.dash)
	};
}

/** The attributes of the tag a marker sits in, for asserting what it does or does not carry. */
function tagAt(src: string, marker: string): string {
	const clean = stripComments(src);
	const at = clean.indexOf(marker);
	if (at < 0) return '';
	// Back up to the `<`, forward to the `>`: the whole opening tag, however many lines it spans.
	const open = clean.lastIndexOf('<', at);
	return clean.slice(open, clean.indexOf('>', at) + 1);
}

describe('which overlapping control gets the tap', () => {
	const src = readFileSync(COMPONENT, 'utf8');
	const at = positions(src);

	it('finds all three controls, so a rename cannot make this pass by matching nothing', () => {
		// The other guards in this repo all carry this assertion and it is the one that keeps them
		// honest: three `-1`s compare as equal and every ordering test below would go green.
		expect(
			at.row,
			`${MARKERS.row} — the top-right button row — is gone from ${COMPONENT}`
		).toBeGreaterThan(-1);
		expect(at.zone, `${MARKERS.zone} — the joystick — is gone from ${COMPONENT}`).toBeGreaterThan(
			-1
		);
		expect(
			at.dash,
			`${MARKERS.dash} — the dash button — is gone from ${COMPONENT}`
		).toBeGreaterThan(-1);
	});

	it('paints the top-right row BEFORE the joystick, which is why it needs its z-10', () => {
		expect(
			at.row,
			'the row now comes after the joystick, so it wins a tap on its own and the `z-10` on it is ' +
				'no longer load-bearing. Check whether that class is still doing anything before trusting it.'
		).toBeLessThan(at.zone);

		// And the consequence. On the narrowest landscape the row reaches back to x≈134 against a zone
		// ending at x=284, so a hundred and fifty pixels of it — including the mute button — overlap a
		// control painted later. Without the z-index those buttons are trap 12 again.
		expect(
			tagAt(src, MARKERS.row),
			'the row is painted before the joystick and overlaps it by ~150 px on a 568 px screen, so ' +
				'it MUST carry an explicit z-index or every button in it is visible and dead (trap 12)'
		).toMatch(/\bz-10\b/);
	});

	it('paints the dash AFTER the joystick, which is the whole reason its overlap is harmless', () => {
		expect(
			at.dash,
			'the dash now comes BEFORE the joystick in the markup. Every element here has `z-index: ' +
				'auto`, so paint order is document order and the zone would win: on a 320 px portrait ' +
				'screen the dash spans x∈[128,208] against a 112 px zone today and a 160 px zone if the ' +
				'portrait rule in app.css ever goes, so its left edge would be visible and dead. Either ' +
				'move it back below `<Joystick>` or give that box a z-index and say why.'
		).toBeGreaterThan(at.zone);

		// No `z-index` in that box, and that is the state this test is protecting rather than an
		// oversight: the buttons are reachable because of where they are, so a z-index there would be
		// a second mechanism for something already handled, and the kind that hides a regression in
		// the first one.
		expect(tagAt(src, MARKERS.dash)).not.toMatch(/\bz-\d/);
	});

	describe('the scanner catches what it exists to catch', () => {
		// `.not.toMatch` and index comparisons against a scan that found nothing pass forever, so the
		// locator is fed the orderings it exists to distinguish.

		const markup = (order: string[]) =>
			order
				.map((k) => `<div ${MARKERS[k as keyof typeof MARKERS]} z-10 absolute"></div>`)
				.join('\n');

		it('sees the order the file actually has', () => {
			const p = positions(markup(['row', 'zone', 'dash']));
			expect(p.row).toBeLessThan(p.zone);
			expect(p.zone).toBeLessThan(p.dash);
		});

		it('sees the dangerous order, where the dash is above the joystick', () => {
			const p = positions(markup(['row', 'dash', 'zone']));
			expect(p.dash).toBeLessThan(p.zone);
		});

		it('is not fooled by a comment naming a control, which is how it was fooled once', () => {
			// Verbatim shape of the real thing: `Game.svelte` names `.action-dash` in a comment above
			// the triangle, 150 lines before the button. Unstripped, the dash reads as coming first and
			// the answer to this file's only question inverts.
			const p = positions(
				`<!-- One colour each (\`.action-dash\` in \`app.css\`) -->\n` +
					`<div ${MARKERS.zone}></div>\n<div ${MARKERS.dash}"></div>`
			);
			expect(p.dash).toBeGreaterThan(p.zone);
		});

		it('reports a missing marker as -1 rather than as "first"', () => {
			// `indexOf` returning -1 is what the presence test above exists to catch; this proves it is
			// -1 and not 0, which would read as "earliest in the document" and silently invert an
			// ordering assertion.
			expect(positions('<div>nothing here</div>').dash).toBe(-1);
		});

		it('reads the whole opening tag, including one broken over several lines', () => {
			// Every marker in the real file sits in a multi-line tag, which is the only reason this
			// helper is not just a substring of one line.
			const tag = tagAt(
				`<button\n\tclass="action action-dash h-full"\n\tz-10\n>Zack!</button>`,
				MARKERS.dash
			);
			expect(tag).toContain('z-10');
			expect(tag).toContain('action-dash');
		});
	});
});
