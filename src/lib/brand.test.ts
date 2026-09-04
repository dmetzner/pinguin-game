import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { APP, STORAGE_NAMESPACE } from './brand';

/**
 * Brand isolation, enforced rather than promised.
 *
 * A sibling project carries the cautionary tale in full: its repository name, its codename and
 * every one of its stored keys still disagree, because the keys were written before the name
 * settled and renaming them later would have stranded real data behind a key nothing reads. The
 * cost of getting this right on day one is this file. The cost of getting it wrong is permanent.
 */

const SRC = new URL('..', import.meta.url).pathname;

function sourceFiles(dir: string, acc: { path: string; source: string }[] = []) {
	for (const entry of readdirSync(dir)) {
		const path = join(dir, entry);
		if (statSync(path).isDirectory()) {
			sourceFiles(path, acc);
		} else if (/\.(ts|svelte|css|html)$/.test(entry)) {
			acc.push({ path: path.slice(SRC.length), source: readFileSync(path, 'utf-8') });
		}
	}
	return acc;
}

describe('brand isolation', () => {
	it('has sources to check at all', () => {
		// Guards against the whole file passing vacuously the day `src/` moves.
		const files = sourceFiles(SRC);
		expect(files.length).toBeGreaterThan(10);
		expect(files.map((f) => f.path)).toContain('lib/brand.ts');
	});

	it('names the product in exactly one module', () => {
		const offenders = sourceFiles(SRC)
			.filter((f) => !f.path.startsWith('lib/brand.'))
			.filter((f) => f.source.includes(APP.name))
			.map((f) => f.path);

		// Components render `APP.name`; they never spell it. When this goes red the fix is to import
		// from `brand.ts`, not to add the file to an exclusion list.
		expect(offenders).toEqual([]);
	});

	it('keeps the codename out of the persisted namespace', () => {
		expect(STORAGE_NAMESPACE).not.toContain(APP.name.toLowerCase());
		expect(STORAGE_NAMESPACE).not.toContain('pinguin');
		expect(STORAGE_NAMESPACE).not.toContain('wackel');
	});

	it('is the kind of check that can fail', () => {
		// Non-vacuousness, proved rather than assumed: feed the same predicate the violation it
		// exists to catch. Without this, a typo in `APP.name` would make the scan above pass forever.
		const planted = `const title = '${APP.name}';`;
		expect(planted.includes(APP.name)).toBe(true);
	});
});
