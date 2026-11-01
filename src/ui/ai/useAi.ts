import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type {
  AiErrorInfo,
  AiProviderId,
  AiStatus,
  CueTranslation,
  ExplainWordParams,
  TranslateCueParams,
  WordExplanation,
} from '../../messaging/ai';
import type { Client } from '../../messaging/client';
import { RpcFailure } from '../../messaging/protocol';

/** Whether AI works now; follows `ai/changed` and service-worker restarts. */
export function useAiStatus(client: Client): AiStatus | null {
  const [status, setStatus] = useState<AiStatus | null>(null);
  useEffect(() => {
    let active = true;
    const load = () => {
      client.request('ai/status', {}).then(
        (next) => {
          if (active) setStatus(next);
        },
        () => undefined,
      );
    };
    const unsubscribe = client.onEvent((event) => {
      if (event.type === 'ai/changed') setStatus(event.status);
      else if (event.type === 'sw/hello') load();
    });
    load();
    return () => {
      active = false;
      unsubscribe();
    };
  }, [client]);
  return status;
}

export type AiKind = 'explain' | 'translate';
export type AiValue<K extends AiKind> = K extends 'explain' ? WordExplanation : CueTranslation;
export type AiParams<K extends AiKind> = K extends 'explain'
  ? Omit<ExplainWordParams, 'cachedOnly'>
  : Omit<TranslateCueParams, 'cachedOnly'>;

export type AnswerState<T> =
  /** Looking in the cache. */
  | { state: 'checking' }
  /** Nothing cached: the user may ask. */
  | { state: 'idle' }
  | { state: 'running'; partial: Partial<T>; provider?: AiProviderId }
  | {
      state: 'done';
      value: T;
      cached: boolean;
      provider: AiProviderId;
      model: string;
      /** Asked here: ms to the first streamed fields and to the whole answer (model choice). */
      timing?: { firstMs: number | null; totalMs: number };
    }
  | { state: 'error'; error: AiErrorInfo };

/** AI answers take seconds; this only catches a request nobody answers any more. */
const REQUEST_TIMEOUT_MS = 240_000;

/**
 * One AI answer: a cached one shows at once, a new one is asked for with `run` and streams in.
 * `key` identifies the question; a new key starts over.
 */
export function useAiAnswer<K extends AiKind>(
  client: Client,
  kind: K,
  params: AiParams<K>,
  key: string,
): { answer: AnswerState<AiValue<K>>; run: () => void } {
  type T = AiValue<K>;
  // The answer belongs to a question: another key reads as "checking" until its lookup is back.
  const [stored, setStored] = useState<{ key: string; answer: AnswerState<T> }>({
    key,
    answer: { state: 'checking' },
  });
  const answer: AnswerState<T> = stored.key === key ? stored.answer : { state: 'checking' };
  const paramsRef = useRef(params);
  const keyRef = useRef(key);
  useLayoutEffect(() => {
    paramsRef.current = params;
    keyRef.current = key;
  });
  const generation = useRef(0);

  const ask = useCallback(
    (cachedOnly: boolean, onProgress?: (partial: Partial<T>, provider: AiProviderId) => void) => {
      const request = { ...paramsRef.current, cachedOnly };
      const options = {
        timeoutMs: cachedOnly ? 15_000 : REQUEST_TIMEOUT_MS,
        onProgress: (progress: { partial: Partial<T>; provider: AiProviderId }) =>
          onProgress?.(progress.partial, progress.provider),
      };
      return kind === 'explain'
        ? client.request('ai/explain-word', request as ExplainWordParams, options as never)
        : client.request('ai/translate-cue', request, options as never);
    },
    [client, kind],
  );

  useEffect(() => {
    const current = ++generation.current;
    const setAnswer = (next: AnswerState<T>) => setStored({ key, answer: next });
    ask(true).then(
      (result) => {
        if (current !== generation.current) return;
        setAnswer(
          result.status === 'ok'
            ? {
                state: 'done',
                value: result.value as T,
                cached: true,
                provider: result.provider,
                model: result.model,
              }
            : { state: 'idle' },
        );
      },
      () => {
        if (current === generation.current) setAnswer({ state: 'idle' });
      },
    );
  }, [ask, key]);

  const run = useCallback(() => {
    const current = ++generation.current;
    const question = keyRef.current;
    const setAnswer = (next: AnswerState<T>) => setStored({ key: question, answer: next });
    setAnswer({ state: 'running', partial: {} });
    const started = performance.now();
    let firstMs: number | null = null;
    ask(false, (partial, provider) => {
      if (current !== generation.current) return;
      if (firstMs === null && Object.keys(partial).length > 0) {
        firstMs = Math.round(performance.now() - started);
      }
      setAnswer({ state: 'running', partial, provider });
    }).then(
      (result) => {
        if (current !== generation.current) return;
        if (result.status === 'ok') {
          setAnswer({
            state: 'done',
            value: result.value as T,
            cached: result.cached,
            provider: result.provider,
            model: result.model,
            timing: { firstMs, totalMs: Math.round(performance.now() - started) },
          });
        } else if (result.status === 'error') {
          setAnswer({ state: 'error', error: result.error });
        } else {
          setAnswer({ state: 'idle' });
        }
      },
      (error: unknown) => {
        if (current !== generation.current) return;
        const detail = error instanceof RpcFailure ? error.message : String(error);
        setAnswer({
          state: 'error',
          error: {
            code: error instanceof RpcFailure && error.code === 'timeout' ? 'timeout' : 'network',
            provider: 'chatgpt-plan',
            detail,
          },
        });
      },
    );
  }, [ask]);

  return { answer, run };
}
