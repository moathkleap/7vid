import { useEffect } from 'react';
import { useMediaStore } from '@/store/mediaStore';

/** Resolves a local file path to a URL the renderer may load (custom protocol in Electron, HTTP in browser mode). */
export function useMediaUrl(path: string | null | undefined): string | null {
  const cached = useMediaStore((s) => (path ? s.urls[path] : undefined));
  const urlFor = useMediaStore((s) => s.urlFor);
  useEffect(() => {
    if (path && cached === undefined) void urlFor(path);
  }, [path, cached, urlFor]);
  return path ? (cached ?? null) : null;
}
