/**
 * AI and account types shared by every context (docs/plan.md §8). Nothing here carries a
 * credential: tokens and API keys stay in the service worker (src/auth, src/ai).
 */
import type { Tone } from '../thai/types';

/** Where AI requests are billed (docs/plan.md §8.5). */
export type AiProviderId = 'chatgpt-plan' | 'openai-api-key';

/** What any context may know about AI: whether it works now and through which provider. */
export interface AiStatus {
  ready: boolean;
  /** The provider requests go to first. */
  provider: AiProviderId;
}

/**
 * Why an AI request failed. The UI shows a message and an action per code
 * (src/ui/ai/AiError.tsx); `detail` carries OpenAI's own code or text for support.
 */
export type AiErrorCode =
  /** Not signed in, no API key, or no model chosen for the API key. */
  | 'not-configured'
  /** The refresh token is gone or was rejected: sign in again. */
  | 'sign-in-again'
  /** Signed in, but the user did not allow the use of the ChatGPT plan. */
  | 'no-plan-permission'
  /** The ChatGPT plan's usage limit: "Manage usage" is the main action. */
  | 'usage-limit'
  /** OpenAI can't serve the plan right now (503): try again later. */
  | 'unavailable'
  /** The ChatGPT account's plan doesn't include usage by apps. */
  | 'not-eligible'
  /** OpenAI refused the request for a policy, region or permission reason. */
  | 'blocked'
  | 'invalid-key'
  /** The API key's account is out of credit. */
  | 'quota'
  | 'rate-limited'
  /** The model or a request feature isn't available: choose another model. */
  | 'unsupported'
  /** The model stopped before finishing (response.incomplete). */
  | 'incomplete'
  | 'failed'
  /** The answer didn't match the expected format, also after one retry. */
  | 'bad-output'
  /** No connection, or the stream broke off before response.completed. */
  | 'network'
  | 'timeout';

export interface AiErrorInfo {
  code: AiErrorCode;
  provider: AiProviderId;
  /** OpenAI's error code or message, for support. */
  detail?: string;
  /** The response id (`resp_…`) when the stream got that far. */
  responseId?: string;
}

/** A word or phrase explained in its subtitle line (plan §8.6 `explainWord`). */
export interface WordExplanation {
  meaning: string;
  partOfSpeech: string | null;
  romanization: string;
  syllables: { thai: string; tone: Tone }[];
  /** Register and politeness, e.g. "informal, between friends". */
  register: string;
  notes: string | null;
  exampleTh: string;
  exampleEn: string;
  classifier: string | null;
}

/** A subtitle line translated (plan §8.6 `translateCue`). */
export interface CueTranslation {
  natural: string;
  literal: string;
  words: { thai: string; en: string }[];
}

/** A subtitle line, with the English line shown under it when there is one. */
export interface AiLine {
  text: string;
  translation?: string;
}

/** The line in question with up to {@link MAX_CONTEXT_LINES} lines on each side. */
export interface AiLineContext {
  line: AiLine;
  before: string[];
  after: string[];
  videoTitle: string;
}

export const MAX_CONTEXT_LINES = 2;

export interface ExplainWordParams extends AiLineContext {
  /** The word or phrase, as it appears in the line. */
  word: string;
  /** Only look in the cache; never calls OpenAI. */
  cachedOnly?: boolean;
}

export interface TranslateCueParams extends AiLineContext {
  cachedOnly?: boolean;
}

export type AiResult<T> =
  | { status: 'ok'; value: T; cached: boolean; provider: AiProviderId; model: string }
  /** `cachedOnly` and nothing cached. */
  | { status: 'miss' }
  | { status: 'error'; error: AiErrorInfo };

/** Pushed while the answer streams in: the fields parsed so far. */
export interface AiProgress<T> {
  provider: AiProviderId;
  partial: Partial<T>;
}

export interface AiModel {
  slug: string;
  displayName: string;
}

export type ChatGptState = 'signed-out' | 'signed-in' | 'needs-sign-in';

/** The account screen (options page only). */
export interface AccountView {
  chatgpt: {
    state: ChatGptState;
    email?: string;
    name?: string;
    /** `chatgpt.tokens.use.direct` was granted (plan §8.2 step 6). */
    planUsage: boolean;
    /** A client id was issued: the next sign-in is a reauthorization. */
    registered: boolean;
    /** A sign-in tab is open and its callback hasn't come back yet. */
    pending: boolean;
  };
  apiKey: {
    set: boolean;
    /** The key's first and last characters, e.g. `sk-…a1b2`. */
    hint?: string;
  };
  status: AiStatus;
}

export type SignInFailure =
  | 'expired'
  | 'state-mismatch'
  | 'denied'
  | 'no-client-id'
  | 'client-mismatch'
  | 'account-mismatch'
  | 'exchange-failed'
  | 'invalid-token'
  | 'network';

export type SignInResult =
  | { ok: true; email?: string; planUsage: boolean }
  | { ok: false; reason: SignInFailure; detail?: string };

/** ChatGPT settings → Usage (OpenAI's UI/UX guidelines: "Manage usage"). */
export const MANAGE_USAGE_URL = 'https://chatgpt.com/settings/usage';
