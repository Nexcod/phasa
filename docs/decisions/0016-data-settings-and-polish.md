# 0016. Data, settings and polish: backup, word lists, appearance, toolbar popup

- Status: Accepted
- Date: 2026-11-12
- Evidence: docs/plan.md §2.1 "Данные", §5.1, §9, §10, §12 phase 6; follow-ups of ADR 0001
  (toolbar popup), 0006 ("About"), 0007 (captions eviction), 0014 (backup without credentials);
  `tests/unit/backup.test.ts`, `tests/unit/settings-appearance.test.ts`, `tests/unit/db.test.ts`,
  `tests/e2e/data.spec.ts`

## Context

Phase 6 asks for a JSON export and import, an Anki TSV export, settings for romanization, tone
colors, font and size, a dark theme, error and empty states, and performance. Its acceptance:
"export → clean install → import restores everything". Plan §9: a full dump with
`schemaVersion`; the import merges by `thai`, the more advanced status wins, contexts are
combined. Earlier ADRs left four items for this phase: the toolbar popup of plan §10 (0001), an
"About" section with the AGPL notices (0006), eviction of the captions cache (0007) and a backup
that never contains credentials (0014).

## Decision

**Backup file** (`src/backup/format.ts`): one JSON document `{format: "phasa-backup", version,
schemaVersion, exportedAt, app, words, phrases, segRules, settings, videos, aiAnswers}`. Not a
table dump: rows refer to each other by Thai text, and the lines a word was saved from are nested
under it, so a backup merges into any database without id remapping.

- In it: words and phrases with status, timestamps, note, SRS state and their lines; merge and
  split rules; the effective settings; analyzed videos with their last stats snapshot; saved AI
  answers (they cost plan usage to ask again).
- Not in it, by design: `credentials` (ADR 0014), the `captions` cache (refetched when the video
  is watched, and it is YouTube's text), the packaged `dict` and the internal `meta`.
  `BACKUP_TABLES` and `NOT_BACKED_UP` name every table; a unit test fails when a new table is in
  neither list, so each new table gets a conscious decision.
- The format has its own `version`; an app refuses a newer one with "update Phasa first".

**Restore** (`src/backup/import.ts`) merges and never deletes. Rows are validated with the same
parsers as messages from content scripts (`unitKey`, `parseStatus`, `parseContext`,
`parseSegRule`, the settings validators); an invalid row is skipped and counted, its valid
siblings are kept.

- Status: `bulkReplaces(current, imported, 'advance')` — new < learning 1–4 < known; ignored is
  never overridden and never overrides. Earliest `createdAt` wins; `updatedAt` moves only with the
  status. A line from the same cue of the same video is saved once (as `vocab/set` does).
- A merge and a split rule for the same text: the newer one stays.
- Settings replace the current ones key by key, only if "Restore the settings too" is ticked
  (default on). A newer analysis of a video replaces an older one.
- AI answers must have a known function and still pass that prompt's new `isValue` shape check;
  the AI service now applies the same check to every cache hit, so a malformed answer is asked
  again instead of reaching the UI.
- The options page sends the file section by section, at most 1000 rows and about 4 MB of JSON
  per `data/import` request, boundary fixes before phrases; each request broadcasts what changed
  (`vocab/changed`, `segmentation/changed`, `settings/changed`). A restore that stops halfway
  can be repeated: merging is idempotent.
- Export (`data/export`) returns the whole backup in one message: Chrome allows 64 MiB per
  message, a heavy user's backup is a few MB. Both methods answer extension pages only.

**Word lists** (`src/backup/word-export.ts`, `data/export-words`): learning (1–4), learning and
known, or all saved words and phrases, oldest first.

- Anki: tab-separated with Anki's header lines (`#separator:tab`, `#html:true`, `#columns:`,
  `#tags column:`), the plan's fields Thai, Romanization, Meaning, Sentence, Translation, Video
  link, plus tags `phasa phasa::learning-2` (and `phasa::phrase`). Fields are HTML-escaped and
  single-line; the word is bold in its line; the link opens the video at the line. Romanization in
  the system chosen in the settings; meanings from the dictionary, or the words of a phrase with
  their glosses. Our own word-list import reads the file back (first field, `#` lines skipped).
- CSV: RFC 4180, UTF-8 with a BOM (Excel then reads Thai), CRLF; cells that start like a formula
  (`= + - @`) get a leading apostrophe, since titles and glosses come from elsewhere.
- Files are saved from the page with a Blob link: no `downloads` permission (ADR 0001).

**Appearance settings** (`src/settings`, `src/ui/appearance.ts`), stored and broadcast like the
others:

- `theme` (system, light, dark) for Phasa's own pages: `data-theme` on `<html>`, cached in the
  extension's localStorage so a page doesn't flash the system theme before the settings arrive.
  UI on youtube.com keeps following YouTube's `<html dark>` (plan §10); the subtitles stay a dark
  box. Pages declare `color-scheme`, so form controls and scrollbars follow the theme; dark pages
  got their own tone colors.
- `thaiFont`: Noto Sans Thai Looped (default) or Noto Sans Thai, as the order of the bundled
  families in `--phasa-font-thai`.
- `subtitleSize`: 50–250 % of the default, which already follows the player's size.
- `toneColors`: custom `#rrggbb` colors for some or all tones, used everywhere (plan §5.1
  "единые во всём UI, настраиваемые"); null or a tone left out keeps the built-in colors, which
  are tuned for light pages, dark pages and the subtitle background. A full custom set replacing
  the built-in ones would have darkened the four untouched tones over the video as soon as one
  was changed. The options page previews the colors on a page and over the video.
- Applied as custom properties on a root element: `<html>` of pages, the overlay and the title
  badge on youtube.com. Sliders and color pickers save once they rest for 300 ms.

**Toolbar popup** (plan §10) replaces "the toolbar button opens the side panel": the video on
screen with its analysis badge, "Open the side panel" (`sidePanel.open` in the click's gesture),
quick settings, AI status with a quick "Continue with ChatGPT" for a returning account (a first
sign-in goes to the options page, which explains OpenAI's screens), and the options page. The
service worker sets `openPanelOnActionClick: false` explicitly: Chrome keeps that behavior across
updates.

**Options page**: sections Known words, Settings, AI, Import and export, My words, About, with a
sticky section bar. About carries the AGPL notice (no warranty, source link, license link), the
data and font licenses and what leaves the browser (ADR 0006).

**Error and empty states**: a content script cut off by an update (Chrome doesn't inject the new
one into open tabs) shows "Phasa was updated. Reload the page…" with a reload button instead of
silently losing the subtitles; filtered word lists say what they filtered; word-list and backup
files that are too large, unreadable, not a backup or from a newer version say so; choosing the
same backup file again works; the options page now loads the bundled Thai fonts too.

**Performance**:

- Captions cache: schema v4 adds `usedAt` (migrated from `fetchedAt`), touched when a page loads
  a cached track; tracks of the least recently used videos beyond 100 are deleted after each new
  video (about 0.5–1 MB each). Saved words keep their lines in `contexts`.
- `vocab/list` without a search or video filter reads only the page from the `updatedAt` index,
  not every saved word: onboarding and imports save thousands, and every status change reloads
  the list.
- A big word-list file is parsed directly instead of filling the text box (20 000 lines there
  froze the page).
- Measured in e2e (`tests/e2e/data.spec.ts`, bundled Chromium, headless): importing 20 000 known
  words 3.4 s; the options page with them reloaded and its first page of words shown 315 ms; the
  20-minute video analyzed in 208 ms with 20 000 known words (plan §7.5: < 500 ms).

## Consequences

- "Export → clean install → import" is an e2e test: the restored install exports the same backup,
  and the video shows the restored statuses and settings.
- New tables must be added to `BACKUP_TABLES` or `NOT_BACKED_UP`; a changed row shape needs a
  parser update in `src/backup/import.ts` and, if old files can't be read as is, a new backup
  `version`.
- Users who relied on the toolbar button opening the side panel now need one more click; Chrome's
  own side panel menu still opens it directly.
- Deferred: IPA as a third romanization system (plan §5.5 "опционально"), `.apkg` export (plan
  §2.1 "позже"), custom tone colors per background, plural forms in messages (Chrome i18n has none;
  counts are written as "words: 12").
