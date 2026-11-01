import type { Pronunciation } from '../dictionary/pronunciation';
import type { RomanizationSystem } from '../settings';

/**
 * Romanization with tones shown twice: Paiboon+ diacritics and the shared
 * tone colors (docs/plan.md §5.1, §5.5). RTGS has no tones, so it is plain.
 */
export function Romanization({
  pronunciation,
  system,
  className,
}: {
  pronunciation: Pronunciation;
  system: RomanizationSystem;
  className?: string;
}) {
  if (system === 'rtgs' && pronunciation.rtgs) {
    return (
      <span className={className} lang="th-Latn">
        {pronunciation.rtgs}
      </span>
    );
  }
  return (
    <span className={className} lang="th-Latn">
      {pronunciation.syllables.map((syllable, index) => (
        <span key={index}>
          {index > 0 && <span className="phasa-roman__sep">-</span>}
          <span className="phasa-tone" data-tone={syllable.tone}>
            {syllable.paiboon}
          </span>
        </span>
      ))}
    </span>
  );
}

/** Plain-text romanization, for aria-labels and lists. */
export function romanizationText(pronunciation: Pronunciation, system: RomanizationSystem): string {
  if (system === 'rtgs' && pronunciation.rtgs) return pronunciation.rtgs;
  return pronunciation.syllables.map((syllable) => syllable.paiboon).join('-');
}
