/**
 * Sign in with ChatGPT in the service worker (docs/plan.md §8.2, §8.7; ADR 0003, ADR 0014).
 *
 * The attempt (state, nonce, PKCE verifier) lives in chrome.storage.session, so a service
 * worker restart while the user is on OpenAI's pages doesn't lose it. Browser APIs come in as
 * dependencies; tests use fakes.
 */
import type { AccountView, SignInResult } from '../messaging/ai';
import type { ChatGptRecord, CredentialStore } from './credentials';
import { verifyIdToken, type KeySource } from './id-token';
import {
  AUTH_ORIGIN,
  ATTEMPT_TTL_MS,
  DISCOVERY_URL,
  OAuthError,
  REVOCATION_URL,
  TOKEN_URL,
  authorizeUrl,
  codeExchangeBody,
  hasPlanScope,
  isTerminalRefreshError,
  needsRefresh,
  newAttempt,
  newHostId,
  oauthErrorCode,
  parseCallback,
  parseTokenResponse,
  refreshBody,
  revokeBody,
  type SignInAttempt,
  type TokenSet,
} from './oauth';

export type AuthErrorKind =
  'not-signed-in' | 'sign-in-again' | 'no-plan-permission' | 'network' | 'unavailable';

/** Why there is no usable access token. Never carries a token. */
export class AuthError extends Error {
  constructor(
    readonly kind: AuthErrorKind,
    readonly detail?: string,
  ) {
    super(detail ? `${kind}: ${detail}` : kind);
    this.name = 'AuthError';
  }
}

export interface AttemptStore {
  get(): Promise<SignInAttempt | undefined>;
  set(attempt: SignInAttempt): Promise<void>;
  clear(): Promise<void>;
}

/** The DNR session rule that sends the loopback redirect to auth-callback.html (ADR 0003, A1). */
export interface RedirectRule {
  install(): Promise<void>;
  remove(): Promise<void>;
}

export interface AuthDeps {
  credentials: CredentialStore;
  attempts: AttemptStore;
  redirect: RedirectRule;
  openTab: (url: string) => Promise<void>;
  fetch: typeof fetch;
  keys: () => KeySource;
  now?: () => number;
  /** Sign-in state changed (broadcast `ai/changed`). */
  onChange?: () => void;
  /** Pause between revoke attempts; tests pass 0. */
  retryDelayMs?: number;
}

export interface ChatGptAuth {
  view(): Promise<AccountView['chatgpt']>;
  /** Signed in with plan usage granted: AI requests can go to the ChatGPT plan. */
  ready(): Promise<boolean>;
  begin(): Promise<void>;
  complete(search: string): Promise<SignInResult>;
  /** A current access token, refreshed first when due; `force` refreshes now (after a 401). */
  accessToken(options?: { force?: boolean }): Promise<string>;
  signOut(): Promise<{ revoked: boolean }>;
  forget(): Promise<{ revoked: boolean }>;
  /** Development aid: the access token counts as expired. */
  expire(): Promise<void>;
  /** On service-worker start: drop a redirect rule no attempt is waiting for. */
  cleanup(): Promise<void>;
}

const FORM_HEADERS = {
  'Content-Type': 'application/x-www-form-urlencoded',
  Accept: 'application/json',
};

function withoutTokens(record: ChatGptRecord): ChatGptRecord {
  const next = { ...record };
  delete next.tokens;
  delete next.hintIdToken;
  delete next.needsSignIn;
  return next;
}

export function createChatGptAuth(deps: AuthDeps): ChatGptAuth {
  const now = deps.now ?? Date.now;
  const changed = () => deps.onChange?.();
  const retryDelayMs = deps.retryDelayMs ?? 1000;
  let refreshing: Promise<TokenSet> | null = null;

  async function record(): Promise<ChatGptRecord> {
    const current = await deps.credentials.chatGpt();
    if (current) return current;
    const created = await deps.credentials.updateChatGpt((c) => c ?? { hostId: newHostId() });
    if (!created) throw new Error('Could not create the ChatGPT record');
    return created;
  }

  async function postForm(
    url: string,
    body: URLSearchParams,
  ): Promise<{ ok: boolean; status: number; json: unknown }> {
    let response: Response;
    try {
      response = await deps.fetch(url, { method: 'POST', headers: FORM_HEADERS, body });
    } catch {
      throw new OAuthError('network', 0, 'Network error');
    }
    const json: unknown = await response.json().catch(() => undefined);
    return { ok: response.ok, status: response.status, json };
  }

  /** One refresh at a time: the refresh token rotates, two would race (docs: serialize). */
  function refresh(): Promise<TokenSet> {
    refreshing ??= (async () => {
      const current = await deps.credentials.chatGpt();
      const tokens = current?.tokens;
      const clientId = current?.clientId;
      if (!tokens || !clientId) throw new AuthError('not-signed-in');
      let answer;
      try {
        answer = await postForm(TOKEN_URL, refreshBody(tokens.refreshToken, clientId));
      } catch {
        throw new AuthError('network');
      }
      if (!answer.ok) {
        const code = oauthErrorCode(answer.json);
        const dropRegistration = code === 'invalid_client';
        if (isTerminalRefreshError(code) || dropRegistration) {
          await deps.credentials.updateChatGpt((c) => {
            if (c?.tokens?.refreshToken !== tokens.refreshToken) return c;
            const next: ChatGptRecord = { ...withoutTokens(c), needsSignIn: true };
            if (dropRegistration) delete next.clientId;
            else next.hintIdToken = tokens.idToken;
            return next;
          });
          changed();
          throw new AuthError('sign-in-again', code);
        }
        // Temporary trouble: keep the credentials (docs: errors and recovery).
        throw new AuthError(answer.status >= 500 ? 'unavailable' : 'network', code);
      }
      let next: TokenSet;
      try {
        next = parseTokenResponse(answer.json, now(), tokens);
      } catch {
        throw new AuthError('unavailable', 'invalid_response');
      }
      // Everything at once, and only onto the token set this refresh started from.
      await deps.credentials.updateChatGpt((c) =>
        c?.tokens?.refreshToken === tokens.refreshToken ? { ...c, tokens: next } : c,
      );
      return next;
    })().finally(() => {
      refreshing = null;
    });
    return refreshing;
  }

  async function revocationEndpoint(): Promise<string> {
    try {
      const response = await deps.fetch(DISCOVERY_URL);
      const json = (await response.json()) as { revocation_endpoint?: unknown };
      const endpoint = json.revocation_endpoint;
      if (typeof endpoint === 'string' && endpoint.startsWith(`${AUTH_ORIGIN}/`)) return endpoint;
    } catch {
      // fall back to the endpoint discovery returned in the spike
    }
    return REVOCATION_URL;
  }

  /** True when OpenAI confirmed the revocation (an empty 200, also for a dead token). */
  async function revoke(refreshToken: string, clientId: string): Promise<boolean> {
    const endpoint = await revocationEndpoint();
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const answer = await postForm(endpoint, revokeBody(refreshToken, clientId));
        if (answer.ok) return true;
        if (answer.status < 500) return false;
      } catch {
        // network: retry once
      }
      if (attempt === 0 && retryDelayMs > 0) await new Promise((r) => setTimeout(r, retryDelayMs));
    }
    return false;
  }

  async function signOut(): Promise<{ revoked: boolean }> {
    const current = await deps.credentials.chatGpt();
    let revoked = true;
    if (current?.tokens && current.clientId) {
      revoked = await revoke(current.tokens.refreshToken, current.clientId);
    }
    // Keep the client id, the account (its email is the next login_hint) and the host id.
    await deps.credentials.updateChatGpt((c) => c && withoutTokens(c));
    changed();
    return { revoked };
  }

  return {
    async view() {
      const current = await deps.credentials.chatGpt();
      const attempt = await deps.attempts.get();
      const view: AccountView['chatgpt'] = {
        state: current?.tokens
          ? 'signed-in'
          : current?.needsSignIn
            ? 'needs-sign-in'
            : 'signed-out',
        planUsage: current?.tokens ? hasPlanScope(current.tokens.scope) : false,
        registered: Boolean(current?.clientId),
        pending: attempt !== undefined && now() - attempt.startedAt < ATTEMPT_TTL_MS,
      };
      if (current?.account?.email) view.email = current.account.email;
      if (current?.account?.name) view.name = current.account.name;
      return view;
    },

    async ready() {
      const tokens = (await deps.credentials.chatGpt())?.tokens;
      return tokens !== undefined && hasPlanScope(tokens.scope);
    },

    async begin() {
      const current = await record();
      const attempt = newAttempt(current.clientId ?? null, now());
      const url = await authorizeUrl({
        attempt,
        hostId: current.hostId,
        idTokenHint: current.tokens?.idToken ?? current.hintIdToken,
        loginHint: current.account?.email,
      });
      await deps.attempts.set(attempt);
      await deps.redirect.install();
      await deps.openTab(url);
      changed();
    },

    async complete(search) {
      const attempt = await deps.attempts.get();
      const parsed = parseCallback(search, attempt, now());
      // A stale tab of an older attempt must not cancel the one in progress.
      if (!parsed.ok && parsed.reason === 'state-mismatch' && attempt) return parsed;
      try {
        if (!parsed.ok || !attempt) return parsed.ok ? { ok: false, reason: 'expired' } : parsed;
        const current = await record();
        if (current.clientId && current.clientId !== parsed.clientId) {
          return { ok: false, reason: 'client-mismatch' };
        }
        // First registration: keep the issued client id before exchanging the code (docs).
        if (!current.clientId) {
          await deps.credentials.updateChatGpt((c) => ({
            ...(c ?? current),
            clientId: parsed.clientId,
          }));
        }
        let answer;
        try {
          answer = await postForm(
            TOKEN_URL,
            codeExchangeBody(parsed.code, parsed.clientId, attempt.verifier),
          );
        } catch {
          return { ok: false, reason: 'network' };
        }
        if (!answer.ok) {
          return { ok: false, reason: 'exchange-failed', detail: oauthErrorCode(answer.json) };
        }
        let tokens: TokenSet;
        try {
          tokens = parseTokenResponse(answer.json, now());
        } catch (error) {
          return { ok: false, reason: 'exchange-failed', detail: (error as Error).message };
        }
        if (!tokens.scope && parsed.scope) tokens.scope = parsed.scope;
        let claims;
        try {
          claims = await verifyIdToken(
            tokens.idToken,
            { clientId: parsed.clientId, nonce: attempt.nonce },
            deps.keys(),
            now(),
          );
        } catch (error) {
          return { ok: false, reason: 'invalid-token', detail: (error as Error).message };
        }
        // A registration belongs to one account (docs: confirm the identity before replacing).
        if (current.account && current.account.sub !== claims.sub) {
          return { ok: false, reason: 'account-mismatch' };
        }
        await deps.credentials.updateChatGpt((c) => ({
          ...withoutTokens(c ?? current),
          clientId: parsed.clientId,
          account: claims,
          tokens,
        }));
        const result: SignInResult = { ok: true, planUsage: hasPlanScope(tokens.scope) };
        if (claims.email) result.email = claims.email;
        return result;
      } finally {
        await deps.attempts.clear();
        await deps.redirect.remove();
        changed();
      }
    },

    async accessToken(options = {}) {
      const current = await deps.credentials.chatGpt();
      const tokens = current?.tokens;
      if (!tokens) throw new AuthError(current?.needsSignIn ? 'sign-in-again' : 'not-signed-in');
      if (!hasPlanScope(tokens.scope)) throw new AuthError('no-plan-permission');
      if (options.force || needsRefresh(tokens, now())) {
        try {
          return (await refresh()).accessToken;
        } catch (error) {
          // A token that is still valid beats a refresh that hit a temporary problem.
          const temporary =
            error instanceof AuthError &&
            (error.kind === 'network' || error.kind === 'unavailable');
          if (!options.force && temporary && now() < tokens.expiresAt - 10_000) {
            return tokens.accessToken;
          }
          throw error;
        }
      }
      return tokens.accessToken;
    },

    signOut,

    async forget() {
      const result = await signOut();
      await deps.credentials.updateChatGpt((c) => c && { hostId: c.hostId });
      changed();
      return result;
    },

    async expire() {
      await deps.credentials.updateChatGpt((c) =>
        c?.tokens ? { ...c, tokens: { ...c.tokens, expiresAt: now() - 1000 } } : c,
      );
    },

    async cleanup() {
      const attempt = await deps.attempts.get();
      if (attempt && now() - attempt.startedAt < ATTEMPT_TTL_MS) return;
      await deps.attempts.clear();
      await deps.redirect.remove();
    },
  };
}
