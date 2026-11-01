/** i18n labels for dictionary codes and word statuses (UI copy is English, AGENTS.md). */
import type { PartOfSpeech, SenseTag } from '../dictionary/types';
import { t, type MessageKey } from '../i18n';
import type { WordStatus } from '../vocab/types';

const POS: Readonly<Record<PartOfSpeech, MessageKey>> = {
  noun: 'posNoun',
  verb: 'posVerb',
  adj: 'posAdj',
  adv: 'posAdv',
  name: 'posName',
  pron: 'posPron',
  intj: 'posIntj',
  classifier: 'posClassifier',
  num: 'posNum',
  prep: 'posPrep',
  conj: 'posConj',
  particle: 'posParticle',
  det: 'posDet',
  phrase: 'posPhrase',
  proverb: 'posProverb',
  prefix: 'posPrefix',
  suffix: 'posSuffix',
};

const TAGS: Readonly<Record<SenseTag, MessageKey>> = {
  formal: 'tagFormal',
  informal: 'tagInformal',
  colloquial: 'tagColloquial',
  slang: 'tagSlang',
  archaic: 'tagArchaic',
  obsolete: 'tagObsolete',
  dated: 'tagDated',
  literary: 'tagLiterary',
  poetic: 'tagPoetic',
  vulgar: 'tagVulgar',
  offensive: 'tagOffensive',
  derogatory: 'tagDerogatory',
  humorous: 'tagHumorous',
  rare: 'tagRare',
  dialectal: 'tagDialectal',
  internet: 'tagInternet',
  idiomatic: 'tagIdiomatic',
  figurative: 'tagFigurative',
  abbreviation: 'tagAbbreviation',
  misspelling: 'tagMisspelling',
  royal: 'tagRoyal',
};

export function posLabel(pos: PartOfSpeech): string {
  return t(POS[pos]);
}

export function tagLabel(tag: SenseTag): string {
  return t(TAGS[tag]);
}

export function statusLabel(status: WordStatus): string {
  switch (status) {
    case 'new':
      return t('wordStatusNew');
    case 'known':
      return t('wordStatusKnown');
    case 'ignored':
      return t('wordStatusIgnored');
    default:
      return t('wordStatusLearning', String(status));
  }
}

/** `1:23` or `1:02:03`. */
export function formatTime(ms: number): string {
  const total = Math.floor(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, '0');
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}`
    : `${minutes}:${seconds}`;
}

/** A watch URL that starts at `ms`. */
export function watchUrl(videoId: string, ms: number): string {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&t=${Math.floor(ms / 1000)}s`;
}
