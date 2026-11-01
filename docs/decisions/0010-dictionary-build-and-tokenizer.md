# 0010. Dictionary build, packaging and tokenizer implementation

- Status: Accepted
- Date: 2026-11-01
- Evidence: `npm run seg:eval`, `npm run data:dict` output below; `tests/e2e/icu.spec.ts`;
  `tests/e2e/words.spec.ts`

## Context

Phase 3 builds the dictionary (plan §6, ADR 0004) and the tokenizer (plan §5.3, ADR 0005). Open
points: where built data lives and how it reaches the extension; how the "dictionary headword"
convention meets Wiktionary, which has entries for compositional sequences (`ไม่มี`, `เข้าไป`,
`ดีกว่า`, `ทุกคน`, `อันนี้`); and what to do where ICU itself cuts through words (Node ICU 78.3
gives `แล้วก|ล้อ|งมัน` for `แล้วกล้องมัน`).

## Decision

**Data build.** `npm run data:freq` then `npm run data:dict` (scripts/build-frequency.ts,
scripts/build-dictionary.ts) turn the raw downloads in `data/raw/` into `data/build/freq.json`
(30 000 Thai words by TNC count, TTC tie-break) and `data/build/dict.json` + `dict.meta.json`.
`--raw-dump <file>` reads the full wiktextract dump and keeps `lang_code == "th"`. Per headword:
senses (≤ 10, gloss ≤ 240 chars, usage tags, classifier, alt-of target), Paiboon / RTGS / IPA,
syllables with tones from the Paiboon diacritics and the Thai phonemic respelling, frequency rank,
proper-noun flag. Volubilis is **not** in this build; checking it is deferred until after the plan's
phases (see Deferred).

Build of 2026-11-01: 21 085 kaikki entries → 17 367 headwords; Paiboon for 17 225; frequency rank
for 10 108; 51 compositional; 4 088 of the 5 000 most frequent TNC words covered; 6.6 MB, 1.28 MB
gzipped (budget 20 MB).

**Committed, one entry per line.** The built files are committed: builds and the F1 gate are
reproducible without the network, and kaikki's weekly re-extraction can't change test results
silently. One entry per line keeps diffs reviewable. WXT copies them to `data/` in the package
(`build:publicAssets` hook). On start the service worker compares `data/dict.meta.json` with the
version in the `meta` table (schema v2) and only then reloads the 17 k rows into `dict`, keeping a
lexicon snapshot (headwords, compositional parts, ranks) in one `meta` row for the tokenizer.

**Convention in the build.** src/thai/convention.ts marks compositional headwords with their parts:
negation `ไม่|X`, quantifiers `ทุก|X` / `ทั้ง|X`, `X|กว่า`, directional `เข้า|ไป`, serial `ไป|X` /
`มา|X`, possessive `ของ|<pronoun>`, classifier/noun + demonstrative when the whole is a noun or
pronoun, modal `X|จะ`, verb + complementizer `X|ว่า`, aspect `X|แล้ว`, each with keep-lists for lexicalized forms (`ไม่ว่า`,
`จนกว่า`, `ทั้งหมด`, `วันนี้`, `ดังนั้น`, `น่าจะ`, `ที่แล้ว`, `ต่อว่า`, idioms and slang). A split is only made
where the parts' Paiboon syllables equal the whole's, so it never cuts inside a syllable
(`มาตรา` is not `มา|ตรา`). No rule for sentence particles: `นะ`, `อะ`, `ไหม` are also syllables of
`มานะ`, `เยอะ`, `ผ้าไหม`.

**Tokenizer** (src/thai/tokenizer.ts), on top of ADR 0005's steps:

1. ICU, `ๆ` and `ฯ` split out, `ฯลฯ` kept whole, zero-width hints as locked boundaries;
2. merges of ≤ 4 ICU pieces into lexicon words chosen by a unigram cost (log of the frequency
   rank under Zipf; unranked headwords count as rank 5000) instead of greedy leftmost-longest, so a
   merge must pay for itself and the likelier of two overlapping merges wins. User phrases and merge
   rules always win, up to 8 pieces;
3. required splits (compositional parts, user split rules), then non-words that are concatenations
   of words are split (fewest, then longest pieces; no one-letter "words");
4. **repair**: a stretch of non-words (with one word of context each side) is re-cut over grapheme
   clusters to leave as few clusters outside words as possible; taken only if that leaves fewer,
   and for a single non-word only if it leaves none (keeps loanwords like `ดีเลย์`);
5. runs of one punctuation character stay together.

Every cut is a grapheme-cluster boundary; leading vowels never end and following vowels never start
a piece. Tokenizing runs in the service worker (`thai/tokenize`), on demand, so new user rules apply
at once (`segmentation/changed`); tokens are not stored with the captions.

**Pronunciation** (src/dictionary/pronunciation.ts): dictionary entry → for a compound the
dictionary lacks, its parts' entries → spelling rules (src/thai/romanize.ts: consonant class,
live/dead syllable, tone marks, clusters, leading ห, อักษรนำ, silent letters), shown as
"approximate". On the 4 082 most frequent dictionary words the rules match Wiktionary's Paiboon
exactly for 78.0 % and get every tone right for 86.5 %.

## Results

`npm run seg:eval`, Node 24 / ICU 78.3, dictionary `42b77dc51d65c8b2`, Thai–Thai boundaries:

| Rows                                   |   n |     P |     R |        F1 | exact |
| -------------------------------------- | --: | ----: | ----: | --------: | ----: |
| all                                    | 299 | 95.1% | 98.1% | **0.966** | 63.5% |
| real cues (13 videos: 8 manual, 5 asr) | 249 | 94.7% | 97.9% | **0.963** | 61.0% |
| seed lines                             |  50 | 97.2% | 99.4% |     0.983 | 76.0% |
| _ICU alone, ๆ split (spike:seg), real_ | 249 | 88.4% | 97.4% |     0.927 | 37.3% |

The real cues: 15 from the committed caption fixtures, then 234 captured on 2026-11-01 in the
owner's Chrome with the spike kit (`phasaSpike.save()`) from the 10 acceptance videos plus two
travel/food vlogs (`VbN95rNUh2U`, `iz-tnQqDN_E`), 20 cues per video spread over its length
(`npm run spike:cues -- --per-video 20`), pre-segmented by ICU, each reviewed against
tests/fixtures/README.md; 6 unreadable ASR lines were left out. The score on them was taken before
any tokenizer change; the complementizer rule (`คิด|ว่า`) then moved it from 0.961 to 0.963.

ICU alone scored 0.944 on the seed lines (docs/spikes.md §3). Before 7 seed lines were relabeled to
the headword convention (each says why in its `note`), the tokenizer scored 0.972 on them. All gold
lines, seed and real, are annotated by the coding assistant and need native-speaker review.
Chromium 156's ICU segments every gold line exactly like Node's (`tests/e2e/icu.spec.ts`).

## Consequences

- Remaining errors on the real cues are mostly coverage: `หลวงพี่` (14, one speaker),
  `ภาษาไทย` / `ภาษาอังกฤษ` / `ภาษาเกาหลี` (20), loanwords cut into syllables (`สตูดิโอ`,
  `ไบค์เกอร์`), names. Then headwords with a literal meaning that the convention splits
  (`เสียง|หัวเราะ`, `ร้าน|ขาย|ยา`), and ICU merges the merge step can't undo (`ว่าการ`, `ให้การ`).
  Words seen in the gold set were deliberately not added to the dictionary. Volubilis would help
  coverage (Deferred); a lattice over dictionary words and ICU tokens, scored with the unigram cost,
  would help the merges.
- Rebuilding the dictionary changes `dict.json`'s version: every installed copy reloads it once.
- The `dict` table is replaced on reload; AI-sourced entries (phase 5) will need their own table or
  a merge.

## Deferred

- **Volubilis** (ADR 0004's supplementary source): not before the plan's phases are done (after
  phase 7, with the "after v1" work). Wiktionary is enough for now: F1 0.963 on real cues, 4 088 of
  the 5 000 most frequent words, pronunciation for 99 % of headwords. When it is picked up:
  1. **License.** Download the current release from SourceForge (project `belisan`) and read the
     license file inside the archive. Use it only if it is CC BY-SA 4.0 or compatible with
     Wiktionary's CC BY-SA 4.0 for the shipped data (ADR 0004, docs/spikes.md §4); record the file
     name, version and license text in docs/spikes.md and close ADR 0004's pending note.
  2. **Format and content.** Which fields exist (headword, English glosses, POS, romanization and
     its system, classifiers), the encoding, how many entries, how many duplicate or variant
     spellings.
  3. **Gain.** Build with Volubilis added only where Wiktionary has no entry (or as extra senses,
     `source: ['volubilis']`) and compare: coverage of the 5 000 most frequent TNC words (now
     4 088), `npm run seg:eval` on the real cues (now 0.963; misses such as `หลวงพี่`,
     `ภาษาอังกฤษ`), `dict.json` size against the 20 MB budget.
  4. **Convention.** Run the compositional rules (src/thai/convention.ts) over the new headwords and
     review what they split; new multi-word entries can merge words the convention keeps apart.
  5. **Attribution.** Credit Volubilis in data/build/ATTRIBUTION.md and the store listing.
