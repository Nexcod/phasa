import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * A setting edited by a slider or a color picker: shown at once, saved once it rests for
 * `delayMs`, so dragging doesn't send a settings change (and a broadcast to every tab) per pixel.
 * A pending value is saved when the component goes away.
 */
export function useDraft<T>(
  value: T,
  commit: (next: T) => void,
  delayMs = 300,
): [T, (next: T) => void] {
  const [draft, setDraft] = useState<{ value: T } | null>(null);
  const pending = useRef<{ value: T } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const commitRef = useRef(commit);
  useEffect(() => {
    commitRef.current = commit;
  }, [commit]);

  const flush = useCallback(() => {
    clearTimeout(timer.current);
    const next = pending.current;
    pending.current = null;
    if (next) commitRef.current(next.value);
  }, []);

  useEffect(() => flush, [flush]);

  const set = useCallback(
    (next: T) => {
      setDraft({ value: next });
      pending.current = { value: next };
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        flush();
        setDraft(null);
      }, delayMs);
    },
    [delayMs, flush],
  );

  return [draft ? draft.value : value, set];
}
