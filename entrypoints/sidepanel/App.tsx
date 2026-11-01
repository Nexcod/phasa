import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { browser } from 'wxt/browser';
import { t, type MessageKey } from '@/src/i18n';
import type { Client } from '@/src/messaging/client';
import type { PanelCue, PanelSession } from '@/src/messaging/panel';
import type { Settings } from '@/src/settings';
import { formatTime, watchUrl } from '@/src/ui/labels';
import { SavedWordList, useSavedWords } from '@/src/ui/SavedWords';
import { StatusLine } from '@/src/ui/StatusLine';
import { useBackgroundStatus } from '@/src/ui/useBackgroundStatus';
import { useSettings } from '@/src/ui/useSettings';
import type { SavedContext } from '@/src/vocab/types';
import { isWatchUrl, useActiveTab, useTabSession } from './useTabSession';

const ERROR_MESSAGES: Readonly<Record<string, MessageKey>> = {
  unavailable: 'captionsErrorUnavailable',
  network: 'captionsErrorNetwork',
  internal: 'captionsErrorInternal',
};

/** Pause auto-scroll this long after the user scrolls the transcript. */
const MANUAL_SCROLL_HOLD_MS = 4000;

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
      <label className="toggle">
        <input
          type="checkbox"
          checked={settings.pauseOnLookup}
          onChange={(event) => onChange({ pauseOnLookup: event.target.checked })}
        />
        {t('settingPauseOnLookup')}
      </label>
      <label className="toggle">
        <input
          type="checkbox"
          checked={settings.showRomanization}
          onChange={(event) => onChange({ showRomanization: event.target.checked })}
        />
        {t('settingShowRomanization')}
      </label>
      <label className="select">
        {t('settingRomanizationPosition')}
        <select
          value={settings.romanizationPosition}
          onChange={(event) =>
            onChange({ romanizationPosition: event.target.value === 'below' ? 'below' : 'above' })
          }
        >
          <option value="above">{t('positionAbove')}</option>
          <option value="below">{t('positionBelow')}</option>
        </select>
      </label>
      <label className="select">
        {t('settingRomanizationSystem')}
        <select
          value={settings.romanizationSystem}
          onChange={(event) =>
            onChange({ romanizationSystem: event.target.value === 'rtgs' ? 'rtgs' : 'paiboon' })
          }
        >
          <option value="paiboon">{t('systemPaiboon')}</option>
          <option value="rtgs">{t('systemRtgs')}</option>
        </select>
      </label>
      <label className="select">
        {t('settingWordBoundaries')}
        <select
          value={settings.wordBoundaries}
          onChange={(event) => {
            const value = event.target.value;
            onChange({
              wordBoundaries: value === 'none' || value === 'underline' ? value : 'gaps',
            });
          }}
        >
          <option value="none">{t('boundariesNone')}</option>
          <option value="gaps">{t('boundariesGaps')}</option>
          <option value="underline">{t('boundariesUnderline')}</option>
        </select>
      </label>
    </div>
  );
}

function WordsTab({
  client,
  videoId,
  onOpen,
}: {
  client: Client;
  videoId: string | undefined;
  onOpen: (context: SavedContext) => void;
}) {
  const [thisVideo, setThisVideo] = useState(false);
  const filter = thisVideo && videoId ? { videoId } : {};
  const { units, total, loaded, more } = useSavedWords(client, filter);
  return (
    <section className="words" data-testid="phasa-panel-words">
      {videoId && (
        <label className="toggle">
          <input
            type="checkbox"
            checked={thisVideo}
            onChange={(event) => setThisVideo(event.target.checked)}
          />
          {t('wordsThisVideo')}
        </label>
      )}
      <SavedWordList
        client={client}
        units={units}
        total={total}
        loaded={loaded}
        onMore={more}
        onOpen={onOpen}
      />
    </section>
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
  const [tabView, setTabView] = useState<'transcript' | 'words'>('transcript');
  const shownVideoId =
    connection.state === 'connected' && connection.session.status !== 'idle'
      ? connection.session.video.videoId
      : undefined;
  const onOpenContext = useCallback(
    (context: SavedContext) => {
      if (context.videoId === shownVideoId) {
        send({ type: 'seekMs', ms: context.cueStartMs });
      } else if (tab) {
        void browser.tabs.update(tab.tabId, { url: watchUrl(context.videoId, context.cueStartMs) });
      }
    },
    [send, shownVideoId, tab],
  );

  let body;
  if (tabView === 'words') {
    body = <WordsTab client={client} videoId={shownVideoId} onOpen={onOpenContext} />;
  } else if (connection.state === 'connected') {
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
      <div className="tabs" role="tablist">
        {(['transcript', 'words'] as const).map((view) => (
          <button
            key={view}
            type="button"
            role="tab"
            className="tabs__tab"
            aria-selected={tabView === view}
            data-testid={`phasa-tab-${view}`}
            onClick={() => setTabView(view)}
          >
            {t(view === 'transcript' ? 'panelTabTranscript' : 'panelTabWords')}
          </button>
        ))}
      </div>
      {body}
    </main>
  );
}
