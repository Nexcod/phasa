import { defineConfig } from '@playwright/test';

// Tests tagged @network hit real youtube.com and run locally before a phase is accepted: YouTube
// shows CI runners a bot check (docs/decisions/0009-network-e2e-runs-locally.md). Everything else
// stubs YouTube and runs offline, also in CI.
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { trace: 'retain-on-failure' },
});
