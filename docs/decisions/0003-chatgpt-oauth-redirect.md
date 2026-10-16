# 0003. Capturing the loopback OAuth redirect without a listener

- Status: Accepted — option A1
- Date: 2026-10-16
- Evidence: docs/plan.md §8.3; docs/spikes.md §2 (documentation check, pre-flight, live run)

## Context

Sign in with ChatGPT requires `redirect_uri=http://127.0.0.1:<port>/auth/callback` (only the port may
vary, no `localhost`). The docs say "start the listener before opening the browser". A Chrome extension
cannot listen on a port, and `chrome.identity.launchWebAuthFlow` uses `https://<id>.chromiumapp.org/`,
which is not allowed here.

## Options

- **A1** — DNR session rule redirects `^http://127\.0\.0\.1:1455/auth/callback\?(.*)$` to
  `chrome-extension://<id>/auth-callback.html?\1`.
- **A2** — `webNavigation.onBeforeNavigate` / `tabs.onUpdated` read the URL, then navigate the tab to our
  page.
- **B** — native-messaging helper with a real loopback listener.
- **C** — user's own OpenAI API key.

## Decision

**A1.** In the live run it completed first registration end-to-end: consent → our callback page →
code exchange → ID token verified against `https://auth.openai.com/.well-known/jwks.json` →
`/v1/models` → streaming `/v1/responses` from the service worker (plain, `json_schema`, a 117 s stream)
→ refresh with rotation. OpenAI did not object to the missing listener.

- The DNR rule exists only while a sign-in attempt is pending (session rule, removed after the
  callback).
- Phase 5 manifest additions: `declarativeNetRequestWithHostAccess`; host permissions
  `https://auth.openai.com/*`, `https://api.openai.com/*`, `http://127.0.0.1/*`; the callback page in
  `web_accessible_resources` for `https://auth.openai.com/*` and `http://127.0.0.1/*`.
- A2 stays a fallback (it worked live too); it would add `webNavigation`, so it is not shipped unless
  A1 breaks.
- C (API key) is always offered. B only if OpenAI starts rejecting A.

## Consequences

- Sign-out revokes the refresh token at `https://auth.openai.com/api/accounts/oauth/revoke` (from OIDC
  discovery; request format to verify), then clears tokens and keeps `client_id`, host id and email.
- Refresh near expiry, respecting `earliest_refresh_at` (advisory: an early refresh succeeded), one
  refresh at a time.
- The consent screen lets the user rename the agent and calls it unverified; our pre-sign-in copy must
  prepare the user for both.
- Every sign-in, including reauthorization with `id_token_hint`, shows the account chooser and
  consent. Reauthorization kept the issued `client_id` (the kit rejects a different one).
- A2 also completed a live sign-in, so the fallback is proven, not just designed.
- The service worker can restart while the user is on OpenAI's pages: the attempt lives in
  `chrome.storage.session`, the callback page reaches the SW with a one-shot message, and UI pages
  must re-subscribe to SW events after a restart.
