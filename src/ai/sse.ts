/** Server-sent events (the Responses API stream), per the HTML spec's parsing rules. */

export interface SseMessage {
  event?: string;
  data: string;
}

/** Splits a text stream into messages; chunk boundaries may fall anywhere, also inside `\r\n`. */
export async function* parseSse(chunks: AsyncIterable<string>): AsyncGenerator<SseMessage> {
  let buffer = '';
  let data: string[] = [];
  let event: string | undefined;
  let pendingCr = false;

  function* line(text: string): Generator<SseMessage> {
    if (text === '') {
      if (data.length > 0) {
        const message: SseMessage = { data: data.join('\n') };
        if (event !== undefined) message.event = event;
        yield message;
      }
      data = [];
      event = undefined;
      return;
    }
    if (text.startsWith(':')) return;
    const colon = text.indexOf(':');
    const field = colon < 0 ? text : text.slice(0, colon);
    let value = colon < 0 ? '' : text.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'data') data.push(value);
    else if (field === 'event') event = value;
  }

  for await (const chunk of chunks) {
    let text = chunk;
    // A "\r" that ended the previous chunk already ended its line; skip the "\n" of "\r\n".
    if (pendingCr && text.startsWith('\n')) text = text.slice(1);
    pendingCr = false;
    buffer += text;
    for (;;) {
      const match = /\r\n|\r|\n/.exec(buffer);
      if (!match) break;
      if (match[0] === '\r' && match.index === buffer.length - 1) pendingCr = true;
      const current = buffer.slice(0, match.index);
      buffer = buffer.slice(match.index + match[0].length);
      yield* line(current);
    }
  }
  if (buffer !== '') yield* line(buffer);
  yield* line('');
}

/** UTF-8 text of a fetch body, chunk by chunk; an abort stops a read that is waiting. */
export async function* textChunks(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const decoder = new TextDecoderStream() as unknown as ReadableWritablePair<string, Uint8Array>;
  const reader = body.pipeThrough(decoder).getReader();
  const onAbort = () => void reader.cancel().catch(() => undefined);
  signal?.addEventListener('abort', onAbort);
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (signal?.aborted) throw new DOMException('The stream was aborted', 'AbortError');
      if (done) return;
      yield value;
    }
  } finally {
    signal?.removeEventListener('abort', onAbort);
    // Stopped early (an error event, an abort): drop the rest of the response.
    await reader.cancel().catch(() => undefined);
  }
}
