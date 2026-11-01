import { useState, type ReactNode } from 'react';
import type { Comprehension, TopWord, VideoAnalysis } from '../analysis/types';
import { t, type MessageKey } from '../i18n';
import type { AnalysisState, MarkNew } from './useVideoAnalysis';

/** "Add top 10 to learning" (plan §7.4). */
export const TOP_TO_LEARN = 10;

const COMPREHENSION: Readonly<Record<Comprehension, MessageKey>> = {
  comfortable: 'comprehensionComfortable',
  challenging: 'comprehensionChallenging',
  hard: 'comprehensionHard',
  'too-hard': 'comprehensionTooHard',
};

type Segment = keyof VideoAnalysis['unique'];
const SEGMENTS: readonly Segment[] = ['known', 'learning', 'ignored', 'new'];
const LEGEND: Readonly<Record<Segment, MessageKey>> = {
  known: 'analysisKnown',
  learning: 'analysisLearning',
  ignored: 'analysisIgnored',
  new: 'analysisNew',
};

/** Whole percent, rounded down: "100 %" only when every word is known. */
export function percent(share: number): string {
  return String(Math.floor(share * 100 + 1e-9));
}

/**
 * `87% known · 61 new words`: the share of what you will hear, and distinct new words (ADR 0012;
 * the plan's `142 new (61 unique)` mixed occurrences and distinct words).
 */
export function badgeText(analysis: VideoAnalysis): string {
  if (analysis.features.tokens === 0) return t('analysisNoWords');
  const known = percent(analysis.coverage);
  return analysis.unique.new === 1
    ? t('analysisBadgeOne', known)
    : t('analysisBadge', [known, String(analysis.unique.new)]);
}

/** Share of occurrences of new words; "<1" rather than "0" when there are some. */
function newShare(analysis: VideoAnalysis): string {
  const share = analysis.features.tokens === 0 ? 0 : analysis.newTokens / analysis.features.tokens;
  return share > 0 && share < 0.01 ? '<1' : percent(share);
}

function Distribution({ unique }: { unique: VideoAnalysis['unique'] }) {
  return (
    <>
      <h3 className="phasa-analysis__heading">{t('analysisDistinct')}</h3>
      <div className="phasa-analysis__bar" role="img" aria-label={t('analysisDistribution')}>
        {SEGMENTS.map((segment) =>
          unique[segment] > 0 ? (
            <span
              key={segment}
              className="phasa-analysis__segment"
              data-status={segment}
              style={{ flexGrow: unique[segment] }}
            />
          ) : null,
        )}
      </div>
      <ul className="phasa-analysis__legend" data-testid="phasa-analysis-legend">
        {SEGMENTS.map((segment) => (
          <li key={segment} data-status={segment}>
            {t(LEGEND[segment], String(unique[segment]))}
          </li>
        ))}
      </ul>
    </>
  );
}

function TopWordRow({
  word,
  busy,
  onMark,
}: {
  word: TopWord;
  busy: boolean;
  onMark: (status: 1 | 'known') => void;
}) {
  return (
    <li className="phasa-analysis__word" data-testid="phasa-analysis-word" data-thai={word.thai}>
      <span className="phasa-analysis__word-head">
        <span className="phasa-analysis__thai" lang="th">
          {word.thai}
        </span>
        {word.romanization && <span className="phasa-analysis__roman">{word.romanization}</span>}
        <span
          className="phasa-analysis__count"
          title={t('analysisOccurrences', String(word.count))}
        >
          {t('analysisTimes', String(word.count))}
        </span>
        <span className="phasa-analysis__word-actions">
          <button
            type="button"
            className="phasa-button phasa-button--small"
            disabled={busy}
            onClick={() => onMark(1)}
          >
            {t('analysisLearn')}
          </button>
          <button
            type="button"
            className="phasa-button phasa-button--small"
            disabled={busy}
            onClick={() => onMark('known')}
          >
            {t('statusButtonKnown')}
          </button>
        </span>
      </span>
      {word.gloss && <span className="phasa-analysis__gloss">{word.gloss}</span>}
    </li>
  );
}

function AnalysisDetails({ analysis, markNew }: { analysis: VideoAnalysis; markNew: MarkNew }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const { unique, features, topNew } = analysis;
  const total = unique.known + unique.learning + unique.ignored + unique.new;

  const run = (params: Parameters<MarkNew>[0]) => {
    setBusy(true);
    setFailed(false);
    markNew(params).then(
      () => {
        setBusy(false);
        setConfirming(false);
      },
      () => {
        setBusy(false);
        setFailed(true);
      },
    );
  };

  return (
    <div className="phasa-analysis__details" data-testid="phasa-analysis-details">
      {analysis.comprehension && (
        <p className="phasa-analysis__comprehension" data-comprehension={analysis.comprehension}>
          {t(COMPREHENSION[analysis.comprehension])}
        </p>
      )}
      {analysis.level && (
        <p className="phasa-analysis__note">{t('analysisLevel', analysis.level)}</p>
      )}
      {features.tokens > 0 && (
        <p className="phasa-analysis__note">
          {t('analysisFeatures', [
            features.speechRate.toFixed(1),
            features.avgCueLength.toFixed(1),
            percent(features.outside3000),
          ])}
        </p>
      )}
      {analysis.newTokens > 0 && (
        <p className="phasa-analysis__note">
          {t('analysisNewShare', [String(analysis.newTokens), newShare(analysis)])}
        </p>
      )}
      {total > 0 && <Distribution unique={unique} />}
      {total === 0 && <p className="phasa-analysis__note">{t('analysisNoWords')}</p>}
      {total > 0 && unique.new === 0 && (
        <p className="phasa-analysis__note">{t('analysisAllKnown')}</p>
      )}
      {unique.new > 0 && (
        <>
          {analysis.newHighFreq > 0 && (
            <p className="phasa-analysis__note">
              {t('analysisNewHighFreq', String(analysis.newHighFreq))}
            </p>
          )}
          {topNew.length > 0 && (
            <>
              <h3 className="phasa-analysis__heading">{t('analysisTopNew')}</h3>
              <ol className="phasa-analysis__top" data-testid="phasa-analysis-top">
                {topNew.map((word) => (
                  <TopWordRow
                    key={word.thai}
                    word={word}
                    busy={busy}
                    onMark={(status) => run({ status, words: [word.thai] })}
                  />
                ))}
              </ol>
            </>
          )}
          <div className="phasa-analysis__actions">
            {topNew.length > 0 && (
              <button
                type="button"
                className="phasa-button"
                disabled={busy}
                onClick={() => run({ status: 1, top: TOP_TO_LEARN })}
              >
                {t('analysisAddTop', String(Math.min(TOP_TO_LEARN, topNew.length)))}
              </button>
            )}
            {!confirming && (
              <button
                type="button"
                className="phasa-button"
                disabled={busy}
                onClick={() => setConfirming(true)}
              >
                {t('analysisMarkAll', String(unique.new))}
              </button>
            )}
          </div>
          {confirming && (
            <div
              className="phasa-analysis__confirm"
              role="group"
              data-testid="phasa-analysis-confirm"
            >
              <p>{t('analysisMarkAllConfirm', String(unique.new))}</p>
              <button
                type="button"
                className="phasa-button phasa-button--primary"
                disabled={busy}
                onClick={() => run({ status: 'known' })}
              >
                {t('analysisMarkAllYes')}
              </button>
              <button
                type="button"
                className="phasa-button"
                disabled={busy}
                onClick={() => setConfirming(false)}
              >
                {t('analysisCancel')}
              </button>
            </div>
          )}
        </>
      )}
      {failed && <p className="phasa-analysis__error">{t('analysisActionFailed')}</p>}
    </div>
  );
}

/**
 * The video's badge — `B1 · 87% known · 142 new (61 unique)`, colored by comprehension — that
 * opens the details: status distribution, top new words and the bulk actions (plan §7.4).
 */
export function AnalysisCard({
  state,
  markNew,
  onRetry,
  defaultOpen = false,
  footer,
}: {
  state: AnalysisState;
  markNew: MarkNew;
  onRetry: () => void;
  defaultOpen?: boolean;
  /** Extra content under the details, e.g. development tools. */
  footer?: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  if (state.status === 'unavailable') return null;
  if (state.status === 'loading') {
    return (
      <div className="phasa-analysis" data-testid="phasa-analysis" data-state="loading">
        <span className="phasa-analysis__badge" data-comprehension="none">
          {t('analysisLoading')}
        </span>
      </div>
    );
  }
  if (state.status === 'error') {
    return (
      <div className="phasa-analysis" data-testid="phasa-analysis" data-state="error">
        <span className="phasa-analysis__error">{t('analysisError')}</span>{' '}
        <button type="button" className="link-button" onClick={onRetry}>
          {t('actionRetry')}
        </button>
      </div>
    );
  }
  const { analysis } = state;
  return (
    <div
      className="phasa-analysis"
      data-testid="phasa-analysis"
      data-state="ready"
      data-analysis-ms={Math.round(analysis.analysisMs)}
    >
      <button
        type="button"
        className="phasa-analysis__badge"
        data-testid="phasa-analysis-badge"
        data-comprehension={analysis.comprehension ?? 'none'}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        {analysis.level && (
          <span className="phasa-analysis__level" title={t('analysisLevelTitle')}>
            {analysis.level}
          </span>
        )}
        <span className="phasa-analysis__summary">{badgeText(analysis)}</span>
        <span className="phasa-analysis__chevron" aria-hidden="true">
          {open ? '▴' : '▾'}
        </span>
      </button>
      {open && <AnalysisDetails analysis={analysis} markNew={markNew} />}
      {footer}
    </div>
  );
}
