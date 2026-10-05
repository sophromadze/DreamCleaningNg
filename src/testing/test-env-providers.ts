import { EnvironmentProviders, Provider, provideCheckNoChangesConfig } from '@angular/core';

/**
 * Providers every spec's TestBed starts with (angular.json -> test.options.providersFile).
 *
 * Exhaustive checkNoChanges: after each change detection pass a fixture runs, re-check every view -
 * OnPush and not-dirty ones included - so a binding that moved without notifying Angular fails the
 * spec with NG0100 instead of passing on a stale DOM. Same setting as app.config.ts, minus the
 * periodic `interval` (it would fire on fake timers in the middle of a spec).
 */
const providers: (Provider | EnvironmentProviders)[] = [
  provideCheckNoChangesConfig({ exhaustive: true }),
];

export default providers;
