/**
 * Chrome Web Store screenshots (ADR 0017): five 1280×800 PNGs in docs/store/screenshots/, taken
 * from the production build on a fresh install against the fake YouTube and the fake OpenAI, with
 * a demo video whose lines were written for Phasa. Also used by the README.
 *
 *   npm run store:screenshots
 *
 * Not part of `npm run test:e2e`; re-run after a visible UI change and look at every image.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { BrowserContext, Locator, Page } from '@playwright/test';
import { expect, test, youTubeTabId } from '../e2e/fixtures';
import { FAKE_VIDEOS, SHOWCASE_VIDEO_ID, routeFakeYouTube } from '../e2e/fake-youtube';
import { routeFakeOpenAi, signIn } from '../e2e/openai';
import { createFakeOpenAi } from '../helpers/fake-openai';
import { showcaseWatchPage } from './showcase-page';

const OUT_DIR = join(import.meta.dirname, '../../docs/store/screenshots');
const WIDTH = 1280;
const HEIGHT = 800;
const PANEL_WIDTH = 400;
/** Onboarding marks this many of the most frequent words known. */
const KNOWN_TOP = 2000;

/** First demo line starts at 0.5 s, one line every 4 s (tests/fixtures/captions/showcase.*). */
const lineTime = (index: number) => 0.5 + index * 4 + 1;

/** "Explain in context" for แม่ค้า in "แม่ค้าบอกว่าจานละห้าสิบบาท". */
const VENDOR_ANSWER = {
  meaning_in_context:
    'the vendor — the woman selling the mango sticky rice at her stall in the market',
  part_of_speech: 'noun',
  romanization_paiboon: 'mɛ̂ɛ-káa',
  syllables: [
    { thai: 'แม่', tone: 'falling' },
    { thai: 'ค้า', tone: 'high' },
  ],
  register: 'neutral, everyday',
  notes:
    'แม่ "mother" + ค้า "trade": a woman who sells things, usually at a market or a stall. A man is พ่อค้า (pɔ̂ɔ-káa).',
  example_th: 'แม่ค้าคนนี้ขายผลไม้ทุกเช้า',
  example_en: 'This vendor sells fruit every morning.',
  classifier: 'คน',
};

const VENDOR_LINE = {
  natural_en: "The vendor says it's fifty baht a plate.",
  literal_en: 'vendor say that plate each fifty baht',
  word_by_word: [
    { thai: 'แม่ค้า', en: 'vendor' },
    { thai: 'บอก', en: 'say' },
    { thai: 'ว่า', en: 'that' },
    { thai: 'จาน', en: 'plate' },
    { thai: 'ละ', en: 'each' },
    { thai: 'ห้าสิบ', en: 'fifty' },
    { thai: 'บาท', en: 'baht' },
  ],
};

const overlay = (page: Page) =>
  page.locator('#movie_player phasa-overlay [data-testid="phasa-overlay"]');
const popup = (page: Page) => overlay(page).getByTestId('phasa-popup');
const titleBadge = (page: Page) => page.locator('phasa-badge [data-testid="phasa-title-badge"]');

const word = (page: Page, thai: string): Locator =>
  overlay(page)
    .getByTestId('phasa-word')
    .filter({ has: page.locator('.phasa-word__thai', { hasText: new RegExp(`^${thai}$`) }) })
    .first();

async function showLine(page: Page, index: number): Promise<void> {
  await page.evaluate(
    (seconds) =>
      new Promise<void>((resolve) => {
        const video = document.querySelector('video')!;
        video.pause();
        video.addEventListener('seeked', () => resolve(), { once: true });
        video.currentTime = seconds;
      }),
    lineTime(index),
  );
  await expect(overlay(page).getByTestId('phasa-subtitles')).toHaveAttribute(
    'data-index',
    String(index),
  );
}

/** Opens `thai` on line `index` and gives it a status key (1–4 learning, k known). */
async function setStatus(page: Page, index: number, thai: string, key: string): Promise<void> {
  await showLine(page, index);
  await word(page, thai).click();
  await expect(popup(page)).toBeVisible();
  await page.keyboard.press(key);
  await page.keyboard.press('Escape');
  await expect(popup(page)).toBeHidden();
}

async function shoot(page: Page, name: string): Promise<void> {
  await page.mouse.move(WIDTH - 2, HEIGHT - 2);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: join(OUT_DIR, name), animations: 'disabled' });
}

/**
 * Onboarding: the most frequent words reviewed and marked known, as a learner who knows some Thai
 * does first. Screenshot 5 is the review list, enlarged so it reads at the store's 640×400.
 */
async function onboard(context: BrowserContext, extensionId: string): Promise<void> {
  const options = await context.newPage();
  await options.setViewportSize({ width: WIDTH, height: HEIGHT });
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  const top = options.getByTestId('phasa-known-top');
  await top.getByLabel('Most frequent words:').selectOption(String(KNOWN_TOP));
  await top.getByRole('button', { name: 'Review the list' }).click();
  await expect(top.getByTestId('phasa-known-list').locator('li')).toHaveCount(KNOWN_TOP, {
    timeout: 30_000,
  });
  await options.evaluate(() => {
    document.body.style.zoom = '1.3';
    document.querySelector('[data-testid="phasa-options-known"]')?.scrollIntoView();
  });
  await shoot(options, '5-known-words.png');
  await top.getByRole('button', { name: /^Mark as known \(\d+\)$/ }).click();
  await expect(top).toContainText('Marked as known');
  await options.close();
}

test('store screenshots @store', async ({ context, extensionId, serviceWorker }) => {
  test.setTimeout(180_000);
  mkdirSync(OUT_DIR, { recursive: true });
  const video = FAKE_VIDEOS[SHOWCASE_VIDEO_ID]!;
  await routeFakeYouTube(context, {
    watchPage: showcaseWatchPage(video.title, video.channel ?? ''),
  });
  const openai = await createFakeOpenAi();
  openai.options.wordAnswer = VENDOR_ANSWER;
  openai.options.lineAnswer = VENDOR_LINE;
  openai.options.planModels = [
    { slug: 'gpt-6-luna', display_name: 'GPT-6-Luna', visibility: 'list' },
  ];
  await routeFakeOpenAi(context, openai);
  await signIn(context, extensionId);
  await onboard(context, extensionId);

  const page = await context.newPage();
  await page.setViewportSize({ width: WIDTH, height: HEIGHT });
  await page.goto(`https://www.youtube.com/watch?v=${SHOWCASE_VIDEO_ID}`);
  await page.waitForFunction(() => (document.querySelector('video')?.readyState ?? 0) >= 1);
  await expect(overlay(page)).toHaveAttribute('data-words', 'ready', { timeout: 30_000 });
  await expect(titleBadge(page).getByTestId('phasa-analysis')).toHaveAttribute(
    'data-state',
    'ready',
  );

  // Some words in learning and a few more known, as after a few videos.
  await setStatus(page, 0, 'สวัสดี', 'k');
  await setStatus(page, 6, 'คลิป', 'k');
  await setStatus(page, 0, 'ตลาดน้ำ', '2');
  await setStatus(page, 1, 'อร่อย', '3');
  await setStatus(page, 4, 'หวาน', '1');

  // 1. Subtitles with romanization and a word's popup.
  await showLine(page, 2);
  await page.keyboard.press('r');
  await word(page, 'ข้าวเหนียวมะม่วง').click();
  await expect(popup(page)).toBeVisible();
  await shoot(page, '1-word-popup.png');
  await page.keyboard.press('Escape');

  // 2. AI: the word explained in its line.
  await showLine(page, 3);
  await word(page, 'แม่ค้า').click();
  await popup(page)
    .getByRole('button', { name: /Explain in context/ })
    .click();
  await expect(popup(page).getByTestId('phasa-ai-explanation')).toContainText('พ่อค้า');
  await shoot(page, '2-ai-explain.png');
  await page.keyboard.press('Escape');

  // 3. The analysis under the title.
  await showLine(page, 1);
  await titleBadge(page).getByTestId('phasa-analysis-badge').click();
  await expect(titleBadge(page).getByTestId('phasa-analysis-details')).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 330));
  await shoot(page, '3-analysis.png');
  await titleBadge(page).getByTestId('phasa-analysis-badge').click();
  await page.evaluate(() => window.scrollTo(0, 0));

  // 4. The side panel next to the video: transcript with the playing line.
  await page.setViewportSize({ width: WIDTH - PANEL_WIDTH, height: HEIGHT });
  await showLine(page, 4);
  const panel = await context.newPage();
  await panel.setViewportSize({ width: PANEL_WIDTH, height: HEIGHT });
  // A dark system theme, like the page next to it ("Same as the system" is the default).
  await panel.emulateMedia({ colorScheme: 'dark' });
  await panel.goto(
    `chrome-extension://${extensionId}/sidepanel.html?tab=${await youTubeTabId(serviceWorker)}`,
  );
  await expect(panel.getByTestId('phasa-transcript').locator('li')).toHaveCount(7);
  await expect(panel.getByTestId('phasa-panel-analysis')).toBeVisible();
  // The transcript scrolled to the playing line; the panel's top (the badge) matters more here.
  await panel.evaluate(() => {
    window.scrollTo(0, 0);
    for (const el of document.querySelectorAll('*')) if (el.scrollTop > 0) el.scrollTop = 0;
  });
  await page.mouse.move(WIDTH - PANEL_WIDTH - 2, HEIGHT - 2);
  const left = await page.screenshot({ animations: 'disabled' });
  const right = await panel.screenshot({ animations: 'disabled' });
  const compose = await context.newPage();
  await compose.setViewportSize({ width: WIDTH, height: HEIGHT });
  await compose.setContent(
    `<body style="margin:0;display:flex;background:#000">
      <img src="data:image/png;base64,${left.toString('base64')}">
      <img src="data:image/png;base64,${right.toString('base64')}" style="border-left:1px solid #303030;margin-left:-1px">
    </body>`,
  );
  await compose.screenshot({ path: join(OUT_DIR, '4-side-panel.png') });
  await compose.close();
  await panel.close();
});
