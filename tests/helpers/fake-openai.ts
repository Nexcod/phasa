/**
 * A stand-in for auth.openai.com and api.openai.com, as the spike and OpenAI's docs describe
 * them (docs/spikes.md §2): dynamic registration, PKCE, RS256 ID tokens from a JWKS, rotating
 * refresh tokens, the ChatGPT-plan `/v1/models` shape and streaming `/v1/responses`. Unit tests
 * use it as `fetch`; e2e tests serve it through Playwright routes.
 */
import { SignJWT, exportJWK, generateKeyPair, type JWK } from 'jose';

export interface FakeRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
}

export interface FakeResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

/** How `/v1/responses` answers. */
export type ResponsesMode =
  | 'ok'
  /** `response.failed` with subscription_sharing_usage_limit_exceeded after some text. */
  | 'usage-limit-mid-stream'
  /** HTTP 429 with the plan's usage-limit code, before the stream. */
  | 'usage-limit'
  | 'unavailable'
  | 'incomplete'
  /** The stream ends without a terminal event. */
  | 'cut'
  /** Valid JSON that doesn't match the schema. */
  | 'bad-json';

export const ISSUED_CLIENT_ID = 'oaiapp_fake0123456789';
export const SUBJECT = 'user-fake-subject';
export const EMAIL = 'learner@example.com';
export const API_KEY = 'sk-proj-fakefakefakefakefake1234';
const ISSUER = 'https://auth.openai.com';
const REDIRECT_URI = 'http://127.0.0.1:1455/auth/callback';

export const WORD_ANSWER = {
  meaning_in_context: 'a story, a matter: here "the topic" the speaker is talking about',
  part_of_speech: 'noun',
  romanization_paiboon: 'rʉ̂ʉang',
  syllables: [{ thai: 'เรื่อง', tone: 'falling' }],
  register: 'neutral, everyday',
  notes: null,
  example_th: 'เรื่องนี้สนุกมาก',
  example_en: 'This story is a lot of fun.',
  classifier: 'เรื่อง',
};

export const LINE_ANSWER = {
  natural_en: 'What do foreigners think of Thai?',
  literal_en: 'foreigner think how with Thai language',
  word_by_word: [
    { thai: 'ฝรั่ง', en: 'Westerner' },
    { thai: 'คิด', en: 'think' },
  ],
};

interface CodeGrant {
  clientId: string;
  nonce: string;
  challenge: string;
  scope: string;
}

async function s256(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return Buffer.from(digest).toString('base64url');
}

function json(status: number, value: unknown): FakeResponse {
  return {
    status,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(value),
  };
}

function sse(events: unknown[]): string {
  return events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('');
}

/** A Responses stream for `text`, in the event order the spike recorded. */
export function responseStream(
  text: string,
  ending: 'completed' | 'usage-limit' | 'incomplete' | 'cut' = 'completed',
  id = 'resp_fake123',
): string {
  const pieces = text.match(/[\s\S]{1,12}/g) ?? [];
  const sent = ending === 'completed' ? pieces : pieces.slice(0, Math.ceil(pieces.length / 2));
  const events: unknown[] = [
    { type: 'response.created', sequence_number: 0, response: { id, status: 'in_progress' } },
    { type: 'response.in_progress', sequence_number: 1, response: { id } },
    { type: 'response.output_item.added', output_index: 0, item: { type: 'message' } },
    { type: 'response.content_part.added', output_index: 0, content_index: 0 },
    ...sent.map((delta) => ({ type: 'response.output_text.delta', delta })),
  ];
  if (ending === 'completed') {
    events.push(
      { type: 'response.output_text.done', text },
      { type: 'response.content_part.done' },
      { type: 'response.output_item.done' },
      { type: 'response.metadata', metadata: {} },
      {
        type: 'response.completed',
        response: {
          id,
          status: 'completed',
          output: [{ type: 'message', content: [{ type: 'output_text', text }] }],
        },
      },
    );
  } else if (ending === 'usage-limit') {
    events.push({
      type: 'response.failed',
      response: {
        id,
        status: 'failed',
        error: {
          code: 'subscription_sharing_usage_limit_exceeded',
          message: 'You have reached your usage limit.',
        },
      },
    });
  } else if (ending === 'incomplete') {
    events.push({
      type: 'response.incomplete',
      response: { id, status: 'incomplete', incomplete_details: { reason: 'content_filter' } },
    });
  }
  return sse(events);
}

export interface FakeOpenAi {
  handle(request: FakeRequest): Promise<FakeResponse>;
  /** As `fetch`, for unit tests. */
  fetch: typeof fetch;
  /** OpenAI's consent: the loopback redirect for an authorize URL (state, code, client id). */
  authorize(url: string, options?: { deny?: boolean; omitClientId?: boolean }): Promise<string>;
  /** Requests seen, for assertions (bodies of POSTs included). */
  readonly log: FakeRequest[];
  /** Every `/v1/responses` body. */
  readonly responsesBodies: Record<string, unknown>[];
  options: {
    mode: ResponsesMode;
    /** Grant chatgpt.tokens.use.direct (the "Use your ChatGPT plan" checkbox). */
    planScope: boolean;
    /** Lifetime of new access tokens, seconds. */
    expiresIn: number;
    subject: string;
    /** The plan's `/v1/models` entries, in OpenAI's order. */
    planModels: { slug: string; display_name: string; visibility: string }[];
  };
  /** Makes every refresh token unusable (as after a revocation in ChatGPT settings). */
  revokeAll(): void;
}

export async function createFakeOpenAi(): Promise<FakeOpenAi> {
  const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true });
  const jwk: JWK = { ...(await exportJWK(publicKey)), kid: 'fake-key-1', alg: 'RS256', use: 'sig' };
  const codes = new Map<string, CodeGrant>();
  const refreshTokens = new Map<string, { clientId: string; scope: string; used: boolean }>();
  const accessTokens = new Map<string, number>();
  const log: FakeRequest[] = [];
  const responsesBodies: Record<string, unknown>[] = [];
  let counter = 0;
  const options: FakeOpenAi['options'] = {
    mode: 'ok',
    planScope: true,
    expiresIn: 3600,
    subject: SUBJECT,
    planModels: [
      { slug: 'gpt-fake-sol', display_name: 'GPT-Fake-Sol', visibility: 'list' },
      { slug: 'gpt-fake-hidden', display_name: 'Hidden', visibility: 'hide' },
      { slug: 'gpt-fake-luna', display_name: 'GPT-Fake-Luna', visibility: 'list' },
    ],
  };

  const scopeOf = () =>
    `openid profile email offline_access resource.invoke${options.planScope ? ' chatgpt.tokens.use.direct' : ''}`;

  async function idToken(clientId: string, nonce: string | undefined): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const claims: Record<string, unknown> = { email: EMAIL, email_verified: true, name: 'Learner' };
    if (nonce) claims.nonce = nonce;
    return new SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256', kid: jwk.kid! })
      .setIssuer(ISSUER)
      .setAudience(clientId)
      .setSubject(options.subject)
      .setIssuedAt(now)
      .setExpirationTime(now + 3600)
      .sign(privateKey);
  }

  async function tokens(clientId: string, scope: string, nonce?: string) {
    const access = `at.${++counter}.${'x'.repeat(40)}`;
    const refresh = `rt.1.${++counter}.${'y'.repeat(40)}`;
    accessTokens.set(access, Date.now() + options.expiresIn * 1000);
    refreshTokens.set(refresh, { clientId, scope, used: false });
    return {
      access_token: access,
      refresh_token: refresh,
      id_token: await idToken(clientId, nonce),
      token_type: 'Bearer',
      expires_in: options.expiresIn,
      scope,
      earliest_refresh_at: Math.floor(Date.now() / 1000) + Math.max(1, options.expiresIn - 360),
    };
  }

  function bearer(request: FakeRequest): string {
    const header = request.headers.authorization ?? request.headers.Authorization ?? '';
    return header.replace(/^Bearer /, '');
  }

  /** Access token valid (plan route) or the API key; else the 401 OpenAI sends. */
  function authorized(request: FakeRequest): 'plan' | 'key' | FakeResponse {
    const token = bearer(request);
    if (token === API_KEY) return 'key';
    if (token.startsWith('sk-')) {
      return json(401, { error: { code: 'invalid_api_key', message: 'Incorrect API key' } });
    }
    const expires = accessTokens.get(token);
    if (expires === undefined || expires < Date.now()) return json(401, { detail: 'Unauthorized' });
    return 'plan';
  }

  async function token(form: URLSearchParams): Promise<FakeResponse> {
    const grant = form.get('grant_type');
    if (form.get('resource') !== 'https://api.openai.com/v1') {
      return json(400, { error: 'invalid_target' });
    }
    if (grant === 'authorization_code') {
      const code = codes.get(form.get('code') ?? '');
      codes.delete(form.get('code') ?? '');
      if (!code) return json(400, { error: 'invalid_grant' });
      if (form.get('client_id') !== code.clientId) return json(401, { error: 'invalid_client' });
      if (form.get('redirect_uri') !== REDIRECT_URI) return json(400, { error: 'invalid_grant' });
      if ((await s256(form.get('code_verifier') ?? '')) !== code.challenge) {
        return json(400, { error: 'invalid_grant', error_description: 'PKCE' });
      }
      return json(200, await tokens(code.clientId, code.scope, code.nonce));
    }
    if (grant === 'refresh_token') {
      if (form.has('scope')) return json(400, { error: 'invalid_scope' });
      const refresh = refreshTokens.get(form.get('refresh_token') ?? '');
      if (!refresh) return json(400, { error: 'invalid_grant' });
      if (refresh.used) return json(400, { error: 'refresh_token_reused' });
      if (form.get('client_id') !== refresh.clientId) return json(401, { error: 'invalid_client' });
      refresh.used = true;
      return json(200, await tokens(refresh.clientId, refresh.scope));
    }
    return json(400, { error: 'unsupported_grant_type' });
  }

  function responses(request: FakeRequest, route: 'plan' | 'key'): FakeResponse {
    const body = JSON.parse(request.body) as Record<string, unknown>;
    responsesBodies.push(body);
    if (route === 'plan') {
      const forbidden = ['temperature', 'top_p', 'max_output_tokens', 'metadata', 'user'];
      if (body.store !== false || body.stream !== true || forbidden.some((f) => f in body)) {
        return json(400, {
          error: { code: 'subscription_sharing_unsupported_capability', param: 'store' },
        });
      }
    }
    const format = (body.text as { format?: { name?: string } } | undefined)?.format?.name;
    const answer = format === 'thai_line_translation' ? LINE_ANSWER : WORD_ANSWER;
    const text = JSON.stringify(answer);
    const stream = (content: string): FakeResponse => ({
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
      body: content,
    });
    switch (options.mode) {
      case 'ok':
        return stream(responseStream(text));
      case 'usage-limit-mid-stream':
        return route === 'plan'
          ? stream(responseStream(text, 'usage-limit'))
          : stream(responseStream(text));
      case 'usage-limit':
        return route === 'plan'
          ? json(429, {
              error: {
                code: 'subscription_sharing_usage_limit_exceeded',
                message: 'Usage limit reached',
              },
            })
          : stream(responseStream(text));
      case 'unavailable':
        return json(503, { error: { code: 'subscription_sharing_usage_unavailable' } });
      case 'incomplete':
        return stream(responseStream(text, 'incomplete'));
      case 'cut':
        return stream(responseStream(text, 'cut'));
      case 'bad-json':
        return stream(responseStream(JSON.stringify({ meaning_in_context: 5 })));
    }
  }

  async function handle(request: FakeRequest): Promise<FakeResponse> {
    log.push(request);
    const url = new URL(request.url);
    const key = `${request.method} ${url.origin}${url.pathname}`;
    switch (key) {
      case 'GET https://auth.openai.com/.well-known/openid-configuration':
        return json(200, {
          issuer: ISSUER,
          jwks_uri: `${ISSUER}/.well-known/jwks.json`,
          revocation_endpoint: `${ISSUER}/api/accounts/oauth/revoke`,
        });
      case 'GET https://auth.openai.com/.well-known/jwks.json':
        return json(200, { keys: [jwk] });
      case 'POST https://auth.openai.com/api/accounts/oauth/token':
        return token(new URLSearchParams(request.body));
      case 'POST https://auth.openai.com/api/accounts/oauth/revoke': {
        const form = new URLSearchParams(request.body);
        refreshTokens.delete(form.get('token') ?? '');
        return { status: 200, headers: {}, body: '' };
      }
      case 'GET https://api.openai.com/v1/models': {
        const route = authorized(request);
        if (typeof route !== 'string') return route;
        return route === 'plan'
          ? json(200, { models: options.planModels })
          : json(200, {
              object: 'list',
              data: [
                { id: 'text-embedding-3-small', created: 3 },
                { id: 'gpt-fake-mini', created: 2 },
                { id: 'gpt-fake-large', created: 1 },
              ],
            });
      }
      case 'POST https://api.openai.com/v1/responses': {
        const route = authorized(request);
        if (typeof route !== 'string') return route;
        return responses(request, route);
      }
      default:
        return json(404, { error: 'not found' });
    }
  }

  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, name) => (headers[name] = value));
    const raw = init?.body;
    const body =
      typeof raw === 'string' ? raw : raw instanceof URLSearchParams ? raw.toString() : '';
    if (init?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const answer = await handle({ url, method: init?.method ?? 'GET', headers, body });
    return new Response(answer.status === 200 && answer.body === '' ? null : answer.body, {
      status: answer.status,
      headers: answer.headers,
    });
  }) as typeof fetch;

  return {
    handle,
    fetch: fetchImpl,
    log,
    responsesBodies,
    options,
    revokeAll() {
      for (const refresh of refreshTokens.values()) refresh.used = true;
      refreshTokens.clear();
    },
    authorize(url, authorizeOptions = {}) {
      const params = new URL(url).searchParams;
      const state = params.get('state') ?? '';
      if (authorizeOptions.deny) {
        return Promise.resolve(
          `${REDIRECT_URI}?error=access_denied&state=${encodeURIComponent(state)}`,
        );
      }
      const requested = params.get('client_id');
      const clientId = requested === 'dynamic_agent_client' ? ISSUED_CLIENT_ID : (requested ?? '');
      const code = `code-${++counter}`;
      codes.set(code, {
        clientId,
        nonce: params.get('nonce') ?? '',
        challenge: params.get('code_challenge') ?? '',
        scope: scopeOf(),
      });
      const query = new URLSearchParams({ code, scope: scopeOf(), state });
      if (!authorizeOptions.omitClientId) query.set('client_id', clientId);
      return Promise.resolve(`${REDIRECT_URI}?${query}`);
    },
  };
}
