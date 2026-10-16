/**
 * Content-script state for one YouTube tab: the player's video, its captions,
 * the cue on screen, settings and player UI state. React components and the
 * side-panel link read {@link ContentState}; actions go through the returned
 * controller.
 */
import type { ProcessedCue } from '../captions/types';
import type { Client } from '../messaging/client';
import { DEFAULT_SETTINGS, type Settings } from '../settings';
import { installHotkeys, type HotkeyAction } from './hotkeys';
import type { MainBridge } from './main-bridge';
import { PlaybackSync, anchorIndex, seekToCue } from './playback';
import {
  findPlayer,
  findVideo,
  observePlayerUi,
  readPlayerUi,
  setNativeCaptionsHidden,
  type PlayerUi,
} from './player-dom';
import { createSessionManager, type SessionState } from './session';
import { createStore, type Store } from './store';

export interface ContentState {
  /** `?v=` of the page URL; subtitles show only while the session is for this video. */
  urlVideoId: string | null;
  session: SessionState;
  /** Index into the Thai cues of the cue on screen, -1 between cues. */
  activeIndex: number;
  settings: Settings;
  player: PlayerUi;
}

export interface ContentController {
  readonly store: Store<ContentState>;
  retry: () => void;
  seekToIndex: (index: number) => void;
  setUrlVideoId: (videoId: string | null) => void;
  applySettings: (patch: Partial<Settings>) => void;
  dispose: () => void;
}

export function thaiCues(state: ContentState): readonly ProcessedCue[] {
  return state.session.status === 'ready' ? state.session.thai.cues : [];
}

/** Subtitles are live: captions ready for the video in the URL and no ad playing. */
export function isLive(state: ContentState): boolean {
  return (
    state.session.status === 'ready' &&
    state.session.video.videoId === state.urlVideoId &&
    !state.player.adShowing
  );
}

export function startContentController(deps: {
  win: Window;
  doc: Document;
  client: Client;
  bridge: MainBridge;
  urlVideoId: string | null;
}): ContentController {
  const { win, doc, client, bridge } = deps;
  const store = createStore<ContentState>({
    urlVideoId: deps.urlVideoId,
    session: { status: 'idle' },
    activeIndex: -1,
    settings: { ...DEFAULT_SETTINGS },
    player: readPlayerUi(findPlayer(doc)),
  });
  const patch = (partial: Partial<ContentState>) =>
    store.set((state) => ({ ...state, ...partial }));
  const cleanups: (() => void)[] = [];

  // Playback sync follows the <video> element; YouTube normally keeps one per page.
  let playback: PlaybackSync | null = null;
  const syncPlayback = () => {
    const state = store.get();
    const video = state.session.status === 'ready' ? findVideo(doc) : null;
    if (playback && (!video || playback.video !== video)) {
      playback.stop();
      playback = null;
      patch({ activeIndex: -1 });
    }
    if (video && !playback) {
      playback = new PlaybackSync(video, {
        cues: () => thaiCues(store.get()),
        autoPause: () => store.get().settings.autoPause,
        suspended: () => !isLive(store.get()),
        onActiveIndex: (activeIndex) => patch({ activeIndex }),
      });
    } else {
      playback?.refresh();
    }
    setNativeCaptionsHidden(doc, isLive(store.get()));
  };

  const sessions = createSessionManager(
    { bridge, client, now: () => win.performance.now() },
    (session) => {
      if (session.status === 'ready' && session.english.status === 'loading') {
        console.info(
          `[phasa] Thai captions ready in ${Math.round(session.loadMs)} ms`,
          `(${session.thai.kind}, ${session.thai.cues.length} cues, ${session.video.videoId})`,
        );
      }
      patch({ session });
      syncPlayback();
    },
  );
  cleanups.push(bridge.onVideo((video) => sessions.setVideo(video)));

  cleanups.push(
    observePlayerUi(doc, (player) => {
      patch({ player });
      syncPlayback();
    }),
  );

  const loadSettings = () => {
    client.request('settings/get', {}).then(
      (settings) => patch({ settings }),
      () => undefined, // defaults stay; the next hello retries
    );
  };
  cleanups.push(
    client.onEvent((event) => {
      if (event.type === 'settings/changed') patch({ settings: event.settings });
      else loadSettings(); // sw/hello: (re)connected, maybe after missing a change
    }),
  );

  const applySettings = (settingsPatch: Partial<Settings>) => {
    patch({ settings: { ...store.get().settings, ...settingsPatch } });
  };

  const currentVideo = () => playback?.video ?? findVideo(doc);
  const seekToIndex = (index: number) => {
    const cue = thaiCues(store.get())[index];
    const video = currentVideo();
    if (cue && video) seekToCue(video, cue);
  };

  const run = (action: HotkeyAction) => {
    const video = currentVideo();
    if (!video) return;
    const cues = thaiCues(store.get());
    const anchor = anchorIndex(cues, video.currentTime * 1000);
    switch (action) {
      case 'prev':
        seekToIndex(Math.max(0, anchor - 1));
        break;
      case 'next':
        seekToIndex(Math.min(cues.length - 1, anchor + 1));
        break;
      case 'repeat':
        seekToIndex(Math.max(0, anchor));
        break;
      case 'toggle-play':
        if (video.paused) void video.play().catch(() => undefined);
        else video.pause();
        break;
      case 'toggle-translation': {
        const showTranslation = !store.get().settings.showTranslation;
        applySettings({ showTranslation });
        client.request('settings/set', { patch: { showTranslation } }).catch(() => undefined);
        break;
      }
    }
  };
  cleanups.push(installHotkeys(win, () => isLive(store.get()), run));

  return {
    store,
    retry: () => sessions.retry(),
    seekToIndex,
    applySettings,
    setUrlVideoId(urlVideoId) {
      patch({ urlVideoId });
      syncPlayback();
    },
    dispose() {
      for (const cleanup of cleanups.splice(0)) cleanup();
      sessions.dispose();
      playback?.stop();
      playback = null;
      setNativeCaptionsHidden(doc, false);
    },
  };
}
