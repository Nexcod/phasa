/**
 * The toolbar popup (docs/plan.md §10, ADR 0001 → 0016): the video on screen with its analysis,
 * the side panel, quick settings, AI and the way to the options page.
 */
import { useCallback, useState } from 'react';
import { browser } from 'wxt/browser';
import { t, type MessageKey } from '@/src/i18n';
import type { Client } from '@/src/messaging/client';
import type { Settings } from '@/src/settings';
import { ContinueWithChatGpt } from '@/src/ui/ai/ContinueWithChatGpt';
import { useAccount } from '@/src/ui/ai/useAccount';
import { AnalysisCard } from '@/src/ui/AnalysisCard';
import { usePageAppearance, useSettings } from '@/src/ui/useSettings';
import {
  isWatchUrl,
  useActiveTab,
  useTabSession,
  type ActiveTab,
  type TabConnection,
} from '@/src/ui/useTabSession';
import { useVideoAnalysis, type AnalysisTrack } from '@/src/ui/useVideoAnalysis';

const QUICK_SETTINGS: readonly { key: keyof Settings; label: MessageKey }[] = [
  { key: 'showTranslation', label: 'settingShowTranslation' },
  { key: 'showRomanization', label: 'settingShowRomanization' },
  { key: 'autoPause', label: 'settingAutoPause' },
  { key: 'pauseOnLookup', label: 'settingPauseOnLookup' },
];

const ERRORS: Readonly<Record<string, MessageKey>> = {
  unavailable: 'captionsErrorUnavailable',
  network: 'captionsErrorNetwork',
  internal: 'captionsErrorInternal',
};

function VideoBlock({
  client,
  tab,
  connection,
  onRetry,
}: {
  client: Client;
  tab: ActiveTab | null;
  connection: TabConnection;
  onRetry: () => void;
}) {
  const session =
    connection.state === 'connected' && connection.session.status !== 'idle'
      ? connection.session
      : null;
  let track: AnalysisTrack | null = null;
  if (session?.status === 'ready') {
    track = { videoId: session.video.videoId, trackKey: session.trackKey };
    if (session.englishKey) track.englishKey = session.englishKey;
  }
  const analysis = useVideoAnalysis(client, track);

  if (!session) {
    let text: MessageKey = 'popupNoVideo';
    if (isWatchUrl(tab?.url)) {
      if (connection.state === 'unreachable') text = 'sidepanelReloadTab';
      else if (connection.state === 'connecting') text = 'captionsLoading';
    }
    return (
      <p className="page__empty" data-testid="phasa-popup-video" data-state="none">
        {t(text)}
      </p>
    );
  }
  return (
    <div className="popup__video" data-testid="phasa-popup-video" data-state={session.status}>
      {session.video.title && <p className="popup__title">{session.video.title}</p>}
      {session.status === 'loading' && <p className="page__empty">{t('captionsLoading')}</p>}
      {session.status === 'no-thai' && <p className="page__empty">{t('captionsNoThai')}</p>}
      {session.status === 'error' && (
        <p className="page__error">
          {t(ERRORS[session.error] ?? 'captionsErrorInternal')}{' '}
          <button type="button" className="link-button" onClick={onRetry}>
            {t('actionRetry')}
          </button>
        </p>
      )}
      {track && (
        <AnalysisCard
          key={`${track.videoId}/${track.trackKey}`}
          state={analysis.state}
          markNew={analysis.markNew}
          onRetry={analysis.retry}
        />
      )}
    </div>
  );
}

function AiBlock({ client }: { client: Client }) {
  const { view } = useAccount(client);
  const [failed, setFailed] = useState(false);
  if (!view) return null;
  const openSettings = () => {
    void browser.tabs.create({ url: browser.runtime.getURL('/options.html#ai') });
    window.close();
  };
  if (view.status.ready) {
    return (
      <p className="popup__ai account__status" data-ready="true" data-testid="phasa-popup-ai">
        {t(view.status.provider === 'chatgpt-plan' ? 'accountReadyPlan' : 'accountReadyKey')}
      </p>
    );
  }
  // A first sign-in needs the explanations of the options page; signing in again doesn't.
  const quick = view.chatgpt.registered && view.chatgpt.state !== 'signed-in';
  return (
    <div className="popup__ai" data-testid="phasa-popup-ai">
      <p className="account__muted">{t('popupAiOff')}</p>
      <div className="account__row">
        {quick ? (
          <ContinueWithChatGpt
            busy={view.chatgpt.pending}
            onClick={() => {
              setFailed(false);
              client.request('account/sign-in', {}).then(
                () => window.close(),
                () => setFailed(true),
              );
            }}
          />
        ) : (
          <button type="button" className="phasa-button" onClick={openSettings}>
            {t('popupAiSetUp')}
          </button>
        )}
      </div>
      {failed && <p className="page__error">{t('accountSignInFailed')}</p>}
    </div>
  );
}

export function App({ client }: { client: Client }) {
  const { settings, loaded, update } = useSettings(client);
  usePageAppearance(settings, loaded);
  const tab = useActiveTab();
  const { connection, send } = useTabSession(tab);
  const [panelFailed, setPanelFailed] = useState(false);

  const onSettings = useCallback(
    (patch: Partial<Settings>) => {
      update(patch);
      // The tab may not hear the SW broadcast while its port sleeps (ADR 0007).
      send({ type: 'settings', settings: patch });
    },
    [update, send],
  );

  return (
    <main className="page page--popup">
      <header className="popup__header">
        <h1>{t('popupTitle')}</h1>
        <button
          type="button"
          className="link-button"
          onClick={() => {
            void browser.runtime.openOptionsPage();
            window.close();
          }}
        >
          {t('popupOptions')}
        </button>
      </header>
      <VideoBlock
        client={client}
        tab={tab}
        connection={connection}
        onRetry={() => send({ type: 'retry' })}
      />
      <button
        type="button"
        className="phasa-button phasa-button--primary popup__panel"
        disabled={!tab}
        data-testid="phasa-popup-open-panel"
        onClick={() => {
          if (!tab) return;
          // Must run in the click's user gesture: no await before it.
          browser.sidePanel.open({ tabId: tab.tabId }).then(
            () => window.close(),
            () => setPanelFailed(true),
          );
        }}
      >
        {t('popupOpenPanel')}
      </button>
      {panelFailed && <p className="page__error">{t('popupPanelFailed')}</p>}
      <section className="popup__settings" aria-label={t('popupQuickSettings')}>
        {QUICK_SETTINGS.map(({ key, label }) => (
          <label key={key} className="toggle">
            <input
              type="checkbox"
              checked={settings[key] === true}
              onChange={(event) => onSettings({ [key]: event.target.checked })}
            />
            {t(label)}
          </label>
        ))}
      </section>
      <AiBlock client={client} />
    </main>
  );
}
