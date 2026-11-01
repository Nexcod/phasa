import 'fake-indexeddb/auto';
import { createHash } from 'node:crypto';
import { createLocalJWKSet } from 'jose';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createChatGptAuth, type AttemptStore, type ChatGptAuth } from '@/src/auth/chatgpt';
import { dbCredentialStore, keyHint, type CredentialStore } from '@/src/auth/credentials';
import {
  ATTEMPT_TTL_MS,
  authorizeUrl,
  needsRefresh,
  newAttempt,
  parseCallback,
  parseInstant,
  parseTokenResponse,
  pkceChallenge,
  type SignInAttempt,
} from '@/src/auth/oauth';
import { PhasaDb } from '@/src/db/db';
import { EMAIL, ISSUED_CLIENT_ID, createFakeOpenAi, type FakeOpenAi } from '../helpers/fake-openai';

describe('oauth helpers', () => {
  it('computes the PKCE S256 challenge: base64url(sha256(verifier)), no padding', async () => {
    const verifier = newAttempt(null, 0).verifier;
    expect(verifier).toMatch(/^[\w-]{43}$/);
    expect(await pkceChallenge(verifier)).toBe(
      createHash('sha256').update(verifier).digest('base64url'),
    );
  });

  it('builds a first-registration authorize URL', async () => {
    const attempt = newAttempt(null, 0);
    const url = new URL(await authorizeUrl({ attempt, hostId: 'urn:uuid:h', loginHint: 'x' }));
    expect(url.origin + url.pathname).toBe('https://auth.openai.com/api/accounts/authorize');
    const params = Object.fromEntries(url.searchParams);
    expect(params).toMatchObject({
      client_id: 'dynamic_agent_client',
      agent_name_hint: 'Phasa',
      ext_agent_host_id: 'urn:uuid:h',
      response_type: 'code',
      redirect_uri: 'http://127.0.0.1:1455/auth/callback',
      scope: 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct',
      resource: 'https://api.openai.com/v1',
      state: attempt.state,
      nonce: attempt.nonce,
      code_challenge_method: 'S256',
    });
    expect(params.code_challenge).toBe(await pkceChallenge(attempt.verifier));
    // Hints belong to reauthorization only.
    expect(params.login_hint).toBeUndefined();
    expect(params.id_token_hint).toBeUndefined();
  });

  it('builds a reauthorization URL with the issued client id and hints', async () => {
    const attempt = newAttempt('oaiapp_1', 0);
    const params = new URL(
      await authorizeUrl({ attempt, hostId: 'h', idTokenHint: 'id.tok.en', loginHint: 'a@b.c' }),
    ).searchParams;
    expect(params.get('client_id')).toBe('oaiapp_1');
    expect(params.has('agent_name_hint')).toBe(false);
    expect(params.get('id_token_hint')).toBe('id.tok.en');
    expect(params.get('login_hint')).toBe('a@b.c');
  });

  it('checks the callback against the attempt', () => {
    const first: SignInAttempt = { ...newAttempt(null, 1000) };
    const ok = `?code=c1&state=${first.state}&client_id=oaiapp_9&scope=openid`;
    expect(parseCallback(ok, first, 2000)).toEqual({
      ok: true,
      code: 'c1',
      clientId: 'oaiapp_9',
      scope: 'openid',
    });
    expect(parseCallback(ok, undefined, 2000)).toMatchObject({ ok: false, reason: 'expired' });
    expect(parseCallback(ok, first, 1000 + ATTEMPT_TTL_MS + 1)).toMatchObject({
      reason: 'expired',
    });
    expect(parseCallback('?code=c1&state=other', first, 2000)).toMatchObject({
      reason: 'state-mismatch',
    });
    expect(parseCallback(`?error=access_denied&state=${first.state}`, first, 2000)).toMatchObject({
      reason: 'denied',
    });
    // First registration without an issued client id is incomplete.
    expect(parseCallback(`?code=c&state=${first.state}`, first, 2000)).toMatchObject({
      reason: 'no-client-id',
    });
    // Reauthorization: client_id may be missing (use ours), must not differ.
    const again = newAttempt('oaiapp_9', 1000);
    expect(parseCallback(`?code=c&state=${again.state}`, again, 2000)).toMatchObject({
      ok: true,
      clientId: 'oaiapp_9',
    });
    expect(
      parseCallback(`?code=c&state=${again.state}&client_id=oaiapp_other`, again, 2000),
    ).toMatchObject({ reason: 'client-mismatch' });
  });

  it('reads token responses, keeping fields a refresh leaves out', () => {
    const first = parseTokenResponse(
      {
        access_token: 'a1',
        refresh_token: 'r1',
        id_token: 'i1',
        expires_in: 3600,
        scope: 'openid chatgpt.tokens.use.direct',
        earliest_refresh_at: 1_000_000,
      },
      0,
    );
    expect(first).toEqual({
      accessToken: 'a1',
      refreshToken: 'r1',
      idToken: 'i1',
      scope: 'openid chatgpt.tokens.use.direct',
      expiresAt: 3_600_000,
      earliestRefreshAt: 1_000_000_000,
    });
    const refreshed = parseTokenResponse({ access_token: 'a2', expires_in: 60 }, 10, first);
    expect(refreshed).toMatchObject({ accessToken: 'a2', refreshToken: 'r1', idToken: 'i1' });
    expect(() => parseTokenResponse({ refresh_token: 'r' }, 0)).toThrow();
  });

  it('reads earliest_refresh_at as seconds, milliseconds or ISO time', () => {
    expect(parseInstant(1_700_000_000)).toBe(1_700_000_000_000);
    expect(parseInstant(1_700_000_000_000)).toBe(1_700_000_000_000);
    expect(parseInstant('2026-11-01T00:00:00Z')).toBe(Date.parse('2026-11-01T00:00:00Z'));
    expect(parseInstant('soon')).toBeUndefined();
  });

  it('refreshes at the suggested time, or 5 minutes before expiry', () => {
    const tokens = {
      accessToken: 'a',
      refreshToken: 'r',
      idToken: 'i',
      scope: '',
      expiresAt: 3_600_000,
    };
    expect(needsRefresh(tokens, 3_000_000)).toBe(false);
    expect(needsRefresh(tokens, 3_300_000)).toBe(true);
    expect(needsRefresh({ ...tokens, earliestRefreshAt: 3_240_000 }, 3_250_000)).toBe(true);
    expect(needsRefresh({ ...tokens, earliestRefreshAt: 3_590_000 }, 3_500_000)).toBe(false);
    expect(needsRefresh({ ...tokens, earliestRefreshAt: 3_590_000 }, 3_545_000)).toBe(true);
  });

  it('shortens API keys to a hint', () => {
    expect(keyHint('sk-proj-abcdefghijklmnop1234')).toBe('sk-proj-…1234');
    expect(keyHint('sk-abcdefghijklmnop9876')).toBe('sk-…9876');
  });
});

interface Harness {
  auth: ChatGptAuth;
  openai: FakeOpenAi;
  credentials: CredentialStore;
  opened: string[];
  rule: { installed: boolean };
  attempts: AttemptStore & { value?: SignInAttempt };
  changes: number;
  clock: { now: number };
}

let db: PhasaDb;
let counter = 0;

async function setup(): Promise<Harness> {
  db = new PhasaDb(`auth-test-${++counter}`);
  const openai = await createFakeOpenAi();
  const jwks = (await (
    await openai.fetch('https://auth.openai.com/.well-known/jwks.json')
  ).json()) as {
    keys: [];
  };
  const credentials = dbCredentialStore(() => db);
  const opened: string[] = [];
  const rule = { installed: false };
  const attempts: Harness['attempts'] = {
    get: () => Promise.resolve(attempts.value),
    set: (attempt) => {
      attempts.value = attempt;
      return Promise.resolve();
    },
    clear: () => {
      delete attempts.value;
      return Promise.resolve();
    },
  };
  const clock = { now: Date.now() };
  const harness: Harness = {
    openai,
    credentials,
    opened,
    rule,
    attempts,
    changes: 0,
    clock,
    auth: createChatGptAuth({
      credentials,
      attempts,
      redirect: {
        install: () => {
          rule.installed = true;
          return Promise.resolve();
        },
        remove: () => {
          rule.installed = false;
          return Promise.resolve();
        },
      },
      openTab: (url) => {
        opened.push(url);
        return Promise.resolve();
      },
      fetch: openai.fetch,
      keys: () => createLocalJWKSet(jwks),
      now: () => clock.now,
      onChange: () => {
        harness.changes++;
      },
      retryDelayMs: 0,
    }),
  };
  return harness;
}

/** Sign-in through the fake consent screen; returns the callback's query string. */
async function signIn(h: Harness, options?: Parameters<FakeOpenAi['authorize']>[1]) {
  await h.auth.begin();
  const redirect = await h.openai.authorize(h.opened.at(-1)!, options);
  return h.auth.complete(new URL(redirect).search);
}

describe('Sign in with ChatGPT', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await setup();
  });
  afterEach(async () => {
    db.close();
    await db.delete();
  });

  it('registers, exchanges the code and verifies the ID token', async () => {
    await h.auth.begin();
    expect(h.rule.installed).toBe(true);
    expect((await h.auth.view()).pending).toBe(true);
    const redirect = await h.openai.authorize(h.opened[0]!);
    const result = await h.auth.complete(new URL(redirect).search);
    expect(result).toEqual({ ok: true, email: EMAIL, planUsage: true });
    expect(h.rule.installed).toBe(false);
    expect(h.attempts.value).toBeUndefined();
    const view = await h.auth.view();
    expect(view).toMatchObject({
      state: 'signed-in',
      email: EMAIL,
      planUsage: true,
      registered: true,
    });
    expect(view.pending).toBe(false);
    const record = await h.credentials.chatGpt();
    expect(record?.clientId).toBe(ISSUED_CLIENT_ID);
    expect(record?.hostId).toMatch(/^urn:uuid:[0-9a-f-]{36}$/);
    expect(await h.auth.ready()).toBe(true);
    expect(await h.auth.accessToken()).toBe(record?.tokens?.accessToken);
    expect(h.changes).toBeGreaterThan(0);
  });

  it('reauthorizes with the issued client id, the ID token hint and the email', async () => {
    await signIn(h);
    const hostId = (await h.credentials.chatGpt())?.hostId;
    const idToken = (await h.credentials.chatGpt())?.tokens?.idToken;
    await h.auth.begin();
    const params = new URL(h.opened.at(-1)!).searchParams;
    expect(params.get('client_id')).toBe(ISSUED_CLIENT_ID);
    expect(params.has('agent_name_hint')).toBe(false);
    expect(params.get('id_token_hint')).toBe(idToken);
    expect(params.get('login_hint')).toBe(EMAIL);
    expect(params.get('ext_agent_host_id')).toBe(hostId);
    // OpenAI may leave client_id out of a reauthorization callback.
    const redirect = await h.openai.authorize(h.opened.at(-1)!, { omitClientId: true });
    expect(await h.auth.complete(new URL(redirect).search)).toMatchObject({ ok: true });
  });

  it('keeps AI off when plan usage was not granted', async () => {
    h.openai.options.planScope = false;
    expect(await signIn(h)).toMatchObject({ ok: true, planUsage: false });
    expect(await h.auth.ready()).toBe(false);
    await expect(h.auth.accessToken()).rejects.toMatchObject({ kind: 'no-plan-permission' });
  });

  it('stops at a denied consent without exchanging a code', async () => {
    expect(await signIn(h, { deny: true })).toMatchObject({ ok: false, reason: 'denied' });
    expect(h.openai.log.some((r) => r.url.endsWith('/oauth/token'))).toBe(false);
    expect(h.rule.installed).toBe(false);
  });

  it('keeps a pending attempt when a stale tab comes back', async () => {
    await h.auth.begin();
    expect(await h.auth.complete('?code=x&state=old')).toMatchObject({ reason: 'state-mismatch' });
    expect(h.attempts.value).toBeDefined();
    expect(h.rule.installed).toBe(true);
  });

  it('rejects a different account for the same registration', async () => {
    await signIn(h);
    await h.auth.signOut();
    h.openai.options.subject = 'someone-else';
    expect(await signIn(h)).toMatchObject({ ok: false, reason: 'account-mismatch' });
    expect((await h.auth.view()).state).toBe('signed-out');
  });

  it('refreshes near expiry, rotates the refresh token and serializes refreshes', async () => {
    h.openai.options.expiresIn = 30; // due for a refresh at once
    await signIn(h);
    const before = (await h.credentials.chatGpt())!.tokens!;
    const [a, b] = await Promise.all([h.auth.accessToken(), h.auth.accessToken()]);
    expect(a).toBe(b);
    expect(a).not.toBe(before.accessToken);
    const after = (await h.credentials.chatGpt())!.tokens!;
    expect(after.refreshToken).not.toBe(before.refreshToken);
    expect(after.idToken).toBeTruthy();
    const refreshes = h.openai.log.filter((r) => r.body.includes('grant_type=refresh_token'));
    expect(refreshes).toHaveLength(1);
    expect(refreshes[0]!.body).not.toContain('scope=');
  });

  it('refreshes an expired token (the development "expire" control)', async () => {
    await signIn(h);
    const before = (await h.credentials.chatGpt())!.tokens!.accessToken;
    await h.auth.expire();
    expect(await h.auth.accessToken()).not.toBe(before);
  });

  it('asks to sign in again after a terminal refresh error, keeping the registration', async () => {
    await signIn(h);
    const idToken = (await h.credentials.chatGpt())!.tokens!.idToken;
    h.openai.revokeAll();
    await expect(h.auth.accessToken({ force: true })).rejects.toMatchObject({
      kind: 'sign-in-again',
      detail: 'invalid_grant',
    });
    const record = await h.credentials.chatGpt();
    expect(record?.tokens).toBeUndefined();
    expect(record?.clientId).toBe(ISSUED_CLIENT_ID);
    expect(record?.hintIdToken).toBe(idToken);
    expect((await h.auth.view()).state).toBe('needs-sign-in');
    await expect(h.auth.accessToken()).rejects.toMatchObject({ kind: 'sign-in-again' });
    // The next sign-in passes the kept ID token as a hint.
    await h.auth.begin();
    expect(new URL(h.opened.at(-1)!).searchParams.get('id_token_hint')).toBe(idToken);
  });

  it('keeps the tokens on a temporary refresh failure while they are valid', async () => {
    await signIn(h);
    const tokens = (await h.credentials.chatGpt())!.tokens!;
    h.clock.now = tokens.expiresAt - 2 * 60_000; // due for a refresh, still valid
    const failing = createChatGptAuth({
      credentials: h.credentials,
      attempts: h.attempts,
      redirect: { install: () => Promise.resolve(), remove: () => Promise.resolve() },
      openTab: () => Promise.resolve(),
      fetch: () => Promise.reject(new TypeError('Failed to fetch')),
      keys: () => {
        throw new Error('unused');
      },
      now: () => h.clock.now,
    });
    expect(await failing.accessToken()).toBe(tokens.accessToken);
    expect((await h.credentials.chatGpt())?.tokens).toEqual(tokens);
  });

  it('signs out: revokes the refresh token, keeps client id, email and host id', async () => {
    await signIn(h);
    const before = await h.credentials.chatGpt();
    expect(await h.auth.signOut()).toEqual({ revoked: true });
    const revoke = h.openai.log.find((r) => r.url.endsWith('/oauth/revoke'))!;
    const form = new URLSearchParams(revoke.body);
    expect(form.get('token')).toBe(before?.tokens?.refreshToken);
    expect(form.get('token_type_hint')).toBe('refresh_token');
    expect(form.get('client_id')).toBe(ISSUED_CLIENT_ID);
    const after = await h.credentials.chatGpt();
    expect(after).toEqual({
      hostId: before?.hostId,
      clientId: ISSUED_CLIENT_ID,
      account: before?.account,
    });
    // After a sign-out the ID token is gone: only login_hint.
    await h.auth.begin();
    const params = new URL(h.opened.at(-1)!).searchParams;
    expect(params.has('id_token_hint')).toBe(false);
    expect(params.get('login_hint')).toBe(EMAIL);
  });

  it('forgets the registration but keeps the host id', async () => {
    await signIn(h);
    const hostId = (await h.credentials.chatGpt())?.hostId;
    await h.auth.forget();
    expect(await h.credentials.chatGpt()).toEqual({ hostId });
    await h.auth.begin();
    expect(new URL(h.opened.at(-1)!).searchParams.get('client_id')).toBe('dynamic_agent_client');
  });

  it('drops a redirect rule no attempt waits for', async () => {
    await h.auth.begin();
    h.clock.now += ATTEMPT_TTL_MS + 1;
    await h.auth.cleanup();
    expect(h.rule.installed).toBe(false);
    expect(h.attempts.value).toBeUndefined();
  });
});
