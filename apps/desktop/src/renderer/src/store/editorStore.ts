import { create } from 'zustand';
import { frameDurationMs, snapToFrame, type Fraction, type NormBox } from '@sevenvid/core';

export type EditorTool = 'select' | 'razor';
export type ToolTab = 'inspector' | 'audio' | 'privacy' | 'subtitles' | 'text' | 'enhance';

export interface CompareState {
  startMs: number;
  endMs: number;
  beforeUrl: string;
  afterUrl: string;
  bypassed: { effects: number; masks: number; audioEffects: number };
}

export interface RenderedPreview {
  path: string;
  url: string;
  startMs: number;
  endMs: number;
  hash: string;
}

interface EditorState {
  playheadMs: number;
  playing: boolean;
  rate: number;
  durationMs: number;
  fps: Fraction;
  selection: string[];
  inMs: number | null;
  outMs: number | null;
  pxPerMs: number;
  scrollMs: number;
  snap: boolean;
  tool: EditorTool;
  previewMode: 'live' | 'rendered';
  renderedPreview: RenderedPreview | null;
  previewTaskId: string | null;
  unplayableAssets: Record<string, boolean>;
  toolTab: ToolTab;
  selectedMaskId: string | null;
  showMasks: boolean;
  /** Region drawing on the preview (privacy tool): active flag and the last drawn box in sequence coordinates. */
  maskDraw: { active: boolean; box: NormBox | null };
  compare: CompareState | null;
  setToolTab(tab: ToolTab): void;
  selectMask(id: string | null): void;
  setShowMasks(v: boolean): void;
  setMaskDraw(v: { active: boolean; box: NormBox | null }): void;
  setCompare(c: CompareState | null): void;
  setContext(durationMs: number, fps: Fraction): void;
  setPlayhead(ms: number, opts?: { snap?: boolean }): void;
  play(): void;
  pause(): void;
  togglePlay(): void;
  stop(): void;
  setRate(rate: number): void;
  stepFrames(n: number): void;
  select(ids: string[], additive?: boolean): void;
  clearSelection(): void;
  setInOut(inMs: number | null, outMs: number | null): void;
  setZoom(pxPerMs: number, anchorMs?: number, anchorPx?: number): void;
  zoomToFit(widthPx: number): void;
  setScroll(ms: number): void;
  toggleSnap(): void;
  setTool(tool: EditorTool): void;
  setRenderedPreview(p: RenderedPreview | null): void;
  setPreviewTask(id: string | null): void;
  setPreviewMode(mode: 'live' | 'rendered'): void;
  markUnplayable(assetId: string, unplayable: boolean): void;
  tick(nowMs: number): void;
}

let lastTick = 0;

export const useEditorStore = create<EditorState>((set, get) => ({
  playheadMs: 0,
  playing: false,
  rate: 1,
  durationMs: 0,
  fps: { num: 30, den: 1 },
  selection: [],
  inMs: null,
  outMs: null,
  pxPerMs: 0.06,
  scrollMs: 0,
  snap: true,
  tool: 'select',
  previewMode: 'live',
  renderedPreview: null,
  previewTaskId: null,
  unplayableAssets: {},
  toolTab: 'inspector',
  selectedMaskId: null,
  showMasks: true,
  maskDraw: { active: false, box: null },
  compare: null,
  setToolTab: (toolTab) => set({ toolTab }),
  selectMask: (selectedMaskId) => set({ selectedMaskId }),
  setShowMasks: (showMasks) => set({ showMasks }),
  setMaskDraw: (maskDraw) => set({ maskDraw }),
  setCompare: (compare) => set({ compare, playing: false }),
  setContext: (durationMs, fps) => set((s) => ({ durationMs, fps, playheadMs: Math.min(s.playheadMs, Math.max(0, durationMs)) })),
  setPlayhead: (ms, opts) => set((s) => ({ playheadMs: Math.max(0, Math.min(s.durationMs, opts?.snap === false ? ms : snapToFrame(ms, s.fps))) })),
  play: () => {
    const s = get();
    if (s.durationMs <= 0) return;
    lastTick = performance.now();
    set({ playing: true, rate: s.rate === 0 ? 1 : s.rate, playheadMs: s.playheadMs >= s.durationMs ? 0 : s.playheadMs });
  },
  pause: () => set({ playing: false }),
  togglePlay: () => (get().playing ? get().pause() : get().play()),
  stop: () => set({ playing: false, rate: 1 }),
  setRate: (rate) => {
    lastTick = performance.now();
    set({ rate, playing: rate !== 0 });
  },
  stepFrames: (n) => {
    const s = get();
    const frame = frameDurationMs(s.fps);
    set({ playing: false, playheadMs: Math.max(0, Math.min(s.durationMs, snapToFrame(s.playheadMs + n * frame, s.fps))) });
  },
  select: (ids, additive) => set((s) => ({ selection: additive ? Array.from(new Set([...s.selection, ...ids])) : ids })),
  clearSelection: () => set({ selection: [] }),
  setInOut: (inMs, outMs) => set({ inMs, outMs }),
  setZoom: (pxPerMs, anchorMs, anchorPx) => {
    const clamped = Math.max(0.002, Math.min(2, pxPerMs));
    if (anchorMs != null && anchorPx != null) set({ pxPerMs: clamped, scrollMs: Math.max(0, anchorMs - anchorPx / clamped) });
    else set({ pxPerMs: clamped });
  },
  zoomToFit: (widthPx) => {
    const d = Math.max(1000, get().durationMs);
    set({ pxPerMs: Math.max(0.002, (widthPx - 24) / d), scrollMs: 0 });
  },
  setScroll: (ms) => set({ scrollMs: Math.max(0, ms) }),
  toggleSnap: () => set((s) => ({ snap: !s.snap })),
  setTool: (tool) => set({ tool }),
  setRenderedPreview: (p) => set({ renderedPreview: p, previewMode: p ? 'rendered' : 'live' }),
  setPreviewTask: (id) => set({ previewTaskId: id }),
  setPreviewMode: (mode) => set({ previewMode: mode }),
  markUnplayable: (assetId, unplayable) => set((s) => ({ unplayableAssets: { ...s.unplayableAssets, [assetId]: unplayable } })),
  tick: (nowMs) => {
    const s = get();
    if (!s.playing) return;
    const dt = Math.min(200, nowMs - lastTick);
    lastTick = nowMs;
    let next = s.playheadMs + dt * s.rate;
    if (next >= s.durationMs) {
      next = s.durationMs;
      set({ playheadMs: next, playing: false });
      return;
    }
    if (next <= 0) {
      set({ playheadMs: 0, playing: false, rate: 1 });
      return;
    }
    set({ playheadMs: next });
  },
}));

/** Starts the master playback clock (one requestAnimationFrame loop for the editor). */
export function startPlaybackClock(): () => void {
  let raf = 0;
  const loop = (now: number) => {
    useEditorStore.getState().tick(now);
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);
  return () => cancelAnimationFrame(raf);
}
