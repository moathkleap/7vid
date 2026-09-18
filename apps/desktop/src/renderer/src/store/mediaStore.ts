import { create } from 'zustand';
import type { AssetInfo } from '@sevenvid/ipc';
import { getApi } from '../api/client';
import { useAppStore } from './appStore';

interface MediaState {
  assets: Record<string, AssetInfo>;
  loadedFor: string | null | undefined;
  loading: boolean;
  urls: Record<string, string | null>;
  load(projectId: string | null): Promise<void>;
  refreshOne(assetId: string): Promise<void>;
  urlFor(path: string | null | undefined): Promise<string | null>;
  importPaths(paths: string[], projectId: string | null): Promise<{ imported: number; skipped: Array<{ path: string; reason: string }> }>;
}

let subscribed = false;

export const useMediaStore = create<MediaState>((set, get) => ({
  assets: {},
  loadedFor: undefined,
  loading: false,
  urls: {},
  async load(projectId) {
    if (!subscribed) {
      subscribed = true;
      getApi().subscribe('assets.changed', (e) => {
        if (e.reason === 'removed') {
          set((s) => {
            const next = { ...s.assets };
            delete next[e.assetId];
            return { assets: next };
          });
        } else void get().refreshOne(e.assetId);
      });
    }
    set({ loading: true });
    try {
      const list = await getApi().invoke('media.list', { projectId, includeLibrary: projectId != null });
      set({ assets: Object.fromEntries(list.map((a) => [a.id, a])), loadedFor: projectId, loading: false });
    } catch (err) {
      set({ loading: false });
      useAppStore.getState().reportError(err);
    }
  },
  async refreshOne(assetId) {
    try {
      const a = await getApi().invoke('media.get', { assetId });
      if (a) set((s) => ({ assets: { ...s.assets, [assetId]: a } }));
    } catch {
      /* removed meanwhile */
    }
  },
  async urlFor(path) {
    if (!path) return null;
    const cached = get().urls[path];
    if (cached !== undefined) return cached;
    try {
      const { url } = await getApi().invoke('media.url', { path });
      set((s) => ({ urls: { ...s.urls, [path]: url } }));
      return url;
    } catch {
      return null;
    }
  },
  async importPaths(paths, projectId) {
    const r = await getApi().invoke('media.import', { paths, projectId });
    set((s) => ({ assets: { ...s.assets, ...Object.fromEntries(r.assets.map((a) => [a.id, a])) } }));
    return { imported: r.assets.length - r.skipped.filter((x) => x.reason === 'duplicate').length, skipped: r.skipped };
  },
}));
