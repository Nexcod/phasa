/**
 * Native-speaker review of tests/fixtures/segmentation.tsv
 * (docs/segmentation-review/GUIDE.md).
 *
 *   npm run seg:review:export                 # → docs/segmentation-review/segmentation-review.csv
 *   npm run seg:review:import -- <file.csv>   # apply the reviewer's verdicts
 *   npm run seg:review:import -- <file.csv> --dry-run
 *
 * The CSV (UTF-8 with BOM, opens in Google Sheets, Excel, LibreOffice) has one
 * row per gold line. The reviewer fills `verdict` (ok / fix / unsure), puts the
 * corrected segmentation in `corrected` for `fix`, and may leave a `comment`.
 * Import changes segmentations and notes only; the text of a line never changes.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  fromReviewNotation,
  isRealCue,
  parseGoldTsv,
  toReviewNotation,
  type GoldRow,
} from '../src/thai/gold';
import { parseGold } from '../src/thai/segmentation-eval';
import { csvField, parseCsv } from './lib/csv';

const ROOT = join(import.meta.dirname, '..');
const GOLD = join(ROOT, 'tests/fixtures/segmentation.tsv');
const OUT = join(ROOT, 'docs/segmentation-review/segmentation-review.csv');
const COLUMNS = [
  'id',
  'type',
  'video',
  'text',
  'segmentation',
  'verdict',
  'corrected',
  'comment',
  'annotator_note',
] as const;
type Column = (typeof COLUMNS)[number];

const NEEDS_REVIEW = /;? ?needs native review/u;
/** Note parts the reviewer doesn't need: the `type` column says it. */
const BOILERPLATE = new Set([
  'asr',
  'manual',
  'real cue annotated by the coding assistant',
  'needs native review',
]);

function typeOf(row: GoldRow): string {
  if (!isRealCue(row)) return 'written by assistant';
  if (row.note.startsWith('asr')) return 'real (auto captions)';
  return row.note.startsWith('manual') ? 'real (manual captions)' : 'real';
}

function videoUrl(row: GoldRow): string {
  if (!isRealCue(row)) return '';
  const [videoId, startMs] = row.id.split('@');
  const seconds = Math.floor(Number(startMs ?? 0) / 1000);
  return `https://www.youtube.com/watch?v=${videoId ?? ''}&t=${seconds}s`;
}

function exportCsv(): void {
  const rows = parseGoldTsv(readFileSync(GOLD, 'utf8'));
  // Real cues first: they matter most for the gate.
  const ordered = [...rows.filter(isRealCue), ...rows.filter((row) => !isRealCue(row))];
  const lines = [COLUMNS.map(csvField).join(',')];
  for (const row of ordered) {
    const values: Record<Column, string> = {
      id: row.id,
      type: typeOf(row),
      video: videoUrl(row),
      text: parseGold(row.segmented).text,
      segmentation: toReviewNotation(row.segmented),
      verdict: '',
      corrected: '',
      comment: '',
      annotator_note: row.note
        .split(/;\s*/u)
        .filter((part) => !BOILERPLATE.has(part.trim()))
        .join('; '),
    };
    lines.push(COLUMNS.map((column) => csvField(values[column])).join(','));
  }
  writeFileSync(OUT, `\uFEFF${lines.join('\r\n')}\r\n`);
  console.log(`${OUT}: ${ordered.length} rows`);
}

function importCsv(file: string, dryRun: boolean): void {
  const [header, ...records] = parseCsv(readFileSync(file, 'utf8'));
  const index = (name: Column) => {
    const at = header?.findIndex((cell) => cell.trim().toLowerCase() === name) ?? -1;
    if (at < 0) throw new Error(`${file}: no "${name}" column`);
    return at;
  };
  const [idCol, verdictCol, correctedCol, commentCol] = [
    index('id'),
    index('verdict'),
    index('corrected'),
    index('comment'),
  ];

  const tsv = readFileSync(GOLD, 'utf8');
  const lines = tsv.split('\n');
  const columns = lines[0]?.split('\t') ?? [];
  const [segCol, noteCol] = [columns.indexOf('segmented'), columns.indexOf('note')];
  const byId = new Map(lines.map((line, i) => [line.split('\t')[0] ?? '', i]));
  const date = new Date().toISOString().slice(0, 10);
  const counts = { ok: 0, fixed: 0, unsure: 0, skipped: 0 };
  const errors: string[] = [];

  for (const record of records) {
    const id = record[idCol]?.trim() ?? '';
    const verdict = (record[verdictCol] ?? '').trim().toLowerCase();
    const comment = (record[commentCol] ?? '').trim().replace(/\s+/gu, ' ');
    const at = byId.get(id);
    if (at === undefined || at === 0) {
      if (id) errors.push(`${id}: not in segmentation.tsv`);
      continue;
    }
    if (verdict === '') {
      counts.skipped++;
      continue;
    }
    const cells = lines[at]?.split('\t') ?? [];
    while (cells.length < columns.length) cells.push('');
    const before = cells[segCol] ?? '';
    let mark: string;
    if (verdict === 'ok') {
      mark = 'ok';
      counts.ok++;
    } else if (verdict === 'fix') {
      const result = fromReviewNotation(record[correctedCol] ?? '', before);
      if (!result.ok) {
        errors.push(`${id}: ${result.error}`);
        continue;
      }
      if (result.segmented === before) {
        mark = 'ok';
        counts.ok++;
      } else {
        mark = `corrected (was ${before})`;
        cells[segCol] = result.segmented;
        counts.fixed++;
        console.log(`${id}\n  - ${before}\n  + ${result.segmented}`);
      }
    } else if (verdict === 'unsure') {
      mark = 'unsure';
      counts.unsure++;
    } else {
      errors.push(`${id}: verdict must be ok, fix or unsure, not "${verdict}"`);
      continue;
    }
    const note = (cells[noteCol] ?? '').replace(NEEDS_REVIEW, '').replace(/^;\s*/u, '');
    const review = `native review ${date}: ${mark}${comment ? `; reviewer: ${comment}` : ''}`;
    cells[noteCol] = note ? `${note}; ${review}` : review;
    lines[at] = cells.join('\t');
  }

  console.log(
    `ok ${counts.ok}, fixed ${counts.fixed}, unsure ${counts.unsure}, not reviewed ${counts.skipped}, errors ${errors.length}`,
  );
  for (const error of errors) console.log(`  ! ${error}`);
  if (dryRun) {
    console.log('dry run: segmentation.tsv unchanged');
    return;
  }
  writeFileSync(GOLD, lines.join('\n'));
  console.log(`${GOLD} updated; run npm run seg:eval and npm test`);
}

const [command, file] = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
if (command === 'export') exportCsv();
else if (command === 'import' && file) importCsv(file, process.argv.includes('--dry-run'));
else {
  console.error('usage: tsx scripts/seg-review.ts export | import <file.csv> [--dry-run]');
  process.exit(1);
}
