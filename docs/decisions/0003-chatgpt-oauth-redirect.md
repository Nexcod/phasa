# 0003. Capturing the loopback OAuth redirect without a listener

- Status: **Proposed** — waiting for the live SIWC spike run (docs/spikes.md §2)
- Date: 2026-10-16
- Evidence: docs/plan.md §8.3; docs/spikes.md §2 (documentation check)

## Context

Sign in with ChatGPT requires `redirect_uri=http://127.0.0.1:<port>/auth/callback` (only the port may
vary, no `localhost`). The docs say "start the listener before opening the browser". A Chrome extension
cannot listen on a port, and `chrome.identity.launchWebAuthFlow` uses `https://<id>.chromiumapp.org/`,
which is not allowed here.

## Options

- **A1** — DNR session rule redirects `^http://127\.0\.0\.1:1455/auth/callback\?(.*)$` to
  `chrome-extension://<id>/auth-callback.html?\1`. Needs `declarativeNetRequestWithHostAccess`,
  host permission `http://127.0.0.1/*`, the page in `web_accessible_resources`. The user sees our
  "Connected ✓" page. The rule exists only during a sign-in attempt.
- **A2** — `webNavigation.onBeforeNavigate` / `tabs.onUpdated` read the URL, then navigate the tab to our
  page. Needs `webNavigation` (or `tabs`). The browser may flash a connection error.
- **B** — native-messaging helper with a real loopback listener. Officially clean, separate install.
- **C** — user's own OpenAI API key. Always available, same Responses client.

## Proposed decision

A1 as primary, A2 as automatic fallback if A1's redirect doesn't fire, C always offered, B only if
OpenAI starts rejecting A. AI features stay optional: the app is fully usable without them.

## To confirm before Accepted

- A1 and A2 both capture `code` + `state` (+ `client_id`) and the exchange succeeds.
- Reauthorization with `id_token_hint` skips the consent screen.
- `json_schema` structured output works on this route (otherwise zod validation + one retry).
- Streaming from the SW survives > 30 s while a port is open.
- The JWKS URL and whether a revocation endpoint exists (for "Sign out").
