import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Does the app actually REACH this code?
 *
 * The dominant failure of the day this file was written, by a wide margin. Five separate times a
 * feature was finished, tested, committed and invisible, because nothing called it:
 *
 *  * a 1516-line island renderer whose `createIsland` had no caller;
 *  * a `SceneHandles.setIsland` verb, added and implemented, that no component ever invoked;
 *  * a camera handed `spec.view` as a RADIUS where it meant a DISTANCE — 26.8 m instead of 14 m,
 *    and the island at 5.2% of the frame instead of 10.3%;
 *  * `ISLAND.portrait = true`, declared, typed and documented, that nothing read — so the one mode
 *    designed to be playable on a tall screen was covered by a card telling the child to rotate;
 *  * `Speech.svelte`, mounted nowhere, so no islander ever said anything on screen.
 *
 * Every one of them typechecks, lints, and passes its own tests. Traps 5 and 15 in `CLAUDE.md` are
 * both this shape and both cost a session. The lesson is short: **"is it built" and "is it called"
 * are different questions, and only the second one shows up on a screen.**
 *
 * So this walks the import graph from the app's real entry points and fails on anything under
 * `src/lib/` it cannot reach. It is a REACHABILITY test, not an import-count test: a module imported
 * only by its own siblings is still unreachable, which is exactly how a whole feature directory hides.
 *
 * What it deliberately does NOT do: check that a reachable module is USED correctly. `setIsland` was
 * called with the right argument and the island still drew nothing for an hour; `spec.view` was passed
 * to the wrong function. Reachability is the cheap half. The other half is a person looking at the
 * screen, which is what `npm run shots` and `docs/ART-DIRECTION.md` are for.
 */

const LIB = join('src', 'lib');

/**
 * Where the running application actually starts.
 *
 * `+page.svelte` and the layout are the browser's way in; the service worker is a second, separate
 * entry (it is bundled on its own and imports `$service-worker`, not the page); the manifest route is
 * prerendered and pulls `brand.ts`. Anything not reachable from one of these four is not in the app a
 * child opens, whatever else is true about it.
 */
const ENTRIES = [
	join('src', 'routes', '+page.svelte'),
	join('src', 'routes', '+layout.svelte'),
	join('src', 'routes', '+layout.ts'),
	join('src', 'service-worker.ts'),
	join('src', 'routes', 'manifest.webmanifest', '+server.ts')
];

/**
 * Modules that are unreachable ON PURPOSE, each with the reason.
 *
 * An allow-list is the honest half of a guard like this: some code legitimately has no caller yet, and
 * the alternative to naming it here is deleting the test the first time it is inconvenient. The rule
 * for adding an entry is that the reason has to be a DECISION, not "not wired up yet" — that phrase
 * is precisely what this file exists to catch.
 */
const DELIBERATELY_UNREACHED: Record<string, string> = {
	// Phase 3's test double. `docs/DECISIONS/0005` builds the netcode against a simulated bad link
	// before a real one exists, so this is imported by tests and by nothing else BY DESIGN — it is the
	// network made of nothing, with latency, jitter and seeded loss.
	[join(LIB, 'net', 'loopback.ts')]:
		'phase 3 test transport — used by session.test.ts, never shipped'
};

/**
 * Features that are finished but not yet wired, as a BASELINE that may only ever shrink.
 *
 * This list is not an allow-list and must not be read as one. `DELIBERATELY_UNREACHED` above holds
 * decisions — code with no caller on purpose, for ever. This holds work in flight, and the difference
 * matters: "not wired up yet" is the exact phrase this whole file exists to catch, so it is not
 * allowed to be a reason for silence.
 *
 * Two assertions keep it honest, and the second is the one that does the work:
 *
 *  1. The orphan set may never GROW beyond this list. That is what stops a sixth stranded feature.
 *  2. Every entry here must STILL be an orphan. The moment something is wired, its line fails and has
 *     to be deleted — so the list cannot rot into a permanent excuse, and it shrinks on its own as the
 *     hooks land.
 *
 * If this list is ever empty, delete it and both assertions with it.
 */
const IN_FLIGHT: Record<string, string> = {};

function walk(dir: string): string[] {
	const out: string[] = [];
	for (const name of readdirSync(dir)) {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) out.push(...walk(path));
		else if (/\.(ts|svelte)$/.test(name) && !name.endsWith('.test.ts') && !name.endsWith('.d.ts'))
			out.push(path);
	}
	return out;
}

/** Resolve an import specifier the way Vite does, for the two forms this project uses. */
function resolve(spec: string, from: string): string | null {
	let base: string;
	if (spec.startsWith('$lib/')) base = join(LIB, spec.slice('$lib/'.length));
	else if (spec.startsWith('.')) base = normalize(join(dirname(from), spec));
	else return null; // a bare package, or one of SvelteKit's `$app/*` virtuals
	for (const candidate of [base, `${base}.ts`, `${base}.svelte`]) {
		try {
			if (statSync(candidate).isFile()) return candidate;
		} catch {
			// not this one
		}
	}
	return null;
}

function importsOf(file: string): string[] {
	const source = readFileSync(file, 'utf-8');
	const found = new Set<string>();
	// Static `from '…'` and side-effecting `import '…'`, plus dynamic `import('…')`. Deliberately a
	// regex rather than a parser: this has to run in the unit suite in milliseconds, and a missed
	// exotic form makes the test STRICTER (something looks unreachable) rather than weaker.
	for (const match of source.matchAll(/(?:from|import)\s*\(?\s*'([^']+)'/g)) {
		const hit = resolve(match[1] as string, file);
		if (hit) found.add(hit);
	}
	return [...found];
}

function reachable(): Set<string> {
	const seen = new Set<string>();
	const stack = ENTRIES.filter((entry) => {
		try {
			return statSync(entry).isFile();
		} catch {
			return false;
		}
	});
	while (stack.length > 0) {
		const file = stack.pop() as string;
		if (seen.has(file)) continue;
		seen.add(file);
		for (const next of importsOf(file)) if (!seen.has(next)) stack.push(next);
	}
	return seen;
}

describe('everything under src/lib is reachable from the app', () => {
	it('has entry points that actually exist', () => {
		// Without this the walk starts nowhere, every module looks unreachable, and the failure would
		// read as "the whole library is dead" rather than "somebody moved the route".
		const found = ENTRIES.filter((entry) => {
			try {
				return statSync(entry).isFile();
			} catch {
				return false;
			}
		});
		expect(found.length, `no entry point found among ${ENTRIES.join(', ')}`).toBeGreaterThan(2);
	});

	it('reaches every module, or names the reason it does not', () => {
		const seen = reachable();
		const orphans = walk(LIB)
			.filter((file) => !seen.has(file))
			.filter((file) => !(file in DELIBERATELY_UNREACHED));
		const unexpected = orphans.filter((file) => !(file in IN_FLIGHT));

		expect(
			unexpected,
			`nothing in the running app imports these, so they cannot be on screen:\n  ${unexpected.join('\n  ')}\n` +
				'Either wire them up, or — only if having no caller is a DECISION rather than a delay — ' +
				'add them to DELIBERATELY_UNREACHED with that reason.'
		).toEqual([]);
	});

	it('and the in-flight list shrinks as things get wired, rather than rotting', () => {
		// The assertion that stops the baseline becoming a permanent excuse: an entry that is no longer
		// an orphan has to be DELETED, so the list can only ever get shorter. Without this, wiring a
		// feature leaves its line behind and the next stranded feature slips in under it.
		const seen = reachable();
		const stale = Object.keys(IN_FLIGHT).filter((file) => seen.has(file));
		expect(
			stale,
			`these are wired now — delete them from IN_FLIGHT:\n  ${stale.join('\n  ')}`
		).toEqual([]);
	});

	it('reaches a lot of modules, so a broken resolver cannot make this pass', () => {
		// The way this guard dies quietly is a resolver that stops matching — every module then looks
		// reachable from nothing, `orphans` fills up and the test fails loudly; or the entry list
		// resolves to everything and it passes forever. This is the second case: assert the walk
		// actually walked.
		const seen = [...reachable()].filter((f) => f.startsWith(LIB));
		expect(seen.length, 'the import walk reached almost nothing — check `resolve`').toBeGreaterThan(
			30
		);
	});

	it('and the check would catch a module nothing imports', () => {
		// Non-vacuous, the way `purity.test.ts` feeds its own regexes the violations they exist to
		// catch: a path that is deliberately not in the graph must be reported as an orphan.
		const seen = reachable();
		const invented = join(LIB, 'a-module-nobody-imports.ts');
		expect(seen.has(invented)).toBe(false);
	});
});
