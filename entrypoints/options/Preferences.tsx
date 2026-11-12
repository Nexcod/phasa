/**
 * Options → Settings (docs/plan.md §12 phase 6): subtitles, romanization, and how Phasa looks —
 * the theme of its pages, the Thai font, the subtitle size and the tone colors (plan §5.1).
 */
import type { CSSProperties, ReactNode } from 'react';
import { t, type MessageKey } from '@/src/i18n';
import {
  SUBTITLE_SIZE_MAX,
  SUBTITLE_SIZE_MIN,
  type Settings,
  type ThaiFontSetting,
  type ThemeSetting,
  type ToneColors,
} from '@/src/settings';
import { TONES } from '@/src/thai/tones';
import type { Tone } from '@/src/thai/types';
import { DARK_TONE_COLORS, DEFAULT_TONE_COLORS, thaiFontStack, toneVar } from '@/src/ui/appearance';
import { useDraft } from '@/src/ui/useDraft';

type Update = (patch: Partial<Settings>) => void;

const TONE_LABELS: Readonly<Record<Tone, MessageKey>> = {
  mid: 'toneMid',
  low: 'toneLow',
  falling: 'toneFalling',
  high: 'toneHigh',
  rising: 'toneRising',
};

/** One common word per tone, Paiboon+ with its tone mark. */
const TONE_SAMPLES: readonly { tone: Tone; thai: string; roman: string }[] = [
  { tone: 'mid', thai: 'มา', roman: 'maa' },
  { tone: 'low', thai: 'ปาก', roman: 'bpàak' },
  { tone: 'falling', thai: 'ไม่', roman: 'mâi' },
  { tone: 'high', thai: 'ม้า', roman: 'máa' },
  { tone: 'rising', thai: 'หมา', roman: 'mǎa' },
];

const FONT_SAMPLE = 'ภาษาไทย น้ำ ที่ ปู่';

function Checkbox({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: MessageKey;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="toggle">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      {t(label)}
    </label>
  );
}

function Choice<T extends string>({
  name,
  value,
  options,
  onChange,
}: {
  name: string;
  value: T;
  options: readonly { value: T; label: MessageKey; hint?: ReactNode }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="prefs__choices" role="radiogroup">
      {options.map((option) => (
        <label key={option.value} className="toggle prefs__choice">
          <input
            type="radio"
            name={name}
            checked={value === option.value}
            onChange={() => onChange(option.value)}
          />
          <span>{t(option.label)}</span>
          {option.hint}
        </label>
      ))}
    </div>
  );
}

function SubtitleSize({ settings, update }: { settings: Settings; update: Update }) {
  const [size, setSize] = useDraft(settings.subtitleSize, (subtitleSize: number) =>
    update({ subtitleSize }),
  );
  return (
    <div className="prefs__row">
      <label className="prefs__range">
        {t('settingSubtitleSize')}
        <input
          type="range"
          min={SUBTITLE_SIZE_MIN}
          max={SUBTITLE_SIZE_MAX}
          step={10}
          value={size}
          onChange={(event) => setSize(Number(event.target.value))}
          data-testid="phasa-pref-subtitle-size"
        />
        <output>{t('settingPercent', String(size))}</output>
      </label>
      {size !== 100 && (
        <button type="button" className="link-button" onClick={() => setSize(100)}>
          {t('settingReset')}
        </button>
      )}
    </div>
  );
}

function toneStyle(colors: ToneColors): CSSProperties {
  return Object.fromEntries(
    TONES.flatMap((tone) => (colors[tone] ? [[toneVar(tone), colors[tone]]] : [])),
  );
}

/** The five sample words on a page and over the video, in the colors chosen. */
function TonePreview({
  colors,
  surface,
}: {
  colors: ToneColors | null;
  surface: 'page' | 'video';
}) {
  // Tones without a custom color: over the video the overlay's built-in ones, on a page the theme's.
  const shown = surface === 'video' ? { ...DARK_TONE_COLORS, ...colors } : (colors ?? {});
  return (
    <div
      className={`prefs__tones-preview prefs__tones-preview--${surface}`}
      style={toneStyle(shown)}
    >
      <span className="prefs__preview-label">
        {t(surface === 'page' ? 'settingTonesOnPages' : 'settingTonesOverVideo')}
      </span>
      {TONE_SAMPLES.map((sample) => (
        <span key={sample.tone} className="prefs__tone-sample">
          <span lang="th" className="prefs__tone-thai">
            {sample.thai}
          </span>
          <span className="phasa-tone" data-tone={sample.tone} lang="th-Latn">
            {sample.roman}
          </span>
        </span>
      ))}
    </div>
  );
}

function ToneColorsBlock({ settings, update }: { settings: Settings; update: Update }) {
  const [colors, setColors] = useDraft<ToneColors | null>(settings.toneColors, (toneColors) =>
    update({ toneColors }),
  );
  return (
    <div className="prefs__tones" data-testid="phasa-pref-tones">
      <p className="prefs__label">{t('settingToneColors')}</p>
      <p className="prefs__hint">{t('settingToneColorsHint')}</p>
      <div className="prefs__tone-pickers">
        {TONES.map((tone) => (
          <label key={tone} className="prefs__tone-picker">
            <input
              type="color"
              value={colors?.[tone] ?? DEFAULT_TONE_COLORS[tone]}
              onChange={(event) => setColors({ ...colors, [tone]: event.target.value })}
              data-testid={`phasa-pref-tone-${tone}`}
            />
            {t(TONE_LABELS[tone])}
          </label>
        ))}
        {colors && (
          <button type="button" className="link-button" onClick={() => setColors(null)}>
            {t('settingToneColorsReset')}
          </button>
        )}
      </div>
      <TonePreview colors={colors} surface="page" />
      <TonePreview colors={colors} surface="video" />
    </div>
  );
}

const THEMES: readonly { value: ThemeSetting; label: MessageKey }[] = [
  { value: 'system', label: 'themeSystem' },
  { value: 'light', label: 'themeLight' },
  { value: 'dark', label: 'themeDark' },
];

const FONTS: readonly { value: ThaiFontSetting; label: MessageKey }[] = [
  { value: 'looped', label: 'fontLooped' },
  { value: 'loopless', label: 'fontLoopless' },
];

export function Preferences({ settings, update }: { settings: Settings; update: Update }) {
  return (
    <section id="settings" className="page__section prefs" data-testid="phasa-options-settings">
      <h2>{t('optionsSectionSettings')}</h2>

      <div className="prefs__block">
        <h3>{t('settingsSubtitlesTitle')}</h3>
        <div className="prefs__column">
          <Checkbox
            checked={settings.showTranslation}
            label="settingShowTranslation"
            onChange={(showTranslation) => update({ showTranslation })}
          />
          <Checkbox
            checked={settings.autoPause}
            label="settingAutoPause"
            onChange={(autoPause) => update({ autoPause })}
          />
          <Checkbox
            checked={settings.pauseOnLookup}
            label="settingPauseOnLookup"
            onChange={(pauseOnLookup) => update({ pauseOnLookup })}
          />
          <label className="select">
            {t('settingWordBoundaries')}
            <select
              value={settings.wordBoundaries}
              onChange={(event) => {
                const value = event.target.value;
                update({
                  wordBoundaries: value === 'none' || value === 'underline' ? value : 'gaps',
                });
              }}
            >
              <option value="none">{t('boundariesNone')}</option>
              <option value="gaps">{t('boundariesGaps')}</option>
              <option value="underline">{t('boundariesUnderline')}</option>
            </select>
          </label>
          <SubtitleSize settings={settings} update={update} />
        </div>
      </div>

      <div className="prefs__block">
        <h3>{t('settingsRomanizationTitle')}</h3>
        <div className="prefs__column">
          <Checkbox
            checked={settings.showRomanization}
            label="settingShowRomanization"
            onChange={(showRomanization) => update({ showRomanization })}
          />
          <label className="select">
            {t('settingPosition')}
            <select
              value={settings.romanizationPosition}
              onChange={(event) =>
                update({ romanizationPosition: event.target.value === 'below' ? 'below' : 'above' })
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
                update({ romanizationSystem: event.target.value === 'rtgs' ? 'rtgs' : 'paiboon' })
              }
            >
              <option value="paiboon">{t('systemPaiboon')}</option>
              <option value="rtgs">{t('systemRtgs')}</option>
            </select>
          </label>
          <p className="prefs__hint">{t('settingRomanizationHint')}</p>
        </div>
      </div>

      <div className="prefs__block">
        <h3>{t('settingsAppearanceTitle')}</h3>
        <p className="prefs__label">{t('settingTheme')}</p>
        <Choice
          name="theme"
          value={settings.theme}
          options={THEMES}
          onChange={(theme) => update({ theme })}
        />
        <p className="prefs__hint">{t('settingThemeHint')}</p>
        <p className="prefs__label">{t('settingThaiFont')}</p>
        <Choice
          name="thai-font"
          value={settings.thaiFont}
          options={FONTS.map((font) => ({
            ...font,
            hint: (
              <span
                lang="th"
                className="prefs__font-sample"
                style={{ fontFamily: thaiFontStack(font.value) }}
              >
                {FONT_SAMPLE}
              </span>
            ),
          }))}
          onChange={(thaiFont) => update({ thaiFont })}
        />
        <ToneColorsBlock settings={settings} update={update} />
      </div>
    </section>
  );
}
