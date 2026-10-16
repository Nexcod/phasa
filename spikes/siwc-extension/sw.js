// Phasa SIWC spike service worker (docs/spikes.md §2).
// Flow per https://developers.openai.com/siwc/token-sharing-open-source/sign-in
// Tokens live only here and in chrome.storage.local; logs show masked values.

const AUTH = 'https://auth.openai.com';
const AUTHORIZE_URL = `${AUTH}/api/accounts/authorize`;
const TOKEN_URL = `${AUTH}/api/accounts/oauth/token`;
const API = 'https://api.openai.com/v1';
const LOOPBACK_PORT = 1455;
const REDIRECT_URI = `http://127.0.0.1:${LOOPBACK_PORT}/auth/callback`;
const SCOPE = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
const CALLBACK_PAGE = chrome.runtime.getURL('callback.html');
const DNR_RULE_ID = 1;

// ---------------------------------------------------------------- utilities
const ports = new Set();

function log(...parts) {
  const line = parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join(' ');
  console.log('[siwc-spike]', line);
  for (const port of ports) port.postMessage({ type: 'log', line });
}

const mask = (token) =>
  typeof token === 'string' ? `${token.slice(0, 6)}…(${token.length})` : token;

function b64url(bytes) {
  let binary = '';
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function b64urlDecode(text) {
  const base64 = text.replaceAll('-', '+').replaceAll('_', '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

const randomToken = () => b64url(crypto.getRandomValues(new Uint8Array(32)));
const sha256 = (text) => crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));

const local = {
  get: async (key) => (await chrome.storage.local.get(key))[key],
  set: (key, value) => chrome.storage.local.set({ [key]: value }),
  remove: (keys) => chrome.storage.local.remove(keys),
};

async function hostId() {
  let id = await local.get('hostId');
  if (!id) {
    id = `urn:uuid:${crypto.randomUUID()}`;
    await local.set('hostId', id);
  }
  return id;
}

async function state() {
  const { tokens, clientId, account } = await chrome.storage.local.get([
    'tokens',
    'clientId',
    'account',
  ]);
  return {
    hostId: await hostId(),
    clientId: clientId ?? null,
    account: account ?? null,
    signedIn: Boolean(tokens?.access_token),
    scopes: tokens?.scope ?? null,
    aiEnabled: Boolean(tokens?.scope?.split(' ').includes('chatgpt.tokens.use.direct')),
    expiresAt: tokens?.expires_at ? new Date(tokens.expires_at).toISOString() : null,
  };
}

async function broadcastState() {
  const snapshot = await state();
  for (const port of ports) port.postMessage({ type: 'state', state: snapshot });
}

// ---------------------------------------------------------------- sign-in
async function signIn(mode) {
  const issuedClientId = await local.get('clientId');
  const account = await local.get('account');
  const retainedIdToken = await local.get('retainedIdToken');
  const attempt = {
    mode,
    state: randomToken(),
    nonce: randomToken(),
    verifier: randomToken(),
    startedAt: Date.now(),
  };
  const params = new URLSearchParams({
    client_id: issuedClientId ?? 'dynamic_agent_client',
    ext_agent_host_id: await hostId(),
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    scope: SCOPE,
    resource: API,
    state: attempt.state,
    nonce: attempt.nonce,
    code_challenge: b64url(await sha256(attempt.verifier)),
    code_challenge_method: 'S256',
  });
  if (!issuedClientId) params.set('agent_name_hint', 'Phasa');
  if (issuedClientId && retainedIdToken) params.set('id_token_hint', retainedIdToken);
  if (issuedClientId && account?.email) params.set('login_hint', account.email);

  await chrome.storage.session.set({ attempt });
  if (mode === 'A1') {
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [DNR_RULE_ID],
      addRules: [
        {
          id: DNR_RULE_ID,
          priority: 1,
          action: { type: 'redirect', redirect: { regexSubstitution: `${CALLBACK_PAGE}?\\1` } },
          condition: {
            regexFilter: `^http://127\\.0\\.0\\.1:${LOOPBACK_PORT}/auth/callback\\?(.*)$`,
            resourceTypes: ['main_frame'],
          },
        },
      ],
    });
  } else {
    await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [DNR_RULE_ID] });
  }
  const tab = await chrome.tabs.create({ url: `${AUTHORIZE_URL}?${params}` });
  await chrome.storage.session.set({ attempt: { ...attempt, tabId: tab.id } });
  log(
    `sign-in ${mode}: opened authorize (${issuedClientId ? 'reauthorization' : 'first registration'})`,
    {
      hints: { id_token_hint: params.has('id_token_hint'), login_hint: params.has('login_hint') },
    },
  );
}

// A2: observe the navigation to the (non-listening) loopback address.
chrome.webNavigation.onBeforeNavigate.addListener(
  (details) =>
    void onLoopbackNavigation(details.tabId, details.url, 'webNavigation.onBeforeNavigate'),
  { url: [{ hostEquals: '127.0.0.1', ports: [LOOPBACK_PORT], pathEquals: '/auth/callback' }] },
);
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.url?.startsWith(REDIRECT_URI))
    void onLoopbackNavigation(tabId, info.url, 'tabs.onUpdated');
});

const handledStates = new Set(); // both A2 listeners can fire for the same navigation

async function onLoopbackNavigation(tabId, url, via) {
  const { attempt } = await chrome.storage.session.get('attempt');
  if (attempt?.mode !== 'A2' || handledStates.has(attempt.state)) return;
  handledStates.add(attempt.state);
  log(`A2: saw loopback navigation via ${via}`);
  const result = await handleCallback(new URL(url).search);
  const query = new URLSearchParams({
    phasa_result: result.ok ? 'ok' : 'error',
    message: result.message,
  });
  await chrome.tabs.update(tabId, { url: `${CALLBACK_PAGE}?${query}` });
}

async function handleCallback(search) {
  const query = new URLSearchParams(search);
  const { attempt } = await chrome.storage.session.get('attempt');
  try {
    if (!attempt) throw new Error('no sign-in attempt in progress');
    log('callback params:', [...query.keys()]);
    if (query.get('state') !== attempt.state) throw new Error('state mismatch');
    if (query.get('error'))
      throw new Error(
        `authorization error: ${query.get('error')} ${query.get('error_description') ?? ''}`,
      );

    const saved = await local.get('clientId');
    const returned = query.get('client_id');
    if (returned && saved && returned !== saved)
      throw new Error('returned client_id differs from the saved one');
    const clientId = returned ?? saved;
    if (!clientId) throw new Error('no issued client_id returned on first registration');
    if (!saved) await local.set('clientId', clientId); // persist before the exchange (docs)
    log('issued client_id:', clientId, '| granted scope param:', query.get('scope'));

    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: clientId,
        code: query.get('code') ?? '',
        code_verifier: attempt.verifier,
        redirect_uri: REDIRECT_URI,
        resource: API,
      }),
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`token exchange ${response.status}: ${JSON.stringify(json)}`);
    log('token response fields:', Object.keys(json), {
      access_token: mask(json.access_token),
      refresh_token: mask(json.refresh_token),
      expires_in: json.expires_in,
      scope: json.scope,
      earliest_refresh_at: json.earliest_refresh_at,
    });

    const claims = await verifyIdToken(json.id_token, clientId, attempt.nonce);
    await saveTokens(json);
    await local.set('account', { sub: claims.sub, email: claims.email ?? null });
    await local.set('retainedIdToken', json.id_token);
    if (!json.scope?.split(' ').includes('chatgpt.tokens.use.direct')) {
      log('⚠ chatgpt.tokens.use.direct NOT granted — AI must stay disabled');
    }
    return { ok: true, message: `Connected as ${claims.email ?? claims.sub}` };
  } catch (error) {
    log('✗ callback failed:', String(error));
    return { ok: false, message: String(error.message ?? error) };
  } finally {
    await chrome.storage.session.remove('attempt');
    await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [DNR_RULE_ID] });
    await broadcastState();
  }
}

async function verifyIdToken(idToken, clientId, nonce) {
  const [rawHeader, rawPayload, rawSignature] = idToken.split('.');
  const header = JSON.parse(new TextDecoder().decode(b64urlDecode(rawHeader)));
  const claims = JSON.parse(new TextDecoder().decode(b64urlDecode(rawPayload)));

  let jwksUri = `${AUTH}/.well-known/jwks.json`;
  try {
    const discovery = await (await fetch(`${AUTH}/.well-known/openid-configuration`)).json();
    if (discovery.jwks_uri) jwksUri = discovery.jwks_uri;
    log('OIDC discovery:', {
      issuer: discovery.issuer,
      jwks_uri: discovery.jwks_uri,
      revocation_endpoint: discovery.revocation_endpoint,
    });
  } catch (error) {
    log('OIDC discovery unavailable, falling back to', jwksUri, String(error));
  }
  const { keys } = await (await fetch(jwksUri)).json();
  const jwk = keys.find((key) => key.kid === header.kid);
  if (!jwk) throw new Error(`no JWKS key for kid ${header.kid}`);
  if (header.alg !== 'RS256') throw new Error(`spike only verifies RS256, got ${header.alg}`);
  const key = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const signatureOk = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    b64urlDecode(rawSignature),
    new TextEncoder().encode(`${rawHeader}.${rawPayload}`),
  );
  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  const checks = {
    signature: signatureOk,
    iss: claims.iss,
    issOk: claims.iss === AUTH || claims.iss === `${AUTH}/`,
    audOk: audience.includes(clientId),
    expOk: claims.exp * 1000 > Date.now(),
    nonceOk: claims.nonce === nonce,
  };
  log('id_token checks:', checks, 'claims:', Object.keys(claims));
  if (!checks.signature || !checks.issOk || !checks.audOk || !checks.expOk || !checks.nonceOk) {
    throw new Error(`id_token validation failed: ${JSON.stringify(checks)}`);
  }
  return claims;
}

async function saveTokens(json) {
  const previous = (await local.get('tokens')) ?? {};
  await local.set('tokens', {
    access_token: json.access_token,
    refresh_token: json.refresh_token ?? previous.refresh_token,
    id_token: json.id_token ?? previous.id_token,
    scope: json.scope ?? previous.scope,
    expires_at: Date.now() + (json.expires_in ?? 3600) * 1000,
    earliest_refresh_at: json.earliest_refresh_at ?? null,
    saved_at: Date.now(),
  });
}

// ---------------------------------------------------------------- tokens
let refreshing = null;

function refresh() {
  // Serialize: the refresh token rotates, concurrent refreshes would race.
  refreshing ??= (async () => {
    const tokens = await local.get('tokens');
    const clientId = await local.get('clientId');
    if (!tokens?.refresh_token || !clientId) throw new Error('not signed in');
    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: clientId,
        refresh_token: tokens.refresh_token,
        resource: API,
      }),
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`refresh ${response.status}: ${JSON.stringify(json)}`);
    log(
      'refreshed; rotated refresh_token:',
      json.refresh_token !== tokens.refresh_token,
      'fields:',
      Object.keys(json),
    );
    await saveTokens(json);
    await broadcastState();
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

async function accessToken() {
  const tokens = await local.get('tokens');
  if (!tokens?.access_token) throw new Error('not signed in');
  if (tokens.expires_at - Date.now() < 60_000) {
    await refresh();
    return (await local.get('tokens')).access_token;
  }
  return tokens.access_token;
}

// ---------------------------------------------------------------- API calls
async function listModels() {
  const response = await fetch(`${API}/models`, {
    headers: { Authorization: `Bearer ${await accessToken()}` },
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`models ${response.status}: ${JSON.stringify(json)}`);
  const all = json.models ?? json.data ?? [];
  log(
    '/v1/models top-level keys:',
    Object.keys(json),
    '| first model keys:',
    Object.keys(all[0] ?? {}),
  );
  const visible = all.filter((m) => m.visibility === undefined || m.visibility === 'list');
  return visible.map((m) => ({
    slug: m.slug ?? m.id,
    displayName: m.display_name ?? m.slug ?? m.id,
  }));
}

const WORD_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['meaning_in_context', 'romanization_paiboon', 'register', 'example_th', 'example_en'],
  properties: {
    meaning_in_context: { type: 'string' },
    romanization_paiboon: { type: 'string' },
    register: { type: 'string' },
    example_th: { type: 'string' },
    example_en: { type: 'string' },
  },
};

async function* sse(response) {
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let boundary;
    while ((boundary = buffer.search(/\r?\n\r?\n/)) >= 0) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary).replace(/^\r?\n\r?\n/, '');
      const data = block
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n');
      if (data && data !== '[DONE]') yield JSON.parse(data);
    }
  }
}

async function respond(port, { model, prompt, structured }) {
  const body = {
    model,
    instructions: 'You are a concise Thai tutor for English speakers.',
    input: [{ role: 'user', content: prompt }],
    store: false,
    stream: true,
  };
  if (structured)
    body.text = {
      format: { type: 'json_schema', name: 'thai_word', strict: true, schema: WORD_SCHEMA },
    };

  const started = performance.now();
  const response = await fetch(`${API}/responses`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  log(
    `/v1/responses → ${response.status} (${structured ? 'json_schema' : 'plain'}), request-id ${response.headers.get('x-request-id')}`,
  );
  if (!response.ok) throw new Error(`responses ${response.status}: ${await response.text()}`);

  let text = '';
  let firstDeltaMs = null;
  let terminal = null;
  const eventTypes = new Map();
  for await (const event of sse(response)) {
    eventTypes.set(event.type, (eventTypes.get(event.type) ?? 0) + 1);
    if (event.type === 'response.output_text.delta') {
      firstDeltaMs ??= Math.round(performance.now() - started);
      text += event.delta;
      port.postMessage({ type: 'delta', delta: event.delta });
    } else if (
      ['response.completed', 'response.failed', 'response.incomplete', 'error'].includes(event.type)
    ) {
      terminal = event;
    }
  }
  const summary = {
    terminal: terminal?.type ?? 'stream ended without terminal event',
    errorCode: terminal?.response?.error?.code ?? terminal?.code ?? null,
    incompleteReason: terminal?.response?.incomplete_details?.reason ?? null,
    firstDeltaMs,
    totalMs: Math.round(performance.now() - started),
    events: Object.fromEntries(eventTypes),
  };
  if (structured && summary.terminal === 'response.completed') {
    try {
      summary.jsonValid = Boolean(JSON.parse(text));
    } catch {
      summary.jsonValid = false;
    }
  }
  log('stream summary:', summary);
  return summary;
}

// ---------------------------------------------------------------- wiring
chrome.action.onClicked.addListener(() =>
  chrome.tabs.create({ url: chrome.runtime.getURL('spike.html') }),
);

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'callback') return false;
  handleCallback(message.search).then(sendResponse);
  return true;
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'spike') return;
  ports.add(port);
  port.onDisconnect.addListener(() => ports.delete(port));
  void broadcastState();
  port.onMessage.addListener(async ({ cmd, args }) => {
    try {
      let result;
      if (cmd === 'signIn') result = await signIn(args.mode);
      else if (cmd === 'refresh') result = await refresh();
      else if (cmd === 'models') result = await listModels();
      else if (cmd === 'respond') result = await respond(port, args);
      else if (cmd === 'signOut') {
        // Docs: clear tokens, keep client/account mapping + host id. No revoke endpoint documented.
        await local.remove(['tokens', 'retainedIdToken']);
      } else if (cmd === 'forget') await chrome.storage.local.clear();
      else if (cmd === 'expire') {
        const tokens = await local.get('tokens');
        if (tokens) await local.set('tokens', { ...tokens, expires_at: Date.now() - 1 });
      }
      port.postMessage({ type: 'result', cmd, result });
    } catch (error) {
      log(`✗ ${cmd} failed:`, String(error));
      port.postMessage({ type: 'result', cmd, error: String(error.message ?? error) });
    }
    await broadcastState();
  });
});
