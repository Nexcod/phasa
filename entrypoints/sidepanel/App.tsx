import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { browser } from 'wxt/browser';
import { t, type MessageKey } from '@/src/i18n';
import type { Client } from '@/src/messaging/client';
import type { PanelCue, PanelSession } from '@/src/messaging/panel';
import type { Settings } from '@/src/settings';
import { calibrationRow } from '@/src/analysis/calibration';
import { MAX_CONTEXT_LINES, type AiLineContext, type AiStatus } from '@/src/messaging/ai';
import { AiAnswer, AiSection } from '@/src/ui/ai/AiAnswer';
import { useAiStatus } from '@/src/ui/ai/useAi';
import { AnalysisCard } from '@/src/ui/AnalysisCard';
import { formatTime, watchUrl } from '@/src/ui/labels';
import { SavedWordList, useSavedWords } from '@/src/ui/SavedWords';
import { StatusLine } from '@/src/ui/StatusLine';
import { useBackgroundStatus } from '@/src/ui/useBackgroundStatus';
import { useSettings } from '@/src/ui/useSettings';
import {
  useVideoAnalysis,
  type AnalysisState,
  type AnalysisTrack,
} from '@/src/ui/useVideoAnalysis';
import type { SavedContext } from '@/src/vocab/types';
import { isWatchUrl, useActiveTab, useTabSession } from './useTabSession';

const ERROR_MESSAGES: Readonly<Record<string, MessageKey>> = {
  unavailable: 'captionsErrorUnavailable',
  network: 'captionsErrorNetwork',
  internal: 'captionsErrorInternal',
};

/** Pause auto-scroll this long after the user scrolls the transcript. */
const MANUAL_SCROLL_HOLD_MS = 4000;

/** The line with up to two lines on each side, for AI requests. */
function lineContext(cues: readonly PanelCue[], index: number, videoTitle: string): AiLineContext {
  const cue = cues[index];
  const context: AiLineContext = {
    line: { text: cue?.text ?? '' },
    before: cues.slice(Math.max(0, index - MAX_CONTEXT_LINES), index).map((c) => c.text),
    after: cues.slice(index + 1, index + 1 + MAX_CONTEXT_LINES).map((c) => c.text),
    videoTitle,
  };
  if (cue?.translation) context.line.translation = cue.translation;
  return context;
}

const CueRow = memo(function CueRow({
  cue,
  index,
  active,
  showTranslation,
  onSeek,
  aiOpen,
  onToggleAi,
  ai,
}: {
  cue: PanelCue;
  index: number;
  active: boolean;
  showTranslation: boolean;
  onSeek: (index: number) => void;
  aiOpen: boolean;
  onToggleAi: (index: number) => void;
  /** The AI translation, while open. */
  ai: ReactNode;
}) {
  return (
    <li
      className="transcript__row"
      data-index={index}
      data-active={active || undefined}
      data-ai={aiOpen || undefined}
      aria-current={active || undefined}
    >
      <button
        type="button"
        className="transcript__ai"
        aria-expanded={aiOpen}
        aria-label={t('aiTranslateLineLabel')}
        title={t('aiTranslateLineLabel')}
        data-testid="phasa-transcript-ai"
        onClick={() => onToggleAi(index)}
      >
        {t('aiBadge')}
      </button>
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
      {ai}
    </li>
  );
});

function Transcript({
  cues,
  only,
  activeIndex,
  showTranslation,
  onSeek,
  client,
  videoTitle,
  aiStatus,
}: {
  cues: PanelCue[];
  /** Show only these cues (lines with new words), or all. */
  only: ReadonlySet<number> | null;
  activeIndex: number;
  showTranslation: boolean;
  onSeek: (index: number) => void;
  client: Client;
  videoTitle: string;
  aiStatus: AiStatus | null;
}) {
  const listRef = useRef<HTMLOListElement>(null);
  const userScrolledAt = useRef(0);
  const [aiOpen, setAiOpen] = useState<ReadonlySet<number>>(new Set());
  const onToggleAi = useCallback((index: number) => {
    setAiOpen((open) => {
      const next = new Set(open);
      if (!next.delete(index)) next.add(index);
      return next;
    });
  }, []);
  const openSettings = useCallback(() => {
    client.request('ui/open-ai-settings', {}).catch(() => undefined);
  }, [client]);

  useEffect(() => {
    const list = listRef.current;
    if (!list || activeIndex < 0 || Date.now() - userScrolledAt.current < MANUAL_SCROLL_HOLD_MS)
      return;
    const row = list.querySelector(`[data-index="${activeIndex}"]`);
    if (row instanceof HTMLElement) row.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [activeIndex]);

  if (only?.size === 0) return <p className="page__empty">{t('transcriptNoNewLines')}</p>;

  return (
    <ol
      ref={listRef}
      className="transcript"
      aria-label={t('transcriptLabel')}
      data-testid="phasa-transcript"
      onWheel={() => (userScrolledAt.current = Date.now())}
      onTouchMove={() => (userScrolledAt.current = Date.now())}
    >
      {cues.map((cue, index) =>
        only && !only.has(index) ? null : (
          <CueRow
            key={`${cue.startMs}-${index}`}
            cue={cue}
            index={index}
            active={index === activeIndex}
            showTranslation={showTranslation}
            onSeek={onSeek}
            aiOpen={aiOpen.has(index)}
            onToggleAi={onToggleAi}
            ai={
              aiOpen.has(index) ? (
                <div className="transcript__answer">
                  <AiSection status={aiStatus}>
                    <AiAnswer
                      client={client}
                      kind="translate"
                      params={lineContext(cues, index, videoTitle)}
                      questionKey={cue.text}
                      label={t('aiTranslateLine')}
                      onOpenSettings={openSettings}
                    />
                  </AiSection>
                </div>
              ) : null
            }
          />
        ),
      )}
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
  analysis,
  activeIndex,
  settings,
  onSettings,
  onSeek,
  onRetry,
  client,
  aiStatus,
}: {
  session: PanelSession;
  analysis: AnalysisState;
  activeIndex: number;
  settings: Settings;
  onSettings: (patch: Partial<Settings>) => void;
  onSeek: (index: number) => void;
  onRetry: () => void;
  client: Client;
  aiStatus: AiStatus | null;
}) {
  const [newOnly, setNewOnly] = useState(false);
  const newCues = analysis.status === 'ready' ? analysis.analysis.newCues : null;
  const only = useMemo(() => (newOnly && newCues ? new Set(newCues) : null), [newOnly, newCues]);
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
          <label className="toggle transcript__filter">
            <input
              type="checkbox"
              checked={newOnly}
              disabled={!newCues}
              onChange={(event) => setNewOnly(event.target.checked)}
            />
            {t('transcriptNewOnly')}
          </label>
          <Transcript
            cues={session.cues}
            only={only}
            activeIndex={activeIndex}
            showTranslation={settings.showTranslation}
            onSeek={onSeek}
            client={client}
            videoTitle={video.title}
            aiStatus={aiStatus}
          />
        </>
      )}
    </section>
  );
}

/** Development builds: copies a row for tests/fixtures/levels.csv (ADR 0011, level calibration). */
function CalibrationCopy({
  video,
  state,
}: {
  video: { videoId: string; title: string };
  state: Extract<AnalysisState, { status: 'ready' }>;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="link-button page__calibration"
      onClick={() => {
        const row = calibrationRow({
          videoId: video.videoId,
          title: video.title,
          features: state.analysis.features,
        });
        void navigator.clipboard.writeText(row).then(() => setCopied(true));
      }}
    >
      {t(copied ? 'analysisCalibrationCopied' : 'analysisCopyCalibration')}
    </button>
  );
}

export function App({ client }: { client: Client }) {
  const status = useBackgroundStatus(client);
  const { settings, update } = useSettings(client);
  const aiStatus = useAiStatus(client);
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
  const ready =
    connection.state === 'connected' && connection.session.status === 'ready'
      ? connection.session
      : null;
  let track: AnalysisTrack | null = null;
  if (ready) {
    track = { videoId: ready.video.videoId, trackKey: ready.trackKey };
    if (ready.englishKey) track.englishKey = ready.englishKey;
  }
  const analysis = useVideoAnalysis(client, track);
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
        analysis={analysis.state}
        activeIndex={connection.activeIndex}
        settings={settings}
        onSettings={onSettings}
        onSeek={onSeek}
        onRetry={onRetry}
        client={client}
        aiStatus={aiStatus}
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
      {ready && (
        <section className="page__analysis" data-testid="phasa-panel-analysis">
          <AnalysisCard
            key={`${ready.video.videoId}/${ready.trackKey}`}
            state={analysis.state}
            markNew={analysis.markNew}
            onRetry={analysis.retry}
            footer={
              import.meta.env.DEV && analysis.state.status === 'ready' ? (
                <CalibrationCopy video={ready.video} state={analysis.state} />
              ) : null
            }
          />
        </section>
      )}
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
