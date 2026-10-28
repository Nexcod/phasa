/**
 * Turns captured json3 caption files (from the captions spike, see
 * spikes/captions-extension) into segmentation.tsv rows pre-segmented by ICU,
 * ready for manual correction:
 *
 *   npm run -s spike:cues spikes/captions-extension/captures/*.json3.json > /tmp/cues.tsv
 *
 * Pre-segmenting biases annotators toward ICU's answer: review every row
 * against tests/fixtures/README.md rather than only fixing obvious errors.
 */
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

interface Json3 {
  events?: { tStartMs?: number; segs?: { utf8?: string }[] }[];
}

const segmenter = new Intl.Segmenter('th', { granularity: 'word' });
const THAI = /[฀-๿]/u;
const NON_SPEECH = /^\[[^\]]*\]$/u; // [เพลง], [ดนตรี], [หัวเราะ] …

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('usage: npm run -s spike:cues <file.json3.json>...');
  process.exit(1);
}

console.log('id\tsource\tsegmented\tnote');
for (const file of files) {
  const json = JSON.parse(readFileSync(file, 'utf8')) as Json3;
  const videoId = basename(file).split('.')[0] ?? 'unknown';
  for (const event of json.events ?? []) {
    const text = (event.segs ?? [])
      .map((seg) => seg.utf8 ?? '')
      .join('')
      .replace(/\s+/gu, ' ')
      .trim();
    if (!THAI.test(text) || NON_SPEECH.test(text)) continue;
    const segmented = [...segmenter.segment(text)].map((s) => s.segment).join('|');
    console.log(`${videoId}@${event.tStartMs ?? 0}\tyoutube:${videoId}\t${segmented}\tTODO review`);
  }
}
