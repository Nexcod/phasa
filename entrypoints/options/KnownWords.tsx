import { useEffect, useState, type ChangeEvent } from 'react';
import { t } from '@/src/i18n';
import type { Client } from '@/src/messaging/client';
import { MAX_STATUS_WORDS } from '@/src/messaging/protocol';
import { statusLabel } from '@/src/ui/labels';
import { parseWordList, type ParsedWordList } from '@/src/vocab/import';
import { COMMON_PARTICLES } from '@/src/vocab/particles';
import {
  FREQUENT_COUNTS,
  type BulkMode,
  type FrequentWord,
  type VocabCounts,
} from '@/src/vocab/types';

/** Larger files are refused: a word list is a few hundred kilobytes at most. */
const MAX_FILE_BYTES = 10 * 1024 * 1024;

function useVocabCounts(client: Client): VocabCounts | null {
  const [counts, setCounts] = useState<VocabCounts | null>(null);
  useEffect(() => {
    let active = true;
    const load = () => {
      client.request('vocab/counts', {}).then(
        (next) => {
          if (active) setCounts(next);
        },
        () => undefined,
      );
    };
    const unsubscribe = client.onEvent((event) => {
      if (event.type === 'vocab/changed' || event.type === 'sw/hello') load();
    });
    load();
    return () => {
      active = false;
      unsubscribe();
    };
  }, [client]);
  return counts;
}

/** Marks words as known in requests of at most {@link MAX_STATUS_WORDS}; resolves with the count changed. */
async function markKnown(
  client: Client,
  words: readonly string[],
  mode: BulkMode,
  split = false,
): Promise<number> {
  let changed = 0;
  for (let i = 0; i < words.length; i += MAX_STATUS_WORDS) {
    const batch = words.slice(i, i + MAX_STATUS_WORDS);
    const result = await client.request(
      'vocab/bulk-set',
      { words: batch, status: 'known', mode, ...(split ? { split } : {}) },
      { timeoutMs: 60_000 },
    );
    changed += result.changed;
  }
  return changed;
}

type Outcome =
  { state: 'idle' } | { state: 'busy' } | { state: 'done'; changed: number } | { state: 'error' };

function OutcomeLine({ outcome }: { outcome: Outcome }) {
  if (outcome.state === 'done') {
    return (
      <p className="known__result" role="status">
        {t('knownMarked', String(outcome.changed))}
      </p>
    );
  }
  if (outcome.state === 'error') return <p className="page__error">{t('knownFailed')}</p>;
  return null;
}

function Particles({ client }: { client: Client }) {
  const [outcome, setOutcome] = useState<Outcome>({ state: 'idle' });
  return (
    <div className="known__block" data-testid="phasa-known-particles">
      <h3>{t('knownBeginnerTitle')}</h3>
      <p>{t('knownBeginnerText')}</p>
      <p lang="th" className="known__particles">
        {COMMON_PARTICLES.join(' · ')}
      </p>
      <button
        type="button"
        className="phasa-button"
        disabled={outcome.state === 'busy'}
        onClick={() => {
          setOutcome({ state: 'busy' });
          markKnown(client, COMMON_PARTICLES, 'new-only').then(
            (changed) => setOutcome({ state: 'done', changed }),
            () => setOutcome({ state: 'error' }),
          );
        }}
      >
        {t('knownParticlesButton', String(COMMON_PARTICLES.length))}
      </button>
      <OutcomeLine outcome={outcome} />
    </div>
  );
}

function TopWords({ client }: { client: Client }) {
  const [count, setCount] = useState<number>(1000);
  const [list, setList] = useState<{ count: number; words: FrequentWord[] } | null>(null);
  const [loading, setLoading] = useState(false);
  /** Words the learner unticked. */
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(new Set());
  const [outcome, setOutcome] = useState<Outcome>({ state: 'idle' });

  const review = () => {
    setLoading(true);
    setOutcome({ state: 'idle' });
    client.request('vocab/frequent', { count }, { timeoutMs: 60_000 }).then(
      ({ words }) => {
        setList({ count, words });
        setExcluded(new Set());
        setLoading(false);
      },
      () => {
        setLoading(false);
        setOutcome({ state: 'error' });
      },
    );
  };

  const selected = list
    ? list.words.filter((word) => word.status === undefined && !excluded.has(word.thai))
    : [];
  const toggle = (thai: string, checked: boolean) => {
    setExcluded((current) => {
      const next = new Set(current);
      if (checked) next.delete(thai);
      else next.add(thai);
      return next;
    });
  };

  return (
    <div className="known__block" data-testid="phasa-known-top">
      <h3>{t('knownTopTitle')}</h3>
      <p>{t('knownTopText')}</p>
      <div className="known__row">
        <label className="select">
          {t('knownTopCount')}
          <select value={count} onChange={(event) => setCount(Number(event.target.value))}>
            {FREQUENT_COUNTS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="phasa-button" disabled={loading} onClick={review}>
          {loading ? t('knownTopLoading') : t('knownTopReview')}
        </button>
      </div>
      {list && (
        <>
          <div className="known__row">
            <span className="known__selected">
              {t('knownTopSelected', [String(selected.length), String(list.words.length)])}
            </span>
            <button type="button" className="link-button" onClick={() => setExcluded(new Set())}>
              {t('knownSelectAll')}
            </button>
            <button
              type="button"
              className="link-button"
              onClick={() => setExcluded(new Set(list.words.map((word) => word.thai)))}
            >
              {t('knownSelectNone')}
            </button>
          </div>
          <ol className="known__list" data-testid="phasa-known-list">
            {list.words.map((word) => {
              const saved = word.status !== undefined;
              return (
                <li key={word.thai} className="known__item" data-saved={saved || undefined}>
                  <label>
                    <input
                      type="checkbox"
                      checked={!saved && !excluded.has(word.thai)}
                      disabled={saved}
                      onChange={(event) => toggle(word.thai, event.target.checked)}
                    />
                    <span className="known__thai" lang="th">
                      {word.thai}
                    </span>
                    {word.romanization && <span className="known__roman">{word.romanization}</span>}
                    {word.gloss && <span className="known__gloss">{word.gloss}</span>}
                    {word.status !== undefined && (
                      <span className="known__status">{statusLabel(word.status)}</span>
                    )}
                  </label>
                </li>
              );
            })}
          </ol>
          <button
            type="button"
            className="phasa-button phasa-button--primary"
            disabled={selected.length === 0 || outcome.state === 'busy'}
            onClick={() => {
              setOutcome({ state: 'busy' });
              markKnown(
                client,
                selected.map((word) => word.thai),
                'new-only',
              ).then(
                (changed) => {
                  setOutcome({ state: 'done', changed });
                  setList(null);
                },
                () => setOutcome({ state: 'error' }),
              );
            }}
          >
            {t('knownTopApply', String(selected.length))}
          </button>
        </>
      )}
      <OutcomeLine outcome={outcome} />
    </div>
  );
}

function ImportList({ client }: { client: Client }) {
  const [text, setText] = useState('');
  const [parsed, setParsed] = useState<ParsedWordList | null>(null);
  const [outcome, setOutcome] = useState<Outcome>({ state: 'idle' });

  const read = (value: string) => {
    setText(value);
    setParsed(value.trim() ? parseWordList(value) : null);
    setOutcome({ state: 'idle' });
  };
  const onFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      setOutcome({ state: 'error' });
      return;
    }
    file.text().then(read, () => setOutcome({ state: 'error' }));
  };

  return (
    <div className="known__block" data-testid="phasa-known-import">
      <h3>{t('knownImportTitle')}</h3>
      <p>{t('knownImportText')}</p>
      <input
        type="file"
        accept=".txt,.csv,.tsv,text/plain,text/csv,text/tab-separated-values"
        aria-label={t('knownImportFile')}
        onChange={onFile}
      />
      <textarea
        className="known__paste"
        lang="th"
        rows={4}
        placeholder={t('knownImportPaste')}
        aria-label={t('knownImportPaste')}
        value={text}
        onChange={(event) => read(event.target.value)}
      />
      {parsed && (
        <p className="known__found">
          {t('knownImportFound', [String(parsed.words.length), String(parsed.skipped)])}
        </p>
      )}
      <button
        type="button"
        className="phasa-button phasa-button--primary"
        disabled={!parsed || parsed.words.length === 0 || outcome.state === 'busy'}
        onClick={() => {
          if (!parsed) return;
          setOutcome({ state: 'busy' });
          markKnown(client, parsed.words, 'advance', true).then(
            (changed) => setOutcome({ state: 'done', changed }),
            () => setOutcome({ state: 'error' }),
          );
        }}
      >
        {t('knownImportApply')}
      </button>
      <OutcomeLine outcome={outcome} />
    </div>
  );
}

/**
 * Onboarding (docs/plan.md §2.1): start from zero, mark the common particles, mark the N most
 * frequent words after a review, or import a list.
 */
export function KnownWords({ client }: { client: Client }) {
  const counts = useVocabCounts(client);
  return (
    <section className="page__section known" data-testid="phasa-options-known">
      <h2>{t('optionsSectionOnboarding')}</h2>
      <p>{t('knownIntro')}</p>
      {counts && (
        <p className="known__counts" data-testid="phasa-known-counts">
          {t('knownCounts', [
            String(counts.known),
            String(counts.learning),
            String(counts.ignored),
          ])}
        </p>
      )}
      <Particles client={client} />
      <TopWords client={client} />
      <ImportList client={client} />
    </section>
  );
}
