/**
 * The segmentation convention (tests/fixtures/README.md, ADR 0005) applied to
 * dictionary headwords. Wiktionary has entries for many compositional
 * sequences — `ไม่มี`, `เข้าไป`, `ดีกว่า`, `ทุกคน`, `อันนี้` — that a learner
 * should see as two known words. The dictionary build marks such entries with
 * their parts; the tokenizer then never merges them and splits them when ICU
 * returns them whole. The entry itself stays in the dictionary for lookups.
 *
 * Rules split only at a known affix whose remainder is itself a headword, and
 * only for affixes that are whole syllables everywhere they occur (no particle
 * rule: `นะ`, `อะ`, `ไหม` are also syllables of `มานะ`, `เยอะ`, `ผ้าไหม`).
 */

export interface ConventionLexicon {
  has(word: string): boolean;
  /** Parts of speech of a headword's senses (wiktextract codes, src/dictionary/types.ts). */
  partsOfSpeech(word: string): readonly string[];
  /** Usage tags of a headword's senses. */
  tags(word: string): readonly string[];
  /** Paiboon romanization of a headword, syllables separated by `-` or spaces. */
  paiboon(word: string): string | undefined;
}

/** Negation splits from what it negates: `ไม่|รู้`, `ไม่|มี`, `ไม่|ค่อย`. */
const NEGATION = 'ไม่';

/** Compositional comparatives `X|กว่า`, except lexicalized ones. */
const COMPARATIVE = 'กว่า';
const COMPARATIVE_KEEP = new Set(['จนกว่า']);

/** Directional serial verbs: `เข้า|ไป`, `กลับ|มา`, `ลง|ไป`. */
const DIRECTION_HEADS = new Set(['เข้า', 'ออก', 'กลับ', 'ขึ้น', 'ลง', 'ข้าม', 'ผ่าน', 'ตาม']);
const DIRECTIONS = ['ไป', 'มา'];

/** Serial verbs after `ไป`/`มา`: `ไป|เที่ยว`, `มา|ถึง`, `มา|จาก`. */
const SERIAL_HEADS = ['ไป', 'มา'];
const SERIAL_KEEP = new Set(['ไปมา']);

/** Quantifier + classifier or noun: `ทุก|คน`, `ทุก|วัน`, `ทั้ง|วัน`. */
const QUANTIFIERS = ['ทุก', 'ทั้ง'];
const QUANTIFIER_KEEP = new Set([
  'ทุกวันนี้',
  'ทุกที',
  'ทุกทุก',
  'ทั้งหมด',
  'ทั้งคู่',
  'ทั้งนั้น',
  'ทั้งสิ้น',
  'ทั้งปวง',
  'ทั้งหลาย',
  'ทั้งนี้',
]);

/** Possessive `ของ` + pronoun: `ของ|เรา` (Wiktionary lists them as genitive pronouns). */
const POSSESSIVE = 'ของ';

/**
 * Classifier or noun + demonstrative: `อัน|นี้`, `เหล่า|นี้`. Only where the
 * whole is itself a noun or pronoun: adverbs and conjunctions such as
 * `ดังนั้น`, `เท่านั้น`, `ตอนนั้น` are lexicalized. Time words keep their
 * demonstrative (README: `วันนี้`, `ตอนนี้`).
 */
const DEMONSTRATIVES = ['นี้', 'นั้น', 'โน้น'];
const DEMONSTRATIVE_WHOLE_POS = new Set(['noun', 'pron', 'det', 'classifier']);
/** `กระนั้น` "even so": `กระ` is a bound prefix here, not a classifier. */
const DEMONSTRATIVE_KEEP = new Set(['กระนั้น']);
const TIME_HEADS = new Set([
  'วัน',
  'พรุ่ง',
  'ตอน',
  'เดี๋ยว',
  'ขณะ',
  'คืน',
  'เวลา',
  'คราว',
  'บัด',
  'เมื่อวาน',
  'เมื่อกี้',
]);

/** Modal + future `อยาก|จะ`, `คง|จะ` (README: aspect and modal verbs split), except `น่าจะ`. */
const FUTURE = 'จะ';
const FUTURE_KEEP = new Set(['น่าจะ']);

/** A verb and the complementizer `ว่า` "that": `คิด|ว่า`, `เรียก|ว่า`. Conjunctions keep it. */
const COMPLEMENTIZER = 'ว่า';
const COMPLEMENTIZER_KEEP = new Set(['ต่อว่า']); // "to reproach"

/** Aspect `X|แล้ว` (README: `ได้|แล้ว`), except lexicalized ones. */
const PERFECT = 'แล้ว';
const PERFECT_KEEP = new Set(['ที่แล้ว']);

/** Idioms keep their form whatever their parts: `ไม่เบา` "considerably". */
function isIdiom(word: string, lexicon: ConventionLexicon): boolean {
  return lexicon.tags(word).some((tag) => tag === 'idiomatic' || tag === 'slang');
}

/** Paiboon syllables without tones and vowel length, for comparing a word with its parts. */
function syllableSkeleton(paiboon: string): string[] {
  return paiboon
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase()
    .split(/[\s-]+/u)
    .filter((syllable) => syllable !== '')
    .map((syllable) => syllable.replace(/(.)\1+/gu, '$1'));
}

/**
 * True when the parts are pronounced as the whole, syllable for syllable: a
 * split never cuts inside a syllable (`มาตรา` mâat-dtraa is not `มา` + `ตรา`).
 */
function alignsWithSyllables(word: string, parts: readonly string[], lexicon: ConventionLexicon) {
  const whole = lexicon.paiboon(word);
  if (!whole) return false;
  const pieces: string[] = [];
  for (const part of parts) {
    const roman = lexicon.paiboon(part);
    if (!roman) return false;
    pieces.push(...syllableSkeleton(roman));
  }
  const target = syllableSkeleton(whole);
  return target.length === pieces.length && target.every((syllable, i) => syllable === pieces[i]);
}

/**
 * Parts of a compositional headword by the convention, or null to keep it
 * whole. Every part is a headword, so unknown fragments are never produced.
 */
export function conventionalParts(word: string, lexicon: ConventionLexicon): string[] | null {
  const parts = splitOnce(word, lexicon);
  if (!parts || !alignsWithSyllables(word, parts, lexicon)) return null;
  // A part can itself be compositional: `ไม่ได้แล้ว` → ไม่ | ได้ | แล้ว.
  return parts.flatMap((part) => conventionalParts(part, lexicon) ?? [part]);
}

function splitOnce(word: string, lexicon: ConventionLexicon): [string, string] | null {
  if (isIdiom(word, lexicon)) return null;
  const prefixed = (prefix: string): [string, string] | null => {
    if (!word.startsWith(prefix) || word.length === prefix.length) return null;
    const rest = word.slice(prefix.length);
    return lexicon.has(rest) ? [prefix, rest] : null;
  };
  const suffixed = (suffix: string): [string, string] | null => {
    if (!word.endsWith(suffix) || word.length === suffix.length) return null;
    const head = word.slice(0, -suffix.length);
    return lexicon.has(head) ? [head, suffix] : null;
  };
  const pos = lexicon.partsOfSpeech(word);

  // `ไม่ว่า` "regardless" is a conjunction, not a negated verb.
  if (!pos.includes('conj')) {
    const negation = prefixed(NEGATION);
    if (negation) return negation;
  }
  if (!QUANTIFIER_KEEP.has(word)) {
    for (const quantifier of QUANTIFIERS) {
      const quantified = prefixed(quantifier);
      // `ทั้งที่` "although" is a conjunction; `ทุกคน` "everyone" still splits (README).
      if (quantified && (quantifier === 'ทุก' || !pos.includes('conj'))) return quantified;
    }
  }
  // Nouns such as `มานะ` "perseverance" or `มายา` "illusion" only look like serial verbs.
  if (!SERIAL_KEEP.has(word) && pos.length > 0 && !pos.some((p) => p === 'noun' || p === 'name')) {
    for (const head of SERIAL_HEADS) {
      const serial = prefixed(head);
      if (serial) return serial;
    }
  }
  const possessive = prefixed(POSSESSIVE);
  if (possessive && lexicon.partsOfSpeech(possessive[1]).includes('pron')) return possessive;
  if (!COMPARATIVE_KEEP.has(word)) {
    const comparative = suffixed(COMPARATIVE);
    if (comparative) return comparative;
  }
  for (const direction of DIRECTIONS) {
    const split = suffixed(direction);
    if (split && DIRECTION_HEADS.has(split[0])) return split;
  }
  if (
    !DEMONSTRATIVE_KEEP.has(word) &&
    pos.length > 0 &&
    pos.every((p) => DEMONSTRATIVE_WHOLE_POS.has(p))
  ) {
    for (const demonstrative of DEMONSTRATIVES) {
      const split = suffixed(demonstrative);
      if (split && !TIME_HEADS.has(split[0])) return split;
    }
  }
  if (!COMPLEMENTIZER_KEEP.has(word) && pos.length > 0 && pos.every((p) => p === 'verb')) {
    const complement = suffixed(COMPLEMENTIZER);
    if (complement && lexicon.partsOfSpeech(complement[0]).includes('verb')) return complement;
  }
  if (!FUTURE_KEEP.has(word)) {
    const future = suffixed(FUTURE);
    if (future) return future;
  }
  if (!PERFECT_KEEP.has(word)) {
    const perfect = suffixed(PERFECT);
    if (perfect) return perfect;
  }
  return null;
}
