/**
 * The two providers (docs/plan.md §8.5): the same Responses API client, different Bearer
 * tokens. The ChatGPT-plan token comes from src/auth and is refreshed there.
 */
import { AuthError, type ChatGptAuth } from '../auth/chatgpt';
import type { CredentialStore } from '../auth/credentials';
import type { AiErrorCode, AiModel, AiProviderId } from '../messaging/ai';
import { AiFailure, failureFromHttp } from './errors';
import {
  MODELS_URL,
  streamResponses,
  type InputMessage,
  type JsonSchemaFormat,
  type ResponsesBody,
  type StreamEvent,
} from './responses';

export interface StreamRequest {
  model: string;
  instructions: string;
  input: InputMessage[];
  format?: JsonSchemaFormat;
}

export interface AIProvider {
  id: AiProviderId;
  isReady(): Promise<boolean>;
  /** Why it isn't ready, or null when it is. */
  readiness(): Promise<AiErrorCode | null>;
  listModels(): Promise<AiModel[]>;
  stream(request: StreamRequest, signal: AbortSignal): AsyncIterable<StreamEvent>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** ChatGPT plan: `models[]`, entries with `visibility: "list"`, in the server's order. */
export function chatGptModels(json: unknown): AiModel[] {
  const list = isRecord(json) && Array.isArray(json.models) ? (json.models as unknown[]) : [];
  const entries = list.filter(isRecord);
  const listed = entries.filter((model) => model.visibility === 'list');
  return (listed.length > 0 || entries.some((m) => 'visibility' in m) ? listed : entries).flatMap(
    (model) => {
      const slug = typeof model.slug === 'string' ? model.slug : undefined;
      if (!slug) return [];
      const name = typeof model.display_name === 'string' ? model.display_name : slug;
      return [{ slug, displayName: name }];
    },
  );
}

/** Model families of the platform API that can't answer a text prompt. */
const NOT_TEXT =
  /embed|whisper|tts|dall-e|image|audio|realtime|transcribe|moderation|search|davinci|babbage|sora|computer-use/;

/** API key: `data[]` of the platform API; text models only, newest first. */
export function apiKeyModels(json: unknown): AiModel[] {
  const list = isRecord(json) && Array.isArray(json.data) ? (json.data as unknown[]) : [];
  return list
    .filter(isRecord)
    .flatMap((model) => {
      const id = typeof model.id === 'string' ? model.id : undefined;
      if (!id || !/^(gpt-|o\d|chatgpt-)/.test(id) || NOT_TEXT.test(id)) return [];
      return [{ id, created: typeof model.created === 'number' ? model.created : 0 }];
    })
    .sort((a, b) => b.created - a.created || a.id.localeCompare(b.id))
    .map(({ id }) => ({ slug: id, displayName: id }));
}

function body(request: StreamRequest): ResponsesBody {
  const result: ResponsesBody = {
    model: request.model,
    instructions: request.instructions,
    input: request.input,
    store: false,
    stream: true,
  };
  if (request.format) result.text = { format: request.format };
  return result;
}

const AUTH_CODES: Readonly<Record<AuthError['kind'], AiErrorCode>> = {
  'not-signed-in': 'not-configured',
  'sign-in-again': 'sign-in-again',
  'no-plan-permission': 'no-plan-permission',
  network: 'network',
  unavailable: 'unavailable',
};

function fromAuth(error: unknown): never {
  if (error instanceof AuthError) throw new AiFailure(AUTH_CODES[error.kind], error.detail);
  throw error;
}

async function getJson(
  fetcher: typeof fetch,
  token: string,
  provider: AiProviderId,
): Promise<{ status: number; json: unknown }> {
  let response: Response;
  try {
    response = await fetcher(MODELS_URL, { headers: { Authorization: `Bearer ${token}` } });
  } catch (error) {
    throw new AiFailure('network', error instanceof Error ? error.message : String(error));
  }
  if (!response.ok) {
    throw failureFromHttp(response.status, await response.text().catch(() => ''), provider);
  }
  return { status: response.status, json: await response.json().catch(() => undefined) };
}

export function chatGptProvider(deps: {
  auth: ChatGptAuth;
  fetch: typeof fetch;
  idleMs?: number;
}): AIProvider {
  const id = 'chatgpt-plan';
  /** A 401 gets one forced refresh and one retry; a second 401 is not a reason to sign out. */
  async function withToken<T>(call: (token: string) => Promise<T>): Promise<T> {
    const token = await deps.auth.accessToken().catch(fromAuth);
    try {
      return await call(token);
    } catch (error) {
      if (!(error instanceof AiFailure) || error.status !== 401) throw error;
    }
    const fresh = await deps.auth.accessToken({ force: true }).catch(fromAuth);
    try {
      return await call(fresh);
    } catch (error) {
      if (error instanceof AiFailure && error.status === 401) {
        throw new AiFailure('blocked', error.detail, 401);
      }
      throw error;
    }
  }

  return {
    id,
    isReady: () => deps.auth.ready(),
    async readiness() {
      const view = await deps.auth.view();
      if (view.state === 'needs-sign-in') return 'sign-in-again';
      if (view.state === 'signed-out') return 'not-configured';
      return view.planUsage ? null : 'no-plan-permission';
    },
    listModels: () =>
      withToken(async (token) => chatGptModels((await getJson(deps.fetch, token, id)).json)),
    async *stream(request, signal) {
      const token = await deps.auth.accessToken().catch(fromAuth);
      const open = (bearer: string) =>
        streamResponses({
          fetch: deps.fetch,
          provider: id,
          token: bearer,
          body: body(request),
          signal,
          ...(deps.idleMs === undefined ? {} : { idleMs: deps.idleMs }),
        });
      try {
        yield* open(token);
        return;
      } catch (error) {
        // Only a failure before the stream has a status; nothing was shown yet.
        if (!(error instanceof AiFailure) || error.status !== 401) throw error;
      }
      const fresh = await deps.auth.accessToken({ force: true }).catch(fromAuth);
      try {
        yield* open(fresh);
      } catch (error) {
        if (error instanceof AiFailure && error.status === 401) {
          throw new AiFailure('blocked', error.detail, 401);
        }
        throw error;
      }
    },
  };
}

export function apiKeyProvider(deps: {
  credentials: CredentialStore;
  fetch: typeof fetch;
  idleMs?: number;
}): AIProvider {
  const id = 'openai-api-key';
  const key = async () => {
    const value = await deps.credentials.apiKey();
    if (!value) throw new AiFailure('not-configured', 'No API key');
    return value;
  };
  return {
    id,
    isReady: async () => Boolean(await deps.credentials.apiKey()),
    readiness: async () => ((await deps.credentials.apiKey()) ? null : 'not-configured'),
    listModels: async () => apiKeyModels((await getJson(deps.fetch, await key(), id)).json),
    async *stream(request, signal) {
      yield* streamResponses({
        fetch: deps.fetch,
        provider: id,
        token: await key(),
        body: body(request),
        signal,
        ...(deps.idleMs === undefined ? {} : { idleMs: deps.idleMs }),
      });
    },
  };
}

/** Checks a key before saving it: `/v1/models` answers 200 for a valid key. */
export async function checkApiKey(
  fetcher: typeof fetch,
  key: string,
): Promise<'ok' | 'invalid-key' | 'network' | 'failed'> {
  try {
    await getJson(fetcher, key, 'openai-api-key');
    return 'ok';
  } catch (error) {
    if (error instanceof AiFailure) {
      if (error.code === 'invalid-key') return 'invalid-key';
      if (error.code === 'network') return 'network';
    }
    return 'failed';
  }
}
