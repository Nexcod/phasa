import { describe, expect, it } from 'vitest';
import type { ProcessedCue } from '@/src/captions/types';
import { hotkeyFor, type KeyLike } from '@/src/content/hotkeys';
import { AUTO_PAUSE_LEAD_MS, PlaybackSync, anchorIndex } from '@/src/content/playback';

/** Enough of HTMLVideoElement for PlaybackSync; frames are delivered by `frame()`. */
class FakeVideo extends EventTarget {
  currentTime = 0;
  paused = true;
  seeking = false;
  playbackRate = 1;
  private callbacks = new Map<number, (now: number, metadata: { mediaTime: number }) => void>();
  private nextHandle = 1;

  requestVideoFrameCallback(
    callback: (now: number, metadata: { mediaTime: number }) => void,
  ): number {
    const handle = this.nextHandle++;
    this.callbacks.set(handle, callback);
    return handle;
  }
  cancelVideoFrameCallback(handle: number): void {
    this.callbacks.delete(handle);
  }
  play(): Promise<void> {
    this.paused = false;
    this.dispatchEvent(new Event('play'));
    return Promise.resolve();
  }
  pause(): void {
    this.paused = true;
    this.dispatchEvent(new Event('pause'));
  }
  seek(ms: number): void {
    this.currentTime = ms / 1000;
    this.dispatchEvent(new Event('seeking'));
    this.dispatchEvent(new Event('seeked'));
  }
  /** A presented frame at `ms`. */
  frame(ms: number): void {
    this.currentTime = ms / 1000;
    this.present(ms);
  }
  /** A frame at `ms` presented while `currentTime` stays, like the picture shown after a seek. */
  present(ms: number): void {
    const pending = [...this.callbacks.values()];
    this.callbacks.clear();
    for (const callback of pending) callback(0, { mediaTime: ms / 1000 });
  }
}

const cues: ProcessedCue[] = [
  { startMs: 1000, endMs: 3000, text: 'หนึ่ง' },
  { startMs: 3000, endMs: 5000, text: 'สอง' },
  { startMs: 8000, endMs: 9000, text: 'สาม' },
];

function setup(options: { autoPause?: boolean; suspended?: boolean } = {}) {
  const video = new FakeVideo();
  const indices: number[] = [];
  const sync = new PlaybackSync(video as unknown as HTMLVideoElement, {
    cues: () => cues,
    autoPause: () => options.autoPause ?? false,
    suspended: () => options.suspended ?? false,
    onActiveIndex: (index) => indices.push(index),
  });
  return { video, sync, indices };
}

describe('PlaybackSync', () => {
  it('follows presented frames and leaves gaps empty', async () => {
    const { video, indices } = setup();
    await video.play();
    for (const ms of [500, 1000, 2990, 3000, 6000, 8500]) video.frame(ms);
    expect(indices).toEqual([0, 1, -1, 2]);
  });

  it('updates on seeks while paused (no frames needed)', () => {
    const { video, sync } = setup();
    video.seek(4000);
    expect(sync.index).toBe(1);
  });

  it('auto-pauses just before the end of a cue reached while playing', async () => {
    const { video } = setup({ autoPause: true });
    await video.play();
    video.frame(1100);
    video.frame(2000);
    expect(video.paused).toBe(false);
    video.frame(3000 - AUTO_PAUSE_LEAD_MS);
    expect(video.paused).toBe(true);
    expect(video.currentTime * 1000).toBeLessThan(3000);

    // Resuming right at the pause point does not pause again.
    await video.play();
    video.frame(2960);
    expect(video.paused).toBe(false);
    // The next cue pauses as usual.
    video.frame(3100);
    video.frame(5000 - AUTO_PAUSE_LEAD_MS);
    expect(video.paused).toBe(true);
  });

  it('re-arms when a cue is repeated while playing', async () => {
    const { video } = setup({ autoPause: true });
    await video.play();
    video.frame(1100);
    video.frame(2950);
    expect(video.paused).toBe(true);
    video.seek(1001);
    await video.play();
    video.frame(1200);
    video.frame(2950);
    expect(video.paused).toBe(true);
  });

  it('shows nothing and never pauses while suspended (ads)', async () => {
    const { video, indices } = setup({ autoPause: true, suspended: true });
    await video.play();
    video.frame(2950);
    expect(indices).toEqual([]);
    expect(video.paused).toBe(false);
  });

  it('ignores a frame presented while a seek is in progress', async () => {
    const { video, sync } = setup();
    await video.play();
    video.frame(1500);
    video.currentTime = 8.5;
    video.seeking = true;
    video.dispatchEvent(new Event('seeking'));
    expect(sync.index).toBe(2);
    video.frame(1533); // stale frame from before the seek
    expect(sync.index).toBe(2);
  });

  it('keeps the cue a paused seek landed in when the frame shown starts before it', () => {
    const { video, sync } = setup();
    video.seek(3001);
    expect(sync.index).toBe(1);
    video.present(2967); // the last frame at or before the seek target
    expect(sync.index).toBe(1);
  });

  it('does not flash the previous cue after a seek while playing', async () => {
    const { video, indices } = setup();
    await video.play();
    video.frame(1500);
    video.seek(3001);
    video.present(2967);
    video.frame(3033);
    expect(indices).toEqual([0, 1]);
  });

  it('forgets the seek target when the media changes', async () => {
    const { video, sync } = setup();
    video.seek(8001);
    video.currentTime = 0;
    video.dispatchEvent(new Event('emptied'));
    await video.play();
    video.frame(1500);
    expect(sync.index).toBe(0);
  });

  it('stops listening when stopped', async () => {
    const { video, sync, indices } = setup();
    sync.stop();
    await video.play();
    video.frame(1500);
    expect(indices).toEqual([]);
  });

  it('navigates from the cue that started, tolerating seek rounding', () => {
    expect(anchorIndex(cues, 0)).toBe(-1);
    expect(anchorIndex(cues, 2999.99)).toBe(1);
    expect(anchorIndex(cues, 6000)).toBe(1);
  });
});

describe('hotkeyFor', () => {
  const key = (code: string, extra: Partial<KeyLike> = {}): KeyLike => ({
    code,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    repeat: false,
    target: null,
    ...extra,
  });

  it('maps physical keys, whatever the keyboard layout', () => {
    expect(hotkeyFor(key('KeyA'))).toBe('prev');
    expect(hotkeyFor(key('KeyD'))).toBe('next');
    expect(hotkeyFor(key('KeyS'))).toBe('repeat');
    expect(hotkeyFor(key('Space'))).toBe('toggle-play');
    expect(hotkeyFor(key('KeyT'))).toBe('toggle-translation');
    expect(hotkeyFor(key('KeyF'))).toBeNull();
  });

  it('leaves shortcuts with modifiers and held Space to the browser', () => {
    expect(hotkeyFor(key('KeyA', { ctrlKey: true }))).toBeNull();
    expect(hotkeyFor(key('KeyT', { shiftKey: true }))).toBeNull();
    expect(hotkeyFor(key('Space', { repeat: true }))).toBeNull();
    expect(hotkeyFor(key('KeyD', { repeat: true }))).toBe('next');
  });
});
