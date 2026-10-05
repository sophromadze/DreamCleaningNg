import { mergeConfig } from 'vitest/config';
import base from './vitest-base.config.mts';

// The "browser" configuration of `ng test` (the specs that need real layout or canvas, run in
// Chromium) shares every setting with the jsdom run, but writes its coverage report beside the
// jsdom one instead of over it.
export default mergeConfig(base, {
  test: {
    coverage: { reportsDirectory: 'coverage/DreamCleaningNG-browser' },
  },
});
