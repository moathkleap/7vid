import { useState } from 'react';

/**
 * Local editable copy of a prop that resets whenever the prop changes (React's documented
 * "adjust state while rendering" pattern, no effects involved).
 */
export function useSyncedState<T>(value: T): [T, (v: T) => void] {
  const [draft, setDraft] = useState(value);
  const [prev, setPrev] = useState(value);
  if (prev !== value) {
    setPrev(value);
    setDraft(value);
  }
  return [draft, setDraft];
}
