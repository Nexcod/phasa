import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseGoldTsv } from '../../src/thai/gold';
import { parseGold } from '../../src/thai/segmentation-eval';
import { expect, test } from './fixtures';

const GOLD = parseGoldTsv(
  readFileSync(join(import.meta.dirname, '../fixtures/segmentation.tsv'), 'utf8'),
);

const boundaries = (text: string) =>
  [...new Intl.Segmenter('th', { granularity: 'word' }).segment(text)].map((s) => s.index);

/**
 * The tokenizer's gate (F1 ≥ 0.90) is measured in Node, but it runs on the browser's ICU.
 * docs/spikes.md §3 left open whether Chrome's ICU segments Thai like Node's: it must, or
 * the Node F1 says nothing about what users see.
 */
test("the browser's ICU segments the gold set like Node's", async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  const texts = GOLD.map((row) => parseGold(row.segmented).text);
  const browser = await page.evaluate(
    (all) =>
      all.map((text) =>
        [...new Intl.Segmenter('th', { granularity: 'word' }).segment(text)].map((s) => s.index),
      ),
    texts,
  );
  const differing = texts.filter((text, i) => browser[i]?.join() !== boundaries(text).join());
  test.info().annotations.push({
    type: 'icu',
    description: `${await page.evaluate(() => navigator.userAgent)} vs Node ${process.versions.node} ICU ${process.versions.icu}: ${differing.length}/${texts.length} differ`,
  });
  expect(differing).toEqual([]);
});
