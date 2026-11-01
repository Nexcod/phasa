/**
 * Content-script state for one YouTube tab: the player's video, its captions,
 * the cue on screen, settings and player UI state. React components and the
 * side-panel link read {@link ContentState}; actions go through the returned
 * controller.
 */
import type { ProcessedCue } from '../captions/types';
import type { WordInfo } from '../dictionary/types';
import { MAX_CONTEXT_LINES, type AiLineContext } from '../messaging/ai';
import type { Client } from '../messaging/client';
import { DEFAULT_SETTINGS, type Settings } from '../settings';
import type { ContextInput, SegRuleKind, UnitKind, WordStatus } from '../vocab/types';
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
import { EMPTY_WORD_DATA, createWordManager, type WordData } from './words';

export interface ContentState {
  /** `?v=` of the page URL; subtitles show only while the session is for this video. */
  urlVideoId: string | null;
  session: SessionState;
  /** Index into the Thai cues of the cue on screen, -1 between cues. */
  activeIndex: number;
  settings: Settings;
  player: PlayerUi;
  /** Tokens, statuses and lookups of the Thai track. */
  words: WordData;
}

export interface ContentController {
  readonly store: Store<ContentState>;
  retry: () => void;
  seekToIndex: (index: number) => void;
  seekToMs: (ms: number) => void;
  setUrlVideoId: (videoId: string | null) => void;
  applySettings: (patch: Partial<Settings>) => void;
  /** Changes a setting here and in the service worker. */
  saveSettings: (patch: Partial<Settings>) => void;
  lookup: (word: string) => Promise<WordInfo>;
  cachedLookup: (word: string) => WordInfo | undefined;
  /** Saves a word or phrase with the cue at `cueIndex` as its context. */
  setStatus: (kind: UnitKind, thai: string, status: WordStatus, cueIndex: number) => Promise<void>;
  forget: (kind: UnitKind, thai: string) => Promise<void>;
  addSegRule: (kind: SegRuleKind, parts: string[]) => Promise<void>;
  /** A word popup opened: pause if the user wants that (docs/plan.md §10). */
  beginLookup: () => void;
  /** The popup closed: resume if opening it paused the video. */
  endLookup: () => void;
  /** W / Q / E: open the first word of the line, move to the previous / next word. */
  onWordKey: (listener: (key: WordKey) => void) => () => void;
  /** The line at `cueIndex` with its neighbours and the video title, for AI requests. */
  aiContext: (cueIndex: number) => AiLineContext | undefined;
  /** Opens the options page at its AI section (the SW does it; content scripts can't). */
  openAiSettings: () => void;
  dispose: () => void;
}

export type WordKey = 'first' | 'prev' | 'next';

/** Track id of the word data: words follow the Thai track on screen. */
function trackIdOf(state: ContentState): string | null {
  return state.session.status === 'ready'
    ? `${state.session.video.videoId}/${state.session.thai.key}`
    : null;
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
    words: EMPTY_WORD_DATA,
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

  const words = createWordManager(client, (data) => patch({ words: data }));

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
      words.setTrack(trackIdOf(store.get()), thaiCues(store.get()));
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
  const saveSettings = (settingsPatch: Partial<Settings>) => {
    applySettings(settingsPatch);
    client.request('settings/set', { patch: settingsPatch }).catch(() => undefined);
  };

  const currentVideo = () => playback?.video ?? findVideo(doc);
  const seekToIndex = (index: number) => {
    const cue = thaiCues(store.get())[index];
    const video = currentVideo();
    if (cue && video) seekToCue(video, cue);
  };

  const wordKeyListeners = new Set<(key: WordKey) => void>();
  const run = (action: HotkeyAction) => {
    if (action === 'word-first' || action === 'word-prev' || action === 'word-next') {
      const key: WordKey =
        action === 'word-first' ? 'first' : action === 'word-prev' ? 'prev' : 'next';
      for (const listener of wordKeyListeners) listener(key);
      return;
    }
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
      case 'toggle-translation':
        saveSettings({ showTranslation: !store.get().settings.showTranslation });
        break;
      case 'toggle-romanization':
        saveSettings({ showRomanization: !store.get().settings.showRomanization });
        break;
    }
  };
  cleanups.push(installHotkeys(win, () => isLive(store.get()), run));

  const contextFor = (index: number): ContextInput | undefined => {
    const { session } = store.get();
    if (session.status !== 'ready') return undefined;
    const cue = session.thai.cues[index];
    if (!cue) return undefined;
    const context: ContextInput = {
      videoId: session.video.videoId,
      videoTitle: session.video.title,
      sentence: cue.text,
      cueStartMs: cue.startMs,
      cueEndMs: cue.endMs,
    };
    if (session.video.channel) context.channel = session.video.channel;
    const english = session.english.status === 'ready' ? session.english.lines[index] : undefined;
    if (english) context.sentenceTranslation = english;
    return context;
  };

  const aiContext = (index: number): AiLineContext | undefined => {
    const { session } = store.get();
    if (session.status !== 'ready') return undefined;
    const cues = session.thai.cues;
    const cue = cues[index];
    if (!cue) return undefined;
    const context: AiLineContext = {
      line: { text: cue.text },
      before: cues.slice(Math.max(0, index - MAX_CONTEXT_LINES), index).map((c) => c.text),
      after: cues.slice(index + 1, index + 1 + MAX_CONTEXT_LINES).map((c) => c.text),
      videoTitle: session.video.title,
    };
    const english = session.english.status === 'ready' ? session.english.lines[index] : undefined;
    if (english) context.line.translation = english;
    return context;
  };

  let pausedForLookup = false;

  return {
    store,
    retry: () => sessions.retry(),
    seekToIndex,
    seekToMs(ms) {
      const video = currentVideo();
      if (video) video.currentTime = ms / 1000;
    },
    applySettings,
    saveSettings,
    lookup: (word) => words.lookup(word),
    cachedLookup: (word) => words.cached(word),
    setStatus: (kind, thai, status, cueIndex) =>
      words.setStatus(kind, thai, status, status === 'new' ? undefined : contextFor(cueIndex)),
    forget: (kind, thai) => words.forget(kind, thai),
    addSegRule: async (kind, parts) => {
      await client.request('segrules/add', { kind, parts });
    },
    beginLookup() {
      const video = currentVideo();
      if (!store.get().settings.pauseOnLookup || !video || video.paused) return;
      video.pause();
      pausedForLookup = true;
    },
    onWordKey(listener) {
      wordKeyListeners.add(listener);
      return () => wordKeyListeners.delete(listener);
    },
    aiContext,
    openAiSettings() {
      client.request('ui/open-ai-settings', {}).catch(() => undefined);
    },
    endLookup() {
      if (!pausedForLookup) return;
      pausedForLookup = false;
      const video = currentVideo();
      if (video?.paused) void video.play().catch(() => undefined);
    },
    setUrlVideoId(urlVideoId) {
      patch({ urlVideoId });
      syncPlayback();
    },
    dispose() {
      for (const cleanup of cleanups.splice(0)) cleanup();
      sessions.dispose();
      words.dispose();
      playback?.stop();
      playback = null;
      setNativeCaptionsHidden(doc, false);
    },
  };
}
