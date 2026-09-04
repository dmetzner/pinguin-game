import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Mode } from '../types';
import { ALL_MODES } from './registry';

/**
 * **Nothing outside `sim/modes/` may compare a mode id.**
 *
 * That is the rule that makes the registry worth building, and a paragraph in `CLAUDE.md` saying so
 * is worth nothing on the afternoon somebody needs one more special case and `world.mode === 'slide'`
 * is right there. This file is worth something, so it scans the tree — the same shape as
 * `sim/purity.test.ts` and `lib/brand.test.ts`, including the part where the guard proves it can
 * fail.
 *
 * Why the rule and not merely the registry: `Mode` was a four-member union whose literals were
 * compared in about thirty non-test files, and the owner has asked for twenty to thirty minigames.
 * Thirty comparisons across five modes is a nuisance; across twenty-five it is a codebase nobody can
 * add the twenty-sixth to. Whatever a comparison was asking — which ending, which camera, which bot,
 * which sound — the descriptor answers, and the answer is shared between the modes that agree.
 */

const SRC = new URL('../../..', import.meta.url).pathname;

/** Every id, from the register rather than typed out: a sixth mode is scanned for on the day it exists. */
const IDS: readonly Mode[] = ALL_MODES.map((mode) => mode.id);
const ID_ALTERNATION = IDS.join('|');

/**
 * A comparison against a mode id, in either direction, plus a `switch` over one.
 *
 * Deliberately NOT a hunt for the literals themselves: a literal is how a mode is NAMED — the
 * descriptors do it, `island.ts` names which door leads where, and every test that builds a world
 * passes one as an argument. Comparing one is how a caller decides behaviour behind the registry's
 * back, and that is the only thing worth banning.
 */
const COMPARISONS: readonly RegExp[] = [
	new RegExp(`[=!]==\\s*['"\`](${ID_ALTERNATION})['"\`]`),
	new RegExp(`['"\`](${ID_ALTERNATION})['"\`]\\s*[=!]==`),
	new RegExp(`case\\s+['"\`](${ID_ALTERNATION})['"\`]\\s*:`)
];

/**
 * Where a comparison is allowed, and why.
 *
 * ONE entry: `sim/modes/` is the register itself, and it is the one place that is supposed to know
 * which mode is which. There is deliberately no debt list — the exemption a component or a route
 * would need is exactly the thing this test exists to prevent, and the fix is always to put the
 * answer on the descriptor. The list is asserted to be exactly this below, so growing it is a
 * decision somebody has to make in this file and explain in the same commit.
 */
const ALLOWED: readonly string[] = ['lib/sim/modes/'];

function sourceFiles(dir: string, acc: { path: string; source: string }[] = []) {
	for (const entry of readdirSync(dir)) {
		const path = join(dir, entry);
		if (statSync(path).isDirectory()) {
			sourceFiles(path, acc);
		} else if (/\.(ts|svelte)$/.test(entry)) {
			acc.push({ path: path.slice(SRC.length), source: readFileSync(path, 'utf-8') });
		}
	}
	return acc;
}

/**
 * Strip comments, so the rule can be DISCUSSED wherever it needs discussing without tripping itself.
 *
 * Three kinds, because this scans Svelte as well as TypeScript: block comments, line comments (not
 * `https://`, hence the leading guard), and markup comments.
 */
function code(source: string): string {
	return source
		.replace(/\/\*[\s\S]*?\*\//g, '')
		.replace(/<!--[\s\S]*?-->/g, '')
		.replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function offences(files: { path: string; source: string }[]) {
	const found: string[] = [];
	for (const { path, source } of files) {
		if (ALLOWED.some((allowed) => path.startsWith(allowed))) continue;
		const body = code(source);
		for (const line of body.split('\n')) {
			if (COMPARISONS.some((pattern) => pattern.test(line))) found.push(`${path}: ${line.trim()}`);
		}
	}
	return found;
}

describe('only the mode registry knows which mode is which', () => {
	it('has sources to check at all', () => {
		// Without this the whole file passes vacuously the day `src/` moves — and a green check nobody
		// has watched fail is not evidence. Named files as well as a count, because a scan that found
		// only `app.css` would also be "not empty".
		const files = sourceFiles(SRC);
		const paths = files.map((f) => f.path);
		expect(paths).toContain('lib/sim/step.ts');
		expect(paths).toContain('lib/sim/round.ts');
		expect(paths).toContain('lib/sim/modes/registry.ts');
		expect(files.length).toBeGreaterThan(30);
	});

	it('has ids to scan for', () => {
		// A pattern built from an empty register matches nothing and passes forever.
		expect(IDS.length).toBeGreaterThanOrEqual(5);
		expect(IDS).toContain('classic');
		expect(IDS).toContain('island');
	});

	it('finds no comparison outside sim/modes/', () => {
		// When this goes red the fix is to ask the descriptor — add a field to `GameMode` if there is
		// nothing on it that answers the question — and NOT to add the file to `ALLOWED`.
		expect(offences(sourceFiles(SRC))).toEqual([]);
	});

	it('allows exactly one place', () => {
		// Pinned, so an exemption cannot be added quietly. `Game.svelte` was on this list for one
		// commit, while the UI designer's pass was still landing in it; the component reads a single
		// `GameMode` now and compares nothing.
		expect([...ALLOWED]).toEqual(['lib/sim/modes/']);
	});

	it('scans the component and the route it used to have to skip', () => {
		// Named explicitly, because those two files held about thirty of the comparisons this guard
		// exists for and a scan that silently stopped reaching them would pass forever.
		const paths = sourceFiles(SRC).map((f) => f.path);
		expect(paths).toContain('lib/components/Game.svelte');
		expect(paths).toContain('routes/+page.svelte');
	});
});

describe('the guard can fail', () => {
	// Non-vacuousness, proved rather than assumed: feed the scanner the violations it exists to catch
	// and watch it object. A `.toEqual([])` against a pattern that matches nothing passes forever.
	const violations = [
		"if (world.mode === 'classic') return 0;",
		'const racing = mode === "slide" || mode === "chase";',
		"if ('royal' !== world.mode) return;",
		"\t\t\tcase 'island':"
	];

	it.each(violations)('catches %s', (line) => {
		expect(offences([{ path: 'lib/sim/step.ts', source: line }])).toHaveLength(1);
	});

	it('does not fire on a mode id used as a NAME rather than as a decision', () => {
		// Which is the thing the codebase does everywhere and must keep doing: a descriptor declares
		// its own id, `island.ts` says which door leads where, and every test names the mode it builds.
		const named = [
			"export const CLASSIC = { id: 'classic' };",
			"leads: { kind: 'mode', mode: 'royal' }",
			"const world = createWorld(['a', 'b'], 11, 'chase');"
		];
		expect(offences(named.map((source) => ({ path: 'lib/sim/thing.ts', source })))).toEqual([]);
	});

	it('does not fire on the same comparison inside a comment', () => {
		const commented = [
			{ path: 'lib/sim/step.ts', source: "// it used to say world.mode === 'slide' here" },
			{ path: 'lib/sim/step.ts', source: "/* mode === 'royal' */\nconst a = 1;" },
			{ path: 'lib/x.svelte', source: "<!-- mode === 'chase' -->" }
		];
		expect(offences(commented)).toEqual([]);
	});

	it('does not exempt a file merely for sitting near the register', () => {
		// `startsWith` on a path prefix is what does the exempting, and 'lib/sim/modeswitch.ts' must not
		// be caught by 'lib/sim/modes/'.
		const nearly = { path: 'lib/sim/modeswitch.ts', source: "if (m === 'slide') return;" };
		expect(offences([nearly])).toHaveLength(1);
	});
});
