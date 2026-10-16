// A1: DNR redirected http://127.0.0.1:1455/auth/callback?code=… here — hand the query to the SW.
// A2: the SW already handled the callback and navigated here with ?phasa_result=…
const status = document.getElementById('status');
const query = new URLSearchParams(location.search);

function show(ok, message) {
  status.textContent = ok
    ? `Connected ✓ — ${message}. You can close this tab.`
    : `Sign-in failed: ${message}`;
  document.title = ok ? 'Phasa — connected' : 'Phasa — sign-in failed';
}

if (query.has('phasa_result')) {
  show(query.get('phasa_result') === 'ok', query.get('message') ?? '');
} else {
  const result = await chrome.runtime.sendMessage({ type: 'callback', search: location.search });
  // Drop code/state from the address bar and history.
  history.replaceState(null, '', location.pathname);
  show(result?.ok, result?.message ?? 'no response from the service worker');
}
