// Phasa captions spike (docs/spikes.md §1). MAIN world, document_start.
//
// On every /watch page it:
//   1. records the player's own /api/timedtext requests (fetch + XHR);
//   2. if no Thai request happens within 2 s, turns Thai captions on via the
//      player API and measures how long the request takes to appear;
//   3. probes which URL variants still work with the captured PoToken (`pot`).
// Results: console (filter "[phasa-spike]") and `phasaSpike.report()`.
//
// Console API (window.phasaSpike): tracks(), enableThai(), hideNative(bool),
// probe(), report(), save() — save() downloads the Thai json3 body for
// `npm run spike:cues`.
(() => {
  const TAG = '[phasa-spike]';
  const AUTO = localStorage.getItem('phasa-spike:auto') !== 'off';
  const nativeFetch = window.fetch.bind(window);
  const SECRET_PARAMS = ['pot', 'signature', 'sig', 'ei', 'key', 'ip'];

  /** @type {{ videoId: string | null, startedAt: number, playerReadyAt: number | null, enabledAt: number | null, captured: any[], probes: any[], notes: string[] }} */
  let session = newSession(null);

  function newSession(videoId) {
    return {
      videoId,
      startedAt: performance.now(),
      playerReadyAt: null,
      enabledAt: null,
      captured: [],
      probes: [],
      notes: [],
    };
  }

  const isThaiCapture = (c) => c.params.v === session.videoId && c.params.lang === 'th';
  const isTimedtext = (url) => typeof url === 'string' && url.includes('/api/timedtext');
  const ms = (t) => (t === null ? null : Math.round(t - session.startedAt));

  function describe(urlString) {
    const p = new URL(urlString, location.href).searchParams;
    return {
      v: p.get('v'),
      lang: p.get('lang'),
      kind: p.get('kind') ?? 'manual',
      fmt: p.get('fmt'),
      tlang: p.get('tlang'),
      hasPot: p.has('pot'),
      potLength: p.get('pot')?.length ?? 0,
      potc: p.get('potc'),
      c: p.get('c'),
    };
  }

  function redact(urlString) {
    const url = new URL(urlString, location.href);
    for (const name of SECRET_PARAMS)
      if (url.searchParams.has(name)) url.searchParams.set(name, '…');
    return url.toString();
  }

  function bodyText(xhr) {
    if (xhr.responseType === '' || xhr.responseType === 'text') return xhr.responseText;
    if (xhr.response instanceof ArrayBuffer) return new TextDecoder().decode(xhr.response);
    if (typeof xhr.response === 'string') return xhr.response;
    return JSON.stringify(xhr.response ?? '');
  }

  function record(via, url, status, body) {
    const entry = {
      atMs: ms(performance.now()),
      via,
      url,
      status,
      bytes: body.length,
      params: describe(url),
      body,
    };
    session.captured.push(entry);
    console.log(TAG, `captured ${via} ${status} ${entry.bytes} B`, entry.params);
    window.dispatchEvent(new CustomEvent('phasa-spike:captured'));
  }

  // --- Interception -------------------------------------------------------
  window.fetch = async function (input, init) {
    const url =
      typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
    const response = await nativeFetch(input, init);
    if (isTimedtext(url)) {
      response
        .clone()
        .text()
        .then((body) => record('fetch', url, response.status, body))
        .catch((error) => console.warn(TAG, 'could not read fetch body', error));
    }
    return response;
  };

  const { open, send } = XMLHttpRequest.prototype;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__phasaUrl = String(url);
    return open.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function (...args) {
    if (isTimedtext(this.__phasaUrl)) {
      this.addEventListener('load', () =>
        record('xhr', this.__phasaUrl, this.status, bodyText(this)),
      );
    }
    return send.apply(this, args);
  };

  // --- Player helpers -----------------------------------------------------
  const player = () => document.getElementById('movie_player');

  function playerVideoId() {
    return player()?.getPlayerResponse?.()?.videoDetails?.videoId ?? null;
  }

  function tracks() {
    const response = player()?.getPlayerResponse?.();
    const list = response?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
    return list.map((t) => ({
      languageCode: t.languageCode,
      kind: t.kind ?? 'manual',
      vssId: t.vssId,
      name: t.name?.simpleText ?? t.name?.runs?.map((r) => r.text).join('') ?? '',
      isTranslatable: Boolean(t.isTranslatable),
      baseUrlHasPot: t.baseUrl.includes('pot='),
      baseUrl: t.baseUrl,
    }));
  }

  function pickThai(list) {
    return (
      list.find((t) => t.languageCode === 'th' && t.kind !== 'asr') ??
      list.find((t) => t.languageCode === 'th')
    );
  }

  function enableThai() {
    const p = player();
    if (!p?.setOption) throw new Error('player API not available');
    p.loadModule?.('captions');
    const internal = p.getOption?.('captions', 'tracklist') ?? [];
    const target = internal.find((t) => t.languageCode === 'th' && t.kind !== 'asr') ??
      internal.find((t) => t.languageCode === 'th') ?? { languageCode: 'th' };
    p.setOption('captions', 'track', target);
    session.enabledAt = performance.now();
    const summary = {
      internalTracks: internal.length,
      chosen: { languageCode: target.languageCode, kind: target.kind ?? 'manual' },
    };
    console.log(TAG, 'enableThai()', summary);
    return summary;
  }

  let hideStyle = null;
  function hideNative(hide = true) {
    if (hide && !hideStyle) {
      hideStyle = document.createElement('style');
      hideStyle.textContent = '.ytp-caption-window-container { display: none !important; }';
      document.documentElement.append(hideStyle);
    } else if (!hide && hideStyle) {
      hideStyle.remove();
      hideStyle = null;
    }
    return hide;
  }

  // --- Probing ------------------------------------------------------------
  function parseStats(text) {
    const trimmed = text.trimStart();
    if (trimmed === '') return { format: 'empty', cues: 0 };
    if (trimmed.startsWith('{')) {
      try {
        const json = JSON.parse(trimmed);
        const events = (json.events ?? []).filter((e) =>
          e.segs?.some((s) => (s.utf8 ?? '').trim()),
        );
        const sample = events.slice(0, 2).map((e) => e.segs.map((s) => s.utf8).join(''));
        return { format: 'json3', cues: events.length, sample };
      } catch {
        return { format: 'bad-json', cues: 0 };
      }
    }
    if (trimmed.startsWith('WEBVTT'))
      return { format: 'vtt', cues: (text.match(/-->/g) ?? []).length };
    if (trimmed.startsWith('<')) return { format: 'xml', cues: (text.match(/<p\b/g) ?? []).length };
    return { format: 'unknown', cues: 0 };
  }

  function variant(base, changes) {
    const url = new URL(base, location.href);
    for (const [name, value] of Object.entries(changes)) {
      if (value === null) url.searchParams.delete(name);
      else url.searchParams.set(name, value);
    }
    return url.toString();
  }

  async function probe() {
    const thaiCapture = [...session.captured]
      .reverse()
      .find((c) => isThaiCapture(c) && c.params.hasPot);
    if (!thaiCapture) throw new Error('no captured Thai timedtext request with pot yet');
    const base = thaiCapture.url;
    const src = new URL(base, location.href).searchParams;
    const potParams = {
      pot: src.get('pot'),
      potc: src.get('potc'),
      c: src.get('c'),
      cver: src.get('cver'),
    };
    const all = tracks();
    const thai = pickThai(all);
    const other = all.find((t) => t.vssId !== thai?.vssId);

    /** @type {[string, string][]} */
    const cases = [
      ['as captured', base],
      ['fmt=json3', variant(base, { fmt: 'json3' })],
      ['fmt=srv3', variant(base, { fmt: 'srv3' })],
      ['fmt=vtt', variant(base, { fmt: 'vtt' })],
      ['tlang=en, fmt=json3', variant(base, { tlang: 'en', fmt: 'json3' })],
      ['no pot, fmt=json3', variant(base, { pot: null, potc: null, fmt: 'json3' })],
    ];
    if (thai)
      cases.push([
        'thai baseUrl + captured pot',
        variant(thai.baseUrl, { ...potParams, fmt: 'json3' }),
      ]);
    if (other) {
      cases.push([
        `swap lang → ${other.languageCode}/${other.kind}`,
        variant(base, {
          lang: other.languageCode,
          kind: other.kind === 'asr' ? 'asr' : null,
          fmt: 'json3',
        }),
      ]);
      cases.push([
        `${other.languageCode}/${other.kind} baseUrl + captured pot`,
        variant(other.baseUrl, { ...potParams, fmt: 'json3' }),
      ]);
    }

    const results = [];
    for (const [name, url] of cases) {
      const started = performance.now();
      try {
        const response = await nativeFetch(url, { credentials: 'include' });
        const text = await response.text();
        results.push({
          case: name,
          status: response.status,
          bytes: text.length,
          ms: Math.round(performance.now() - started),
          ...parseStats(text),
        });
      } catch (error) {
        results.push({ case: name, status: 'error', error: String(error) });
      }
    }
    session.probes = results;
    console.log(TAG, 'probe results');
    console.table(results.map(({ sample: _sample, ...row }) => row));
    return results;
  }

  function report() {
    const firstThai = session.captured.find((c) => isThaiCapture(c));
    return {
      spike: 'captions',
      at: new Date().toISOString(),
      userAgent: navigator.userAgent,
      videoId: session.videoId,
      title: document.title.replace(/ - YouTube$/, ''),
      tracks: tracks().map(({ baseUrl: _baseUrl, ...t }) => t),
      timing: {
        playerReadyMs: ms(session.playerReadyAt),
        enabledThaiMs: ms(session.enabledAt),
        firstThaiCaptureMs: firstThai?.atMs ?? null,
        captureAfterPlayerReadyMs:
          firstThai && session.playerReadyAt !== null
            ? firstThai.atMs - ms(session.playerReadyAt)
            : null,
      },
      captured: session.captured.map(({ body: _body, url, ...c }) => ({ ...c, url: redact(url) })),
      probes: session.probes,
      notes: session.notes,
    };
  }

  function save() {
    const thai = [...session.captured].reverse().find((c) => isThaiCapture(c) && c.body);
    if (!thai) throw new Error('nothing captured yet');
    if (thai.params.fmt !== 'json3') console.warn(TAG, 'saved body is not json3:', thai.params.fmt);
    const blob = new Blob([thai.body], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${session.videoId}.th.${thai.params.fmt ?? 'raw'}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    return a.download;
  }

  window.phasaSpike = {
    tracks,
    enableThai,
    hideNative,
    probe,
    report,
    save,
    session: () => session,
  };

  // --- Auto run per watch page -------------------------------------------
  const sleep = (t) => new Promise((resolve) => setTimeout(resolve, t));

  function waitFor(predicate, timeoutMs, intervalMs = 100) {
    return new Promise((resolve) => {
      const started = performance.now();
      const tick = () => {
        const value = predicate();
        if (value || performance.now() - started > timeoutMs) resolve(value);
        else setTimeout(tick, intervalMs);
      };
      tick();
    });
  }

  let runId = 0;
  async function onWatchPage() {
    const videoId = new URL(location.href).searchParams.get('v');
    if (location.pathname !== '/watch' || !videoId || videoId === session.videoId) return;
    const myRun = ++runId;
    const carried = session.captured.filter((c) => c.params.v === videoId); // requests that beat navigation
    session = newSession(videoId);
    session.captured.push(...carried);
    console.log(TAG, 'watch page', videoId);

    const ready = await waitFor(() => playerVideoId() === videoId, 15000);
    if (myRun !== runId) return;
    if (!ready) {
      session.notes.push('player did not report this videoId within 15 s');
      return;
    }
    session.playerReadyAt = performance.now();
    const all = tracks();
    const thai = pickThai(all);
    console.log(
      TAG,
      'tracks',
      all.map(({ baseUrl: _b, ...t }) => t),
    );
    if (!thai) {
      session.notes.push('no Thai track → "No Thai subtitles"');
      console.log(TAG, 'no Thai track');
      return;
    }
    if (!AUTO) return;

    const hasThai = () => session.captured.some((c) => isThaiCapture(c));
    if (!(await waitFor(hasThai, 2000))) {
      enableThai();
      hideNative(true);
      if (!(await waitFor(hasThai, 8000))) {
        session.notes.push('no timedtext request within 8 s after enableThai()');
        console.warn(TAG, 'Thai track did not load');
        return;
      }
    }
    if (myRun !== runId) return;
    await sleep(300);
    await probe().catch((error) => session.notes.push(`probe failed: ${error.message}`));
    console.log(TAG, 'report (copy into docs/spikes.md):', JSON.stringify(report(), null, 2));
  }

  document.addEventListener('yt-navigate-finish', () => void onWatchPage());
  window.addEventListener('popstate', () => void onWatchPage());
  setInterval(() => void onWatchPage(), 1000); // fallback when the event is missed
})();
