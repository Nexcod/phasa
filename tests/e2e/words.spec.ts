import type { Locator, Page } from '@playwright/test';
import { expect, test, youTubeTabId } from './fixtures';
import { THAI_CUES, routeFakeYouTube } from './fake-youtube';

const overlay = (page: Page) =>
  page.locator('#movie_player phasa-overlay [data-testid="phasa-overlay"]');

/** The word button for `thai` in the subtitle line. */
const word = (page: Page, thai: string): Locator =>
  overlay(page)
    .getByTestId('phasa-word')
    .filter({ has: page.locator('.phasa-word__thai', { hasText: new RegExp(`^${thai}$`) }) });

async function openCue(page: Page, seconds = 2.5): Promise<void> {
  await page.goto('https://www.youtube.com/watch?v=iH31BMKBEdU');
  await page.waitForFunction(() => (document.querySelector('video')?.readyState ?? 0) >= 1);
  await expect(overlay(page)).toHaveAttribute('data-status', 'ready');
  // The first video after install also loads the dictionary into IndexedDB.
  await expect(overlay(page)).toHaveAttribute('data-words', 'ready', { timeout: 30_000 });
  await page.evaluate(
    (s) =>
      new Promise<void>((resolve) => {
        const video = document.querySelector('video')!;
        video.addEventListener('seeked', () => resolve(), { once: true });
        video.currentTime = s;
      }),
    seconds,
  );
  await expect(overlay(page).getByTestId('phasa-subtitles')).toHaveAttribute('data-index', '1');
}

const paused = (page: Page) => page.evaluate(() => document.querySelector('video')!.paused);

test.describe('words', () => {
  test('a word opens its popup in under 100 ms and saves with its context', async ({
    context,
    extensionId,
    serviceWorker,
  }, testInfo) => {
    await routeFakeYouTube(context);
    const page = await context.newPage();
    await openCue(page);

    // The cue is split into words on grapheme boundaries: the text is unchanged.
    const line = overlay(page).getByTestId('phasa-cue-thai');
    await expect(line).toHaveText(THAI_CUES[1]!.text);
    await expect(overlay(page).getByTestId('phasa-word')).toHaveCount(10);
    await expect(word(page, 'เรื่อง')).toHaveAttribute('data-status', 'new');

    await word(page, 'เรื่อง').click();
    const popup = overlay(page).getByTestId('phasa-popup');
    await expect(popup).toBeVisible();
    await expect(popup).toHaveAttribute('data-open-ms', /^\d+$/);
    const openMs = Number(await popup.getAttribute('data-open-ms'));
    testInfo.annotations.push({ type: 'popup-open-ms', description: String(openMs) });
    expect(openMs).toBeLessThan(100);
    await expect(popup.getByTestId('phasa-popup-word')).toHaveText('เรื่อง');
    await expect(popup.locator('.phasa-popup__roman')).toHaveText('rʉ̂ʉang');
    await expect(popup.locator('.phasa-tone[data-tone="falling"]')).toHaveText('rʉ̂ʉang');
    await expect(popup.locator('.phasa-popup__senses')).toContainText('story');

    // Key 1 = learning 1; YouTube must not see it (digits seek there).
    await page.keyboard.press('1');
    await expect(popup.getByTestId('phasa-popup-status')).toHaveText('Learning 1');
    await expect(word(page, 'เรื่อง')).toHaveAttribute('data-status', 'learning-1');
    await page.keyboard.press('Escape');
    await expect(popup).toHaveCount(0);

    // Saved with its context: visible in the side panel …
    const panel = await context.newPage();
    await panel.goto(
      `chrome-extension://${extensionId}/sidepanel.html?tab=${await youTubeTabId(serviceWorker)}`,
    );
    await panel.getByTestId('phasa-tab-words').click();
    const saved = panel.getByTestId('phasa-saved-word').filter({ hasText: 'เรื่อง' });
    await expect(saved).toContainText('story');
    await expect(saved).toContainText(THAI_CUES[1]!.text);
    await expect(saved).toContainText("Hello, I have something I'd like to discuss today.");
    await expect(saved.getByRole('combobox')).toHaveValue('1');

    // … and in the options page.
    const options = await context.newPage();
    await options.goto(`chrome-extension://${extensionId}/options.html`);
    const listed = options
      .getByTestId('phasa-options-words')
      .getByTestId('phasa-saved-word')
      .filter({ hasText: 'เรื่อง' });
    await expect(listed).toContainText(THAI_CUES[1]!.text);
    await expect(listed).toContainText('Open at 0:02');

    // A change in the list reaches the overlay.
    await listed.getByRole('combobox').selectOption('known');
    await expect(word(page, 'เรื่อง')).toHaveAttribute('data-status', 'known');
  });

  test('opening a word pauses playback and closing it resumes', async ({ context }) => {
    await routeFakeYouTube(context);
    const page = await context.newPage();
    await openCue(page, 2.2);
    await page.evaluate(() => document.querySelector('video')!.play());
    await word(page, 'คุย').click();
    await expect(overlay(page).getByTestId('phasa-popup')).toBeVisible();
    expect(await paused(page)).toBe(true);
    // A click on the video only closes it: the player must not also toggle (it would pause again).
    await page.mouse.click(5, 5);
    await expect(overlay(page).getByTestId('phasa-popup')).toHaveCount(0);
    await expect.poll(() => paused(page)).toBe(false);
    await page.waitForTimeout(500);
    expect(await paused(page)).toBe(false);
  });

  test('a click outside the player closes the popup, resumes and still reaches the page', async ({
    context,
  }) => {
    await routeFakeYouTube(context);
    const page = await context.newPage();
    await openCue(page, 2.2);
    await page.evaluate(() => document.querySelector('video')!.play());
    await word(page, 'คุย').click();
    await expect(overlay(page).getByTestId('phasa-popup')).toBeVisible();
    await page.locator('#search').click();
    await expect(overlay(page).getByTestId('phasa-popup')).toHaveCount(0);
    await expect(page.locator('#search')).toBeFocused();
    await expect.poll(() => paused(page)).toBe(false);
  });

  test('with "pause when I open a word" off, a click on the video keeps it playing', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    await routeFakeYouTube(context);
    const page = await context.newPage();
    await openCue(page, 2.2);
    const panel = await context.newPage();
    await panel.goto(
      `chrome-extension://${extensionId}/sidepanel.html?tab=${await youTubeTabId(serviceWorker)}`,
    );
    await panel.getByLabel('Pause when I open a word').uncheck();
    await page.bringToFront();
    await page.evaluate(() => document.querySelector('video')!.play());
    await word(page, 'คุย').click();
    await expect(overlay(page).getByTestId('phasa-popup')).toBeVisible();
    expect(await paused(page)).toBe(false);
    await page.mouse.click(5, 5);
    await expect(overlay(page).getByTestId('phasa-popup')).toHaveCount(0);
    await page.waitForTimeout(500);
    expect(await paused(page)).toBe(false);
  });

  test('R shows romanization with tone colors', async ({ context }) => {
    await routeFakeYouTube(context);
    const page = await context.newPage();
    await openCue(page);
    await expect(overlay(page).locator('.phasa-word__roman')).toHaveCount(0);
    await page.keyboard.press('r');
    const roman = word(page, 'อยาก').locator('.phasa-word__roman');
    await expect(roman).toHaveText('yàak');
    await expect(roman.locator('.phasa-tone')).toHaveAttribute('data-tone', 'low');
  });

  test('a selection over several words becomes a phrase that can be made one word', async ({
    context,
  }) => {
    await routeFakeYouTube(context);
    const page = await context.newPage();
    await openCue(page);

    const from = await word(page, 'อยาก').boundingBox();
    const to = await word(page, 'จะ').boundingBox();
    if (!from || !to) throw new Error('words not laid out');
    await page.mouse.move(from.x + 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + to.width - 2, to.y + to.height / 2, { steps: 5 });
    await page.mouse.up();

    const phrase = overlay(page).getByTestId('phasa-phrase-popup');
    await expect(phrase.getByTestId('phasa-popup-word')).toHaveText('อยากจะ');
    await expect(phrase).toContainText('to want');
    await phrase.getByRole('button', { name: 'Make it one word' }).click();

    // The user's merge rule overrides the convention (อยาก|จะ) everywhere.
    await expect(word(page, 'อยากจะ')).toHaveCount(1);
    await expect(overlay(page).getByTestId('phasa-word')).toHaveCount(9);
  });
});
