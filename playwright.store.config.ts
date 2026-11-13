import { defineConfig } from '@playwright/test';

// Chrome Web Store screenshots (tests/store, ADR 0017): `npm run store:screenshots` builds the
// production extension and writes docs/store/screenshots/. Offline, like the e2e tests.
export default defineConfig({
  testDir: 'tests/store',
  timeout: 180_000,
  workers: 1,
  reporter: 'list',
  use: { trace: 'retain-on-failure' },
});
