/**
 * Builds data/build/freq.json: Thai words in frequency order (docs/plan.md §6,
 * ADR 0004). Rank by the Thai National Corpus count, ties broken by the Thai
 * Textbook Corpus count. Both lists are CC0-1.0, from PyThaiNLP.
 *
 *   npm run data:freq              # reuse data/raw/ downloads
 *   npm run data:freq -- --refresh # download again
 *
 * Run before `npm run data:dict`, which reads the ranks.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { headwordKey } from '../src/dictionary/kaikki';
import { BUILD_DIR, contentVersion, ensureRaw, sourceMeta } from './lib/raw-data';

const PYTHAINLP = 'https://raw.githubusercontent.com/PyThaiNLP/pythainlp/dev/pythainlp/corpus';
/** Enough for the analysis buckets (top 1000 … 10000, docs/plan.md §7.2) with room to spare. */
export const MAX_WORDS = 30_000;

function readCounts(path: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const [word = '', count = ''] = line.split('\t');
    const key = headwordKey(word.trim());
    const value = Number(count);
    if (!key || !Number.isFinite(value)) continue;
    counts.set(key, (counts.get(key) ?? 0) + value);
  }
  return counts;
}

const tnc = await ensureRaw('PyThaiNLP tnc_freq.txt', `${PYTHAINLP}/tnc_freq.txt`, 'tnc_freq.txt');
const ttc = await ensureRaw('PyThaiNLP ttc_freq.txt', `${PYTHAINLP}/ttc_freq.txt`, 'ttc_freq.txt');
const tncCounts = readCounts(tnc.path);
const ttcCounts = readCounts(ttc.path);

const words = [...new Set([...tncCounts.keys(), ...ttcCounts.keys()])]
  .sort(
    (a, b) =>
      (tncCounts.get(b) ?? 0) - (tncCounts.get(a) ?? 0) ||
      (ttcCounts.get(b) ?? 0) - (ttcCounts.get(a) ?? 0) ||
      (a < b ? -1 : a > b ? 1 : 0),
  )
  .slice(0, MAX_WORDS);

const body = JSON.stringify(words);
const meta = {
  version: contentVersion(body),
  builtAt: new Date().toISOString().slice(0, 10),
  words: words.length,
  sources: [sourceMeta(tnc), sourceMeta(ttc)],
};
const out = join(BUILD_DIR, 'freq.json');
writeFileSync(out, `{"meta":${JSON.stringify(meta)},\n"words":${body}}\n`);
console.log(`${out}: ${words.length} words, version ${meta.version}`);
