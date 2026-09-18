import { useCallback, useState } from 'react';
import { getApi } from '@/api/client';
import { useAppStore } from '@/store/appStore';

type Kind = 'media' | 'video' | 'image' | 'audio' | 'subtitle' | 'any';

/**
 * Opens the native file dialog when the host provides one; otherwise falls back to the in-app browser.
 * Returns the selected paths through the promise in both cases.
 */
export function usePickFiles(): { pick: (kind?: Kind, multiple?: boolean) => Promise<string[]>; browserOpen: boolean; onBrowserSelect: (paths: string[]) => void; onBrowserClose: () => void } {
  const [browserOpen, setBrowserOpen] = useState(false);
  const [resolver, setResolver] = useState<((paths: string[]) => void) | null>(null);
  const pick = useCallback(async (kind: Kind = 'media', multiple = true) => {
    try {
      const r = await getApi().invoke('dialog.pickFiles', { kind, multiple });
      if (r.native) return r.paths;
    } catch (err) {
      useAppStore.getState().reportError(err);
      return [];
    }
    return new Promise<string[]>((resolve) => {
      setResolver(() => resolve);
      setBrowserOpen(true);
    });
  }, []);
  const onBrowserSelect = useCallback((paths: string[]) => {
    setBrowserOpen(false);
    resolver?.(paths);
    setResolver(null);
  }, [resolver]);
  const onBrowserClose = useCallback(() => {
    setBrowserOpen(false);
    resolver?.([]);
    setResolver(null);
  }, [resolver]);
  return { pick, browserOpen, onBrowserSelect, onBrowserClose };
}
