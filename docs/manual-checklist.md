# Manual checklist

Automation cannot load real captions (YouTube returns empty timedtext bodies to automated browsers,
docs/spikes.md §1), so these checks run by hand in a normal Chrome profile with the unpacked build
(`npm run build` → `chrome://extensions` → Load unpacked → `.output/chrome-mv3`). Videos:
`tests/e2e/videos.ts`. Open DevTools on the YouTube tab and filter the console by `[phasa]`.

## Every phase

- [ ] **Network e2e.** `npm run test:e2e:network` passes. Run it from a home connection: YouTube
      shows datacenter IPs, including CI runners, a bot check instead of the video
      ([ADR 0009](decisions/0009-network-e2e-runs-locally.md)).

## Phase 6 — data and polish

Use the production build in a profile with real data from the earlier phases: learning, known and
ignored words, a phrase, a boundary fix, a few AI answers, changed settings. For the update items
keep a build of the previous commit (`git stash`/`git worktree`, `npm run build`) at hand.
Covered by e2e, not repeated here: the restore cycle on the fake YouTube, Anki/CSV file contents,
settings reaching the open video, the popup's quick settings, the analysis with 20 000 known words
(`tests/e2e/data.spec.ts`).

All items passed on 2026-11-13, together with the network e2e (Every phase).

- [x] **Backup → clean install → restore (acceptance).** Options → Import and export → "Download
      backup": `phasa-backup-YYYY-MM-DD.json` is saved and "Saved … · words: …" shows. Open the
      file: no access, refresh or ID token, no `sk-` key. Write down the counts line under Known
      words. Remove Phasa at `chrome://extensions` and load the unpacked build again: Known words
      says 0 everywhere. Restore → choose the file: the preview's counts look right; "Restore".
      Then the counts line is the one written down; My words lists the words with their lines;
      on a video the statuses, the phrase as one unit and the boundary fix are back; the theme,
      font, size and colors are back; a word explained before shows its "saved answer" with no
      `responses` request in the service worker's Network tab. Options → AI still asks to sign
      in: the sign-in is not part of a backup.
- [x] **Merge.** Restore the same file again: every line says "0 added, 0 merged". Set a word that
      is learning in the backup to Known, restore: it stays Known. Mark a word Ignored, restore:
      it stays Ignored.
- [x] **Anki.** Export for Anki (Learning) and import it in Anki (File → Import): Anki takes tab
      as the separator, HTML and the tags column by itself; the six fields fill in order; the
      word is bold in its line; the link opens YouTube at that line. Export as CSV and open it in
      a spreadsheet: Thai is readable, one word per row.
- [x] **Settings on YouTube.** Options → Settings on a second monitor or window while a Thai video
      plays: "Noto Sans Thai" changes the subtitle letters at once (no loops); subtitle size
      150 % and 60 % in the default, theater and fullscreen views, no stacked mark cut (น้ำ, ที่);
      a custom tone color shows in the subtitles' romanization (R), in the word popup and in the
      side panel; "Use the default colors" brings back the built-in ones.
- [x] **Theme.** System dark with "Same as the system", then "Light" and "Dark": the side panel,
      the options page and the toolbar popup follow at once, also their checkboxes, selects and
      scrollbars; tone colors and the ChatGPT button are readable on both. On YouTube the badge
      under the title follows YouTube's own theme, not this setting.
- [x] **Toolbar popup.** The toolbar button opens a popup, not the side panel, also right after
      loading this build over the previous one. On a Thai video: its title and badge; "Open the
      side panel" opens the panel for this tab and closes the popup; the four quick settings
      change the subtitles at once; "Settings" opens the options page. With AI off it offers
      "Set up AI" (or "Continue with ChatGPT" after a sign-out); signed in it says AI is ready.
      On another site it says to open a YouTube video.
- [x] **Update notice.** With a Thai video open, reload Phasa at `chrome://extensions`: the player
      shows "Phasa was updated. Reload the page to see its subtitles again." with "Reload";
      clicking it reloads the tab and the subtitles come back. × hides the notice.
- [x] **Empty and error states.** Side panel → My words → "This video only" on a video without
      saved words: "No saved words from this video yet." Options → My words, search for a word
      you haven't saved: "No saved word contains …". Restore any other JSON file: "This file
      isn't a Phasa backup." Known words → import a file over
      10 MB: the size message, not "Couldn't mark the words".
- [x] **Speed with the restored data.** On the long video (`SVj46JwYnB4`) the badge's
      `data-analysis-ms` (see phase 4) stays under 500, and Options → My words shows its first
      page without a pause.

## Phase 5 — AI

Needs a ChatGPT Plus or Pro account. Use a development build (`npm run dev`, load
`.output/chrome-mv3-dev`) for the token item, the production build for the rest. Keep `npm run dev`
running while you use the development build: its side panel and options page load their code from
the dev server and stay blank without it. It is a separate extension, so sign in there again and
turn the production build off meanwhile. Keep DevTools
of the service worker open (`chrome://extensions` → Phasa → "service worker") on its Network tab:
requests to OpenAI show there, and nothing should go to OpenAI unless you ask. Write down what
OpenAI shows at each sign-in: docs and spike disagree (ADR 0014).

All items passed on 2026-11-02, together with the network e2e (Every phase).

- [x] **First sign-in.** Options → AI: the text warns that OpenAI calls Phasa unverified and
      lets you rename the agent. "Continue with ChatGPT" opens OpenAI in a new tab: account
      chooser, the agent name ("Phasa"), consent with "Use your ChatGPT plan". Then Phasa's page:
      "Connected ✓ as …", "You're using your ChatGPT plan", and its address bar shows no `code=`.
      "Got it" closes the tab; the options page says "Signed in as …" without a reload, and the
      model list's default names GPT-6-Luna, or the first model if OpenAI lists no GPT-6-Luna
      (ADR 0015).
- [x] **Explain.** On a video with Thai subtitles click a word: under the dictionary part,
      "Explain in context" and "Translate the line" with "Using ChatGPT plan · Manage usage".
      Explain: the meaning appears first and the rest follows within seconds; it fits this line.
      Translate the line: natural, literal, word by word. Close and reopen the word: both answers
      show at once marked "saved answer", and the Network tab has no new `responses` request.
- [x] **Phrase and side panel.** Select 2–3 words: the phrase popup has the same AI buttons.
      Side panel → hover a transcript line → AI → "Translate the line".
- [x] **Default model.** For the first listed model and two others (the spike listed GPT-6.1-Sol
      first; try the Luna ones), choose it in Options → AI, explain a new word, and read
      `data-first-ms` and `data-total-ms` of `[data-testid="phasa-ai-explain"]` (DevTools →
      Elements, inside the `phasa-overlay` shadow root). Note the numbers and whether the
      answers are good; a clearly faster model changes the default rule (ADR 0014).
- [x] **Sign in again.** Options → Sign out: no warning about an unconfirmed revocation.
      "Continue with ChatGPT" again: per OpenAI's docs only the account chooser shows (no name, no
      consent screen), then "Connected ✓". Note what appeared. Then "Forget account" and sign in:
      the full first-registration screens show again.
- [x] **Refresh after expiry.** Development build: Options → AI → Development → "Expire the
      access token now", then explain a word not asked before: it works without signing in, and
      the Network tab shows `oauth/token` before `responses`. Once more after the browser was
      closed for more than an hour: AI still works without signing in.
- [x] **Service worker asleep during sign-in.** Sign out, start the sign-in and wait 1–2 minutes
      on OpenAI's screen before continuing: it still ends in "Connected ✓".
- [x] **Usage limit.** Covered by e2e (`tests/e2e/ai.spec.ts`: the popup says the limit is
      reached, "Manage usage" first, linking to ChatGPT settings → Usage). If the real limit is
      hit, check the same message.
- [x] **Without AI.** Sign out: words, popups, badge, side panel and options all work. "Explain
      in context" says AI is off; "AI settings" opens the options page at the AI section.
- [x] **API key (optional, needs a platform key).** Options → AI → paste a key → "Key saved:
      sk-…" → choose a model → "Use for AI: My OpenAI API key": explain works and says "your API
      key". With the ChatGPT plan chosen and the fallback box ticked, the key answers only when
      the plan can't.

## Phase 4 — analysis and onboarding

Start from a fresh install (remove and load the unpacked build again) so the vocabulary is empty.
Use 3–4 of the acceptance videos, one of them long (`SVj46JwYnB4`).

All items passed on 2026-11-01, together with the network e2e (Every phase).

- [x] **Badge.** Under the video title: `B1 · 0% known · N new words`, red border (too hard)
      on a fresh install. In YouTube's dark theme it is readable too. On `jNQXAC9IVRw` it says "No
      Thai subtitles" in grey. Navigating to another video through recommendations, the badge
      follows without a reload.
- [x] **Speed.** On the long video, DevTools → Elements → the badge's `data-analysis-ms`
      (`phasa-badge` shadow root → `[data-testid="phasa-analysis"]`) is under 500.
- [x] **Live.** Mark a word known in the subtitles (click it, K): the badge's percentage goes up at
      once. Set it back to new (side panel → My words → Delete): it goes down.
- [x] **Details.** Click the badge: comprehension sentence, level and measures, the status bar,
      "Top new words to learn first" with meanings. "Learn" on one word: it turns yellow in the
      subtitles and side panel → My words lists it with its line. "Add top 10 to learning": 10
      more. "Mark all new words as known" asks first; after confirming, "0 new" and the subtitles
      have no blue underlines left except the learning words.
- [x] **Side panel.** The same badge above the tabs; "Only lines with new words" shows only those
      lines and follows status changes.
- [x] **Onboarding: particles and top N.** Options → Known words: "Mark these 9 particles as
      known". Then most frequent 1000 → "Review the list": the list shows Thai, romanization,
      meaning; the particles show as Known and can't be ticked. Untick two words, "Mark as known
      (…)". The counts line and the badge on an open video tab (without reloading it) change.
- [x] **Onboarding: import.** Import a TXT file with one word per line, and an Anki deck exported
      as "Notes in Plain Text" (.txt) whose first field is Thai: the "Entries with Thai" count is
      right, "Mark them as known" changes the counts and the badge of an open video tab right away
      — also after leaving the options page idle for a minute first (the service worker sleeps).

## Phase 3 — words

Do these on 3–4 of the acceptance videos (one manual-Thai, one auto-generated, one long). The first
video after installing loads the dictionary into IndexedDB; words become clickable a few seconds
after the subtitles appear.

All items passed on 2026-11-01, together with the network e2e (Every phase).

- [x] **Gold set.** `tests/fixtures/segmentation.tsv` has ≥ 200 real cues from ≥ 10 videos (manual and asr), captured per its README and reviewed against the convention; `npm test` still passes (F1 ≥ 0.90) and `npm run seg:eval` reports the numbers for the acceptance note. Done 2026-11-01: 249 real cues from 13 videos, F1 0.963 (ADR 0010); native-speaker review open.
- [x] **Words.** Thai subtitles are split into words: the line reads exactly as before, nothing is
      cut inside a stacked mark (น้ำ, ที่). With side panel → Word boundaries, "Thin gaps" and
      "Alternating underline" mark the words; "None" doesn't.
- [x] **Popup speed.** Click 10 different words: each popup appears at once (< 100 ms; the popup's
      `data-open-ms` attribute in DevTools shows the time).
- [x] **Popup content.** For a common word: Paiboon romanization with tone colors and diacritics,
      "Pronounced: …" syllables, part of speech, glosses, the classifier of a noun, the frequency
      rank. For a word the dictionary lacks: "Made of" parts or an "approximate" romanization. The
      🔊 button reads the word with a Thai voice, or says no Thai voice is installed.
- [x] **Pause.** Clicking a word while the video plays pauses it; Esc, × or a click outside closes the popup and playback continues. A click on the video only closes the popup: playback must not stop again a moment later. With "Pause when I open a word" off, it keeps playing.
- [x] **Status keys.** In the popup, 1–4, 5/K and X set learning 1–4, known and ignored; YouTube
      doesn't seek (digits) or pause (K). The word's highlight changes in the subtitles at once.
- [x] **Context.** Side panel → My words lists the saved words with the line, its translation and
      "Open at m:ss"; clicking it seeks in the same video or opens the other video at that time.
      The options page lists them too; changing a status or deleting there updates the subtitles.
- [x] **Phrases.** Pause the video first (Space), so the line stays on screen.
  1. In the Thai line, press the mouse on the first of 2–3 neighbouring words, drag to the last one
     and release. A phrase popup opens: the selected text, its romanization and, under "Words", each
     word with its meaning.
  2. Press 1 (or click "1"): the phrase is saved. In the subtitles it now shows as one highlighted
     piece (saved phrases become one unit, plan §5.3), and side panel → My words lists it with the
     line it came from.
  3. Select 2–3 other words with no space between them and click "Make it one word": they become
     one word in this line, in any other line with the same words, and after a page reload. Undo:
     click that word → "Wrong word boundaries?" → click between the letters where the boundary was.
- [x] **Boundary fixes.** "Wrong word boundaries?" → join with the next word, and split a word by
      clicking between its letters: the subtitles and the popup follow at once, also after a reload.
- [x] **Romanization.** R shows romanization over the words (side panel: above / below, Paiboon+ /
      RTGS); R again hides it. Fullscreen and theater mode keep the popup inside the player.
- [x] **Keyboard.** W opens the popup of the first word of the line; Q / E move it to the previous / next word; 1–4 / K / X set the status of the word reached; W or Esc closes. YouTube's own keys (J, L, arrows, F, M) still work while no popup is open.

## Phase 2 — captions and rendering

All items passed on 2026-10-28, together with the network e2e (Every phase).

- [x] **Speed.** For each of the 10 acceptance videos, the console shows
      `[phasa] Thai captions ready in N ms` with N < 3000. Do it once with YouTube captions off
      and once with them on.
- [x] **Track choice.** Manual-Thai videos show the manual text: punctuation and sentence-like
      lines. `pBoQcFogon8` and `pxLHURprYuI` show the auto-generated text, and the overlay chip
      says "Auto-generated captions — may contain errors" when the controls are visible.
- [x] **English line.** Present on all 10. On `6FGHJxEx6Ts`, `PoautAigKP8`, `uYEW8BeJ0zY` and
      `0DVrEKzzYEQ` it comes from the uploader's English track, elsewhere from YouTube's
      translation.
- [x] **No Thai.** `jNQXAC9IVRw`: no subtitles. Hovering shows the grey "No Thai subtitles" chip,
      and YouTube's own captions behave as usual.
- [x] **SPA navigation.** Click through 3–4 recommendations without reloading. Subtitles switch
      each time, and the old video's subtitles never show over the new one.
- [x] **Theater and fullscreen.** Toggle theater (YouTube's button) and fullscreen (F). Subtitles
      stay visible, scale with the player and sit above the control bar while it is shown.
- [x] **Hotkeys.** A / D previous / next line, S repeat, Space play/pause, T translation on/off.
      Repeat with the **Thai keyboard layout** active. Typing in the search box and in comments is
      unaffected.
- [x] **Auto-pause.** Side panel → "Pause after each line": playback stops at the end of each line.
      Space continues to the next line.
- [x] **Side panel.** The transcript lists every line, the playing line is highlighted and
      followed, and clicking a line seeks there. Switching to a non-YouTube tab shows the empty
      state.
- [x] **Caption preference untouched.** With YouTube captions off, watch 3 Thai videos, then open
      a non-Thai video: CC is still off. Compare `yt-player-caption-sticky-language` and
      `yt-player-caption-persistence` in youtube.com localStorage before and after: they are
      identical.
- [x] **Cache.** Reopen a video watched earlier: subtitles appear without a forced CC flicker, and
      the Network tab shows no new `timedtext` request.
- [x] **Ads.** On a video with a pre-roll ad, no subtitles show during the ad; they appear after it.
- [x] **Fonts.** In a dev build (`npm run dev`), `chrome-extension://<id>/fonts-test.html` says "all
      checks passed" and no stacked mark (น้ำ, ที่, ปู่, ญี่ปุ่น) is cut. On youtube.com, the
      subtitles use the looped font.
