/**
 * AI answers in the word popup (youtube.com shadow root) and the side panel: an "ask" button,
 * the answer streaming in, errors with their action (docs/plan.md §8.4, OpenAI's UI/UX
 * guidelines: "Using ChatGPT plan" + "Manage usage", "Manage usage" first at the usage limit).
 */
import type { ReactNode } from 'react';
import { t, type MessageKey } from '../../i18n';
import {
  MANAGE_USAGE_URL,
  type AiErrorCode,
  type AiErrorInfo,
  type AiProviderId,
  type AiStatus,
  type CueTranslation,
  type WordExplanation,
} from '../../messaging/ai';
import type { Client } from '../../messaging/client';
import { useAiAnswer, type AiKind, type AiParams, type AnswerState } from './useAi';

const ERRORS: Readonly<Record<AiErrorCode, MessageKey>> = {
  'not-configured': 'aiErrorNotConfigured',
  'sign-in-again': 'aiErrorSignInAgain',
  'no-plan-permission': 'aiErrorNoPlanPermission',
  'usage-limit': 'aiErrorUsageLimit',
  unavailable: 'aiErrorUnavailable',
  'not-eligible': 'aiErrorNotEligible',
  blocked: 'aiErrorBlocked',
  'invalid-key': 'aiErrorInvalidKey',
  quota: 'aiErrorQuota',
  'rate-limited': 'aiErrorRateLimited',
  unsupported: 'aiErrorUnsupported',
  incomplete: 'aiErrorIncomplete',
  failed: 'aiErrorFailed',
  'bad-output': 'aiErrorBadOutput',
  network: 'aiErrorNetwork',
  timeout: 'aiErrorTimeout',
};

/** Errors the settings fix; the rest may go away by asking again. */
const SETTINGS_ERRORS: ReadonlySet<AiErrorCode> = new Set([
  'not-configured',
  'sign-in-again',
  'no-plan-permission',
  'not-eligible',
  'invalid-key',
  'unsupported',
]);
const RETRY_ERRORS: ReadonlySet<AiErrorCode> = new Set([
  'unavailable',
  'rate-limited',
  'incomplete',
  'failed',
  'bad-output',
  'network',
  'timeout',
]);

export function ManageUsageLink({ primary = false }: { primary?: boolean }) {
  return (
    <a
      className={primary ? 'phasa-ai__primary' : 'phasa-ai__link'}
      href={MANAGE_USAGE_URL}
      target="_blank"
      rel="noreferrer"
      data-testid="phasa-ai-manage-usage"
    >
      {t('aiManageUsage')}
    </a>
  );
}

/** "Using ChatGPT plan · Manage usage" next to AI answers (OpenAI's UI/UX guidelines). */
export function AiUsageNote({ provider }: { provider: AiProviderId }) {
  return (
    <span className="phasa-ai__usage" data-testid="phasa-ai-usage" data-provider={provider}>
      {provider === 'chatgpt-plan' ? (
        <>
          {t('aiUsingPlan')} · <ManageUsageLink />
        </>
      ) : (
        t('aiUsingKey')
      )}
    </span>
  );
}

export function AiErrorView({
  error,
  onRetry,
  onOpenSettings,
}: {
  error: AiErrorInfo;
  onRetry: () => void;
  onOpenSettings: () => void;
}) {
  const settingsButton = (
    <button type="button" className="phasa-ai__button" onClick={onOpenSettings}>
      {t('aiOpenSettings')}
    </button>
  );
  return (
    <div
      className="phasa-ai__error"
      role="alert"
      data-testid="phasa-ai-error"
      data-code={error.code}
    >
      <p>{t(ERRORS[error.code])}</p>
      {error.detail && error.code !== 'not-configured' && (
        <p className="phasa-ai__detail">{error.detail}</p>
      )}
      <div className="phasa-ai__actions">
        {error.code === 'usage-limit' && (
          <>
            <ManageUsageLink primary />
            <span className="phasa-ai__muted">{t('aiUseKeyHint')}</span>
          </>
        )}
        {SETTINGS_ERRORS.has(error.code) && settingsButton}
        {RETRY_ERRORS.has(error.code) && (
          <button type="button" className="phasa-ai__button" onClick={onRetry}>
            {t('aiRetry')}
          </button>
        )}
      </div>
    </div>
  );
}

/** Romanization parts colored by the AI's tones, when they line up. */
function AiRomanization({ value }: { value: Partial<WordExplanation> }) {
  const romanization = value.romanization;
  if (!romanization) return null;
  const parts = romanization.split('-');
  const syllables = value.syllables ?? [];
  const aligned = syllables.length === parts.length;
  return (
    <span className="phasa-ai__roman" lang="th-Latn" title={t('aiRomanizationHint')}>
      {aligned
        ? parts.map((part, index) => (
            <span key={index}>
              {index > 0 && <span className="phasa-roman__sep">-</span>}
              <span className="phasa-tone" data-tone={syllables[index]?.tone}>
                {part}
              </span>
            </span>
          ))
        : romanization}
    </span>
  );
}

export function WordExplanationView({ value }: { value: Partial<WordExplanation> }) {
  const meta = [value.partOfSpeech, value.register].filter(Boolean).join(' · ');
  return (
    <div className="phasa-ai__answer" data-testid="phasa-ai-explanation">
      {value.meaning && <p className="phasa-ai__meaning">{value.meaning}</p>}
      {(value.romanization ?? meta) && (
        <p className="phasa-ai__meta">
          <AiRomanization value={value} />
          {value.romanization && meta && ' · '}
          {meta}
        </p>
      )}
      {value.syllables && value.syllables.length > 1 && (
        <p className="phasa-ai__syllables" lang="th">
          {value.syllables.map((syllable, index) => (
            <span key={index} className="phasa-tone" data-tone={syllable.tone}>
              {index > 0 && ' · '}
              {syllable.thai}
            </span>
          ))}
        </p>
      )}
      {value.notes && <p className="phasa-ai__notes">{value.notes}</p>}
      {value.exampleTh && (
        <div className="phasa-ai__example">
          <span className="phasa-ai__label">{t('aiExample')}</span>
          <p lang="th">{value.exampleTh}</p>
          {value.exampleEn && <p lang="en">{value.exampleEn}</p>}
        </div>
      )}
      {value.classifier && (
        <p className="phasa-ai__classifier">
          {t('aiClassifier')} <span lang="th">{value.classifier}</span>
        </p>
      )}
    </div>
  );
}

export function CueTranslationView({ value }: { value: Partial<CueTranslation> }) {
  return (
    <div className="phasa-ai__answer" data-testid="phasa-ai-translation">
      {value.natural && <p className="phasa-ai__meaning">{value.natural}</p>}
      {value.literal && (
        <p className="phasa-ai__literal">
          <span className="phasa-ai__label">{t('aiLiterally')}</span> {value.literal}
        </p>
      )}
      {value.words && value.words.length > 0 && (
        <ul className="phasa-ai__words" aria-label={t('aiWordByWord')}>
          {value.words.map((word, index) => (
            <li key={index}>
              <span lang="th">{word.thai}</span> — {word.en}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Answer({
  kind,
  answer,
}: {
  kind: AiKind;
  answer: Extract<AnswerState<unknown>, { state: 'running' | 'done' }>;
}) {
  const value = answer.state === 'done' ? answer.value : answer.partial;
  return kind === 'explain' ? (
    <WordExplanationView value={value as Partial<WordExplanation>} />
  ) : (
    <CueTranslationView value={value as Partial<CueTranslation>} />
  );
}

/**
 * The AI part of a popup or transcript row: a button until asked, then the answer. A cached
 * answer shows without asking (it costs nothing).
 */
export function AiAnswer<K extends AiKind>({
  client,
  kind,
  params,
  questionKey,
  label,
  onOpenSettings,
  footer,
}: {
  client: Client;
  kind: K;
  params: AiParams<K>;
  /** Identifies the question; a change starts over. */
  questionKey: string;
  label: string;
  onOpenSettings: () => void;
  footer?: ReactNode;
}) {
  const { answer, run } = useAiAnswer(client, kind, params, questionKey);
  return (
    <div
      className="phasa-ai"
      data-testid={`phasa-ai-${kind}`}
      data-state={answer.state}
      data-first-ms={answer.state === 'done' ? (answer.timing?.firstMs ?? undefined) : undefined}
      data-total-ms={answer.state === 'done' ? answer.timing?.totalMs : undefined}
    >
      {(answer.state === 'idle' || answer.state === 'checking') && (
        <button
          type="button"
          className="phasa-ai__ask"
          disabled={answer.state === 'checking'}
          onClick={run}
        >
          <span className="phasa-ai__badge">{t('aiBadge')}</span> {label}
        </button>
      )}
      {answer.state === 'running' && (
        <>
          <p className="phasa-ai__working" role="status">
            <span className="phasa-ai__badge">{t('aiBadge')}</span> {t('aiWorking')}
          </p>
          <Answer kind={kind} answer={answer} />
        </>
      )}
      {answer.state === 'done' && (
        <>
          <div className="phasa-ai__head">
            <span className="phasa-ai__badge">{t('aiBadge')}</span>
            <span className="phasa-ai__muted" data-testid="phasa-ai-source">
              {[
                answer.model,
                answer.cached ? t('aiCached') : null,
                answer.provider === 'openai-api-key' ? t('aiViaKey') : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </span>
          </div>
          <Answer kind={kind} answer={answer} />
          {footer}
        </>
      )}
      {answer.state === 'error' && (
        <AiErrorView error={answer.error} onRetry={run} onOpenSettings={onOpenSettings} />
      )}
    </div>
  );
}

/**
 * The AI actions of one place (popup, transcript line) with the provider note once, next to the
 * buttons, as OpenAI's guidelines put it near the composer.
 */
export function AiSection({ status, children }: { status: AiStatus | null; children: ReactNode }) {
  return (
    <div className="phasa-ai-section" data-testid="phasa-ai-section">
      {children}
      {status?.ready && <AiUsageNote provider={status.provider} />}
    </div>
  );
}
