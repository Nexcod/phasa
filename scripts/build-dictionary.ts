/**
 * Builds data/build/dict.json from English Wiktionary's Thai entries
 * (wiktextract via kaikki.org, CC BY-SA 4.0 + GFDL; docs/plan.md §6, ADR 0004).
 *
 *   npm run data:dict                        # kaikki's Thai JSONL, cached in data/raw/
 *   npm run data:dict -- --refresh           # download it again
 *   npm run data:dict -- --raw-dump <file>   # filter a full wiktextract dump (.jsonl or .jsonl.gz)
 *
 * kaikki marks its per-language files deprecated; `--raw-dump` reads the full
 * English-Wiktionary extraction (https://kaikki.org/dictionary/rawdata.html)
 * and keeps `lang_code == "th"`, the long-term path.
 *
 * Reads data/build/freq.json (`npm run data:freq`) for frequency ranks and
 * marks compositional headwords for the tokenizer (src/thai/convention.ts).
 * One entry per line keeps git diffs of the committed file readable; the
 * header also goes to data/build/dict.meta.json. Both ship in the extension
 * under data/ (wxt.config.ts).
 */
import { createReadStream, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { createInterface } from 'node:readline';
import { gzipSync, createGunzip } from 'node:zlib';
import { entryFromKaikki, mergeEntries, type KaikkiEntry } from '../src/dictionary/kaikki';
import type { DictEntry, DictMeta } from '../src/dictionary/types';
import { conventionalParts } from '../src/thai/convention';
import { BUILD_DIR, contentVersion, ensureRaw, sourceMeta, type RawSource } from './lib/raw-data';

const KAIKKI_THAI = 'https://kaikki.org/dictionary/Thai/kaikki.org-dictionary-Thai.jsonl';
/** docs/plan.md §6: at most 20 MB compressed. */
const BUDGET_GZIP_BYTES = 20 * 1024 * 1024;

async function rawDumpSource(path: string): Promise<RawSource> {
  if (!existsSync(path)) throw new Error(`${path}: no such file`);
  const { createHash } = await import('node:crypto');
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return {
    name: `wiktextract raw dump ${basename(path)} (lang_code th)`,
    url: 'https://kaikki.org/dictionary/rawdata.html',
    path,
    retrievedAt: statSync(path).mtime.toISOString().slice(0, 10),
    sha256: hash.digest('hex'),
  };
}

async function* jsonLines(path: string): AsyncGenerator<KaikkiEntry> {
  const stream = createReadStream(path);
  const input = path.endsWith('.gz') ? stream.pipe(createGunzip()) : stream;
  for await (const line of createInterface({ input, crlfDelay: Infinity })) {
    if (line.trim() === '') continue;
    // A full dump holds every language; skip others before the expensive parse when possible.
    if (!line.includes('"lang_code": "th"') && !line.includes('"lang_code":"th"')) continue;
    yield JSON.parse(line) as KaikkiEntry;
  }
}

const dumpIndex = process.argv.indexOf('--raw-dump');
const dumpPath = dumpIndex >= 0 ? process.argv[dumpIndex + 1] : undefined;
if (dumpIndex >= 0 && !dumpPath) throw new Error('--raw-dump needs a file path');
const source = dumpPath
  ? await rawDumpSource(dumpPath)
  : await ensureRaw('kaikki.org Thai (wiktextract)', KAIKKI_THAI, 'kaikki-thai.jsonl');

const byWord = new Map<string, DictEntry>();
let rawEntries = 0;
for await (const raw of jsonLines(source.path)) {
  rawEntries++;
  const entry = entryFromKaikki(raw);
  if (!entry) continue;
  const existing = byWord.get(entry.thai);
  byWord.set(entry.thai, existing ? mergeEntries(existing, entry) : entry);
}

const freqPath = join(BUILD_DIR, 'freq.json');
if (!existsSync(freqPath)) throw new Error(`${freqPath} is missing: run npm run data:freq first`);
const freq = JSON.parse(readFileSync(freqPath, 'utf8')) as {
  meta: { sources: DictMeta['sources'] };
  words: string[];
};
const rank = new Map(freq.words.map((word, index) => [word, index + 1]));

const lexicon = {
  has: (word: string) => byWord.has(word),
  partsOfSpeech: (word: string) => byWord.get(word)?.senses.flatMap((s) => s.pos ?? []) ?? [],
  tags: (word: string) => byWord.get(word)?.senses.flatMap((s) => s.tags ?? []) ?? [],
  paiboon: (word: string) => byWord.get(word)?.romanization?.paiboon,
};
let compositional = 0;
const entries = [...byWord.values()]
  .map((entry) => {
    const out: DictEntry = { ...entry };
    const freqRank = rank.get(entry.thai);
    if (freqRank !== undefined) out.freqRank = freqRank;
    const parts = conventionalParts(entry.thai, lexicon);
    if (parts) {
      out.parts = parts;
      compositional++;
    }
    return out;
  })
  .sort((a, b) => (a.thai < b.thai ? -1 : a.thai > b.thai ? 1 : 0));

const lines = entries.map((entry) => JSON.stringify(entry));
const meta: DictMeta = {
  version: contentVersion(lines.join('\n')),
  builtAt: new Date().toISOString().slice(0, 10),
  entries: entries.length,
  sources: [sourceMeta(source), ...freq.meta.sources],
};
const text = `{"meta":${JSON.stringify(meta)},\n"entries":[\n${lines.join(',\n')}\n]}\n`;
const out = join(BUILD_DIR, 'dict.json');
writeFileSync(out, text);
// The service worker reads this small file on start to decide whether to reload the dictionary.
writeFileSync(join(BUILD_DIR, 'dict.meta.json'), `${JSON.stringify(meta, null, 2)}\n`);

const gzipBytes = gzipSync(text).length;
const withRoman = entries.filter((entry) => entry.romanization?.paiboon).length;
const ranked = entries.filter((entry) => entry.freqRank !== undefined).length;
const top5000 = freq.words.slice(0, 5000).filter((word) => byWord.has(word)).length;
console.log(`${out}
  ${rawEntries} raw entries → ${entries.length} headwords (version ${meta.version})
  Paiboon romanization: ${withRoman} · frequency rank: ${ranked} · compositional: ${compositional}
  coverage of the 5000 most frequent words: ${top5000}
  size ${(text.length / 1e6).toFixed(1)} MB, gzip ${(gzipBytes / 1e6).toFixed(2)} MB`);
if (gzipBytes > BUDGET_GZIP_BYTES) throw new Error('Dictionary exceeds the 20 MB budget (plan §6)');
