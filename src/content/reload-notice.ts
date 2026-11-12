/**
 * After Phasa is updated or reloaded, Chrome cuts this content script off from the extension and
 * doesn't inject the new one into open tabs: the subtitles disappear without a word. The old
 * script can still touch the page, so it says why and offers a reload (docs/plan.md §12 phase 6:
 * error states). Plain DOM: the extension's styles and messages may be gone by then.
 */
export interface ReloadNoticeText {
  message: string;
  reload: string;
  close: string;
}

export const RELOAD_NOTICE_ATTR = 'data-phasa-reload-notice';

/** `<html data-phasa-content>`: the id of the content script instance that runs the page now. */
const INSTANCE_ATTR = 'data-phasa-content';

/** Marks this instance as the current one and drops a notice an older instance left. */
export function claimPage(doc: Document): string {
  const id = crypto.randomUUID();
  doc.documentElement.setAttribute(INSTANCE_ATTR, id);
  for (const notice of doc.querySelectorAll(`[${RELOAD_NOTICE_ATTR}]`)) notice.remove();
  return id;
}

/**
 * The script was invalidated: say so, unless a newer instance took over the page meanwhile
 * (WXT invalidates the old script when a new one starts, e.g. after a reinjection).
 */
export function noticeIfOrphaned(
  doc: Document,
  id: string,
  text: ReloadNoticeText,
  delayMs = 1500,
): void {
  setTimeout(() => {
    if (doc.documentElement.getAttribute(INSTANCE_ATTR) === id) showReloadNotice(doc, text);
  }, delayMs);
}

export function showReloadNotice(doc: Document, text: ReloadNoticeText): void {
  const player = doc.getElementById('movie_player');
  if (!player || player.querySelector(`[${RELOAD_NOTICE_ATTR}]`)) return;
  const box = doc.createElement('div');
  box.setAttribute(RELOAD_NOTICE_ATTR, '');
  box.setAttribute('role', 'status');
  box.style.cssText =
    'position:absolute;top:12px;left:12px;z-index:60;display:flex;gap:8px;align-items:center;' +
    'max-width:calc(100% - 24px);padding:4px 6px 4px 12px;border-radius:999px;' +
    'background:rgba(0,0,0,.8);color:#fff;font:13px/1.4 system-ui,sans-serif;';
  const label = doc.createElement('span');
  label.textContent = text.message;
  const button = (content: string, onClick: () => void, title?: string) => {
    const element = doc.createElement('button');
    element.type = 'button';
    element.textContent = content;
    if (title) element.title = title;
    element.style.cssText =
      'padding:0 8px;border:1px solid rgba(255,255,255,.6);border-radius:999px;' +
      'background:transparent;color:inherit;font:inherit;cursor:pointer;';
    // The player would toggle playback on a click that reaches it.
    for (const type of ['click', 'mousedown', 'mouseup', 'pointerdown', 'pointerup']) {
      element.addEventListener(type, (event) => event.stopPropagation());
    }
    element.addEventListener('click', onClick);
    return element;
  };
  box.append(
    label,
    button(text.reload, () => doc.location.reload()),
    button('×', () => box.remove(), text.close),
  );
  player.append(box);
}
