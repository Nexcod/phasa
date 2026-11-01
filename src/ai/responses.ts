/**
 * The Responses API client both providers share (docs/plan.md §8.4, §8.5). The ChatGPT-plan
 * route's preview rules hold for every request: `store: false`, `stream: true`, full context
 * in `input`, instructions not as a system message, and none of the fields OpenAI rejects
 * there (preview limitations page, checked 2026-11-01). Success only on `response.completed`.
 */
import type { AiProviderId } from '../messaging/ai';
import { AiFailure, failureFromEvent, failureFromHttp } from './errors';
import type { JsonSchema } from './schema';
import { parseSse, textChunks, type SseMessage } from './sse';

export const RESPONSES_URL = 'https://api.openai.com/v1/responses';
export const MODELS_URL = 'https://api.openai.com/v1/models';

/** Request fields the ChatGPT-plan route rejects. */
export const FORBIDDEN_FIELDS = [
  'background',
  'conversation',
  'max_output_tokens',
  'max_tool_calls',
  'metadata',
  'moderation',
  'multi_agent',
  'previous_response_id',
  'prompt',
  'prompt_cache_retention',
  'safety_identifier',
  'temperature',
  'top_logprobs',
  'top_p',
  'truncation',
  'user',
] as const;

export type ForbiddenField = (typeof FORBIDDEN_FIELDS)[number];

/** No `system` role: the route rejects it; instructions go in `instructions`. */
export interface InputMessage {
  role: 'user' | 'developer' | 'assistant';
  content: string;
}

export interface JsonSchemaFormat {
  type: 'json_schema';
  name: string;
  strict: true;
  schema: JsonSchema;
}

/** The forbidden fields are `never`: a request that sets one doesn't compile. */
export type ResponsesBody = {
  model: string;
  instructions: string;
  input: InputMessage[];
  store: false;
  stream: true;
  text?: { format: JsonSchemaFormat };
} & Readonly<Partial<Record<ForbiddenField, never>>>;

/** The runtime half of the rules, for bodies built from untyped data. */
export function checkBody(body: Record<string, unknown>): void {
  const forbidden = FORBIDDEN_FIELDS.filter((field) => Object.hasOwn(body, field));
  if (forbidden.length > 0) throw new Error(`Forbidden request fields: ${forbidden.join(', ')}`);
  if (body.store !== false || body.stream !== true) {
    throw new Error('Requests must set store: false and stream: true');
  }
  const input = body.input;
  if (!Array.isArray(input)) throw new Error('input must be an array');
  if (input.some((item) => (item as { role?: unknown } | null)?.role === 'system')) {
    throw new Error('role "system" is rejected; use instructions');
  }
}

export type StreamEvent =
  | { type: 'started'; responseId: string }
  | { type: 'delta'; delta: string }
  | { type: 'completed'; text: string; responseId?: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The output text of a completed response, for streams that sent no deltas. */
function outputText(response: unknown): string {
  if (!isRecord(response) || !Array.isArray(response.output)) return '';
  let text = '';
  for (const item of response.output as unknown[]) {
    if (!isRecord(item) || !Array.isArray(item.content)) continue;
    for (const part of item.content as unknown[]) {
      if (isRecord(part) && part.type === 'output_text' && typeof part.text === 'string') {
        text += part.text;
      }
    }
  }
  return text;
}

/** Responses API events → {@link StreamEvent}s; throws {@link AiFailure} on any other ending. */
export async function* readResponseStream(
  messages: AsyncIterable<SseMessage>,
): AsyncGenerator<StreamEvent> {
  let text = '';
  let responseId: string | undefined;
  for await (const message of messages) {
    if (message.data === '[DONE]') continue;
    let event: unknown;
    try {
      event = JSON.parse(message.data);
    } catch {
      continue; // not JSON: not an event we know
    }
    if (!isRecord(event)) continue;
    const type = typeof event.type === 'string' ? event.type : message.event;
    const response = isRecord(event.response) ? event.response : undefined;
    if (!responseId && typeof response?.id === 'string') {
      responseId = response.id;
      yield { type: 'started', responseId };
    }
    switch (type) {
      case 'response.output_text.delta':
        if (typeof event.delta === 'string' && event.delta !== '') {
          text += event.delta;
          yield { type: 'delta', delta: event.delta };
        }
        break;
      case 'response.completed': {
        const completed: StreamEvent = { type: 'completed', text: text || outputText(response) };
        if (responseId) completed.responseId = responseId;
        yield completed;
        return;
      }
      case 'response.failed':
      case 'error': {
        const failure = failureFromEvent(event);
        failure.responseId = responseId;
        throw failure;
      }
      case 'response.incomplete': {
        const details = isRecord(response?.incomplete_details) ? response.incomplete_details : {};
        const reason = typeof details.reason === 'string' ? details.reason : undefined;
        throw new AiFailure('incomplete', reason, 0, responseId);
      }
      default:
        break; // created, in_progress, output_item.*, content_part.*, metadata …
    }
  }
  throw new AiFailure('network', 'The stream ended before response.completed', 0, responseId);
}

export interface StreamOptions {
  fetch: typeof fetch;
  provider: AiProviderId;
  token: string;
  body: ResponsesBody;
  signal?: AbortSignal;
  /** Abort when nothing arrives for this long (also while waiting for the headers). */
  idleMs?: number;
}

/** POST /v1/responses and its events. A failure before the stream carries the HTTP status. */
export async function* streamResponses(options: StreamOptions): AsyncGenerator<StreamEvent> {
  checkBody(options.body);
  const idleMs = options.idleMs ?? 60_000;
  const controller = new AbortController();
  const outer = options.signal;
  const onAbort = () => controller.abort();
  outer?.addEventListener('abort', onAbort);
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, idleMs);
  };
  const interrupted = (error: unknown): AiFailure => {
    if (outer?.aborted && outer.reason instanceof AiFailure) return outer.reason;
    if (timedOut) return new AiFailure('timeout', `Nothing arrived for ${idleMs / 1000} s`);
    return new AiFailure('network', error instanceof Error ? error.message : String(error));
  };
  arm();
  try {
    let response: Response;
    try {
      response = await options.fetch(RESPONSES_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${options.token}`,
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        body: JSON.stringify(options.body),
        signal: controller.signal,
      });
    } catch (error) {
      throw interrupted(error);
    }
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw failureFromHttp(response.status, text, options.provider);
    }
    if (!response.body) throw new AiFailure('network', 'The response has no body');
    const body = response.body;
    async function* chunks(): AsyncGenerator<string> {
      for await (const chunk of textChunks(body, controller.signal)) {
        arm();
        yield chunk;
      }
    }
    try {
      yield* readResponseStream(parseSse(chunks()));
    } catch (error) {
      if (error instanceof AiFailure) throw error;
      throw interrupted(error);
    }
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener('abort', onAbort);
  }
}
