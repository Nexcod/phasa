# 0011. Video analysis, known-word onboarding and the change signal

- Status: Accepted; badge wording and what counts as a word revised by
  [0012](0012-badge-counts-and-asr-artifacts.md), the level capped by the delivery in
  [0013](0013-level-capped-by-delivery.md)
- Date: 2026-11-01
- Evidence: `tests/unit/analysis.test.ts`, `tests/unit/analysis-handlers.test.ts`,
  `tests/e2e/analysis.spec.ts` (numbers below)

## Context

Phase 4 (plan §7, §2.1 "Analysis on load" and "Onboarding"). Open points: where the analysis runs
and how it stays current when statuses change; where frequency ranks come from for words the
dictionary lacks; the plan's "top new words" score; the level heuristic and its calibration; which
list "mark the top N as known" uses; and how a bulk change made in the options page reaches a
YouTube tab whose port closed while the service worker slept.

## Decision

**Analysis in the service worker** (plan §3.2 rule 5). `analysis/video {videoId, trackKey}` reads
the cached Thai track and works in two parts (src/analysis/analyze.ts):

1. a **profile** that depends only on the video — tokens from the same tokenizer as the subtitles,
   occurrences per word, frequency ranks, syllables, the level — kept in memory for the 4 most
   recent tracks and dropped when word boundaries change (`segmentation/changed`);
2. the learner's **statuses**, applied on every request: one IndexedDB read.

A snapshot goes to `videos.stats` (plan §9). The badge under the title and the side panel ask
again on `vocab/changed`, `segmentation/changed` and `sw/hello`, 30 ms debounced.

**What counts** (plan §5.4): Thai word tokens, as their normalized form. Names (dictionary entries
whose senses are all proper nouns) don't count; `ๆ` belongs to the word before it (not counted,
but its syllables are spoken); numbers, Latin text and punctuation don't count. A phrase saved
without spaces is one token and counts with its own status.

**Measures** (plan §7.2) as the plan lists them. Speech rate: syllables (dictionary pronunciation,
else spelling rules, else grapheme clusters ÷ 2.5) per second of the union of the lines that have
Thai words. Names count for speech rate and words per line, not for vocabulary.

**Frequency list in the package.** `data/build/freq.json` (30 000 TNC words, 0.6 MB) ships as
`data/freq.json`; the service worker fetches it on first use and keeps a map in memory. The
dictionary has ranks only for its 10 108 ranked headwords; without the list, every word Wiktionary
lacks would count as rare.

**Top new words.** Score = occurrences in the video × ln(1 + 30 000 / rank); a word without a rank
counts as rank 60 000. The plan's `× log(1/freqRank)` is ≤ 0 for every rank: it would put rare
words first and turn more occurrences into a penalty. Only words in the dictionary or the frequency
list are suggested (not ICU fragments); "Mark all as known" covers every new word.

**Comprehension** uses the plan's thresholds (98 / 95 / 90 % known-token coverage).

**Level (provisional).** A weighted mean of per-feature scores on 0 (A1) … 5 (C2), each linear
between two anchors (src/analysis/levels.ts):

| Feature                      | A1 anchor | C2 anchor | Weight |
| ---------------------------- | --------: | --------: | -----: |
| share outside the top 1 000  |      0.08 |      0.35 |   0.20 |
| share outside the top 3 000  |      0.03 |      0.22 |   0.25 |
| share outside the top 10 000 |      0.01 |      0.14 |   0.20 |
| speech rate, syllables/s     |       3.0 |       7.5 |   0.25 |
| words per line               |         3 |        16 |   0.10 |

TNC ranks come from written Thai, so even easy speech has many tokens outside the top 1 000 (the
gold set's 13 videos: 11–25 %); line length depends on the captioner as much as on the speaker.
Below 30 counted tokens there is no level. **Calibration** (plan §7.3) needs 30–50 videos rated by
hand: `tests/fixtures/levels.csv`, rows copied from a development build's side panel ("Copy
calibration row"); a unit test then requires the estimate within one level for 80 % of them. It is
skipped while the file is empty.

**Onboarding** (options → Known words):

- the plan §5.4 particles (`ครับ ค่ะ คะ นะ จ้ะ น่ะ ล่ะ ไหม มั้ย`), one button;
- the top N (100 … 5 000) of the frequency list, keeping only words the tokenizer shows as one unit
  (a compositional headword like `ไม่มี` never occurs in the subtitles, ADR 0010) and not names;
  reviewed with checkboxes first, saved words shown and left alone;
- a word list: TXT / CSV (first column) / Anki "Notes in Plain Text" (first field, HTML stripped,
  `#` header lines skipped); each entry is split by the tokenizer and its words become known.

Bulk changes (`vocab/bulk-set`, extension pages only) have two modes: **new-only** for the top N,
the particles and a video's "mark all as known" ("remaining words", plan §2.1), and **advance** for
an import, which also moves learning words to known (plan §9: the more advanced status wins).
Ignored words are never touched. The video's actions (`analysis/mark-new`, also for the content
script) act only on that video's new words; "Add top 10 to learning" saves each word with the line
it first occurs in and that line's translation. A `vocab/changed` event lists at most 1 000
changes; beyond that it says `reload: true`.

**Change signal.** An MV3 service worker stops after about 30 s idle. The ports of the contexts
connected to it close and only reopen with their next request, so they miss what another context
broadcasts after waking the worker — e.g. an import in the options page while the YouTube tab sits
still. With every broadcast the worker now bumps `phasaChanged` in `chrome.storage.local`; storage
changes reach every context, whose client (src/messaging/browser.ts) reconnects if its port is
closed; the `sw/hello` it gets makes the subtitles, the badge and the lists reload. Nothing keeps
the worker alive.

**Where it shows.** The badge — `B1 · 87% known · 142 new (61 unique)`, its border and level
colored by comprehension — goes right after `ytd-watch-metadata #title` in its own shadow root
(WXT `autoMount` follows the title; a 1 s check puts the same host back if YouTube drops it but
keeps the title). It follows YouTube's `<html dark>` through `data-theme`. Videos without a Thai
track get the grey "No Thai subtitles" badge (plan §4.1 step 3). Clicking it opens the details:
comprehension, level and the measures behind it, the status distribution, top new words with
"Learn" / "Known" each, "Add top 10 to learning" and "Mark all new words as known" behind an inline
confirmation. The side panel shows the same card above its tabs, and the transcript gets "Only
lines with new words" (plan §2.1) from the analysis.

## Results

- 20-minute video (fake page: 400 lines of real subtitle text from the gold set, 3 794 counted
  words, 787 distinct), headless Chromium, in the service worker: **78–79 ms** for the first
  analysis, tokenizing included and the one-time dictionary install excluded; **3 ms** after a
  status change. Budget: 500 ms (plan §7.5).
- Importing 500 words in the options page: the badge of the open video tab shows the new coverage
  **125 ms** after the click (e2e, background tab, no reload).
- Real youtube.com, run from the development machine on 2026-11-01: the grey badge mounts under the
  real title (`@network` smoke test).

## Consequences

- The level is a guess until `levels.csv` has its rows; the details show the measures it rests on,
  so a wrong level can be understood.
- The package grows by 0.6 MB (`freq.json`).
- A restarted service worker rebuilds the profile on the next request (about 80 ms for 20 minutes).
- Any future broadcast reaches sleeping contexts the same way; no event needs its own workaround.

## Deferred

- **Spelling variants** (plan §5.4, `มั้ย` / `ไหม`, `ป่าว` / `เปล่า` sharing a status). Wiktionary's
  "alternative form of" (905 entries) mixes colloquial variants with archaic spellings and
  misspellings, so it can't serve as the variants table. Needs a curated list, and shared statuses:
  saving one form sets the group; statuses and `vocab/changed` events expanded to the group.
- **Level calibration** on 30–50 hand-rated videos (`tests/fixtures/levels.csv`, see its README).
