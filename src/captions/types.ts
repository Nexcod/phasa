/** `asr` = YouTube auto-generated captions. */
export type TrackKind = 'manual' | 'asr';

export interface CaptionCue {
  startMs: number;
  endMs: number;
  text: string;
}
