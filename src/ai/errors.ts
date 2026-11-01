/**
 * OpenAI errors → {@link AiErrorCode} (docs/plan.md §8.4; OpenAI's "Errors and recovery" page,
 * checked 2026-11-01). The list there is not exhaustive: unknown codes fall back to the HTTP
 * status.
 */
import type { AiErrorCode, AiErrorInfo, AiProviderId } from '../messaging/ai';

export class AiFailure extends Error {
  constructor(
    readonly code: AiErrorCode,
    readonly detail?: string,
    /** HTTP status before the stream; 0 for stream events and local failures. */
    readonly status = 0,
    public responseId?: string,
  ) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'AiFailure';
  }

  info(provider: AiProviderId): AiErrorInfo {
    const info: AiErrorInfo = { code: this.code, provider };
    if (this.detail) info.detail = this.detail.slice(0, 300);
    if (this.responseId) info.responseId = this.responseId;
    return info;
  }
}

const BY_CODE: Readonly<Record<string, AiErrorCode>> = {
  subscription_sharing_usage_limit_exceeded: 'usage-limit',
  subscription_sharing_usage_unavailable: 'unavailable',
  subscription_sharing_user_unavailable: 'unavailable',
  subscription_sharing_user_not_eligible: 'not-eligible',
  subscription_sharing_unsupported_capability: 'unsupported',
  subscription_sharing_route_not_supported: 'blocked',
  subscription_sharing_invalid_user: 'sign-in-again',
  chatpass_v2_scope_not_authorized: 'blocked',
  chatpass_v2_invalid_authorization_context: 'blocked',
  // The API-key route (platform errors).
  invalid_api_key: 'invalid-key',
  insufficient_quota: 'quota',
  rate_limit_exceeded: 'rate-limited',
  model_not_found: 'unsupported',
  server_error: 'failed',
};

/** Codes after which a request may succeed later; the rest won't change by retrying. */
export const RETRYABLE: ReadonlySet<AiErrorCode> = new Set([
  'unavailable',
  'network',
  'timeout',
  'failed',
  'incomplete',
  'rate-limited',
  'bad-output',
]);

/** Errors for which the user's API key may stand in for the ChatGPT plan, if they enabled it. */
export const PLAN_FALLBACK: ReadonlySet<AiErrorCode> = new Set([
  'usage-limit',
  'unavailable',
  'not-eligible',
  'no-plan-permission',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

interface ErrorFields {
  code?: string;
  message?: string;
  param?: string;
}

/** `{error: {code, message, param}}`, a bare `{code, message}`, or `{detail: "…"}`. */
export function errorFields(value: unknown): ErrorFields {
  if (!isRecord(value)) return {};
  const source = isRecord(value.error) ? value.error : value;
  const fields: ErrorFields = {};
  if (typeof source.code === 'string') fields.code = source.code;
  else if (typeof source.type === 'string') fields.code = source.type;
  if (typeof source.message === 'string') fields.message = source.message;
  else if (typeof value.detail === 'string') fields.message = value.detail;
  if (typeof source.param === 'string') fields.param = source.param;
  return fields;
}

function describe(fields: ErrorFields): string | undefined {
  const parts = [fields.code, fields.param && `param ${fields.param}`, fields.message].filter(
    (part): part is string => Boolean(part),
  );
  return parts.length > 0 ? parts.join(' — ') : undefined;
}

/** A non-2xx answer before the stream started. */
export function failureFromHttp(status: number, body: string, provider: AiProviderId): AiFailure {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    json = undefined;
  }
  const fields = errorFields(json);
  const detail = describe(fields) ?? (body.trim().slice(0, 200) || `HTTP ${status}`);
  const known = fields.code ? BY_CODE[fields.code] : undefined;
  if (known) return new AiFailure(known, detail, status);
  let code: AiErrorCode;
  if (status === 401) code = provider === 'openai-api-key' ? 'invalid-key' : 'sign-in-again';
  else if (status === 403) code = 'blocked';
  else if (status === 429) code = provider === 'chatgpt-plan' ? 'usage-limit' : 'rate-limited';
  else if (status === 400 || status === 404 || status === 422) code = 'unsupported';
  else if (status >= 500) code = 'unavailable';
  else code = 'failed';
  return new AiFailure(code, detail, status);
}

/** `response.failed` / `error` events: a code inside the stream, possibly after some text. */
export function failureFromEvent(event: Record<string, unknown>): AiFailure {
  const response = isRecord(event.response) ? event.response : undefined;
  const fields = errorFields(response?.error ?? event.error ?? event);
  const known = fields.code ? BY_CODE[fields.code] : undefined;
  return new AiFailure(known ?? 'failed', describe(fields));
}
