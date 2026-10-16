import { defineConfig } from '@playwright/test';

// Tests tagged @network hit real youtube.com and run on a schedule, not per PR
// (docs/plan.md §13). Everything else stubs YouTube and runs offline.
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { trace: 'retain-on-failure' },
});
