import { expect, test, youTubeTabId } from './fixtures';
import { THAI_CUES, routeFakeYouTube } from './fake-youtube';

test.describe('side panel', () => {
  test('shows the transcript, follows the playing line and seeks on click', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    await routeFakeYouTube(context);
    const page = await context.newPage();
    await page.goto('https://www.youtube.com/watch?v=iH31BMKBEdU');
    await page.waitForFunction(() => (document.querySelector('video')?.readyState ?? 0) >= 1);
    const overlay = page.locator('#movie_player phasa-overlay [data-testid="phasa-overlay"]');
    await expect(overlay).toHaveAttribute('data-status', 'ready');

    const panel = await context.newPage();
    await panel.goto(
      `chrome-extension://${extensionId}/sidepanel.html?tab=${await youTubeTabId(serviceWorker)}`,
    );
    await expect(panel.getByRole('heading', { level: 2 })).toHaveText(
      'ฝรั่งคิดยังไงกับภาษาไทย? เปิดใจเผยความคิดลึกๆ',
    );
    await expect(panel.getByText('Auto-generated captions — may contain errors')).toBeVisible();
    const rows = panel.getByTestId('phasa-transcript').locator('li');
    await expect(rows).toHaveCount(THAI_CUES.length);
    await expect(rows.nth(1)).toContainText(THAI_CUES[1]!.text);
    await expect(rows.nth(1)).toContainText(
      "Hello, I have something I'd like to discuss today. To",
    );

    // The playing line is highlighted.
    await page.evaluate(() => (document.querySelector('video')!.currentTime = 2.5));
    await expect(rows.nth(1)).toHaveAttribute('aria-current', 'true');

    // A click seeks the video to the start of the line.
    await rows.nth(3).getByRole('button').click();
    await expect
      .poll(() => page.evaluate(() => document.querySelector('video')!.currentTime))
      .toBeCloseTo(THAI_CUES[3]!.startMs / 1000, 2);
    await expect(rows.nth(3)).toHaveAttribute('aria-current', 'true');

    // The translation toggle hides the English lines in the panel and the overlay.
    await panel.getByLabel('English translation (T)').uncheck();
    await expect(rows.nth(1)).not.toContainText('Hello');
    await expect(overlay.getByTestId('phasa-cue-en')).toHaveCount(0);
  });

  test('shows an empty state for tabs without a video', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    await routeFakeYouTube(context);
    const page = await context.newPage();
    await page.goto('https://www.youtube.com/watch?v=jNQXAC9IVRw');
    const panel = await context.newPage();
    await panel.goto(
      `chrome-extension://${extensionId}/sidepanel.html?tab=${await youTubeTabId(serviceWorker)}`,
    );
    await expect(panel.getByText('No Thai subtitles')).toBeVisible();

    await page.goto('https://www.youtube.com/');
    await expect(
      panel.getByText('Open a video with Thai subtitles to see its transcript here.'),
    ).toBeVisible();
  });
});
