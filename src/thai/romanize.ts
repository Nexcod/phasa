/**
 * Rule-based romanization and tones for words the dictionary doesn't have
 * (docs/plan.md §5.5, source 2). Thai spelling underdetermines pronunciation
 * (implicit vowels, silent letters, exceptions), so results are marked
 * approximate: syllables are parsed from the spelling, tones come from
 * consonant class, live/dead syllable and tone mark.
 */
import { withPaiboonTone } from './tones';
import type { Tone } from './types';

export interface RomanSyllable {
  /** Spelling of the syllable as written. */
  text: string;
  paiboon: string;
  rtgs: string;
  tone: Tone;
}

type ConsonantClass = 'mid' | 'high' | 'low';

const MID = 'กจฎฏดตบปอ';
const HIGH = 'ขฃฉฐถผฝศษสห';

function consonantClass(c: string): ConsonantClass {
  if (MID.includes(c)) return 'mid';
  if (HIGH.includes(c)) return 'high';
  return 'low';
}

/** Initial consonant → [Paiboon, RTGS]. */
const INITIAL: Readonly<Record<string, [string, string]>> = {
  ก: ['g', 'k'],
  ข: ['k', 'kh'],
  ฃ: ['k', 'kh'],
  ค: ['k', 'kh'],
  ฅ: ['k', 'kh'],
  ฆ: ['k', 'kh'],
  ง: ['ng', 'ng'],
  จ: ['j', 'ch'],
  ฉ: ['ch', 'ch'],
  ช: ['ch', 'ch'],
  ซ: ['s', 's'],
  ฌ: ['ch', 'ch'],
  ญ: ['y', 'y'],
  ฎ: ['d', 'd'],
  ฏ: ['dt', 't'],
  ฐ: ['t', 'th'],
  ฑ: ['t', 'th'],
  ฒ: ['t', 'th'],
  ณ: ['n', 'n'],
  ด: ['d', 'd'],
  ต: ['dt', 't'],
  ถ: ['t', 'th'],
  ท: ['t', 'th'],
  ธ: ['t', 'th'],
  น: ['n', 'n'],
  บ: ['b', 'b'],
  ป: ['bp', 'p'],
  ผ: ['p', 'ph'],
  ฝ: ['f', 'f'],
  พ: ['p', 'ph'],
  ฟ: ['f', 'f'],
  ภ: ['p', 'ph'],
  ม: ['m', 'm'],
  ย: ['y', 'y'],
  ร: ['r', 'r'],
  ล: ['l', 'l'],
  ว: ['w', 'w'],
  ศ: ['s', 's'],
  ษ: ['s', 's'],
  ส: ['s', 's'],
  ห: ['h', 'h'],
  ฬ: ['l', 'l'],
  อ: ['', ''],
  ฮ: ['h', 'h'],
};

/** Final consonant → [Paiboon, RTGS, stop?]. */
function finalSound(c: string): [string, string, boolean] {
  if ('กขคฆ'.includes(c)) return ['k', 'k', true];
  if ('บปพฟภ'.includes(c)) return ['p', 'p', true];
  if ('จชซฌฎฏฐฑฒดตถทธศษส'.includes(c)) return ['t', 't', true];
  if (c === 'ง') return ['ng', 'ng', false];
  if (c === 'ม') return ['m', 'm', false];
  if (c === 'ย') return ['i', 'i', false];
  if (c === 'ว') return ['o', 'o', false];
  return ['n', 'n', false]; // ญ ณ น ร ล ฬ
}

const CONSONANT = /[\u0E01-\u0E2E]/u;
const PRE_VOWEL = 'เแโใไ';
const TONE_MARKS = '่้๊๋';
const CLUSTER_SECOND: Readonly<Record<string, string>> = {
  ก: 'รลว',
  ข: 'รลว',
  ค: 'รลว',
  ต: 'ร',
  ป: 'รล',
  พ: 'รล',
  ผ: 'ล',
};
const LEADING_H = 'งญนมยรลว';

interface Nucleus {
  /** Paiboon vowel; RTGS vowel. */
  paiboon: string;
  rtgs: string;
  long: boolean;
}

const V = (paiboon: string, rtgs: string, long: boolean): Nucleus => ({ paiboon, rtgs, long });

/** What a syllable passes to the next one: the อักษรนำ rule needs its class and shape. */
interface Previous {
  cls: ConsonantClass;
  /** A lone consonant read with an implicit a (ส in สบาย, ข in ขนม). */
  implicitA: boolean;
}

const LOW_SONORANT = 'งญนมยรลว';
const MARKS_AND_VOWELS = 'ัิีึืุู็่้๊๋าะำ';

/** Reads one syllable starting at `i`; returns null on text it can't parse. */
function readSyllable(
  word: string,
  start: number,
  previous: Previous | null,
): { syllable: RomanSyllable; end: number; next: Previous } | null {
  let i = start;
  const at = (k: number) => word[k] ?? '';
  /** Nothing of this syllable follows `k`: end, a consonant or a leading vowel. */
  const endsAt = (k: number) => at(k) === '' || CONSONANT.test(at(k)) || PRE_VOWEL.includes(at(k));
  const pre = PRE_VOWEL.includes(at(i)) ? at(i++) : '';
  if (!CONSONANT.test(at(i))) return null;

  // Initial consonant or cluster.
  let first = at(i++);
  let cls = consonantClass(first);
  let [initialP, initialR] = INITIAL[first] ?? ['', ''];
  const second = at(i);
  const nextIsVowelish = (k: number) => !CONSONANT.test(at(k)) || at(k) === '';
  if (first === 'ห' && LEADING_H.includes(second) && second !== '') {
    // ห นำ: silent ห makes the sonorant high class.
    first = second;
    [initialP, initialR] = INITIAL[second] ?? ['', ''];
    cls = 'high';
    i++;
  } else if (first === 'อ' && second === 'ย') {
    [initialP, initialR] = ['y', 'y'];
    i++;
  } else if (
    (first === 'ท' || first === 'ส' || first === 'ศ') &&
    second === 'ร' &&
    !nextIsVowelish(i + 1)
  ) {
    // ทร, สร, ศร read as s (ทราย, สร้าง) when a vowel or final follows.
    [initialP, initialR] = ['s', 's'];
    i++;
  } else if (
    CLUSTER_SECOND[first]?.includes(second) &&
    second !== '' &&
    !(second === 'ร' && at(i + 1) === 'ร') && // -รร- is a vowel (กรรม gam)
    clusterFollows(word, i + 1, second)
  ) {
    const [p, r] = INITIAL[second] ?? ['', ''];
    initialP += p;
    initialR += r;
    i++;
  }

  // Marks above and below, in any order: vowel signs, tone mark, mai taikhu.
  let tone = '';
  let above = '';
  while ('ัิีึืุู็่้๊๋'.includes(at(i)) && at(i) !== '') {
    if (TONE_MARKS.includes(at(i))) tone = at(i);
    else above += at(i);
    i++;
  }

  let nucleus: Nucleus;
  let implicitA = false;
  let finalChar = '';
  let explicitFinalVowel = false;

  const takeFinal = () => {
    // A consonant is a final unless a vowel or mark makes it the next initial.
    const c = at(i);
    if (!CONSONANT.test(c) || 'หอฮ'.includes(c)) return; // ห, อ, ฮ never close a syllable
    const after = at(i + 1);
    if (after === '์') return; // silent letter, skipped below
    if (MARKS_AND_VOWELS.includes(after) && after !== '') return;
    // A lone consonant left at the end is a syllable of its own (กุศล gù-sǒn, กบฏ gà-bòt).
    if (CONSONANT.test(after) && at(i + 2) === '' && after !== 'ร') return;
    if (endsAt(i + 1)) {
      finalChar = c;
      i++;
      // A final ร after it is silent at the end or before a consonant (เพชร, มิตร).
      if (at(i) === 'ร' && endsAt(i + 1) && at(i + 1) !== 'ร') i++;
    }
  };

  if (pre === 'เ') {
    if (above === 'ี' && at(i) === 'ย') {
      i++;
      nucleus = V('iia', 'ia', true);
      takeFinal();
    } else if (above === 'ื' && at(i) === 'อ') {
      i++;
      nucleus = V('ʉʉa', 'uea', true);
      takeFinal();
    } else if (at(i) === 'า' && at(i + 1) === 'ะ') {
      i += 2;
      nucleus = V('ɔ', 'o', false);
    } else if (at(i) === 'า') {
      i++;
      nucleus = V('ao', 'ao', true);
      explicitFinalVowel = true;
    } else if (at(i) === 'อ' && at(i + 1) === 'ะ') {
      i += 2;
      nucleus = V('ə', 'oe', false);
    } else if (above === 'ิ') {
      nucleus = V('əə', 'oe', true);
      takeFinal();
    } else if (at(i) === 'อ') {
      i++;
      nucleus = V('əə', 'oe', true);
    } else if (at(i) === 'ย' && endsAt(i + 1)) {
      i++;
      nucleus = V('əəi', 'oei', true);
      explicitFinalVowel = true;
    } else if (at(i) === 'ะ') {
      i++;
      nucleus = V('e', 'e', false);
    } else if (above === '็') {
      nucleus = V('e', 'e', false);
      takeFinal();
    } else {
      nucleus = V('ee', 'e', true);
      takeFinal();
    }
  } else if (pre === 'แ') {
    if (at(i) === 'ะ') {
      i++;
      nucleus = V('ɛ', 'ae', false);
    } else if (above === '็') {
      nucleus = V('ɛ', 'ae', false);
      takeFinal();
    } else {
      nucleus = V('ɛɛ', 'ae', true);
      takeFinal();
    }
  } else if (pre === 'โ') {
    if (at(i) === 'ะ') {
      i++;
      nucleus = V('o', 'o', false);
    } else {
      nucleus = V('oo', 'o', true);
      takeFinal();
    }
  } else if (pre === 'ใ' || pre === 'ไ') {
    nucleus = V('ai', 'ai', false);
    explicitFinalVowel = true;
    if (at(i) === 'ย' && at(i + 1) === '') i++; // ไทย
  } else if (above.includes('ั') && at(i) === 'ว') {
    i++;
    nucleus = V('uua', 'ua', true);
    takeFinal();
  } else if (above.includes('ั')) {
    nucleus = V('a', 'a', false);
    takeFinal();
  } else if (above.includes('ิ')) {
    nucleus = V('i', 'i', false);
    takeFinal();
  } else if (above.includes('ี')) {
    nucleus = V('ii', 'i', true);
    takeFinal();
  } else if (above.includes('ึ')) {
    nucleus = V('ʉ', 'ue', false);
    takeFinal();
  } else if (above.includes('ื')) {
    if (at(i) === 'อ') i++;
    nucleus = V('ʉʉ', 'ue', true);
    takeFinal();
  } else if (above.includes('ุ')) {
    nucleus = V('u', 'u', false);
    takeFinal();
  } else if (above.includes('ู')) {
    nucleus = V('uu', 'u', true);
    takeFinal();
  } else if (at(i) === 'ำ') {
    i++;
    nucleus = V('am', 'am', false);
    explicitFinalVowel = true;
  } else if (at(i) === 'า') {
    i++;
    nucleus = V('aa', 'a', true);
    takeFinal();
  } else if (at(i) === 'ะ') {
    i++;
    nucleus = V('a', 'a', false);
  } else if (at(i) === 'ร' && at(i + 1) === 'ร') {
    // -รร-: a + n, or a + the next final (กรรม gam).
    i += 2;
    nucleus = V('a', 'a', false);
    const before = i;
    takeFinal();
    if (i === before) finalChar = 'น';
  } else if (
    at(i) === 'อ' &&
    (CONSONANT.test(at(i + 1)) || at(i + 1) === '' || TONE_MARKS.includes(at(i + 1)))
  ) {
    i++;
    nucleus = V('ɔɔ', 'o', true);
    takeFinal();
  } else if (at(i) === 'ว' && CONSONANT.test(at(i + 1)) && endsAt(i + 2)) {
    // -ว- as vowel between consonants: สวน suuan.
    i++;
    nucleus = V('uua', 'ua', true);
    takeFinal();
  } else {
    // No written vowel: implicit o before a final, implicit a in an open syllable.
    const before = i;
    takeFinal();
    nucleus = i > before ? V('o', 'o', false) : V('a', 'a', false);
    implicitA = i === before;
  }

  // Silent letters marked with thanthakhat: จันทร์, ศิลป์, กษัตริย์.
  for (;;) {
    if (CONSONANT.test(at(i)) && at(i + 1) === '์') i += 2;
    else if (
      CONSONANT.test(at(i)) &&
      'ิุ'.includes(at(i + 1) || 'x') &&
      CONSONANT.test(at(i + 2)) &&
      at(i + 3) === '์'
    )
      i += 4;
    else if (at(i) === '์') i++;
    else break;
  }
  // The consonant after a silent one can still close the syllable: การ์ด gáat, กอล์ฟ gɔ\u0301ɔp.
  if (!finalChar && i > start && word[i - 1] === '์' && !explicitFinalVowel) takeFinal();

  let finalP = '';
  let finalR = '';
  let stop = false;
  if (finalChar) [finalP, finalR, stop] = finalSound(finalChar);

  const dead = stop || (!finalChar && !explicitFinalVowel && !nucleus.long);
  // อักษรนำ: a low sonorant after an open short syllable of a mid or high consonant
  // takes that class (ตลาด dtà-làat, ขนม kà-nǒm).
  if (
    previous?.implicitA &&
    previous.cls !== 'low' &&
    cls === 'low' &&
    LOW_SONORANT.includes(first) &&
    initialP.length <= 2
  ) {
    cls = previous.cls;
  }
  const toneValue = toneOf(cls, tone, dead, nucleus.long);
  const toneless = `${initialP}${nucleus.paiboon}${finalP}`;
  return {
    syllable: {
      text: word.slice(start, i),
      paiboon: withPaiboonTone(toneless, toneValue),
      rtgs: `${initialR}${nucleus.rtgs}${finalR}`,
      tone: toneValue,
    },
    end: i,
    next: { cls, implicitA },
  };
}

/**
 * A cluster's second consonant is followed by a vowel (กรา, กลอง) or by one
 * final consonant (กรด, กลม); before a leading vowel or at the end it is a
 * final itself (กลไก gon-gai).
 */
function clusterFollows(word: string, k: number, second: string): boolean {
  const next = word[k] ?? '';
  if (next === '' || PRE_VOWEL.includes(next)) return false;
  if (!CONSONANT.test(next) || next === 'อ') return true;
  // Before a lone final, ว is the vowel ua (กวน guuan), not a cluster.
  if (second === 'ว') return false;
  const after = word[k + 1] ?? '';
  return after === '' || CONSONANT.test(after) || PRE_VOWEL.includes(after);
}

function toneOf(cls: ConsonantClass, mark: string, dead: boolean, long: boolean): Tone {
  switch (mark) {
    case '่':
      return cls === 'low' ? 'falling' : 'low';
    case '้':
      return cls === 'low' ? 'high' : 'falling';
    case '๊':
      return 'high';
    case '๋':
      return 'rising';
  }
  if (cls === 'mid') return dead ? 'low' : 'mid';
  if (cls === 'high') return dead ? 'low' : 'rising';
  if (!dead) return 'mid';
  return long ? 'falling' : 'high';
}

/** Syllables of a Thai word by spelling rules, or null if some part can't be parsed. */
export function romanizeByRules(word: string): RomanSyllable[] | null {
  const syllables: RomanSyllable[] = [];
  let previous: Previous | null = null;
  for (let i = 0; i < word.length;) {
    const read = readSyllable(word, i, previous);
    if (!read || read.end <= i) return null;
    syllables.push(read.syllable);
    previous = read.next;
    i = read.end;
  }
  return syllables.length > 0 ? syllables : null;
}
