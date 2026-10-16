/**
 * URLs of YouTube's `/api/timedtext` endpoint (docs/decisions/0002-captions-source.md).
 *
 * A track's `baseUrl` (from the player response) is signed but has no PoToken.
 * The player's own request adds the PoToken (`pot`) and client parameters
 * (`c`, `cver`, …). Live check (docs/spikes.md §1, run 3): `baseUrl + pot`
 * alone returns an empty body, `baseUrl` + every extra parameter of the
 * player's request works for any track of the same video, including `tlang`.
 */

export const TIMEDTEXT_PATH = '/api/timedtext';

/** Parameters that select a track or format; never copied from a captured request. */
const TRACK_PARAMS = new Set(['lang', 'kind', 'tlang', 'fmt', 'name', 'vssid']);

export function isTimedtextUrl(url: string): boolean {
  return url.includes(TIMEDTEXT_PATH);
}

export interface TimedtextRequest {
  videoId: string | null;
  lang: string | null;
  kind: 'asr' | 'manual';
  tlang: string | null;
  fmt: string | null;
  hasPot: boolean;
}

export function describeTimedtextUrl(url: URL): TimedtextRequest {
  const params = url.searchParams;
  return {
    videoId: params.get('v'),
    lang: params.get('lang'),
    kind: params.get('kind') === 'asr' ? 'asr' : 'manual',
    tlang: params.get('tlang'),
    fmt: params.get('fmt'),
    hasPot: (params.get('pot') ?? '') !== '',
  };
}

/** The PoToken and client parameters of a captured request, relative to a track's `baseUrl`. */
export function sessionParams(captured: URL, baseUrl: URL): [string, string][] {
  return [...captured.searchParams].filter(
    ([name]) => !TRACK_PARAMS.has(name) && !baseUrl.searchParams.has(name),
  );
}

/** A json3 URL for a track (optionally machine-translated) with the session's PoToken. */
export function buildTrackUrl(
  baseUrl: URL,
  session: readonly [string, string][],
  tlang?: string,
): string {
  const url = new URL(baseUrl);
  for (const [name, value] of session) url.searchParams.set(name, value);
  url.searchParams.set('fmt', 'json3');
  if (tlang) url.searchParams.set('tlang', tlang);
  else url.searchParams.delete('tlang');
  return url.toString();
}
