import type { Page } from '@playwright/test';
import { expect, test, youTubeTabId } from './fixtures';
import { PRESET_STICKY_LANGUAGE, THAI_CUES, routeFakeYouTube } from './fake-youtube';

const overlay = (page: Page) =>
  page.locator('#movie_player phasa-overlay [data-testid="phasa-overlay"]');

interface FakeState {
  setOptionCalls: unknown[];
  pageKeys: { KeyT: number; Space: number };
}

const fakeState = (page: Page) =>
  page.evaluate(() => (window as unknown as { __fakeYt: FakeState }).__fakeYt);

async function openWatch(page: Page, videoId = 'iH31BMKBEdU'): Promise<void> {
  await page.goto(`https://www.youtube.com/watch?v=${videoId}`);
  await page.waitForFunction(() => (document.querySelector('video')?.readyState ?? 0) >= 1);
}

async function seek(page: Page, seconds: number): Promise<void> {
  await page.evaluate(
    (s) =>
      new Promise<void>((resolve) => {
        const video = document.querySelector('video')!;
        video.addEventListener('seeked', () => resolve(), { once: true });
        video.currentTime = s;
      }),
    seconds,
  );
}

const currentTime = (page: Page) =>
  page.evaluate(() => document.querySelector('video')!.currentTime);

test.describe('captions and rendering', () => {
  test('loads Thai + English for a video with captions off and restores the caption state', async ({
    context,
  }, testInfo) => {
    const log = await routeFakeYouTube(context);
    const page = await context.newPage();
    await openWatch(page);

    await expect(overlay(page)).toHaveAttribute('data-status', 'ready');
    const loadMs = Number(await overlay(page).getAttribute('data-load-ms'));
    expect(loadMs).toBeGreaterThan(0);
    expect(loadMs).toBeLessThan(3000); // docs/plan.md §4.3

    await seek(page, 2.5);
    await expect(overlay(page).getByTestId('phasa-cue-thai')).toHaveText(THAI_CUES[1]!.text);
    await expect(overlay(page).getByTestId('phasa-cue-en')).toHaveText(
      "Hello, I have something I'd like to discuss today. To",
    );

    // Forced switch on, then off, and both caption keys exactly as before.
    expect((await fakeState(page)).setOptionCalls).toEqual([{ languageCode: 'th' }, {}]);
    const storage = await page.evaluate(() => [
      localStorage.getItem('yt-player-caption-sticky-language'),
      localStorage.getItem('yt-player-caption-persistence'),
    ]);
    expect(storage).toEqual([PRESET_STICKY_LANGUAGE, null]);

    // Native captions hidden while ours show; only PoToken requests carry our fetches.
    await expect(page.locator('#native-captions')).toBeHidden();
    await page
      .locator('#player-container')
      .screenshot({ path: testInfo.outputPath('overlay.png') });
    expect(log.some((entry) => entry.url.searchParams.get('tlang') === 'en' && entry.hasPot)).toBe(
      true,
    );
  });

  test("uses the player's own request when the user keeps captions on", async ({ context }) => {
    await routeFakeYouTube(context, { captionsOn: true });
    const page = await context.newPage();
    await openWatch(page);
    await expect(overlay(page)).toHaveAttribute('data-status', 'ready');
    expect((await fakeState(page)).setOptionCalls).toEqual([]);
    expect(Number(await overlay(page).getAttribute('data-load-ms'))).toBeLessThan(1500);
  });

  test('reopening a cached video does not touch the player or the network', async ({ context }) => {
    const log = await routeFakeYouTube(context);
    const page = await context.newPage();
    await openWatch(page);
    await expect(overlay(page)).toHaveAttribute('data-status', 'ready');
    const before = log.length;

    await page.reload();
    await expect(overlay(page)).toHaveAttribute('data-status', 'ready');
    expect((await fakeState(page)).setOptionCalls).toEqual([]);
    expect(log.length).toBe(before);
  });

  test('follows SPA navigation without a reload and shows "No Thai subtitles"', async ({
    context,
  }) => {
    await routeFakeYouTube(context);
    const page = await context.newPage();
    await openWatch(page);
    await expect(overlay(page)).toHaveAttribute('data-status', 'ready');
    await page.evaluate(() => ((window as unknown as { marker: number }).marker = 42));

    // To a video with a manual English track: the second line comes from it.
    await page.click('#next');
    await expect(overlay(page)).toHaveAttribute('data-video-id', 'uYEW8BeJ0zY');
    await expect(overlay(page)).toHaveAttribute('data-status', 'ready');
    await seek(page, 4.2);
    await expect(overlay(page).getByTestId('phasa-cue-en')).toHaveText('I’m Jing Babyjingko.');

    // To a video without Thai: grey status with the player controls, native captions untouched.
    await page.click('#no-thai');
    await expect(overlay(page)).toHaveAttribute('data-status', 'no-thai');
    await expect(overlay(page).getByTestId('phasa-subtitles')).toHaveCount(0);
    await expect(page.locator('#native-captions')).toBeVisible();
    await page.evaluate(() =>
      document.getElementById('movie_player')!.classList.remove('ytp-autohide'),
    );
    await expect(overlay(page).getByTestId('phasa-status')).toHaveText('No Thai subtitles');

    expect(await page.evaluate(() => (window as unknown as { marker: number }).marker)).toBe(42);
  });

  test('hotkeys move between cues, toggle the translation and play/pause, and stay out of YouTube', async ({
    context,
  }) => {
    await routeFakeYouTube(context);
    const page = await context.newPage();
    await openWatch(page);
    await expect(overlay(page)).toHaveAttribute('data-status', 'ready');
    await seek(page, 2.5);

    const start = (i: number) => THAI_CUES[i]!.startMs / 1000;
    await page.keyboard.press('d');
    await expect.poll(() => currentTime(page)).toBeCloseTo(start(2), 2);
    await page.keyboard.press('a');
    await expect.poll(() => currentTime(page)).toBeCloseTo(start(1), 2);
    await seek(page, 3.5);
    await page.keyboard.press('s');
    await expect.poll(() => currentTime(page)).toBeCloseTo(start(1), 2);

    await page.keyboard.press('t');
    await expect(overlay(page).getByTestId('phasa-cue-en')).toHaveCount(0);
    await page.keyboard.press('t');
    await expect(overlay(page).getByTestId('phasa-cue-en')).toBeVisible();

    await page.keyboard.press('Space');
    await expect
      .poll(() => page.evaluate(() => document.querySelector('video')!.paused))
      .toBe(false);
    await page.keyboard.press('Space');
    await expect
      .poll(() => page.evaluate(() => document.querySelector('video')!.paused))
      .toBe(true);

    // Consumed: YouTube's own T (theater) and Space handlers never saw them.
    expect((await fakeState(page)).pageKeys).toEqual({ KeyT: 0, Space: 0 });

    // Typing in a text field is left alone.
    await page.locator('#search').fill('');
    // Space/Space let the video run for a moment, so compare with the paused position.
    const before = await currentTime(page);
    await page.locator('#search').press('d');
    await expect(page.locator('#search')).toHaveValue('d');
    expect(await currentTime(page)).toBe(before);
  });

  test('switches cues within 100 ms of their start time', async ({ context }) => {
    await routeFakeYouTube(context);
    const page = await context.newPage();
    await openWatch(page);
    await expect(overlay(page)).toHaveAttribute('data-status', 'ready');
    await seek(page, 1.5);

    const starts = THAI_CUES.map((cue) => cue.startMs);
    const lags = await page.evaluate(async (cueStarts) => {
      const root = document.querySelector('phasa-overlay')!.shadowRoot!;
      const video = document.querySelector('video')!;
      const lags: number[] = [];
      const observer = new MutationObserver(() => {
        const index = root.querySelector<HTMLElement>('[data-testid="phasa-subtitles"]')?.dataset
          .index;
        if (index === undefined) return;
        lags.push(video.currentTime * 1000 - cueStarts[Number(index)]!);
      });
      observer.observe(root, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
      });
      await video.play();
      await new Promise((resolve) => setTimeout(resolve, 6000));
      video.pause();
      observer.disconnect();
      return lags;
    }, starts);

    // 1.5 s → 7.5 s crosses the starts at 2.08, 4.08 and 6.68 s.
    expect(lags.length).toBeGreaterThanOrEqual(3);
    for (const lag of lags) {
      expect(lag).toBeGreaterThanOrEqual(-1);
      expect(lag).toBeLessThan(100);
    }
  });

  test('keeps the overlay in fullscreen and scales subtitles with the player', async ({
    context,
  }) => {
    await routeFakeYouTube(context);
    const page = await context.newPage();
    await openWatch(page);
    await expect(overlay(page)).toHaveAttribute('data-status', 'ready');
    await seek(page, 2.5);
    const thai = overlay(page).getByTestId('phasa-cue-thai');
    const fontSize = () => thai.evaluate((el) => Number.parseFloat(getComputedStyle(el).fontSize));
    const small = await fontSize();

    // Theater mode: the player grows.
    await page.evaluate(() => {
      const container = document.getElementById('player-container')!;
      container.style.width = '1200px';
      container.style.height = '675px';
    });
    await expect.poll(fontSize).toBeGreaterThan(small);

    await page.click('#fullscreen');
    await expect
      .poll(() => page.evaluate(() => document.fullscreenElement?.id))
      .toBe('player-container');
    await expect(thai).toBeVisible();
    const box = await thai.boundingBox();
    const viewport = page.viewportSize()!;
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
    await page.evaluate(() => document.exitFullscreen());
  });

  test('auto-pause stops at the end of the line', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    await routeFakeYouTube(context);
    const page = await context.newPage();
    await openWatch(page);
    await expect(overlay(page)).toHaveAttribute('data-status', 'ready');

    // Turn it on from the side panel, which also tells the tab directly.
    const panel = await context.newPage();
    await panel.goto(
      `chrome-extension://${extensionId}/sidepanel.html?tab=${await youTubeTabId(serviceWorker)}`,
    );
    await panel.getByLabel('Pause after each line').check();

    await page.bringToFront();
    const cue = THAI_CUES[1]!;
    await seek(page, (cue.startMs + 100) / 1000);
    await page.evaluate(() => document.querySelector('video')!.play());
    await expect
      .poll(() => page.evaluate(() => document.querySelector('video')!.paused), { timeout: 5000 })
      .toBe(true);
    const stoppedAt = (await currentTime(page)) * 1000;
    expect(stoppedAt).toBeGreaterThan(cue.endMs - 250);
    expect(stoppedAt).toBeLessThanOrEqual(cue.endMs);
    await expect(overlay(page).getByTestId('phasa-cue-thai')).toHaveText(cue.text);
  });
});
