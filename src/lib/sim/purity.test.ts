import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Invariant 1, enforced rather than asserted in prose.
 *
 * `src/lib/sim/` is the whole game minus everything you can see. It must stay pure: no renderer, no
 * framework, no clock, no unseeded randomness. Three separate things depend on that and each fails
 * differently when it slips —
 *
 *  * the **tests** stop being able to replay a round,
 *  * the **bots** need a second code path once the sim knows what a canvas is, and
 *  * **phase 3** breaks intermittently, which is the worst way for a networking bug to break.
 *
 * A comment in CLAUDE.md saying so is worth nothing on the afternoon someone needs a timestamp and
 * `Date.now()` is right there. This file is worth something, so it scans the tree.
 */

const SIM_DIR = new URL('.', import.meta.url).pathname;

function simSources(): { name: string; source: string }[] {
	return readdirSync(SIM_DIR)
		.filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
		.map((name) => ({ name, source: readFileSync(join(SIM_DIR, name), 'utf-8') }));
}

/** Strip comments, so a rule can be *discussed* in a docblock without tripping its own guard. */
function code(source: string): string {
	return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('the simulation is pure', () => {
	it('has sources to check at all', () => {
		// Without this, every assertion below passes vacuously the day the directory moves — a green
		// check nobody has watched fail is not evidence.
		const names = simSources().map((f) => f.name);
		expect(names).toContain('step.ts');
		expect(names).toContain('floe.ts');
		expect(names.length).toBeGreaterThanOrEqual(6);
	});

	it('imports no renderer and no framework', () => {
		for (const { name, source } of simSources()) {
			const body = code(source);
			expect(body, `${name} imports three.js`).not.toMatch(/from\s+['"]three/);
			expect(body, `${name} imports svelte`).not.toMatch(/from\s+['"]svelte/);
			expect(body, `${name} imports $app or $lib`).not.toMatch(/from\s+['"]\$(app|lib|env)/);
		}
	});

	it('reads no clock', () => {
		// Time enters the simulation as a tick count and in no other way. A `Date.now()` here is a
		// world that advances differently on a slow phone than on a fast one.
		for (const { name, source } of simSources()) {
			const body = code(source);
			expect(body, `${name} calls Date.now()`).not.toMatch(/Date\.now\s*\(/);
			expect(body, `${name} constructs a Date`).not.toMatch(/new\s+Date\s*\(/);
			expect(body, `${name} uses performance.now()`).not.toMatch(/performance\.now\s*\(/);
		}
	});

	it('uses no unseeded randomness', () => {
		for (const { name, source } of simSources()) {
			expect(code(source), `${name} calls Math.random()`).not.toMatch(/Math\.random\s*\(/);
		}
	});

	it('touches no browser global', () => {
		for (const { name, source } of simSources()) {
			const body = code(source);
			expect(body, `${name} touches window`).not.toMatch(/\bwindow\./);
			expect(body, `${name} touches document`).not.toMatch(/\bdocument\./);
			expect(body, `${name} touches localStorage`).not.toMatch(/\blocalStorage\b/);
		}
	});
});

describe('the guard can fail', () => {
	// Proving a scanner non-vacuous, the way `schema_guards.sql` gets proved in the sibling repo:
	// feed it the thing it claims to catch and watch it object. Without this the regexes could all
	// be quietly wrong — a `.not.toMatch` against a pattern that matches nothing always passes.
	const violations = [
		["import { Scene } from 'three';", /from\s+['"]three/],
		["import { mount } from 'svelte';", /from\s+['"]svelte/],
		['const t = Date.now();', /Date\.now\s*\(/],
		['const r = Math.random();', /Math\.random\s*\(/],
		['window.addEventListener("resize", f);', /\bwindow\./]
	] as const;

	it.each(violations)('catches %s', (line, pattern) => {
		expect(code(line)).toMatch(pattern);
	});

	it('does not fire on the same thing inside a comment', () => {
		expect(code('// never call Math.random() here')).not.toMatch(/Math\.random\s*\(/);
		expect(code('/* Date.now() is banned */\nconst a = 1;')).not.toMatch(/Date\.now\s*\(/);
	});
});
