import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test, youTubeTabId } from './fixtures';
import { LONG_VIDEO_ID, routeFakeYouTube } from './fake-youtube';

const overlay = (page: Page) =>
  page.locator('#movie_player phasa-overlay [data-testid="phasa-overlay"]');
const titleBadge = (page: Page) => page.locator('phasa-badge [data-testid="phasa-title-badge"]');
const badgeButton = (page: Page) => titleBadge(page).getByTestId('phasa-analysis-badge');

const BADGE_TEXT = /^(?:[ABC][12])?(\d+)% known · (\d+) new words?[▾▴]$/;

async function knownPercent(page: Page): Promise<number> {
  const text = (await badgeButton(page).textContent()) ?? '';
  const match = BADGE_TEXT.exec(text);
  if (!match) throw new Error(`unexpected badge: ${text}`);
  return Number(match[1]);
}

async function openVideo(page: Page, videoId = 'iH31BMKBEdU'): Promise<void> {
  await page.goto(`https://www.youtube.com/watch?v=${videoId}`);
  await expect(overlay(page)).toHaveAttribute('data-status', 'ready');
  // The first video after install also loads the dictionary into IndexedDB.
  await expect(titleBadge(page).getByTestId('phasa-analysis')).toHaveAttribute(
    'data-state',
    'ready',
    { timeout: 30_000 },
  );
}

/** The 500 most frequent words, as an imported list (data/build/freq.json). */
function frequentWords(count: number): string[] {
  const file = JSON.parse(
    readFileSync(join(import.meta.dirname, '../../data/build/freq.json'), 'utf8'),
  ) as { words: string[] };
  return file.words.slice(0, count);
}

test.describe('video analysis', () => {
  test('the badge under the title counts known and new words and follows status changes', async ({
    context,
  }) => {
    await routeFakeYouTube(context);
    const page = await context.newPage();
    await openVideo(page);

    await expect(badgeButton(page)).toHaveText(BADGE_TEXT);
    expect(await knownPercent(page)).toBe(0);
    const [, , newWords] = BADGE_TEXT.exec((await badgeButton(page).textContent()) ?? '')!;

    // A word marked known in the subtitles counts at once.
    await expect(overlay(page)).toHaveAttribute('data-words', 'ready', { timeout: 30_000 });
    await page.evaluate(() => (document.querySelector('video')!.currentTime = 2.5));
    const word = overlay(page)
      .getByTestId('phasa-word')
      .filter({ has: page.locator('.phasa-word__thai', { hasText: /^ครับ$/ }) })
      .first();
    await word.click();
    await page.keyboard.press('k');
    await expect.poll(() => knownPercent(page)).toBeGreaterThan(0);

    // Details: distribution, top new words, adding the top 10 to learning.
    await badgeButton(page).click();
    const details = titleBadge(page).getByTestId('phasa-analysis-details');
    await expect(details).toContainText('Too hard for now');
    await expect(details.getByTestId('phasa-analysis-legend')).toContainText('Known 1');
    // The badge counts distinct words, like the legend; occurrences have their own line.
    await expect(details.getByTestId('phasa-analysis-legend')).toContainText(
      `New ${Number(newWords) - 1}`,
    );
    await expect(details).toContainText(
      /Occurrences of new words: \d+ — \d+% of what you will hear\./,
    );
    const top = details.getByTestId('phasa-analysis-word');
    await expect(top.first()).toBeVisible();
    const firstTop = await top.first().getAttribute('data-thai');
    await details.getByRole('button', { name: 'Add top 10 to learning' }).click();
    await expect(details.getByTestId('phasa-analysis-legend')).toContainText('Learning 10');
    await expect(
      overlay(page)
        .getByTestId('phasa-word')
        .filter({
          has: page.locator('.phasa-word__thai', { hasText: new RegExp(`^${firstTop}$`) }),
        })
        .first(),
    ).toHaveAttribute('data-status', 'learning-1');

    // Mark the rest known, after a confirmation.
    await details.getByRole('button', { name: /^Mark all new words as known \(\d+\)$/ }).click();
    const confirm = details.getByTestId('phasa-analysis-confirm');
    await expect(confirm).toContainText('Words you are learning stay as they are.');
    await confirm.getByRole('button', { name: 'Mark as known' }).click();
    await expect(badgeButton(page)).toContainText('· 0 new words');
    await expect(details).toContainText('No new words left in this video.');
    await expect(details.getByTestId('phasa-analysis-legend')).toContainText('Learning 10');
  });

  test('a video without Thai subtitles gets a grey badge', async ({ context }) => {
    await routeFakeYouTube(context);
    const page = await context.newPage();
    await page.goto('https://www.youtube.com/watch?v=jNQXAC9IVRw');
    await expect(titleBadge(page)).toHaveText('No Thai subtitles');
  });

  test('a 20-minute video is analyzed in under 500 ms', async ({ context }, testInfo) => {
    await routeFakeYouTube(context);
    const page = await context.newPage();
    await openVideo(page, LONG_VIDEO_ID);
    const analysis = titleBadge(page).getByTestId('phasa-analysis');
    const coldMs = Number(await analysis.getAttribute('data-analysis-ms'));
    await badgeButton(page).click();
    const words = await titleBadge(page)
      .getByTestId('phasa-analysis-legend')
      .locator('[data-status="new"]')
      .textContent();
    testInfo.annotations.push({ type: 'analysis-ms (cold)', description: String(coldMs) });
    testInfo.annotations.push({ type: 'distinct new words', description: words ?? '' });
    expect(coldMs).toBeLessThan(500);

    // A status change re-applies statuses to the cached profile.
    await titleBadge(page)
      .getByTestId('phasa-analysis-word')
      .first()
      .getByRole('button', { name: 'Known' })
      .click();
    await expect.poll(() => knownPercent(page)).toBeGreaterThan(0);
    const warmMs = Number(await analysis.getAttribute('data-analysis-ms'));
    testInfo.annotations.push({ type: 'analysis-ms (warm)', description: String(warmMs) });
    expect(warmMs).toBeLessThan(500);
  });

  test('the side panel shows the analysis and filters lines with new words', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    await routeFakeYouTube(context);
    const page = await context.newPage();
    await openVideo(page);
    const panel = await context.newPage();
    await panel.goto(
      `chrome-extension://${extensionId}/sidepanel.html?tab=${await youTubeTabId(serviceWorker)}`,
    );
    const card = panel.getByTestId('phasa-panel-analysis');
    await expect(card.getByTestId('phasa-analysis-badge')).toHaveText(BADGE_TEXT);
    const rows = panel.getByTestId('phasa-transcript').locator('li');
    const all = await rows.count();

    await panel.getByLabel('Only lines with new words').check();
    await expect(rows).toHaveCount(all); // every line of a fresh video has new words

    await card.getByTestId('phasa-analysis-badge').click();
    await card.getByRole('button', { name: /^Mark all new words as known \(\d+\)$/ }).click();
    await card.getByRole('button', { name: 'Mark as known' }).click();
    await expect(panel.getByText('No line has a new word.')).toBeVisible();
    // The page's badge heard it too.
    await expect(badgeButton(page)).toContainText('100% known · 0 new words');
  });
});

test.describe('known words onboarding', () => {
  test('importing 500 words updates the coverage of the open video at once', async ({
    context,
    extensionId,
  }, testInfo) => {
    await routeFakeYouTube(context);
    const page = await context.newPage();
    await openVideo(page);
    expect(await knownPercent(page)).toBe(0);

    const options = await context.newPage();
    await options.goto(`chrome-extension://${extensionId}/options.html`);
    const importer = options.getByTestId('phasa-known-import');
    await importer
      .getByLabel('…or paste the words here, one per line')
      .fill(frequentWords(500).join('\n'));
    await expect(importer).toContainText('Entries with Thai: 500 · skipped lines without Thai: 0');
    const started = Date.now();
    await importer.getByRole('button', { name: 'Mark them as known' }).click();
    await expect(importer).toContainText(/Marked as known: \d+/);
    await expect(options.getByTestId('phasa-known-counts')).toContainText(/Known: [1-9]\d\d/);

    // The YouTube tab, in the background, follows without a reload.
    await expect.poll(() => knownPercent(page), { intervals: [50] }).toBeGreaterThan(30);
    const ms = Date.now() - started;
    testInfo.annotations.push({ type: 'import-to-badge-ms', description: String(ms) });
    expect(ms).toBeLessThan(2000);
  });

  test('the most frequent words are reviewed, unticked and marked known', async ({
    context,
    extensionId,
  }) => {
    const options = await context.newPage();
    await options.goto(`chrome-extension://${extensionId}/options.html`);
    const top = options.getByTestId('phasa-known-top');
    await top.getByLabel('Most frequent words:').selectOption('100');
    await top.getByRole('button', { name: 'Review the list' }).click();
    const list = top.getByTestId('phasa-known-list').locator('li');
    await expect(list).toHaveCount(100, { timeout: 30_000 });
    await expect(list.first()).toContainText('ที่');
    await list.nth(1).getByRole('checkbox').uncheck();
    await expect(top).toContainText('99 of 100 selected');
    await top.getByRole('button', { name: 'Mark as known (99)' }).click();
    await expect(top).toContainText('Marked as known: 99');
    await expect(options.getByTestId('phasa-known-counts')).toContainText('Known: 99');

    // Reviewing again shows them as saved.
    await top.getByRole('button', { name: 'Review the list' }).click();
    await expect(list.first()).toContainText('Known');
    await expect(top).toContainText('1 of 100 selected');

    // The particles button skips what is known already.
    const particles = options.getByTestId('phasa-known-particles');
    await particles.getByRole('button', { name: /^Mark these \d+ particles as known$/ }).click();
    await expect(particles).toContainText(/Marked as known: \d+/);
  });
});
