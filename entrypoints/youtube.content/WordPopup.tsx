import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { DictEntry, WordInfo } from '@/src/dictionary/types';
import { t } from '@/src/i18n';
import type { Settings } from '@/src/settings';
import type { Token } from '@/src/thai/types';
import { posLabel, statusLabel, tagLabel } from '@/src/ui/labels';
import { Romanization, romanizationText } from '@/src/ui/Romanization';
import { speakThai } from '@/src/ui/tts';
import type { SegRuleKind, UnitKind, WordStatus } from '@/src/vocab/types';

/** Where the popup points: the word's box, relative to the overlay. */
export interface PopupAnchor {
  centerX: number;
  /** Distance from the overlay's bottom edge to the word's top edge. */
  bottom: number;
}

export interface PopupActions {
  lookup: (word: string) => Promise<WordInfo>;
  cached: (word: string) => WordInfo | undefined;
  setStatus: (kind: UnitKind, thai: string, status: WordStatus) => Promise<void>;
  forget: (kind: UnitKind, thai: string) => Promise<void>;
  addSegRule: (kind: SegRuleKind, parts: string[]) => Promise<void>;
  close: () => void;
}

/** Popup keys (docs/plan.md §2.1): 1–4 learning, 5 or K known, X ignored, Esc closes. */
export function statusForKey(code: string): WordStatus | 'close' | null {
  switch (code) {
    case 'Digit1':
    case 'Numpad1':
      return 1;
    case 'Digit2':
    case 'Numpad2':
      return 2;
    case 'Digit3':
    case 'Numpad3':
      return 3;
    case 'Digit4':
    case 'Numpad4':
      return 4;
    case 'Digit5':
    case 'Numpad5':
    case 'KeyK':
      return 'known';
    case 'KeyX':
      return 'ignored';
    case 'Escape':
      return 'close';
    default:
      return null;
  }
}

/**
 * Popup keys win over YouTube's (digits seek, K plays): window capture phase,
 * consumed with their keyup and keypress.
 */
function usePopupKeys(onKey: (result: WordStatus | 'close') => void) {
  const latest = useRef(onKey);
  useLayoutEffect(() => {
    latest.current = onKey;
  });
  useEffect(() => {
    const consumed = new Set<string>();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.composedPath()[0];
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
      const result = statusForKey(event.code);
      if (result === null) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      consumed.add(event.code);
      latest.current(result);
    };
    const onOther = (event: KeyboardEvent) => {
      if (!consumed.has(event.code)) return;
      if (event.type === 'keyup') consumed.delete(event.code);
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    window.addEventListener('keydown', onKeyDown, { capture: true });
    window.addEventListener('keyup', onOther, { capture: true });
    window.addEventListener('keypress', onOther, { capture: true });
    return () => {
      window.removeEventListener('keydown', onKeyDown, { capture: true });
      window.removeEventListener('keyup', onOther, { capture: true });
      window.removeEventListener('keypress', onOther, { capture: true });
    };
  }, []);
}

/** Positions the popup over its word and keeps it inside the overlay. */
function PopupFrame({
  anchor,
  openedAt,
  testId,
  label,
  onClose,
  children,
}: {
  anchor: PopupAnchor;
  openedAt: number;
  testId: string;
  label: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [left, setLeft] = useState(anchor.centerX);
  const [openMs, setOpenMs] = useState<number>();

  useLayoutEffect(() => {
    const element = ref.current;
    const parent = element?.offsetParent;
    if (!element || !(parent instanceof HTMLElement)) return;
    const half = element.offsetWidth / 2;
    const margin = 8;
    setLeft(Math.min(Math.max(anchor.centerX, half + margin), parent.clientWidth - half - margin));
    // Click → popup on screen (docs/plan.md §12 phase 3: < 100 ms).
    setOpenMs(Math.round(performance.now() - openedAt));
  }, [anchor, openedAt]);

  return (
    <div
      ref={ref}
      className="phasa-popup"
      role="dialog"
      aria-label={label}
      data-testid={testId}
      data-open-ms={openMs}
      style={{ left, bottom: anchor.bottom + 8 }}
    >
      <button
        type="button"
        className="phasa-popup__close"
        aria-label={t('popupClose')}
        onClick={onClose}
      >
        ×
      </button>
      {children}
    </div>
  );
}

function SpeakButton({ text }: { text: string }) {
  const [noVoice, setNoVoice] = useState(false);
  return (
    <button
      type="button"
      className="phasa-popup__speak"
      aria-label={t('popupSpeak')}
      title={noVoice ? t('popupNoVoice') : t('popupSpeak')}
      data-novoice={noVoice || undefined}
      onClick={() => {
        void speakThai(text).then((spoken) => setNoVoice(!spoken));
      }}
    >
      🔊
    </button>
  );
}

function StatusButtons({
  status,
  onSet,
  onForget,
}: {
  status: WordStatus | undefined;
  onSet: (status: WordStatus) => void;
  onForget: (() => void) | undefined;
}) {
  const options: { value: WordStatus; label: string }[] = [
    ...([1, 2, 3, 4] as const).map((level) => ({
      value: level,
      label: t('statusButtonLearning', String(level)),
    })),
    { value: 'known', label: t('statusButtonKnown') },
    { value: 'ignored', label: t('statusButtonIgnore') },
  ];
  return (
    <div className="phasa-popup__section">
      <div className="phasa-popup__heading">
        {t('popupStatus')}:{' '}
        <span data-testid="phasa-popup-status">{statusLabel(status ?? 'new')}</span>
      </div>
      <div className="phasa-popup__statuses" role="group" aria-label={t('popupStatus')}>
        {options.map((option) => (
          <button
            key={String(option.value)}
            type="button"
            className="phasa-popup__status"
            data-status={String(option.value)}
            aria-pressed={status === option.value}
            onClick={() => onSet(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
      {onForget && (
        <button type="button" className="phasa-popup__link" onClick={onForget}>
          {t('popupForget')}
        </button>
      )}
      <p className="phasa-popup__hint">{t('popupKeysHint')}</p>
    </div>
  );
}

function Senses({ entry }: { entry: DictEntry }) {
  return (
    <ol className="phasa-popup__senses">
      {entry.senses.map((sense, index) => (
        <li key={index}>
          {sense.pos && <span className="phasa-popup__pos">{posLabel(sense.pos)}</span>}
          {sense.tags?.map((tag) => (
            <span key={tag} className="phasa-popup__tag">
              {tagLabel(tag)}
            </span>
          ))}
          <span>{sense.glosses.join('; ')}</span>
          {sense.classifier && (
            <span className="phasa-popup__classifier" lang="th">
              {' '}
              ({t('popupClassifier', sense.classifier)})
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}

function Pronounced({ info, settings }: { info: WordInfo; settings: Settings }) {
  const pronunciation = info.pronunciation;
  if (!pronunciation) return null;
  const respelling = pronunciation.syllables.every((syllable) => syllable.text)
    ? pronunciation.syllables
    : null;
  return (
    <div className="phasa-popup__pronunciation">
      <Romanization
        className="phasa-popup__roman"
        pronunciation={pronunciation}
        system={settings.romanizationSystem}
      />
      {pronunciation.source === 'rules' && (
        <span className="phasa-popup__badge" title={t('popupApproximateHint')}>
          {t('popupApproximate')}
        </span>
      )}
      {respelling && respelling.length > 1 && pronunciation.source === 'dictionary' && (
        <div className="phasa-popup__syllables">
          {t('popupPronouncedAs')}:{' '}
          <span lang="th">
            {respelling.map((syllable, index) => (
              <span key={index} className="phasa-tone" data-tone={syllable.tone}>
                {index > 0 && ' · '}
                {syllable.text}
              </span>
            ))}
          </span>
        </div>
      )}
    </div>
  );
}

/** Up to `limit` grapheme clusters of a word, for the split control. */
function graphemes(word: string): string[] {
  return [...new Intl.Segmenter('th', { granularity: 'grapheme' }).segment(word)].map(
    (segment) => segment.segment,
  );
}

function BoundaryFix({
  word,
  previous,
  next,
  onRule,
}: {
  word: string;
  previous: string | undefined;
  next: string | undefined;
  onRule: (kind: SegRuleKind, parts: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const clusters = graphemes(word);
  return (
    <div className="phasa-popup__section">
      <button
        type="button"
        className="phasa-popup__link"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {t('popupBoundaries')}
      </button>
      {open && (
        <div className="phasa-popup__boundaries">
          {previous && (
            <button
              type="button"
              className="phasa-popup__small"
              onClick={() => onRule('merge', [previous, word])}
            >
              {t('popupJoinPrevious')}
            </button>
          )}
          {next && (
            <button
              type="button"
              className="phasa-popup__small"
              onClick={() => onRule('merge', [word, next])}
            >
              {t('popupJoinNext')}
            </button>
          )}
          {clusters.length > 1 && (
            <>
              <p className="phasa-popup__hint">{t('popupSplitHint')}</p>
              <div className="phasa-popup__split" lang="th">
                {clusters.map((cluster, index) => (
                  <span key={index}>
                    {index > 0 && (
                      <button
                        type="button"
                        className="phasa-popup__cut"
                        aria-label={t('popupSplitAt', clusters.slice(index).join(''))}
                        onClick={() =>
                          onRule('split', [
                            clusters.slice(0, index).join(''),
                            clusters.slice(index).join(''),
                          ])
                        }
                      >
                        |
                      </button>
                    )}
                    {cluster}
                  </span>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** The word's lookup: cached (same frame), else fetched. Popups are keyed by word. */
function useInfo(word: string, actions: PopupActions): WordInfo | undefined {
  const [info, setInfo] = useState(() => actions.cached(word));
  const missing = info === undefined;
  useEffect(() => {
    if (!missing) return;
    let active = true;
    actions.lookup(word).then(
      (result) => {
        if (active) setInfo(result);
      },
      () => {
        if (active) setInfo({ thai: word });
      },
    );
    return () => {
      active = false;
    };
  }, [word, actions, missing]);
  return info;
}

export function WordPopup({
  word,
  previous,
  next,
  status,
  anchor,
  openedAt,
  settings,
  actions,
}: {
  word: string;
  /** Adjacent Thai words, for merge rules. */
  previous: string | undefined;
  next: string | undefined;
  status: WordStatus | undefined;
  anchor: PopupAnchor;
  openedAt: number;
  settings: Settings;
  actions: PopupActions;
}) {
  const info = useInfo(word, actions);
  const [error, setError] = useState(false);
  const run = (task: Promise<void>, closeAfter = false) => {
    setError(false);
    task.then(
      () => {
        if (closeAfter) actions.close();
      },
      () => setError(true),
    );
  };
  const setStatus = (value: WordStatus) => run(actions.setStatus('word', word, value));
  usePopupKeys((result) => {
    if (result === 'close') actions.close();
    else setStatus(result);
  });

  const entry = info?.entry;
  const main = info?.main;
  return (
    <PopupFrame
      anchor={anchor}
      openedAt={openedAt}
      testId="phasa-popup"
      label={word}
      onClose={actions.close}
    >
      <div className="phasa-popup__head">
        <span className="phasa-popup__word" lang="th" data-testid="phasa-popup-word">
          {word}
        </span>
        <SpeakButton text={word} />
        {entry?.freqRank !== undefined && (
          <span className="phasa-popup__freq">{t('popupFrequency', String(entry.freqRank))}</span>
        )}
      </div>
      {!info && <p className="phasa-popup__muted">{t('popupLoading')}</p>}
      {info && <Pronounced info={info} settings={settings} />}
      {entry && <Senses entry={entry} />}
      {main && (
        <div className="phasa-popup__section">
          <div className="phasa-popup__heading" lang="th">
            {t('popupAltOf', main.thai)}
          </div>
          <Senses entry={main} />
        </div>
      )}
      {info && !entry && info.parts && (
        <div className="phasa-popup__section">
          <div className="phasa-popup__heading">{t('popupMadeOf')}</div>
          <ul className="phasa-popup__parts">
            {info.parts.map((part, index) => (
              <li key={index}>
                <span lang="th">{part.thai}</span>
                {part.entry?.senses[0] && <span> — {part.entry.senses[0].glosses.join('; ')}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {info && !entry && !info.parts && <p className="phasa-popup__muted">{t('popupNotFound')}</p>}
      <StatusButtons
        status={status}
        onSet={setStatus}
        onForget={status && status !== 'new' ? () => run(actions.forget('word', word)) : undefined}
      />
      <BoundaryFix
        word={word}
        previous={previous}
        next={next}
        onRule={(kind, parts) => run(actions.addSegRule(kind, parts), true)}
      />
      {error && <p className="phasa-popup__error">{t('popupError')}</p>}
    </PopupFrame>
  );
}

export function PhrasePopup({
  text,
  tokens,
  status,
  anchor,
  openedAt,
  settings,
  actions,
}: {
  /** The selected text, spaces included. */
  text: string;
  tokens: readonly Token[];
  status: WordStatus | undefined;
  anchor: PopupAnchor;
  openedAt: number;
  settings: Settings;
  actions: PopupActions;
}) {
  const [error, setError] = useState(false);
  const words = tokens.filter((token) => token.kind === 'thai');
  const joinable = !text.includes(' ') && words.length >= 2 && words.length <= 8;
  const run = (task: Promise<void>, closeAfter = false) => {
    setError(false);
    task.then(
      () => {
        if (closeAfter) actions.close();
      },
      () => setError(true),
    );
  };
  const setStatus = (value: WordStatus) => run(actions.setStatus('phrase', text, value));
  usePopupKeys((result) => {
    if (result === 'close') actions.close();
    else setStatus(result);
  });
  const romanization = words
    .map((token) => actions.cached(token.text)?.pronunciation)
    .map((pronunciation) =>
      pronunciation ? romanizationText(pronunciation, settings.romanizationSystem) : '…',
    )
    .join(' ');

  return (
    <PopupFrame
      anchor={anchor}
      openedAt={openedAt}
      testId="phasa-phrase-popup"
      label={t('phraseTitle')}
      onClose={actions.close}
    >
      <div className="phasa-popup__head">
        <span className="phasa-popup__word" lang="th" data-testid="phasa-popup-word">
          {text}
        </span>
        <SpeakButton text={text} />
      </div>
      <div className="phasa-popup__roman" lang="th-Latn">
        {romanization}
      </div>
      <div className="phasa-popup__section">
        <div className="phasa-popup__heading">{t('phraseWords')}</div>
        <ul className="phasa-popup__parts">
          {words.map((token, index) => {
            const gloss = actions.cached(token.text)?.entry?.senses[0]?.glosses.join('; ');
            return (
              <li key={index}>
                <span lang="th">{token.text}</span>
                {gloss && <span> — {gloss}</span>}
              </li>
            );
          })}
        </ul>
      </div>
      <StatusButtons
        status={status}
        onSet={setStatus}
        onForget={
          status && status !== 'new' ? () => run(actions.forget('phrase', text)) : undefined
        }
      />
      {joinable && (
        <div className="phasa-popup__section">
          <button
            type="button"
            className="phasa-popup__small"
            onClick={() =>
              run(
                actions.addSegRule(
                  'merge',
                  words.map((token) => token.text),
                ),
                true,
              )
            }
          >
            {t('phraseJoin')}
          </button>
        </div>
      )}
      {error && <p className="phasa-popup__error">{t('popupError')}</p>}
    </PopupFrame>
  );
}
