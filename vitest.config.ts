import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		// `node`, not a DOM environment, and that is a statement about what this suite covers rather
		// than a shortcut. Everything worth unit-testing here — the simulation, the joystick maths —
		// is pure by invariant, so a DOM would only be scenery. It also sidesteps the Node 25
		// localStorage/happy-dom collision the sibling repos ran into (see `package.json`). The day a
		// test genuinely needs a document, add happy-dom for that file with `@vitest-environment`
		// rather than switching the whole suite.
		environment: 'node',
		include: ['src/**/*.test.ts'],
		/**
		 * Twenty seconds, not five, and it is a statement about what this suite IS.
		 *
		 * Vitest's default is chosen for a unit test that calls a function once. Most of this suite
		 * plays whole ROUNDS: `chase.test.ts` runs five seeds of a course that can last four minutes of
		 * game time, with six bots deciding every tick, which is on the order of a hundred and eighty
		 * thousand decisions in one assertion. That is not slowness to be optimised away — the
		 * measurement over many seeds is the evidence the mode works (`backlog/stories/08-the-chase.md`
		 * records the leash being proved that way), and trading seeds for a green tick would trade real
		 * coverage for a timer.
		 *
		 * The number is set against MEASURED spread rather than against the slowest test. The same test
		 * took 3.8 s alone and 6.4 s with ten agents running on this machine, and a CI runner is slower
		 * again with one worker — so several tests sit in a 2–4 s band where a 2× machine difference
		 * crosses a 5 s line. That is the failure mode: not one slow test, a whole band of them going
		 * red one pipeline at a time. Twenty seconds is roughly 5× the slowest measured run, which is
		 * headroom for a slow runner and still short enough that a genuinely HUNG test fails inside a
		 * coffee break.
		 *
		 * The one true outlier carries its own, larger timeout at the test rather than here, so a
		 * reader meets the cost where it is paid.
		 */
		testTimeout: 20_000,
		// Renderer code is excluded from coverage of any kind on purpose: nothing under `render/`
		// is unit-testable in a meaningful way, and the honest check for it is `e2e/` plus a human
		// looking at the screen.
		globals: false
	}
});
