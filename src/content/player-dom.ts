/**
 * The parts of YouTube's player DOM the overlay depends on. All selectors live
 * here so a YouTube redesign is fixed in one place.
 *
 * The overlay's shadow host is a child of the player element, so it is inside
 * whatever YouTube makes fullscreen (the player or an ancestor) and follows
 * theater mode and resizes without remounting.
 */

export const PLAYER_SELECTOR = '#movie_player';

export function findPlayer(doc: Document): HTMLElement | null {
  return doc.querySelector<HTMLElement>(PLAYER_SELECTOR);
}

export function findVideo(doc: Document): HTMLVideoElement | null {
  return (
    doc.querySelector<HTMLVideoElement>(`${PLAYER_SELECTOR} video.html5-main-video`) ??
    doc.querySelector<HTMLVideoElement>(`${PLAYER_SELECTOR} video`)
  );
}

export interface PlayerUi {
  /** Control bar shown (hover, paused): subtitles move up above it. */
  controlsVisible: boolean;
  /** An ad plays in the same <video>. */
  adShowing: boolean;
}

export function readPlayerUi(player: Element | null): PlayerUi {
  return {
    controlsVisible: !!player && !player.classList.contains('ytp-autohide'),
    adShowing: !!player?.classList.contains('ad-showing'),
  };
}

/** Calls `onChange` when the player's state classes change; follows a replaced player element. */
export function observePlayerUi(doc: Document, onChange: (ui: PlayerUi) => void): () => void {
  let observed: Element | null = null;
  let last = '';
  const emit = () => {
    const ui = readPlayerUi(observed);
    const key = `${ui.controlsVisible}|${ui.adShowing}`;
    if (key === last) return;
    last = key;
    onChange(ui);
  };
  const classObserver = new MutationObserver(emit);
  const attach = () => {
    const player = findPlayer(doc);
    if (player === observed) return;
    classObserver.disconnect();
    observed = player;
    if (player) classObserver.observe(player, { attributes: true, attributeFilter: ['class'] });
    emit();
  };
  // The player is created after document_idle on some loads and survives SPA navigation.
  const timer = setInterval(attach, 1000);
  attach();
  return () => {
    clearInterval(timer);
    classObserver.disconnect();
  };
}

const HIDE_NATIVE_STYLE_ID = 'phasa-hide-native-captions';

/** Hides YouTube's own caption window while our overlay shows subtitles (docs/plan.md §4.1 step 5). */
export function setNativeCaptionsHidden(doc: Document, hidden: boolean): void {
  const existing = doc.getElementById(HIDE_NATIVE_STYLE_ID);
  if (!hidden) {
    existing?.remove();
    return;
  }
  if (existing) return;
  const style = doc.createElement('style');
  style.id = HIDE_NATIVE_STYLE_ID;
  style.textContent = '.ytp-caption-window-container { display: none !important; }';
  // `head` can still be missing at document_start.
  ((doc.head as HTMLHeadElement | null) ?? doc.documentElement).append(style);
}
