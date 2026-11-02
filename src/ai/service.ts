/**
 * AI requests in the service worker (docs/plan.md §8.4–§8.6, ADR 0014): provider choice and
 * fallback, model, cache, streaming progress, answer validation with one retry, and limits.
 */
import type {
  AiErrorCode,
  AiModel,
  AiProgress,
  AiProviderId,
  AiResult,
  AiStatus,
} from '../messaging/ai';
import type { Settings } from '../settings';
import { cacheKey, type AiCache } from './cache';
import { AiFailure, PLAN_FALLBACK } from './errors';
import { defaultPlanModel } from './models';
import { parsePartialJson } from './partial-json';
import type { Prompt } from './prompts/types';
import type { AIProvider, StreamRequest } from './providers';
import { validate } from './schema';

/** Remembered default model of the ChatGPT plan, for cache lookups without a network call. */
export interface ModelMemory {
  get(provider: AiProviderId): Promise<string | undefined>;
  set(provider: AiProviderId, slug: string): Promise<void>;
}

export interface AiServiceDeps {
  providers: Readonly<Record<AiProviderId, AIProvider>>;
  settings: () => Promise<Settings>;
  cache: AiCache;
  models: ModelMemory;
  now?: () => number;
  /** Progress at most this often. */
  progressMs?: number;
  /** A request is cut off after this long in total. */
  totalMs?: number;
}

export interface RunOptions<T> {
  cachedOnly?: boolean;
  onProgress?: (progress: AiProgress<T>) => void;
  /** Content-script requests are rate limited per tab. */
  tabId?: number;
}

export interface AiService {
  status(): Promise<AiStatus>;
  run<P, T>(prompt: Prompt<P, T>, params: P, options?: RunOptions<T>): Promise<AiResult<T>>;
  listModels(provider: AiProviderId): Promise<AiModel[]>;
  /** Stops every request in flight (sign-out). */
  abortAll(reason: AiFailure): void;
}

const MAX_PARALLEL = 3;
/** Requests that reach OpenAI per tab and minute; humans click far less. */
export const TAB_RATE_LIMIT = 20;
const MODEL_LIST_TTL_MS = 10 * 60_000;

interface Flight {
  promise: Promise<unknown>;
  listeners: Set<(progress: AiProgress<unknown>) => void>;
}

export function createAiService(deps: AiServiceDeps): AiService {
  const now = deps.now ?? Date.now;
  const progressMs = deps.progressMs ?? 120;
  const totalMs = deps.totalMs ?? 180_000;
  const flights = new Map<string, Flight>();
  const controllers = new Set<AbortController>();
  const modelLists = new Map<AiProviderId, { at: number; models: AiModel[] }>();
  const tabRequests = new Map<number, number[]>();
  let running = 0;
  const waiting: (() => void)[] = [];

  /** The providers to try, in order: the chosen one, then the API key if the user allows it. */
  function chain(settings: Settings): AiProviderId[] {
    if (settings.aiProvider === 'openai-api-key') return ['openai-api-key'];
    return settings.aiFallbackToApiKey ? ['chatgpt-plan', 'openai-api-key'] : ['chatgpt-plan'];
  }

  async function readiness(id: AiProviderId, settings: Settings): Promise<AiErrorCode | null> {
    const reason = await deps.providers[id].readiness();
    if (reason) return reason;
    if (id === 'openai-api-key' && !settings.aiModelApiKey) return 'not-configured';
    return null;
  }

  async function listModels(id: AiProviderId): Promise<AiModel[]> {
    const cached = modelLists.get(id);
    if (cached && now() - cached.at < MODEL_LIST_TTL_MS) return cached.models;
    const models = await deps.providers[id].listModels();
    modelLists.set(id, { at: now(), models });
    return models;
  }

  /** The model to use; the plan's default comes from OpenAI's list (ADR 0015). */
  async function model(id: AiProviderId, settings: Settings, cachedOnly: boolean) {
    if (id === 'openai-api-key') return settings.aiModelApiKey || undefined;
    if (settings.aiModelChatGpt) return settings.aiModelChatGpt;
    if (cachedOnly) return deps.models.get(id);
    const chosen = defaultPlanModel(await listModels(id));
    if (!chosen) throw new AiFailure('unsupported', 'OpenAI lists no models for this account');
    await deps.models.set(id, chosen.slug);
    return chosen.slug;
  }

  async function slot(): Promise<() => void> {
    if (running >= MAX_PARALLEL) await new Promise<void>((resolve) => waiting.push(resolve));
    running++;
    return () => {
      running--;
      waiting.shift()?.();
    };
  }

  function rateLimited(tabId: number | undefined): boolean {
    if (tabId === undefined) return false;
    const since = now() - 60_000;
    const recent = (tabRequests.get(tabId) ?? []).filter((at) => at > since);
    if (recent.length >= TAB_RATE_LIMIT) {
      tabRequests.set(tabId, recent);
      return true;
    }
    recent.push(now());
    tabRequests.set(tabId, recent);
    return false;
  }

  /** The streamed text of one answer, with progress from its partial JSON. */
  async function collect<T>(
    prompt: Prompt<unknown, T>,
    provider: AIProvider,
    request: StreamRequest,
    signal: AbortSignal,
    emit: (progress: AiProgress<T>) => void,
  ): Promise<string> {
    let text = '';
    let responseId: string | undefined;
    let lastEmit = 0;
    try {
      for await (const event of provider.stream(request, signal)) {
        if (event.type === 'started') responseId = event.responseId;
        else if (event.type === 'delta') {
          text += event.delta;
          if (now() - lastEmit >= progressMs) {
            lastEmit = now();
            emit({ provider: provider.id, partial: prompt.partial(parsePartialJson(text)) });
          }
        } else return event.text || text;
      }
    } catch (error) {
      if (error instanceof AiFailure && !error.responseId && responseId) {
        error.responseId = responseId;
      }
      throw error;
    }
    throw new AiFailure('network', 'The stream ended before response.completed', 0, responseId);
  }

  async function execute<T>(
    prompt: Prompt<unknown, T>,
    params: unknown,
    provider: AIProvider,
    modelSlug: string,
    key: string,
    emit: (progress: AiProgress<T>) => void,
  ): Promise<T> {
    const release = await slot();
    const controller = new AbortController();
    controllers.add(controller);
    const timer = setTimeout(
      () => controller.abort(new AiFailure('timeout', `No answer within ${totalMs / 1000} s`)),
      totalMs,
    );
    try {
      const request: StreamRequest = {
        model: modelSlug,
        instructions: prompt.instructions,
        input: [{ role: 'user', content: prompt.input(params) }],
        format: {
          type: 'json_schema',
          name: prompt.schemaName,
          strict: true,
          schema: prompt.schema,
        },
      };
      let problems: string[] = [];
      // One retry when the answer isn't what the schema says (plan §8.4).
      for (let attempt = 0; attempt < 2; attempt++) {
        const text = await collect(prompt, provider, request, controller.signal, emit);
        let json: unknown;
        try {
          json = JSON.parse(text);
          problems = validate(prompt.schema, json);
        } catch {
          problems = ['not JSON'];
        }
        if (problems.length === 0) {
          const value = prompt.fromJson(json);
          await deps.cache.put(key, {
            fn: prompt.name,
            model: modelSlug,
            provider: provider.id,
            value,
          });
          return value;
        }
      }
      throw new AiFailure('bad-output', problems.slice(0, 3).join('; '));
    } finally {
      clearTimeout(timer);
      controllers.delete(controller);
      release();
    }
  }

  /** Identical requests in flight share one stream and its progress. */
  function joinFlight<T>(
    key: string,
    start: (emit: (progress: AiProgress<T>) => void) => Promise<T>,
    listener: ((progress: AiProgress<T>) => void) | undefined,
  ): Promise<T> {
    let flight = flights.get(key);
    if (!flight) {
      const listeners = new Set<(progress: AiProgress<unknown>) => void>();
      const created: Flight = {
        listeners,
        promise: start((progress) => {
          for (const each of listeners) each(progress);
        }).finally(() => flights.delete(key)),
      };
      flights.set(key, created);
      flight = created;
    }
    const joined = flight;
    const each = listener;
    if (each) joined.listeners.add(each);
    return (joined.promise as Promise<T>).finally(() => {
      if (each) joined.listeners.delete(each);
    });
  }

  return {
    async status() {
      const settings = await deps.settings();
      const providers = chain(settings);
      for (const id of providers) {
        if ((await readiness(id, settings)) === null) return { ready: true, provider: id };
      }
      return { ready: false, provider: settings.aiProvider };
    },

    async run<P, T>(prompt: Prompt<P, T>, params: P, options: RunOptions<T> = {}) {
      const settings = await deps.settings();
      const providers = chain(settings);
      let failure: AiFailure | undefined;
      let failedProvider: AiProviderId = providers[0] ?? settings.aiProvider;
      for (const [index, id] of providers.entries()) {
        const hasNext = index < providers.length - 1;
        // Cached answers show also when signed out: only new requests need a provider.
        const notReady = options.cachedOnly ? null : await readiness(id, settings);
        if (notReady) {
          if (!failure) {
            failure = new AiFailure(notReady);
            failedProvider = id;
          }
          continue;
        }
        let slug: string | undefined;
        try {
          slug = await model(id, settings, options.cachedOnly === true);
        } catch (error) {
          failure = error instanceof AiFailure ? error : new AiFailure('failed', String(error));
          failedProvider = id;
          if (hasNext && PLAN_FALLBACK.has(failure.code)) continue;
          break;
        }
        if (!slug) {
          if (options.cachedOnly) continue;
          failure = new AiFailure('not-configured', 'No model');
          failedProvider = id;
          break;
        }
        const key = await cacheKey(prompt.name, prompt.version, slug, prompt.cacheInput(params));
        const hit = await deps.cache.get(key);
        if (hit) {
          return { status: 'ok', value: hit.value as T, cached: true, provider: id, model: slug };
        }
        if (options.cachedOnly) continue;
        if (rateLimited(options.tabId)) {
          return {
            status: 'error',
            error: new AiFailure('rate-limited', 'Too many requests from this tab').info(id),
          };
        }
        const provider = deps.providers[id];
        try {
          const value = await joinFlight<T>(
            key,
            (emit) => execute(prompt as Prompt<unknown, T>, params, provider, slug, key, emit),
            options.onProgress,
          );
          return { status: 'ok', value, cached: false, provider: id, model: slug };
        } catch (error) {
          failure = error instanceof AiFailure ? error : new AiFailure('failed', String(error));
          failedProvider = id;
          if (id === 'chatgpt-plan' && hasNext && PLAN_FALLBACK.has(failure.code)) continue;
          break;
        }
      }
      if (options.cachedOnly) return { status: 'miss' };
      return {
        status: 'error',
        error: (failure ?? new AiFailure('not-configured')).info(failedProvider),
      };
    },

    listModels,

    abortAll(reason) {
      for (const controller of controllers) controller.abort(reason);
    },
  };
}
