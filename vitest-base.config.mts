import { defineConfig } from 'vitest/config';

// Shared Vitest settings for `ng test` (angular.json -> test.runnerConfig). The Angular builder owns
// test discovery, the environment (jsdom, or Chromium for the "browser" configuration) and setup files.
//
// Random order like Karma/Jasmine had: files and tests are shuffled. Every run prints its seed;
// replay an order with VITEST_SEED=<seed> npm test.
const seed = Number(process.env['VITEST_SEED'] ?? Math.floor(Math.random() * 1_000_000));
console.log(`Vitest random order seed: ${seed} (replay with VITEST_SEED=${seed})`);

export default defineConfig({
  test: {
    sequence: { shuffle: { files: true, tests: true }, seed },
    // Jasmine removed every spyOn() spy after each spec; Vitest keeps vi.spyOn() spies unless told
    // to restore them. Without this a spy (e.g. on window.scrollTo) leaks into later tests.
    restoreMocks: true,
    // Memory, not speed, is the limit on this machine: every worker loads its own jsdom and its own
    // copy of the test bundle, and the default (one per CPU) peaked at 10 GB. Four threads measured
    // 3.3 GB at the same speed as six; VITEST_MAX_WORKERS=<n> overrides it for one run.
    pool: 'threads',
    maxWorkers: Number(process.env['VITEST_MAX_WORKERS']) || 4,
    // Fail the run on errors thrown outside a test (timers, unhandled rejections) instead of only
    // reporting them.
    dangerouslyIgnoreUnhandledErrors: false,
  },
});
