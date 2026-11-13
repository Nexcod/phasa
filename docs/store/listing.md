# Chrome Web Store listing

The text for each field of the Chrome Web Store developer dashboard (ADR 0017). The dashboard is
the source of truth once submitted; keep this file in step with it. Where the dashboard limits a
field, the limit is noted. Paste the descriptions as plain text: the store shows no Markdown.

## Package

Upload `phasa-<version>-chrome.zip` from the draft GitHub release of the version tag (or
`npm run zip && npm run package:check`). The name and summary come from the zip's manifest
(`public/_locales/en/messages.json`: `extName`, `extDescription`).

## Store listing tab

**Name** (from the manifest, ≤ 75): Phasa — learn Thai from videos

**Summary** (from the manifest, ≤ 132): Interactive Thai subtitles for YouTube: word lookups,
romanization, tones and known-word tracking.

**Category:** Education. **Language:** English.

**Description:**

```text
Phasa turns YouTube videos with Thai subtitles into Thai lessons. Watch what you like — vlogs, talks, series, cooking — and look up every word you don't know without leaving the video.

Subtitles you can read
• Thai and English subtitles over the player, in a clear Thai font with loops
• Romanization above or below the line (Paiboon+ or RTGS), tones in color and with tone marks
• Thin gaps or alternating underlines between words, since written Thai has no spaces
• Keys for the previous / next line, repeat, pause after each line

Words in one click
• Click a word: meaning, part of speech, classifier, syllables with their tones, frequency, and a Thai voice to hear it
• Drag across words to look up a phrase; fix word boundaries when the split is wrong
• Mark words as learning (1–4), known or ignored; they are colored in every video
• Saved words keep the line they came from and jump back to that moment in the video

Know before you watch
• Under the title: a level estimate, how much of the video you already know and how many new words it has
• The most useful new words to learn first, one click to learn them or mark them known
• Start fast: mark the most frequent words or Thai particles as known, or import a word list or an Anki deck

Side panel
• The full transcript next to the video, with the playing line, click to jump, and a filter for lines with new words
• Your saved words, for this video or all of them

Optional AI
• "Explain in context" and "Translate the line" with your ChatGPT Plus or Pro plan (Sign in with ChatGPT), or your own OpenAI API key
• Everything else works without AI, from Phasa's built-in dictionary

Your data stays yours
• No account, no server, no tracking: words and settings stay in your browser
• Back up and restore everything as a file; export your words for Anki or as CSV
• Text goes to OpenAI only when you ask for an AI answer

Works on YouTube videos that have Thai subtitles, made by the uploader or generated automatically. Videos without Thai subtitles are not supported.

Free and open source (GNU AGPL v3): https://github.com/Nexcod/phasa
Dictionary: English Wiktionary (CC BY-SA 4.0). Phasa is not affiliated with YouTube or OpenAI.
```

**Graphic assets** (`docs/store/`, see its README):

| Field              | File                                                                          |
| ------------------ | ----------------------------------------------------------------------------- |
| Store icon         | `public/icon/128.png`                                                         |
| Screenshots, order | `screenshots/1-word-popup.png` … `5-known-words.png` (1280×800, five of five) |
| Small promo tile   | `promo-small.png` (440×280)                                                   |
| Marquee promo tile | `promo-marquee.png` (1400×560)                                                |

**Official URL:** none (needs a verified site). **Homepage URL:** https://github.com/Nexcod/phasa
**Support URL:** https://github.com/Nexcod/phasa/issues. **Mature content:** no.

## Privacy practices tab

**Single purpose:**

```text
Phasa helps English speakers learn Thai from YouTube videos that have Thai subtitles: it shows the subtitles as interactive text with word lookups, romanization and tones, keeps track of which words the learner knows, and estimates how hard each video is for them. Optional AI explanations of words and lines use the learner's own ChatGPT plan or OpenAI API key.
```

**Permission justifications** (`scripts/check-package.ts` fails the build when the manifest asks
for anything else):

| Permission                            | Justification                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `storage`                             | Keeps a sign-in attempt (state, nonce, PKCE verifier) in session storage while the user is on OpenAI's sign-in page, and a small change signal in local storage so open video tabs, the side panel and the options page update together when the user's words change.                                                                                           |
| `unlimitedStorage`                    | The bundled Thai dictionary (17,000 entries, about 7 MB) and frequency list are loaded into the extension's IndexedDB on first use, next to the learner's vocabulary, cached subtitles of recently watched videos and saved AI answers. The default quota is not enough for the dictionary plus a growing vocabulary.                                           |
| `sidePanel`                           | The side panel shows the video's full transcript, the video's analysis and the learner's saved words next to the video.                                                                                                                                                                                                                                         |
| `declarativeNetRequestWithHostAccess` | Sign in with ChatGPT requires the redirect address http://127.0.0.1:1455/auth/callback. While a sign-in is in progress, one session rule redirects exactly that address to the extension's own callback page, so the sign-in can finish without a local server. The rule is removed when the sign-in ends. No other request is redirected, modified or blocked. |
| Host `*://*.youtube.com/*`            | The content scripts run on YouTube watch pages: they read the Thai subtitle track the player loads and show the interactive subtitles, word popups and the difficulty badge.                                                                                                                                                                                    |
| Host `https://auth.openai.com/*`      | Optional Sign in with ChatGPT: exchanging the authorization code, refreshing and revoking tokens, and checking the ID token's signature.                                                                                                                                                                                                                        |
| Host `https://api.openai.com/*`       | Optional AI: the explanations and translations the user asks for, and the list of models, with the user's ChatGPT plan or API key.                                                                                                                                                                                                                              |
| Host `http://127.0.0.1/*`             | Needed for the declarativeNetRequest redirect of OpenAI's loopback callback described above. Phasa sends no requests to it.                                                                                                                                                                                                                                     |

**Remote code:** No, I am not using remote code. (All scripts are in the package; AI answers are
JSON shown as text.)

**Data usage** — what Phasa handles, all of it on the device (the store asks for local handling
too); only the AI request text goes anywhere, to OpenAI, when the user asks:

| Category                     | Tick | Why                                                                                                                        |
| ---------------------------- | ---- | -------------------------------------------------------------------------------------------------------------------------- |
| Personally identifiable info | yes  | The email address of the ChatGPT account, if the user signs in ("Signed in as …"). Stored locally.                         |
| Health information           | no   |                                                                                                                            |
| Financial and payment info   | no   |                                                                                                                            |
| Authentication information   | yes  | OpenAI tokens or the user's API key, if AI is set up. Stored locally, sent only to OpenAI.                                 |
| Personal communications      | no   |                                                                                                                            |
| Location                     | no   |                                                                                                                            |
| Web history                  | yes  | IDs and titles of YouTube videos the user opened with Thai subtitles (cached subtitles, saved words' context). Local only. |
| User activity                | no   | Keys are handled as shortcuts on YouTube watch pages, never recorded.                                                      |
| Website content              | yes  | The video's subtitles and title. Stored locally; the lines around a word go to OpenAI when the user asks for an AI answer. |

Certify all three statements (no selling or transferring outside the approved uses, no use
unrelated to the single purpose, no creditworthiness or lending use).

**Privacy policy URL:** https://github.com/Nexcod/phasa/blob/main/PRIVACY.md

## Distribution tab

Free, public, all regions.

## Test instructions tab (for the reviewer)

```text
No account is needed for the main features. Open a YouTube video with Thai subtitles, for example https://www.youtube.com/watch?v=48A9SU6_bQ8 — Thai and English subtitles appear over the player within a few seconds; click any Thai word for its popup. The badge under the video title shows the analysis; the toolbar button opens a popup with a link to the side panel. The AI buttons are optional and need a ChatGPT Plus or Pro account (Options → AI → Continue with ChatGPT) or an OpenAI API key; without them everything else works.
```
