import { memo, type MouseEvent } from 'react';
import type { WordInfo } from '@/src/dictionary/types';
import type { Settings } from '@/src/settings';
import type { Token } from '@/src/thai/types';
import { Romanization } from '@/src/ui/Romanization';
import type { WordStatus } from '@/src/vocab/types';

/** A click on a word, or a selection over several. */
export type LineAction =
  | { kind: 'word'; tokenIndex: number; anchor: DOMRect; at: number }
  | { kind: 'phrase'; from: number; to: number; anchor: DOMRect; at: number };

function statusAttr(status: WordStatus | undefined): string {
  if (status === undefined || status === 'new') return 'new';
  return typeof status === 'number' ? `learning-${status}` : status;
}

function tokenIndexOf(node: Node | null): number | null {
  const element = node instanceof Element ? node : node?.parentElement;
  const index = element?.closest<HTMLElement>('[data-token]')?.dataset.token;
  return index === undefined ? null : Number(index);
}

/**
 * The Thai cue as words (docs/plan.md §2.1, §5.1): one span per token, on
 * grapheme boundaries, colored by status, with optional romanization and
 * boundary marks. Falls back to the plain text until tokens arrive.
 */
export const ThaiLine = memo(function ThaiLine({
  text,
  tokens,
  statuses,
  lookup,
  settings,
  onAction,
  selectedFrom,
  selectedTo,
}: {
  /** Changes as prefetched lookups arrive, so romanization and labels fill in. */
  revision: number;
  /** Token range of the open popup's word or phrase in this line; -1 when there is none. */
  selectedFrom: number;
  selectedTo: number;
  text: string;
  tokens: readonly Token[] | undefined;
  statuses: Readonly<Record<string, WordStatus>>;
  /** Cached lookups; the parent re-renders as more arrive. */
  lookup: (word: string) => WordInfo | undefined;
  settings: Settings;
  onAction: (action: LineAction) => void;
}) {
  const romanization = settings.showRomanization ? settings.romanizationPosition : 'off';

  if (!tokens) {
    return (
      <p className="phasa-subs__line phasa-subs__thai" lang="th" data-testid="phasa-cue-thai">
        {text}
      </p>
    );
  }

  const open = (index: number, element: HTMLElement) =>
    onAction({
      kind: 'word',
      tokenIndex: index,
      anchor: element.getBoundingClientRect(),
      at: performance.now(),
    });

  const onMouseUp = (event: MouseEvent<HTMLParagraphElement>) => {
    const root = event.currentTarget.getRootNode() as ShadowRoot & {
      getSelection?: () => Selection | null;
    };
    const selection = root.getSelection?.() ?? document.getSelection();
    if (!selection || selection.isCollapsed) return;
    const a = tokenIndexOf(selection.anchorNode);
    const b = tokenIndexOf(selection.focusNode);
    if (a === null || b === null || a === b) return;
    const from = Math.min(a, b);
    const to = Math.max(a, b);
    const thaiCount = tokens.slice(from, to + 1).filter((token) => token.kind === 'thai').length;
    if (thaiCount < 2) return;
    const range = selection.getRangeAt(0);
    const anchor = range.getBoundingClientRect();
    selection.removeAllRanges();
    onAction({ kind: 'phrase', from, to, anchor, at: performance.now() });
  };

  let parity = 0;
  return (
    <p
      className="phasa-subs__line phasa-subs__thai"
      lang="th"
      data-testid="phasa-cue-thai"
      data-boundaries={settings.wordBoundaries}
      data-romanization={romanization}
      onMouseUp={onMouseUp}
    >
      {tokens.map((token, index) => {
        if (token.kind === 'space') return ' ';
        if (token.kind !== 'thai') {
          return (
            <span key={index} className="phasa-token" data-token={index} data-kind={token.kind}>
              {token.text}
            </span>
          );
        }
        const info = lookup(token.text);
        const pronunciation = info?.pronunciation;
        parity = 1 - parity;
        const activate = (event: MouseEvent<HTMLSpanElement>) => {
          // A drag that selected text is a phrase, handled on mouseup.
          const root = event.currentTarget.getRootNode() as ShadowRoot & {
            getSelection?: () => Selection | null;
          };
          const selection = root.getSelection?.() ?? document.getSelection();
          if (selection && !selection.isCollapsed) return;
          open(index, event.currentTarget);
        };
        return (
          // Not focusable: Chrome won't start a drag selection (a phrase) on a focusable element,
          // and keyboard users reach words with W / Q / E (src/content/hotkeys.ts).
          <span
            key={index}
            className="phasa-word"
            data-token={index}
            data-status={statusAttr(statuses[token.text])}
            data-parity={parity}
            data-selected={(index >= selectedFrom && index <= selectedTo) || undefined}
            data-testid="phasa-word"
            onClick={activate}
          >
            {romanization !== 'off' && (
              <span className="phasa-word__roman" aria-hidden="true">
                {pronunciation ? (
                  <Romanization
                    pronunciation={pronunciation}
                    system={settings.romanizationSystem}
                  />
                ) : (
                  ' '
                )}
              </span>
            )}
            <span className="phasa-word__thai">{token.text}</span>
          </span>
        );
      })}
    </p>
  );
});
