/**
 * Service-worker side of captions: parse, normalize and cache bodies fetched
 * in the page (docs/plan.md §3.2 rule 5: heavy processing in the SW).
 */
import { MAX_BODY_CHARS, isVideoId, parseTrackRef } from '../captions/bridge';
import { CaptionParseError } from '../captions/parse';
import { isThaiLanguage, processTrack } from '../captions/process';
import { chooseThaiTrack } from '../captions/tracks';
import { PROCESSING_VERSION, trackKey, type ProcessedTrack } from '../captions/types';
import type { PhasaDb } from '../db/db';
import type { CaptionTrackRow } from '../db/types';
import {
  RpcFailure,
  type CaptionsProcessParams,
  type CaptionsProcessResult,
} from '../messaging/protocol';

const MAX_ITEMS = 6;

export function rowToTrack(row: CaptionTrackRow): ProcessedTrack {
  const track: ProcessedTrack = {
    videoId: row.videoId,
    key: row.vssId,
    languageCode: row.languageCode,
    kind: row.trackKind,
    cues: row.cues,
    fetchedAt: row.fetchedAt,
    processingVersion: row.processingVersion,
  };
  if (row.translatedFrom !== undefined) track.translatedFrom = row.translatedFrom;
  return track;
}

export function trackToRow(track: ProcessedTrack): CaptionTrackRow {
  const row: CaptionTrackRow = {
    videoId: track.videoId,
    vssId: track.key,
    languageCode: track.languageCode,
    trackKind: track.kind,
    cues: track.cues,
    fetchedAt: track.fetchedAt,
    processingVersion: track.processingVersion,
  };
  if (track.translatedFrom !== undefined) row.translatedFrom = track.translatedFrom;
  return row;
}

export async function getCachedTracks(db: PhasaDb, videoId: unknown): Promise<ProcessedTrack[]> {
  if (!isVideoId(videoId)) throw new RpcFailure('bad_request', 'Invalid videoId');
  const rows = await db.captions.where('videoId').equals(videoId).toArray();
  return rows.filter((row) => row.processingVersion === PROCESSING_VERSION).map(rowToTrack);
}

function badRequest(message: string): never {
  throw new RpcFailure('bad_request', message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateItem(value: unknown): CaptionsProcessParams['items'][number] {
  if (!isRecord(value)) badRequest('Invalid item');
  const ref = parseTrackRef(value.ref);
  if (!ref) badRequest('Invalid track ref');
  const { languageCode, kind, body } = value;
  if (typeof languageCode !== 'string' || languageCode.length > 20)
    badRequest('Invalid languageCode');
  if (kind !== 'manual' && kind !== 'asr') badRequest('Invalid kind');
  if (typeof body !== 'string' || body.length > MAX_BODY_CHARS) badRequest('Invalid body');
  return { ref, languageCode, kind, body };
}

/** Params come from a content script: validate every field. */
export function validateProcessParams(params: unknown): CaptionsProcessParams {
  if (!isRecord(params) || !isRecord(params.video)) badRequest('Invalid video');
  const { videoId, title, channel, durationSec } = params.video;
  if (!isVideoId(videoId) || typeof title !== 'string' || typeof channel !== 'string') {
    badRequest('Invalid video');
  }
  if (typeof durationSec !== 'number' || !Number.isFinite(durationSec))
    badRequest('Invalid durationSec');
  const { items } = params;
  if (!Array.isArray(items) || items.length === 0 || items.length > MAX_ITEMS)
    badRequest('Invalid items');
  return {
    video: {
      videoId,
      title: title.slice(0, 1000),
      channel: channel.slice(0, 500),
      durationSec: Math.max(0, durationSec),
    },
    items: (items as unknown[]).map(validateItem),
  };
}

export async function processAndStore(
  db: PhasaDb,
  params: CaptionsProcessParams,
  now: number,
): Promise<CaptionsProcessResult> {
  const { video } = params;
  const tracks: ProcessedTrack[] = [];
  const failed: CaptionsProcessResult['failed'] = [];
  for (const item of params.items) {
    try {
      tracks.push(
        processTrack({
          videoId: video.videoId,
          ref: item.ref,
          languageCode: item.languageCode,
          kind: item.kind,
          body: item.body,
          fetchedAt: now,
        }),
      );
    } catch (error) {
      if (!(error instanceof CaptionParseError)) throw error;
      failed.push({ key: trackKey(item.ref), error: error.message });
    }
  }

  await db.transaction('rw', db.captions, db.videos, async () => {
    await db.captions.bulkPut(tracks.map(trackToRow));
    const thai = (await db.captions.where('videoId').equals(video.videoId).toArray())
      .filter(
        (row) => row.processingVersion === PROCESSING_VERSION && isThaiLanguage(row.languageCode),
      )
      .map(rowToTrack);
    const chosen = chooseThaiTrack(thai);
    if (!chosen) return;
    const existing = await db.videos.get(video.videoId);
    await db.videos.put({
      ...existing,
      videoId: video.videoId,
      title: video.title,
      channel: video.channel,
      durationSec: video.durationSec,
      trackKind: chosen.kind,
    });
  });
  return { tracks, failed };
}
