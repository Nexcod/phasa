import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { expect, extensionIdOf, launchWithExtension, test, youTubeTabId } from './fixtures';
import { LONG_VIDEO_ID, routeFakeYouTube } from './fake-youtube';

const overlay = (page: Page) =>
  page.locator('#movie_player phasa-overlay [data-testid="phasa-overlay"]');

const word = (page: Page, thai: string): Locator =>
  overlay(page)
    .getByTestId('phasa-word')
    .filter({ has: page.locator('.phasa-word__thai', { hasText: new RegExp(`^${thai}$`) }) });

/** Opens the fake video at its second line, with words clickable. */
async function openCue(page: Page): Promise<void> {
  await page.goto('https://www.youtube.com/watch?v=iH31BMKBEdU');
  await page.waitForFunction(() => (document.querySelector('video')?.readyState ?? 0) >= 1);
  await expect(overlay(page)).toHaveAttribute('data-status', 'ready');
  // The first video after install also loads the dictionary into IndexedDB.
  await expect(overlay(page)).toHaveAttribute('data-words', 'ready', { timeout: 30_000 });
  await page.evaluate(() => (document.querySelector('video')!.currentTime = 2.5));
  await expect(overlay(page).getByTestId('phasa-subtitles')).toHaveAttribute('data-index', '1');
}

/** Saves เรื่อง as learning 2 with its line, from the subtitles. */
async function saveWord(page: Page): Promise<void> {
  await word(page, 'เรื่อง').click();
  await page.keyboard.press('2');
  await expect(word(page, 'เรื่อง')).toHaveAttribute('data-status', 'learning-2');
  await page.keyboard.press('Escape');
}

async function download(page: Page, button: Locator, dir: (name: string) => string) {
  const started = page.waitForEvent('download');
  await button.click();
  const file = await started;
  const path = dir(file.suggestedFilename());
  await file.saveAs(path);
  return { name: file.suggestedFilename(), text: await readFile(path, 'utf8'), path };
}

interface BackupJson {
  exportedAt: string;
  words: { thai: string; status: unknown; contexts: { videoId: string }[] }[];
  [key: string]: unknown;
}

test.describe('import and export', () => {
  test('a backup restores everything after a fresh install', async ({
    context,
    extensionId,
  }, testInfo) => {
    // Two installs, each loading the dictionary once.
    test.setTimeout(90_000);
    await routeFakeYouTube(context);
    const page = await context.newPage();
    await openCue(page);
    await saveWord(page);

    const options = await context.newPage();
    await options.goto(`chrome-extension://${extensionId}/options.html`);
    const particles = options.getByTestId('phasa-known-particles');
    await particles.getByRole('button', { name: /^Mark these \d+ particles as known$/ }).click();
    await expect(particles).toContainText(/Marked as known: \d+/);
    const settings = options.getByTestId('phasa-options-settings');
    await settings.getByLabel('Dark', { exact: true }).check();
    await settings.getByTestId('phasa-pref-subtitle-size').fill('150');
    await expect(options.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(overlay(page)).toHaveAttribute('style', /--phasa-subs-scale: 1\.5/);
    const counts = (await options.getByTestId('phasa-known-counts').textContent()) ?? '';
    expect(counts).toMatch(/^Known: [1-9]\d* · learning: 1 · ignored: 0$/);

    const exported = await download(
      options,
      options.getByTestId('phasa-data-export').getByRole('button', { name: 'Download backup' }),
      (name) => testInfo.outputPath(name),
    );
    expect(exported.name).toMatch(/^phasa-backup-\d{4}-\d{2}-\d{2}\.json$/);
    await expect(options.getByTestId('phasa-data-export')).toContainText(
      `Saved ${exported.name} · words:`,
    );
    const backup = JSON.parse(exported.text) as BackupJson;
    expect(backup.words.find((unit) => unit.thai === 'เรื่อง')).toMatchObject({
      status: 2,
      contexts: [{ videoId: 'iH31BMKBEdU' }],
    });
    // No credentials (ADR 0014): this test signs in to nothing, so the check is about the shape.
    expect(Object.keys(backup)).not.toContain('credentials');
    expect(exported.text).not.toMatch(/refresh_?token|access_?token|id_?token|"sk-/i);

    const fresh = await launchWithExtension();
    try {
      await routeFakeYouTube(fresh);
      const id = await extensionIdOf(fresh);
      const target = await fresh.newPage();
      await target.goto(`chrome-extension://${id}/options.html#data`);
      await expect(target.getByTestId('phasa-known-counts')).toHaveText(
        'Known: 0 · learning: 0 · ignored: 0',
      );
      const restore = target.getByTestId('phasa-data-restore');
      await restore.getByLabel('Backup file').setInputFiles(exported.path);
      await expect(restore.getByTestId('phasa-data-preview')).toContainText(
        /Words: \d+ · phrases: 0 · lines: 1 · word-boundary fixes: 0 · analyzed videos: 1/,
      );
      await restore.getByRole('button', { name: 'Restore' }).click();
      await expect(restore.getByTestId('phasa-data-restored')).toContainText('Restored.');
      await expect(target.getByTestId('phasa-known-counts')).toHaveText(counts);
      await expect(target.locator('html')).toHaveAttribute('data-theme', 'dark');

      // Exported again, the restored install gives the same backup.
      const again = await download(
        target,
        target.getByTestId('phasa-data-export').getByRole('button', { name: 'Download backup' }),
        (name) => testInfo.outputPath(`again-${name}`),
      );
      const restored = JSON.parse(again.text) as BackupJson;
      expect({ ...restored, exportedAt: '' }).toEqual({ ...backup, exportedAt: '' });

      // The video shows the word as learning 2, at the restored subtitle size.
      const video = await fresh.newPage();
      await openCue(video);
      await expect(word(video, 'เรื่อง')).toHaveAttribute('data-status', 'learning-2');
      await expect(overlay(video)).toHaveAttribute('style', /--phasa-subs-scale: 1\.5/);

      // The same file again adds nothing.
      await restore.getByLabel('Backup file').setInputFiles(exported.path);
      await restore.getByRole('button', { name: 'Restore' }).click();
      await expect(restore.getByTestId('phasa-data-restored')).toContainText(
        /Words: 0 added, 0 merged, \d+ already here/,
      );
    } finally {
      await fresh.close();
    }
  });

  test('a file that is not a backup is refused', async ({ context, extensionId }, testInfo) => {
    const options = await context.newPage();
    await options.goto(`chrome-extension://${extensionId}/options.html#data`);
    const restore = options.getByTestId('phasa-data-restore');
    const path = testInfo.outputPath('words.json');
    await import('node:fs/promises').then((fs) => fs.writeFile(path, '{"words":["ภาษา"]}'));
    await restore.getByLabel('Backup file').setInputFiles(path);
    await expect(restore).toContainText("This file isn't a Phasa backup.");
    await expect(restore.getByRole('button', { name: 'Restore' })).toHaveCount(0);
  });

  test('saved words export for Anki and as CSV', async ({ context, extensionId }, testInfo) => {
    await routeFakeYouTube(context);
    const options = await context.newPage();
    await options.goto(`chrome-extension://${extensionId}/options.html#data`);
    const words = options.getByTestId('phasa-data-words');
    // Nothing saved yet.
    await words.getByRole('button', { name: 'Export for Anki' }).click();
    await expect(words).toContainText('No saved words match this choice.');

    const page = await context.newPage();
    await openCue(page);
    await saveWord(page);

    const anki = await download(
      options,
      words.getByRole('button', { name: 'Export for Anki' }),
      (name) => testInfo.outputPath(name),
    );
    expect(anki.name).toMatch(/^phasa-anki-\d{4}-\d{2}-\d{2}\.txt$/);
    const lines = anki.text.trimEnd().split('\n');
    expect(lines.slice(0, 2)).toEqual(['#separator:tab', '#html:true']);
    const fields = lines[4]?.split('\t') ?? [];
    expect(fields[0]).toBe('เรื่อง');
    expect(fields[1]).toBe('rʉ̂ʉang');
    expect(fields[2]).toContain('story');
    expect(fields[3]).toContain('<b>เรื่อง</b>');
    expect(fields[5]).toMatch(
      /^<a href="https:\/\/www\.youtube\.com\/watch\?v=iH31BMKBEdU&amp;t=2s">/,
    );
    expect(fields[6]).toBe('phasa phasa::learning-2');
    await expect(words).toContainText(`Saved ${anki.name} · entries: 1`);

    const csv = await download(
      options,
      words.getByRole('button', { name: 'Export as CSV' }),
      (name) => testInfo.outputPath(name),
    );
    expect(csv.text.startsWith('﻿Thai,Romanization,Meaning,Status,')).toBe(true);
    expect(csv.text).toContain('เรื่อง,rʉ̂ʉang,');
    expect(csv.text).toContain(',learning-2,word,');
  });
});

test.describe('settings', () => {
  test('appearance settings apply to the open video at once', async ({ context, extensionId }) => {
    await routeFakeYouTube(context);
    const page = await context.newPage();
    await openCue(page);
    const thai = overlay(page).getByTestId('phasa-cue-thai');
    const fontSize = () => thai.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    const before = await fontSize();

    const options = await context.newPage();
    await options.goto(`chrome-extension://${extensionId}/options.html#settings`);
    const settings = options.getByTestId('phasa-options-settings');

    await settings.getByLabel(/^Noto Sans Thai: without loops/).check();
    await expect(overlay(page)).toHaveAttribute(
      'style',
      /--phasa-font-thai: 'Phasa Noto Sans Thai', 'Phasa Noto Sans Thai Looped'/,
    );
    await expect
      .poll(() => thai.evaluate((el) => getComputedStyle(el).fontFamily))
      .toMatch(/^"Phasa Noto Sans Thai", "Phasa Noto Sans Thai Looped"/);

    await settings.getByTestId('phasa-pref-subtitle-size').fill('200');
    await expect.poll(fontSize).toBeGreaterThan(before * 1.5);

    await settings.getByTestId('phasa-pref-tone-mid').fill('#ff0000');
    await expect(overlay(page)).toHaveAttribute('style', /--phasa-tone-mid: #ff0000/);
    await expect(options.locator('html')).toHaveAttribute('style', /--phasa-tone-mid: #ff0000/);
    // Only that tone: the others keep the colors made for each background.
    await expect(overlay(page)).not.toHaveAttribute('style', /--phasa-tone-low/);
    await settings.getByRole('button', { name: 'Use the default colors' }).click();
    await expect(overlay(page)).not.toHaveAttribute('style', /--phasa-tone-mid/);

    await settings.getByLabel('Light', { exact: true }).check();
    await expect(options.locator('html')).toHaveAttribute('data-theme', 'light');
    await settings.getByLabel('Same as the system').check();
    await expect(options.locator('html')).not.toHaveAttribute('data-theme', /./);
  });

  test('the toolbar popup shows the video and changes quick settings', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    await routeFakeYouTube(context);
    const page = await context.newPage();
    await openCue(page);
    await expect(overlay(page).getByTestId('phasa-cue-en')).toBeVisible();

    const popup = await context.newPage();
    await popup.goto(
      `chrome-extension://${extensionId}/popup.html?tab=${await youTubeTabId(serviceWorker)}`,
    );
    const video = popup.getByTestId('phasa-popup-video');
    await expect(video).toHaveAttribute('data-state', 'ready');
    await expect(video).toContainText('ฝรั่งคิดยังไงกับภาษาไทย');
    await expect(video.getByTestId('phasa-analysis-badge')).toContainText(/% known/);
    await expect(popup.getByTestId('phasa-popup-open-panel')).toBeEnabled();
    await expect(popup.getByTestId('phasa-popup-ai')).toContainText('AI explanations are off.');

    await popup.getByLabel('English translation (T)').uncheck();
    await expect(overlay(page).getByTestId('phasa-cue-en')).toHaveCount(0);
    await popup.getByLabel('Romanization (R)').check();
    await expect(overlay(page).getByTestId('phasa-cue-thai')).toHaveAttribute(
      'data-romanization',
      'above',
    );
  });
});

/** The N most frequent words of the packaged list (data/build/freq.json). */
function frequentWords(count: number): string[] {
  const file = JSON.parse(
    readFileSync(join(import.meta.dirname, '../../data/build/freq.json'), 'utf8'),
  ) as { words: string[] };
  return file.words.slice(0, count);
}

test.describe('performance', () => {
  test('with 20 000 known words a 20-minute video is still analyzed in under 500 ms', async ({
    context,
    extensionId,
  }, testInfo) => {
    test.setTimeout(180_000);
    await routeFakeYouTube(context);
    const options = await context.newPage();
    await options.goto(`chrome-extension://${extensionId}/options.html`);
    const importer = options.getByTestId('phasa-known-import');
    await importer.getByLabel('Word list file').setInputFiles({
      name: 'words.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from(frequentWords(20_000).join('\n')),
    });
    await expect(importer).toContainText('Entries with Thai: 20000');
    const started = Date.now();
    await importer.getByRole('button', { name: 'Mark them as known' }).click();
    await expect(importer).toContainText(/Marked as known: \d{5}/, { timeout: 120_000 });
    testInfo.annotations.push({
      type: 'import-20000-ms',
      description: String(Date.now() - started),
    });

    // The word list shows its first page without reading every word.
    const listed = Date.now();
    await options.reload();
    await expect(options.getByTestId('phasa-saved-word').first()).toBeVisible();
    await expect(options.getByTestId('phasa-options-words')).toContainText(/\d{5} saved/);
    testInfo.annotations.push({ type: 'list-ms', description: String(Date.now() - listed) });

    const page = await context.newPage();
    await page.goto(`https://www.youtube.com/watch?v=${LONG_VIDEO_ID}`);
    const analysis = page.locator('phasa-badge [data-testid="phasa-analysis"]');
    await expect(analysis).toHaveAttribute('data-state', 'ready', { timeout: 30_000 });
    const ms = Number(await analysis.getAttribute('data-analysis-ms'));
    testInfo.annotations.push({ type: 'analysis-ms (20 000 known)', description: String(ms) });
    expect(ms).toBeLessThan(500);
  });
});

test.describe('error states', () => {
  test('a tab cut off by an extension update says so', async ({ context, serviceWorker }) => {
    await routeFakeYouTube(context);
    const page = await context.newPage();
    await openCue(page);
    // What an update does to open tabs: the old content script loses the extension. (Under
    // --load-extension the reloaded extension doesn't come back, so the new subtitles after the
    // page reload are a manual check.)
    await serviceWorker.evaluate(() => {
      (
        globalThis as unknown as { chrome: { runtime: { reload(): void } } }
      ).chrome.runtime.reload();
    });
    const notice = page.locator('[data-phasa-reload-notice]');
    await expect(notice).toContainText('Phasa was updated. Reload the page', { timeout: 10_000 });
    await expect(page.locator('[data-testid="phasa-overlay"]')).toHaveCount(0);
    // Its clicks don't reach the player.
    const paused = await page.evaluate(() => document.querySelector('video')!.paused);
    await notice.getByRole('button', { name: '×' }).click();
    await expect(notice).toHaveCount(0);
    expect(await page.evaluate(() => document.querySelector('video')!.paused)).toBe(paused);
  });
});
