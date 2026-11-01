/**
 * Video analysis in the service worker (docs/plan.md §7, §3.2 rule 5): reads
 * the cached Thai track, tokenizes it, and keeps the status-independent
 * profile of the last few tracks in memory, so applying a status change costs
 * one IndexedDB read of statuses (plan §7.4: recomputed in real time).
 */
import { analyzeProfile, buildProfile, newUnits, type TrackProfile } from '../analysis/analyze';
import type { VideoAnalysis, VideoStats } from '../analysis/types';
import { isThaiLanguage } from '../captions/process';
import { alignTranslation } from '../captions/tracks';
import { PROCESSING_VERSION, type ProcessedTrack } from '../captions/types';
import type { PhasaDb } from '../db/db';
import type { FrequencyList } from '../dictionary/frequency';
import { pronounce } from '../dictionary/pronunciation';
import type { DictionaryStore } from '../dictionary/store';
import { bulkSetWords, setUnit, statusesOf } from '../vocab/store';
import type { ContextInput, VocabChange, WordStatus } from '../vocab/types';
import { rowToTrack } from './captions';
import type { LanguageService } from './language';

/** Profiles kept in memory: the video on screen and a few the learner went back and forth between. */
const CACHED_PROFILES = 4;

export interface AnalysisDeps {
  db: () => PhasaDb;
  language: Pick<LanguageService, 'tokenize'>;
  dictionary: DictionaryStore;
  frequency: () => Promise<FrequencyList>;
  now: () => number;
}

export interface MarkNewInput {
  videoId: string;
  trackKey: string;
  /** English track to take the context's translation from. */
  englishKey?: string;
  status: WordStatus;
  /** Only these words (if they are new in the video). */
  words?: string[];
  /** Only the N best new words to learn (plan §7.4 "Add top 10 to learning"). */
  top?: number;
}

export interface AnalysisService {
  /** Null when the track isn't cached (it is once the page has loaded it). */
  analyze(videoId: string, trackKey: string): Promise<VideoAnalysis | null>;
  /** Sets the status of new words of the video; learning words get their first line as context. */
  markNew(input: MarkNewInput): Promise<VocabChange[] | null>;
  /** Word boundaries changed: profiles must be rebuilt. */
  invalidate(): void;
}

interface Cached {
  track: ProcessedTrack;
  profile: TrackProfile;
}

const graphemes = new Intl.Segmenter('th', { granularity: 'grapheme' });

/** Fallback when no pronunciation can be derived: about one syllable per 2.5 clusters. */
function estimateSyllables(word: string): number {
  return Math.max(1, Math.round([...graphemes.segment(word)].length / 2.5));
}

function snapshot(analysis: VideoAnalysis): VideoStats {
  const { trackKey, features, level, coverage, comprehension, knownTokens, newTokens } = analysis;
  const { unique, newHighFreq, newRare } = analysis;
  return {
    trackKey,
    features,
    level,
    coverage,
    comprehension,
    knownTokens,
    newTokens,
    unique,
    newHighFreq,
    newRare,
  };
}

export function createAnalysisService(deps: AnalysisDeps): AnalysisService {
  const { db, language, dictionary, frequency, now } = deps;
  /** Insertion order is recency order. */
  const cache = new Map<string, Promise<Cached | null>>();
  let generation = 0;

  async function loadTrack(videoId: string, key: string): Promise<ProcessedTrack | null> {
    const row = await db().captions.get([videoId, key]);
    if (row?.processingVersion !== PROCESSING_VERSION) return null;
    return rowToTrack(row);
  }

  async function build(track: ProcessedTrack): Promise<TrackProfile> {
    const tokens = await language.tokenize(
      track.cues.map((cue) =>
        cue.hints ? { text: cue.text, hints: cue.hints } : { text: cue.text },
      ),
    );
    const words = new Set<string>();
    for (const cue of tokens)
      for (const token of cue) if (token.kind === 'thai') words.add(token.text);
    const [entries, freq] = await Promise.all([dictionary.entries(words), frequency()]);
    return buildProfile({
      cues: track.cues,
      tokens,
      facts: (word) => {
        const entry = entries.get(word);
        const rank = freq.rank(word) ?? entry?.freqRank;
        const syllables =
          pronounce(word, entries, null)?.syllables.length ?? estimateSyllables(word);
        const gloss = entry?.senses[0]?.glosses[0];
        const romanization = entry?.romanization?.paiboon;
        return {
          inDictionary: entry !== undefined,
          isProperNoun: entry?.isProperNoun === true,
          syllables: Math.max(1, syllables),
          ...(rank === undefined ? {} : { rank }),
          ...(gloss ? { gloss } : {}),
          ...(romanization ? { romanization } : {}),
        };
      },
    });
  }

  function cached(videoId: string, trackKey: string): Promise<Cached | null> {
    const key = `${generation}\n${videoId}\n${trackKey}`;
    let entry = cache.get(key);
    if (entry) {
      cache.delete(key);
    } else {
      entry = loadTrack(videoId, trackKey).then(async (track) => {
        if (!track || !isThaiLanguage(track.languageCode) || track.translatedFrom) return null;
        return { track, profile: await build(track) };
      });
      // A failure (or a track not cached yet) is not remembered: the next call tries again.
      entry.then(
        (value) => {
          if (!value) cache.delete(key);
        },
        () => cache.delete(key),
      );
    }
    cache.set(key, entry);
    while (cache.size > CACHED_PROFILES) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
    return entry;
  }

  async function contextOf(
    track: ProcessedTrack,
    cueIndex: number,
    translations: readonly string[],
  ): Promise<ContextInput | undefined> {
    const cue = track.cues[cueIndex];
    if (!cue) return undefined;
    const video = await db().videos.get(track.videoId);
    const context: ContextInput = {
      videoId: track.videoId,
      videoTitle: video?.title ?? '',
      sentence: cue.text,
      cueStartMs: cue.startMs,
      cueEndMs: cue.endMs,
    };
    if (video?.channel) context.channel = video.channel;
    const translation = translations[cueIndex];
    if (translation) context.sentenceTranslation = translation;
    return context;
  }

  return {
    async analyze(videoId, trackKey) {
      // Installing the dictionary after an update takes seconds once; it is not analysis time.
      await dictionary.lexicon();
      const started = performance.now();
      const entry = await cached(videoId, trackKey);
      if (!entry) return null;
      const database = db();
      const statuses = await statusesOf(
        database,
        entry.profile.units.map((unit) => unit.thai),
      );
      const analysis: VideoAnalysis = {
        ...analyzeProfile(entry.profile, statuses, { videoId, trackKey }),
        analysisMs: performance.now() - started,
      };
      await database.videos.update(videoId, { stats: snapshot(analysis), analyzedAt: now() });
      return analysis;
    },

    async markNew(input) {
      const entry = await cached(input.videoId, input.trackKey);
      if (!entry) return null;
      const database = db();
      const statuses = await statusesOf(
        database,
        entry.profile.units.map((unit) => unit.thai),
      );
      let targets = newUnits(entry.profile, statuses, { all: input.top === undefined });
      if (input.words) {
        const wanted = new Set(input.words);
        targets = targets.filter((unit) => wanted.has(unit.thai));
      }
      if (input.top !== undefined) targets = targets.slice(0, input.top);
      if (targets.length === 0) return [];

      if (typeof input.status !== 'number') {
        return bulkSetWords(
          database,
          targets.map((unit) => unit.thai),
          input.status,
          'new-only',
          now(),
        );
      }
      // Words to learn are saved like a click in the subtitles: with the line they first occur in.
      const english = input.englishKey ? await loadTrack(input.videoId, input.englishKey) : null;
      const translations = english ? alignTranslation(entry.track.cues, english.cues) : [];
      const changes: VocabChange[] = [];
      for (const unit of targets) {
        const context = await contextOf(entry.track, unit.firstCue, translations);
        const saved = await setUnit(
          database,
          { kind: 'word', thai: unit.thai, status: input.status, ...(context ? { context } : {}) },
          now(),
        );
        changes.push({ kind: 'word', thai: saved.thai, status: saved.status });
      }
      return changes;
    },

    invalidate() {
      generation++;
      cache.clear();
    },
  };
}
