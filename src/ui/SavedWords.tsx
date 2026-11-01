import { useCallback, useEffect, useState } from 'react';
import { t } from '../i18n';
import type { Client } from '../messaging/client';
import { WORD_STATUSES, type SavedContext, type SavedUnit, type WordStatus } from '../vocab/types';
import { formatTime, statusLabel } from './labels';

const PAGE_SIZE = 50;

/** Saved words and phrases from the SW, refreshed on `vocab/changed` (docs/plan.md §2.1). */
export function useSavedWords(
  client: Client,
  filter: { videoId?: string; query?: string },
): { units: SavedUnit[]; total: number; loaded: boolean; more: () => void } {
  const [state, setState] = useState<{ units: SavedUnit[]; total: number; loaded: boolean }>({
    units: [],
    total: 0,
    loaded: false,
  });
  const [limit, setLimit] = useState(PAGE_SIZE);
  const { videoId, query } = filter;

  useEffect(() => {
    let active = true;
    const load = () => {
      const params = {
        limit,
        ...(videoId ? { videoId } : {}),
        ...(query ? { query } : {}),
      };
      client.request('vocab/list', params).then(
        ({ units, total }) => {
          if (active) setState({ units, total, loaded: true });
        },
        () => {
          if (active) setState((current) => ({ ...current, loaded: true }));
        },
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
  }, [client, videoId, query, limit]);

  const more = useCallback(() => setLimit((current) => current + PAGE_SIZE), []);
  return { ...state, more };
}

function ContextLine({
  context,
  onOpen,
}: {
  context: SavedContext;
  onOpen: (context: SavedContext) => void;
}) {
  return (
    <li className="saved__context">
      <span className="saved__sentence" lang="th">
        {context.sentence}
      </span>
      {context.sentenceTranslation && (
        <span className="saved__translation" lang="en">
          {context.sentenceTranslation}
        </span>
      )}
      <button type="button" className="link-button saved__open" onClick={() => onOpen(context)}>
        {context.videoTitle ? `${context.videoTitle} · ` : ''}
        {t('contextOpen', formatTime(context.cueStartMs))}
      </button>
    </li>
  );
}

export function SavedWordItem({
  unit,
  client,
  onOpen,
  maxContexts = 3,
}: {
  unit: SavedUnit;
  client: Client;
  onOpen: (context: SavedContext) => void;
  maxContexts?: number;
}) {
  const setStatus = (status: WordStatus) => {
    client
      .request('vocab/set', { kind: unit.kind, thai: unit.thai, status })
      .catch(() => undefined);
  };
  return (
    <li className="saved__item" data-testid="phasa-saved-word" data-thai={unit.thai}>
      <div className="saved__head">
        <span className="saved__thai" lang="th">
          {unit.thai}
        </span>
        {unit.romanization && <span className="saved__roman">{unit.romanization}</span>}
        <select
          className="saved__status"
          aria-label={t('wordsStatusLabel', unit.thai)}
          value={String(unit.status)}
          onChange={(event) => {
            const value = event.target.value;
            setStatus((/^\d$/.test(value) ? Number(value) : value) as WordStatus);
          }}
        >
          {WORD_STATUSES.filter((status) => status !== 'new').map((status) => (
            <option key={String(status)} value={String(status)}>
              {statusLabel(status)}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="link-button saved__delete"
          onClick={() => {
            client
              .request('vocab/delete', { kind: unit.kind, thai: unit.thai })
              .catch(() => undefined);
          }}
        >
          {t('wordsDelete')}
        </button>
      </div>
      {unit.gloss && <p className="saved__gloss">{unit.gloss}</p>}
      {unit.contexts.length > 0 && (
        <ul className="saved__contexts">
          {unit.contexts.slice(0, maxContexts).map((context) => (
            <ContextLine
              key={`${context.videoId}:${context.cueStartMs}`}
              context={context}
              onOpen={onOpen}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

export function SavedWordList({
  client,
  units,
  total,
  loaded,
  onMore,
  onOpen,
}: {
  client: Client;
  units: SavedUnit[];
  total: number;
  loaded: boolean;
  onMore: () => void;
  onOpen: (context: SavedContext) => void;
}) {
  if (loaded && units.length === 0) return <p className="page__empty">{t('wordsEmpty')}</p>;
  return (
    <>
      <p className="saved__total">{t('wordsTotal', String(total))}</p>
      <ul className="saved" data-testid="phasa-saved-words">
        {units.map((unit) => (
          <SavedWordItem
            key={`${unit.kind}:${unit.thai}`}
            unit={unit}
            client={client}
            onOpen={onOpen}
          />
        ))}
      </ul>
      {units.length < total && (
        <button type="button" className="link-button" onClick={onMore}>
          {t('wordsMore')}
        </button>
      )}
    </>
  );
}
