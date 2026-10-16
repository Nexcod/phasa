import { FAKE_WATCH_PAGE, expect, test } from './fixtures';

test('overlay mounts over #movie_player and reaches the service worker', async ({ context }) => {
  await context.route('https://www.youtube.com/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: FAKE_WATCH_PAGE }),
  );
  const page = await context.newPage();
  await page.goto('https://www.youtube.com/watch?v=phasaTest01');

  const overlay = page.locator('#movie_player phasa-overlay [data-testid="phasa-overlay"]');
  await expect(overlay).toHaveAttribute('data-video-id', 'phasaTest01');
  await expect(overlay.getByTestId('phasa-status')).toHaveAttribute('data-state', 'connected');

  // The MAIN-world script ran at document_start.
  await expect(page.locator('html')).toHaveAttribute('data-phasa-main', 'ready');

  // The layer must not swallow clicks meant for the player.
  const pointerEvents = await overlay.evaluate((el) => getComputedStyle(el).pointerEvents);
  expect(pointerEvents).toBe('none');
});

test('overlay stays hidden outside /watch', async ({ context }) => {
  await context.route('https://www.youtube.com/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: FAKE_WATCH_PAGE }),
  );
  const page = await context.newPage();
  await page.goto('https://www.youtube.com/');
  await expect(page.locator('#movie_player phasa-overlay')).toBeAttached();
  await expect(page.locator('[data-testid="phasa-overlay"]')).toHaveCount(0);
});

test('side panel page connects to the service worker and the database', async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await expect(page.getByRole('heading', { name: 'Phasa' })).toBeVisible();
  await expect(page.getByTestId('phasa-status')).toHaveAttribute('data-state', 'connected');
  await expect(page.getByTestId('phasa-status')).toHaveText('Connected · database v1');
});

test('options page renders its sections', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await expect(page).toHaveTitle('Phasa settings');
  await expect(page.getByRole('heading', { level: 2 })).toHaveCount(3);
});

test('real watch page gets the overlay @network', async ({ context }) => {
  const page = await context.newPage();
  // "Me at the zoo" — stable, short, public. Thai-caption videos live in tests/e2e/videos.ts.
  await page.goto('https://www.youtube.com/watch?v=jNQXAC9IVRw');
  const overlay = page.locator('#movie_player phasa-overlay [data-testid="phasa-overlay"]');
  await expect(overlay).toBeAttached({ timeout: 20_000 });
  await expect(overlay.getByTestId('phasa-status')).toHaveAttribute('data-state', 'connected');
});
