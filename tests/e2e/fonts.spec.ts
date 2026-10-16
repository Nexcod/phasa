import { expect, test } from './fixtures';
import { routeFakeYouTube } from './fake-youtube';

interface FontsReport {
  ok: boolean;
  loaded: Record<string, boolean>;
  checks: { family: string; size: number; roomAbovePx: number; roomBelowPx: number; ok: boolean }[];
}

test('fonts test page: bundled fonts load and no stacked mark leaves the line box', async ({
  context,
  extensionId,
}, testInfo) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/fonts-test.html`);
  await expect(page.locator('body')).toHaveAttribute('data-fonts-ready', 'true');
  const report = await page.evaluate(
    () => (window as unknown as { phasaFontsReport: FontsReport }).phasaFontsReport,
  );

  expect(Object.values(report.loaded)).toEqual([true, true]);
  expect(report.checks.filter((check) => !check.ok)).toEqual([]);
  expect(report.ok).toBe(true);
  // For the visual check on style changes (docs/plan.md §5.1): kept with the test results.
  await page.screenshot({ path: testInfo.outputPath('fonts-test.png'), fullPage: true });
});

test('youtube.com gets the bundled Thai font through document.head', async ({ context }) => {
  await routeFakeYouTube(context);
  const page = await context.newPage();
  await page.goto('https://www.youtube.com/watch?v=iH31BMKBEdU');
  const overlay = page.locator('#movie_player phasa-overlay [data-testid="phasa-overlay"]');
  await expect(overlay).toHaveAttribute('data-status', 'ready');
  await page.evaluate(() => (document.querySelector('video')!.currentTime = 2.5));

  expect(await page.evaluate(() => document.head.querySelector('#phasa-font-faces') !== null)).toBe(
    true,
  );
  const loaded = await page.evaluate(async () => {
    await document.fonts.load('16px "Phasa Noto Sans Thai Looped"', 'น้ำ');
    return document.fonts.check('16px "Phasa Noto Sans Thai Looped"', 'น้ำ');
  });
  expect(loaded).toBe(true);
  const family = await overlay
    .getByTestId('phasa-cue-thai')
    .evaluate((el) => getComputedStyle(el).fontFamily);
  expect(family).toContain('Phasa Noto Sans Thai Looped');
});
