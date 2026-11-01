/**
 * Turns captured json3 caption files (from the captions spike kit, see
 * spikes/README.md) into segmentation.tsv rows pre-segmented by ICU, ready
 * for manual review:
 *
 *   npm run -s spike:cues spikes/captions-extension/captures/*.json > /tmp/cues.tsv
 *   npm run -s spike:cues -- --per-video 25 --exclude tests/fixtures/segmentation.tsv captures/*.json
 *
 * Cues go through the extension's own processing (src/captions/process.ts:
 * non-speech tags removed, normalized, auto-generated fragments merged), so
 * the rows are the lines users see. `--per-video N` picks N cues spread evenly
 * over each video (default: all); `--exclude <tsv>` skips ids already there.
 *
 * Pre-segmenting biases annotators toward ICU's answer: review every row
 * against tests/fixtures/README.md rather than only fixing obvious errors.
 */
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { processTrack } from '../../src/captions/process';
import type { ProcessedCue } from '../../src/captions/types';
import { parseGoldTsv } from '../../src/thai/gold';

interface Json3 {
  events?: { segs?: { utf8?: string; acAsrConf?: number; tOffsetMs?: number }[] }[];
}

const segmenter = new Intl.Segmenter('th', { granularity: 'word' });
const THAI = /[ก-๛]/u;
const MIN_CHARS = 8;
const MAX_CHARS = 160;

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const perVideo = Number(option('--per-video') ?? Infinity);
const excludeFile = option('--exclude');
const optionValues = new Set([option('--per-video'), excludeFile]);
const files = process.argv
  .slice(2)
  .filter((arg) => !arg.startsWith('--') && !optionValues.has(arg));
if (files.length === 0) {
  console.error(
    'usage: npm run -s spike:cues [-- --per-video N --exclude gold.tsv] <file.json>...',
  );
  process.exit(1);
}
const excluded = new Set(
  excludeFile ? parseGoldTsv(readFileSync(excludeFile, 'utf8')).map((row) => row.id) : [],
);

/** Auto-generated json3 carries per-word timing and confidence. */
function isAsr(json: Json3): boolean {
  return (json.events ?? []).some((event) =>
    (event.segs ?? []).some((seg) => seg.acAsrConf !== undefined || seg.tOffsetMs !== undefined),
  );
}

/** `count` items spread evenly over `items`, keeping their order. */
function spread<T>(items: readonly T[], count: number): T[] {
  if (items.length <= count) return [...items];
  const picked: T[] = [];
  for (let i = 0; i < count; i++) {
    const item = items[Math.floor(((i + 0.5) * items.length) / count)];
    if (item !== undefined) picked.push(item);
  }
  return picked;
}

console.log('id\tsource\tsegmented\tnote');
for (const file of files) {
  const body = readFileSync(file, 'utf8');
  const videoId = basename(file).split('.')[0] ?? 'unknown';
  const kind = isAsr(JSON.parse(body) as Json3) ? 'asr' : 'manual';
  const cues = processTrack({
    videoId,
    ref: { vssId: kind === 'asr' ? 'a.th' : '.th' },
    languageCode: 'th',
    kind,
    body,
    fetchedAt: 0,
  }).cues.filter(
    (cue: ProcessedCue) =>
      THAI.test(cue.text) &&
      cue.text.length >= MIN_CHARS &&
      cue.text.length <= MAX_CHARS &&
      !excluded.has(`${videoId}@${cue.startMs}`),
  );
  for (const cue of spread(cues, perVideo)) {
    const segmented = [...segmenter.segment(cue.text)].map((s) => s.segment).join('|');
    console.log(
      `${videoId}@${cue.startMs}\tyoutube:${videoId}\t${segmented}\t${kind}; TODO review`,
    );
  }
}
