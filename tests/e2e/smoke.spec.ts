import { FAKE_WATCH_PAGE, expect, expectPlayable, test } from './fixtures';

test('overlay mounts over #movie_player and waits for the player', async ({ context }) => {
  await context.route('https://www.youtube.com/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: FAKE_WATCH_PAGE }),
  );
  const page = await context.newPage();
  await page.goto('https://www.youtube.com/watch?v=phasaTest01');

  const overlay = page.locator('#movie_player phasa-overlay [data-testid="phasa-overlay"]');
  await expect(overlay).toHaveAttribute('data-video-id', 'phasaTest01');
  // This page has no player API, so no video is ever reported.
  await expect(overlay).toHaveAttribute('data-status', 'idle');

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
  await expect(
    page.getByText('Open a video with Thai subtitles to see its transcript here.'),
  ).toBeVisible();
});

test('options page renders its sections', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await expect(page).toHaveTitle('Phasa settings');
  await expect(page.getByRole('heading', { level: 2 })).toHaveCount(3);
});

test('real watch page without Thai captions says so @network', async ({ context }) => {
  const page = await context.newPage();
  // "Me at the zoo" — stable, short, public, English/German captions only.
  await page.goto('https://www.youtube.com/watch?v=jNQXAC9IVRw');
  await expectPlayable(page);
  const overlay = page.locator('#movie_player phasa-overlay [data-testid="phasa-overlay"]');
  await expect(overlay).toBeAttached({ timeout: 20_000 });
  // The track list comes from the player response, which works under automation.
  await expect(overlay).toHaveAttribute('data-status', 'no-thai', { timeout: 20_000 });
});

test('real watch page with Thai captions is detected @network', async ({ context }) => {
  const page = await context.newPage();
  await page.goto('https://www.youtube.com/watch?v=iH31BMKBEdU');
  await expectPlayable(page);
  const overlay = page.locator('#movie_player phasa-overlay [data-testid="phasa-overlay"]');
  // Timedtext bodies are empty under automation (docs/spikes.md §1), so "ready" is not
  // reachable here; detection of the Thai track is.
  await expect(overlay).toHaveAttribute('data-status', /loading|ready|error/, { timeout: 20_000 });
});
