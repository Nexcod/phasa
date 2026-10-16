import { memo, useCallback, useEffect, useRef } from 'react';
import { t, type MessageKey } from '@/src/i18n';
import type { Client } from '@/src/messaging/client';
import type { PanelCue, PanelSession } from '@/src/messaging/panel';
import type { Settings } from '@/src/settings';
import { StatusLine } from '@/src/ui/StatusLine';
import { useBackgroundStatus } from '@/src/ui/useBackgroundStatus';
import { useSettings } from '@/src/ui/useSettings';
import { isWatchUrl, useActiveTab, useTabSession } from './useTabSession';

const ERROR_MESSAGES: Readonly<Record<string, MessageKey>> = {
  unavailable: 'captionsErrorUnavailable',
  network: 'captionsErrorNetwork',
  internal: 'captionsErrorInternal',
};

/** Pause auto-scroll this long after the user scrolls the transcript. */
const MANUAL_SCROLL_HOLD_MS = 4000;

export function formatTime(ms: number): string {
  const total = Math.floor(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, '0');
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}`
    : `${minutes}:${seconds}`;
}

const CueRow = memo(function CueRow({
  cue,
  index,
  active,
  showTranslation,
  onSeek,
}: {
  cue: PanelCue;
  index: number;
  active: boolean;
  showTranslation: boolean;
  onSeek: (index: number) => void;
}) {
  return (
    <li
      className="transcript__row"
      data-active={active || undefined}
      aria-current={active || undefined}
    >
      <button type="button" className="transcript__button" onClick={() => onSeek(index)}>
        <span className="transcript__time">{formatTime(cue.startMs)}</span>
        <span className="transcript__text">
          <span className="transcript__thai" lang="th">
            {cue.text}
          </span>
          {showTranslation && cue.translation && (
            <span className="transcript__en" lang="en">
              {cue.translation}
            </span>
          )}
        </span>
      </button>
    </li>
  );
});

function Transcript({
  cues,
  activeIndex,
  showTranslation,
  onSeek,
}: {
  cues: PanelCue[];
  activeIndex: number;
  showTranslation: boolean;
  onSeek: (index: number) => void;
}) {
  const listRef = useRef<HTMLOListElement>(null);
  const userScrolledAt = useRef(0);

  useEffect(() => {
    const list = listRef.current;
    if (!list || activeIndex < 0 || Date.now() - userScrolledAt.current < MANUAL_SCROLL_HOLD_MS)
      return;
    const row = list.children[activeIndex];
    if (row instanceof HTMLElement) row.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [activeIndex]);

  return (
    <ol
      ref={listRef}
      className="transcript"
      aria-label={t('transcriptLabel')}
      data-testid="phasa-transcript"
      onWheel={() => (userScrolledAt.current = Date.now())}
      onTouchMove={() => (userScrolledAt.current = Date.now())}
    >
      {cues.map((cue, index) => (
        <CueRow
          key={`${cue.startMs}-${index}`}
          cue={cue}
          index={index}
          active={index === activeIndex}
          showTranslation={showTranslation}
          onSeek={onSeek}
        />
      ))}
    </ol>
  );
}

function Toggles({
  settings,
  onChange,
}: {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
}) {
  return (
    <div className="toggles">
      <label className="toggle">
        <input
          type="checkbox"
          checked={settings.showTranslation}
          onChange={(event) => onChange({ showTranslation: event.target.checked })}
        />
        {t('settingShowTranslation')}
      </label>
      <label className="toggle">
        <input
          type="checkbox"
          checked={settings.autoPause}
          onChange={(event) => onChange({ autoPause: event.target.checked })}
        />
        {t('settingAutoPause')}
      </label>
    </div>
  );
}

function SessionView({
  session,
  activeIndex,
  settings,
  onSettings,
  onSeek,
  onRetry,
}: {
  session: PanelSession;
  activeIndex: number;
  settings: Settings;
  onSettings: (patch: Partial<Settings>) => void;
  onSeek: (index: number) => void;
  onRetry: () => void;
}) {
  if (session.status === 'idle') return <p className="page__empty">{t('sidepanelEmpty')}</p>;
  const { video } = session;
  return (
    <section className="video" data-testid="phasa-panel-session" data-status={session.status}>
      {video.title && (
        <div className="video__meta">
          <h2 className="video__title">{video.title}</h2>
          {video.channel && <p className="video__channel">{video.channel}</p>}
        </div>
      )}
      {session.status === 'loading' && <p className="page__empty">{t('captionsLoading')}</p>}
      {session.status === 'no-thai' && <p className="page__empty">{t('captionsNoThai')}</p>}
      {session.status === 'error' && (
        <p className="page__error">
          {t(ERROR_MESSAGES[session.error] ?? 'captionsErrorInternal')}{' '}
          <button type="button" className="link-button" onClick={onRetry}>
            {t('actionRetry')}
          </button>
        </p>
      )}
      {session.status === 'ready' && (
        <>
          {session.kind === 'asr' && <p className="video__note">{t('captionsAutoGenerated')}</p>}
          <Toggles settings={settings} onChange={onSettings} />
          <p className="video__hint">{t('sidepanelHotkeys')}</p>
          <Transcript
            cues={session.cues}
            activeIndex={activeIndex}
            showTranslation={settings.showTranslation}
            onSeek={onSeek}
          />
        </>
      )}
    </section>
  );
}

export function App({ client }: { client: Client }) {
  const status = useBackgroundStatus(client);
  const { settings, update } = useSettings(client);
  const tab = useActiveTab();
  const { connection, send } = useTabSession(tab);

  const onSettings = useCallback(
    (patch: Partial<Settings>) => {
      update(patch);
      // The tab hears the SW broadcast only while its port is awake; tell it directly too.
      send({ type: 'settings', settings: patch });
    },
    [update, send],
  );
  const onSeek = useCallback((index: number) => send({ type: 'seek', index }), [send]);
  const onRetry = useCallback(() => send({ type: 'retry' }), [send]);

  let body;
  if (connection.state === 'connected') {
    body = (
      <SessionView
        session={connection.session}
        activeIndex={connection.activeIndex}
        settings={settings}
        onSettings={onSettings}
        onSeek={onSeek}
        onRetry={onRetry}
      />
    );
  } else if (connection.state === 'unreachable' && isWatchUrl(tab?.url)) {
    body = <p className="page__empty">{t('sidepanelReloadTab')}</p>;
  } else if (connection.state === 'connecting' && isWatchUrl(tab?.url)) {
    body = <p className="page__empty">{t('captionsLoading')}</p>;
  } else {
    body = <p className="page__empty">{t('sidepanelEmpty')}</p>;
  }

  return (
    <main className="page page--panel">
      <header className="page__header">
        <h1>{t('sidepanelTitle')}</h1>
        <StatusLine status={status} className="page__status" />
      </header>
      {body}
    </main>
  );
}
