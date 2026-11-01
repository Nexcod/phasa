/**
 * Sign in with ChatGPT: the OAuth pieces that need no browser API (docs/plan.md §8.2,
 * docs/decisions/0003-chatgpt-oauth-redirect.md). Endpoints and parameters follow OpenAI's
 * "Registration and sign-in" and "Accounts and sessions" pages, checked on 2026-11-01.
 */
import type { SignInFailure } from '../messaging/ai';

export const AUTH_ORIGIN = 'https://auth.openai.com';
export const ISSUER = 'https://auth.openai.com';
export const AUTHORIZE_URL = `${AUTH_ORIGIN}/api/accounts/authorize`;
export const TOKEN_URL = `${AUTH_ORIGIN}/api/accounts/oauth/token`;
export const DISCOVERY_URL = `${AUTH_ORIGIN}/.well-known/openid-configuration`;
export const JWKS_URL = `${AUTH_ORIGIN}/.well-known/jwks.json`;
/** From OIDC discovery in the spike (docs/spikes.md §2); discovery is asked first. */
export const REVOCATION_URL = `${AUTH_ORIGIN}/api/accounts/oauth/revoke`;
export const API_RESOURCE = 'https://api.openai.com/v1';
export const LOOPBACK_PORT = 1455;
/** Never listened on: a DNR rule sends the browser to auth-callback.html instead (ADR 0003). */
export const REDIRECT_URI = `http://127.0.0.1:${LOOPBACK_PORT}/auth/callback`;
export const PLAN_SCOPE = 'chatgpt.tokens.use.direct';
export const SCOPE = `openid profile email offline_access resource.invoke ${PLAN_SCOPE}`;
export const DYNAMIC_CLIENT_ID = 'dynamic_agent_client';
export const AGENT_NAME = 'Phasa';
/** A sign-in tab left open longer than this can't finish; the user starts again. */
export const ATTEMPT_TTL_MS = 30 * 60_000;

/** One sign-in attempt, kept in chrome.storage.session while the user is on OpenAI's pages. */
export interface SignInAttempt {
  state: string;
  nonce: string;
  verifier: string;
  startedAt: number;
  /** The issued client id the attempt was started with; null = first registration. */
  clientId: string | null;
  /** The tab that started it, focused again afterwards. */
  openerTabId?: number;
}

export interface TokenSet {
  accessToken: string;
  refreshToken: string;
  idToken: string;
  /** Granted scopes, space-separated. */
  scope: string;
  expiresAt: number;
  /** OpenAI's suggested earliest refresh (advisory: an earlier refresh worked, spike §2). */
  earliestRefreshAt?: number;
}

/** An error from OpenAI's OAuth endpoints, with its machine-readable code. */
export class OAuthError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message = code,
  ) {
    super(message);
    this.name = 'OAuthError';
  }
}

export function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

/** 32 random bytes, base64url: state, nonce and PKCE verifier (43 characters). */
export function randomToken(): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(32)));
}

/** PKCE S256: base64url(sha256(verifier)) without padding. */
export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

export function newHostId(): string {
  return `urn:uuid:${crypto.randomUUID()}`;
}

export function newAttempt(
  clientId: string | null,
  now: number,
  openerTabId?: number,
): SignInAttempt {
  const attempt: SignInAttempt = {
    state: randomToken(),
    nonce: randomToken(),
    verifier: randomToken(),
    startedAt: now,
    clientId,
  };
  if (openerTabId !== undefined) attempt.openerTabId = openerTabId;
  return attempt;
}

/**
 * The authorize URL. First registration: `dynamic_agent_client` + `agent_name_hint`.
 * Reauthorization: the issued client id, `id_token_hint` (may be expired) and `login_hint`;
 * OpenAI then skips the account chooser and consent.
 */
export async function authorizeUrl(options: {
  attempt: SignInAttempt;
  hostId: string;
  idTokenHint?: string | undefined;
  loginHint?: string | undefined;
}): Promise<string> {
  const { attempt } = options;
  const params = new URLSearchParams({
    client_id: attempt.clientId ?? DYNAMIC_CLIENT_ID,
    ext_agent_host_id: options.hostId,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    scope: SCOPE,
    resource: API_RESOURCE,
    state: attempt.state,
    nonce: attempt.nonce,
    code_challenge: await pkceChallenge(attempt.verifier),
    code_challenge_method: 'S256',
  });
  if (attempt.clientId === null) {
    params.set('agent_name_hint', AGENT_NAME);
  } else {
    if (options.idTokenHint) params.set('id_token_hint', options.idTokenHint);
    if (options.loginHint) params.set('login_hint', options.loginHint);
  }
  return `${AUTHORIZE_URL}?${params}`;
}

export type CallbackResult =
  | { ok: true; code: string; clientId: string; scope: string | null }
  | { ok: false; reason: SignInFailure; detail?: string };

/**
 * Checks the redirect's query against the pending attempt. `client_id` is returned on first
 * registration and may be missing on reauthorization; a different one than ours is rejected.
 */
export function parseCallback(
  search: string,
  attempt: SignInAttempt | undefined,
  now: number,
): CallbackResult {
  const query = new URLSearchParams(search);
  if (!attempt || now - attempt.startedAt > ATTEMPT_TTL_MS) return { ok: false, reason: 'expired' };
  if (query.get('state') !== attempt.state) return { ok: false, reason: 'state-mismatch' };
  const error = query.get('error');
  if (error) {
    const description = query.get('error_description');
    return {
      ok: false,
      reason: error === 'access_denied' ? 'denied' : 'exchange-failed',
      detail: description ? `${error}: ${description}` : error,
    };
  }
  const code = query.get('code');
  if (!code) return { ok: false, reason: 'exchange-failed', detail: 'no code' };
  const returned = query.get('client_id');
  if (attempt.clientId !== null && returned !== null && returned !== attempt.clientId) {
    return { ok: false, reason: 'client-mismatch' };
  }
  const clientId = returned ?? attempt.clientId;
  if (!clientId || clientId === DYNAMIC_CLIENT_ID) return { ok: false, reason: 'no-client-id' };
  return { ok: true, code, clientId, scope: query.get('scope') };
}

export function codeExchangeBody(
  code: string,
  clientId: string,
  verifier: string,
): URLSearchParams {
  return new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: clientId,
    code,
    code_verifier: verifier,
    redirect_uri: REDIRECT_URI,
    resource: API_RESOURCE,
  });
}

/** No `scope`: omitting it keeps the grant. */
export function refreshBody(refreshToken: string, clientId: string): URLSearchParams {
  return new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: clientId,
    refresh_token: refreshToken,
    resource: API_RESOURCE,
  });
}

export function revokeBody(refreshToken: string, clientId: string): URLSearchParams {
  return new URLSearchParams({
    token: refreshToken,
    token_type_hint: 'refresh_token',
    client_id: clientId,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** `earliest_refresh_at` in seconds, milliseconds or ISO form; undefined if unreadable. */
export function parseInstant(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value < 1e12 ? value * 1000 : value;
  }
  if (typeof value === 'string') {
    if (/^\d+(\.\d+)?$/.test(value)) return parseInstant(Number(value));
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? undefined : parsed;
  }
  return undefined;
}

/**
 * A token endpoint answer as a full token set. A refresh may leave out fields that didn't
 * change; they come from `previous`. Throws {@link OAuthError} if a token is missing.
 */
export function parseTokenResponse(json: unknown, now: number, previous?: TokenSet): TokenSet {
  if (!isRecord(json)) throw new OAuthError('invalid_response', 200, 'Token response is not JSON');
  const text = (key: string): string | undefined => {
    const value = json[key];
    return typeof value === 'string' && value !== '' ? value : undefined;
  };
  const accessToken = text('access_token');
  const refreshToken = text('refresh_token') ?? previous?.refreshToken;
  const idToken = text('id_token') ?? previous?.idToken;
  if (!accessToken || !refreshToken || !idToken) {
    throw new OAuthError('invalid_response', 200, 'Token response lacks a token');
  }
  const expiresIn =
    typeof json.expires_in === 'number' && json.expires_in > 0 ? json.expires_in : 3600;
  const tokens: TokenSet = {
    accessToken,
    refreshToken,
    idToken,
    scope: text('scope') ?? previous?.scope ?? '',
    expiresAt: now + expiresIn * 1000,
  };
  const earliest = parseInstant(json.earliest_refresh_at);
  if (earliest !== undefined) tokens.earliestRefreshAt = earliest;
  return tokens;
}

/** The OAuth error code of a failed token-endpoint answer (`error` string or `error.code`). */
export function oauthErrorCode(json: unknown): string {
  if (!isRecord(json)) return 'unknown';
  const { error, code } = json;
  if (typeof error === 'string') return error;
  if (isRecord(error) && typeof error.code === 'string') return error.code;
  if (typeof code === 'string') return code;
  return 'unknown';
}

/** Refresh errors after which the token set is unusable: sign in again with the same client id. */
const TERMINAL_REFRESH_ERRORS = new Set([
  'invalid_grant',
  'invalid_refresh_token',
  'token_expired',
  'refresh_token_expired',
  'refresh_token_invalidated',
  'refresh_token_reused',
]);

export function isTerminalRefreshError(code: string): boolean {
  return TERMINAL_REFRESH_ERRORS.has(code);
}

export function hasPlanScope(scope: string): boolean {
  return scope.split(/\s+/).includes(PLAN_SCOPE);
}

/** Refresh ahead of expiry: at OpenAI's suggested time, or 5 minutes before; never too late. */
export function needsRefresh(tokens: TokenSet, now: number): boolean {
  if (now >= tokens.expiresAt - 60_000) return true;
  if (tokens.earliestRefreshAt !== undefined) return now >= tokens.earliestRefreshAt;
  return now >= tokens.expiresAt - 5 * 60_000;
}
