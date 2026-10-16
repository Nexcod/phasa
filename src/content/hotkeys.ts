/**
 * Player hotkeys (docs/plan.md §2.1). Matched by `KeyboardEvent.code`, the
 * physical key, so they work while a Thai keyboard layout is active (`A` types
 * `ฟ` there). R (romanization) arrives with romanization in phase 3.
 */

export type HotkeyAction = 'prev' | 'next' | 'repeat' | 'toggle-play' | 'toggle-translation';

export const HOTKEYS: Readonly<Record<string, HotkeyAction>> = {
  KeyA: 'prev',
  KeyD: 'next',
  KeyS: 'repeat',
  Space: 'toggle-play',
  KeyT: 'toggle-translation',
};

const TEXT_INPUT_TYPES = new Set([
  'text',
  'search',
  'email',
  'url',
  'tel',
  'password',
  'number',
  'date',
  'time',
  'datetime-local',
  'month',
  'week',
]);

/** True when a key press belongs to a text field rather than the player. */
export function isEditableTarget(target: EventTarget | null | undefined): boolean {
  if (!target || !(target instanceof Element)) return false;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  if (target instanceof HTMLInputElement) return TEXT_INPUT_TYPES.has(target.type);
  if (target instanceof HTMLElement && target.isContentEditable) return true;
  return (
    target.closest('[contenteditable=""], [contenteditable="true"], [role="textbox"]') !== null
  );
}

/** Space activates focused buttons and links; leave that to the browser. */
function isActivatable(target: EventTarget | null | undefined): boolean {
  return (
    !!target &&
    target instanceof Element &&
    target.closest('button, a[href], [role="button"]') !== null
  );
}

export interface KeyLike {
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  repeat: boolean;
  /** The innermost target, through shadow roots (`composedPath()[0]`). */
  target: EventTarget | null | undefined;
}

export function hotkeyFor(event: KeyLike): HotkeyAction | null {
  if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return null;
  const action = HOTKEYS[event.code];
  if (!action || isEditableTarget(event.target)) return null;
  if (action === 'toggle-play' && (event.repeat || isActivatable(event.target))) return null;
  return action;
}

/**
 * Listens in the capture phase on `window`, before YouTube's own handlers: a
 * handled key is consumed so YouTube does not also act on it (Space would
 * toggle twice, T would switch theater mode).
 */
export function installHotkeys(
  win: Window,
  enabled: () => boolean,
  run: (action: HotkeyAction) => void,
): () => void {
  const consumed = new Set<string>();

  const onKeyDown = (event: KeyboardEvent) => {
    if (!enabled()) return;
    const action = hotkeyFor({
      code: event.code,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      altKey: event.altKey,
      shiftKey: event.shiftKey,
      repeat: event.repeat,
      target: event.composedPath()[0] ?? event.target,
    });
    if (!action) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    consumed.add(event.code);
    run(action);
  };

  const onKeyUpOrPress = (event: KeyboardEvent) => {
    if (!consumed.has(event.code)) return;
    if (event.type === 'keyup') consumed.delete(event.code);
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  win.addEventListener('keydown', onKeyDown, { capture: true });
  win.addEventListener('keypress', onKeyUpOrPress, { capture: true });
  win.addEventListener('keyup', onKeyUpOrPress, { capture: true });
  return () => {
    win.removeEventListener('keydown', onKeyDown, { capture: true });
    win.removeEventListener('keypress', onKeyUpOrPress, { capture: true });
    win.removeEventListener('keyup', onKeyUpOrPress, { capture: true });
  };
}
