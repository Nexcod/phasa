# Phasa privacy policy

Effective 2026-11-13. Applies to the Phasa browser extension, version 1.0.0 and later.

**In short:** Phasa has no server, no account, no analytics and no ads. What you save stays in
your browser. Text goes to OpenAI only when you sign in to ChatGPT or add your own OpenAI API key
and then ask for an AI answer, and it goes from your browser straight to OpenAI. The developer
receives nothing.

## What Phasa stores, and where

Everything below is stored only in your browser, in the extension's own storage (IndexedDB and
`chrome.storage`), which websites, including YouTube, cannot read:

- **Your vocabulary:** the words and phrases you mark (new, learning, known, ignored), the
  subtitle line you saved each one from with its English line, the video's ID, title and channel,
  and the time in the video; your word-boundary fixes.
- **Video data:** the Thai and English subtitles of videos you open on YouTube (for the 100 most
  recently used videos), and each video's word analysis.
- **Settings:** your appearance, subtitle and AI preferences.
- **Saved AI answers:** the explanations and translations you asked for (up to 5,000), so they show
  again without a new request.
- **The dictionary and word frequency list** that ship with Phasa.
- **AI sign-in, only if you set up AI:** for Sign in with ChatGPT, the tokens OpenAI issues, your
  ChatGPT account's email address and user ID (shown as "Signed in as …"), the client ID OpenAI
  assigned to Phasa and a random installation ID OpenAI asks for; or the OpenAI API key you
  entered. Only Phasa's background service worker reads them; they are never shown to web pages.

Backup files you download from Options → Import and export are saved where you choose. They hold
your vocabulary, settings, video data and saved AI answers, but never the sign-in tokens or an API
key.

## What leaves your browser

- **YouTube.** Phasa works on YouTube watch pages. To show subtitles it uses the subtitle requests
  YouTube's own player makes, and may repeat them to YouTube in another format or with YouTube's
  English translation. These requests go to YouTube with your YouTube session, as the player's own
  requests do; YouTube's privacy policy applies to them. Phasa sends nothing else to YouTube.
- **OpenAI — only if you choose to use AI.** When you click "Continue with ChatGPT", OpenAI's
  sign-in page opens in a tab, and Phasa then exchanges and periodically renews the sign-in with
  `auth.openai.com`. While you're signed in, the AI settings ask `api.openai.com` for the list of
  models. When you click "Explain in context" or "Translate the line", Phasa sends OpenAI the word
  or phrase, the subtitle line with its English line, up to two lines before and after it, and the
  video's title. With your own API key, the same requests go to OpenAI with that key, and the key
  is checked with OpenAI once when you save it. Requests ask OpenAI not to store the response
  (`store: false`). OpenAI's privacy policy and terms apply to what you send to OpenAI, and AI
  requests count toward your ChatGPT plan's usage limits or your API account.
- **Speech.** The 🔊 button uses Chrome's text-to-speech with a Thai voice. If that voice is an
  online voice (for example one of Google's), Chrome sends the word to that voice's service.

Phasa never sends your vocabulary, your browsing history or anything about other websites to
anyone. It runs only on `youtube.com`, and on OpenAI's sign-in redirect while you sign in.

## Sharing and use

The developer collects no data and has no server to collect it on. Phasa does not sell or transfer
your data, does not use it for advertising, and does not use it for anything other than its single
purpose: helping you learn Thai from videos with Thai subtitles. The use of information received
from Chrome's APIs adheres to the
[Chrome Web Store User Data Policy](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq),
including the Limited Use requirements.

## Your control

- **Delete words:** Options → My words or the side panel's My words ("Delete"), or "Remove from
  my words" in a word's popup.
- **Sign out of ChatGPT:** Options → AI → Sign out deletes the tokens and asks OpenAI to revoke
  them; "Forget account" also deletes the account's email and the client ID. "Remove key" deletes
  an API key. You can also revoke Phasa's access in your ChatGPT settings.
- **Delete everything:** remove Phasa at `chrome://extensions`. Chrome deletes all of the data
  above with it, except backup files you downloaded. Sign out first if you want OpenAI to revoke
  the ChatGPT sign-in right away.

## Changes and contact

Changes to this policy are published in this file, with a new effective date; the history is in
the repository. Questions: open an issue at <https://github.com/Nexcod/phasa/issues>.
