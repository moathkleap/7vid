import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Film, Layers, Lock, LockOpen, Volume2, VolumeX } from 'lucide-react';
import { clipEndMs, formatMs, type Clip, type Command, type ProjectDocument, type Track } from '@sevenvid/core';
import { getApi } from '@/api/client';
import { useEditorStore } from '@/store/editorStore';
import { useMediaStore } from '@/store/mediaStore';
import { cn } from '@/lib/cn';

const HEADER_W = 150;
const RULER_H = 28;
const GAP = 2;
const EDGE = 8;
const TRACK_H: Record<Track['kind'], number> = { video: 72, overlay: 48, audio: 56 };

interface DragState {
  kind: 'move' | 'trim-start' | 'trim-end' | 'scrub';
  clipId: string | null;
  startX: number;
  startY: number;
  originStartMs: number;
  originEndMs: number;
  originTrackId: string | null;
  currentStartMs: number;
  currentEndMs: number;
  currentTrackId: string | null;
  moved: boolean;
  alt: boolean;
}

interface SpriteImage {
  img: HTMLImageElement;
  meta: { count: number; cols: number; tileWidth: number; tileHeight: number; intervalMs: number };
}

export interface TimelineProps {
  doc: ProjectDocument;
  onCommand: (cmd: Command) => Promise<unknown>;
  onDropAsset: (assetId: string, trackId: string | null, atMs: number) => void;
}

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888';
}

/** Canvas timeline: ruler, multi-track lanes with thumbnails/waveforms, drag/move/trim, razor, snapping, drop. */
export function Timeline({ doc, onCommand, onDropAsset }: TimelineProps) {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 300 });
  const dragRef = useRef<DragState | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [hover, setHover] = useState<{ clipId: string; zone: 'move' | 'trim-start' | 'trim-end' } | null>(null);
  const spritesRef = useRef(new Map<string, SpriteImage | 'loading'>());
  const wavesRef = useRef(new Map<string, { peaks: number[]; samplesPerSecond: number } | 'loading' | null>());
  const [, force] = useState(0);
  const redraw = useCallback(() => force((n) => n + 1), []);
  const store = useEditorStore();
  const media = useMediaStore((s) => s.assets);

  const tracks = doc.tracks;
  const trackTop = (i: number) => RULER_H + tracks.slice(0, i).reduce((s, tr) => s + TRACK_H[tr.kind] + GAP, 0);
  const contentH = trackTop(tracks.length) + 12;
  const xOf = (ms: number) => HEADER_W + (ms - store.scrollMs) * store.pxPerMs;
  const msOf = (x: number) => store.scrollMs + (x - HEADER_W) / store.pxPerMs;
  const trackAtY = (y: number): number => {
    for (let i = 0; i < tracks.length; i++) if (y >= trackTop(i) && y < trackTop(i) + TRACK_H[tracks[i]!.kind]) return i;
    return -1;
  };

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (store.durationMs > 0 && store.pxPerMs * store.durationMs < 200) store.zoomToFit(size.w - HEADER_W);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.w]);

  const ensureSprite = useCallback((assetId: string) => {
    const cache = spritesRef.current;
    if (cache.has(assetId)) return cache.get(assetId);
    const asset = media[assetId];
    if (!asset?.spritePath || !asset.spriteMeta) return undefined;
    cache.set(assetId, 'loading');
    void useMediaStore.getState().urlFor(asset.spritePath).then((url) => {
      if (!url) return;
      const img = new Image();
      img.onload = () => {
        cache.set(assetId, { img, meta: asset.spriteMeta! });
        redraw();
      };
      img.src = url;
    });
    return 'loading';
  }, [media, redraw]);

  const ensureWave = useCallback((assetId: string) => {
    const cache = wavesRef.current;
    if (cache.has(assetId)) return cache.get(assetId);
    cache.set(assetId, 'loading');
    getApi().invoke('media.waveform', { assetId }).then((wf) => {
      cache.set(assetId, wf ? { peaks: wf.peaks, samplesPerSecond: wf.samplesPerSecond } : null);
      redraw();
    }).catch(() => cache.set(assetId, null));
    return 'loading';
  }, [redraw]);

  const snapPoints = useCallback((excludeClipId: string | null): number[] => {
    const pts = [0, store.playheadMs];
    if (store.inMs != null) pts.push(store.inMs);
    if (store.outMs != null) pts.push(store.outMs);
    for (const m of doc.markers) pts.push(m.tMs);
    for (const tr of tracks) for (const c of tr.clips) if (c.id !== excludeClipId) pts.push(c.startMs, clipEndMs(c));
    return pts;
  }, [doc.markers, tracks, store.playheadMs, store.inMs, store.outMs]);

  const snap = useCallback((ms: number, excludeClipId: string | null): number => {
    if (!store.snap) return Math.max(0, Math.round(ms));
    const threshold = EDGE / store.pxPerMs;
    let best = ms;
    let bestDist = threshold;
    for (const p of snapPoints(excludeClipId)) {
      const dist = Math.abs(p - ms);
      if (dist < bestDist) {
        best = p;
        bestDist = dist;
      }
    }
    return Math.max(0, Math.round(best));
  }, [store.snap, store.pxPerMs, snapPoints]);

  const hitClip = (x: number, y: number): { clip: Clip; track: Track; zone: 'move' | 'trim-start' | 'trim-end' } | null => {
    const ti = trackAtY(y);
    if (ti < 0) return null;
    const track = tracks[ti]!;
    const ms = msOf(x);
    for (const clip of track.clips) {
      if (ms < clip.startMs || ms > clipEndMs(clip)) continue;
      const x0 = xOf(clip.startMs);
      const x1 = xOf(clipEndMs(clip));
      const zone = x - x0 <= EDGE ? 'trim-start' : x1 - x <= EDGE ? 'trim-end' : 'move';
      return { clip, track, zone };
    }
    return null;
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    e.currentTarget.setPointerCapture(e.pointerId);
    if (x < HEADER_W) return;
    if (y < RULER_H) {
      const marker = doc.markers.find((m) => Math.abs(xOf(m.tMs) - x) < 6);
      store.setPlayhead(marker ? marker.tMs : Math.max(0, msOf(x)));
      dragRef.current = { kind: 'scrub', clipId: null, startX: x, startY: y, originStartMs: 0, originEndMs: 0, originTrackId: null, currentStartMs: 0, currentEndMs: 0, currentTrackId: null, moved: false, alt: e.altKey };
      return;
    }
    const hit = hitClip(x, y);
    if (!hit) {
      store.clearSelection();
      store.setPlayhead(Math.max(0, msOf(x)));
      dragRef.current = { kind: 'scrub', clipId: null, startX: x, startY: y, originStartMs: 0, originEndMs: 0, originTrackId: null, currentStartMs: 0, currentEndMs: 0, currentTrackId: null, moved: false, alt: e.altKey };
      return;
    }
    if (store.tool === 'razor') {
      const at = snap(msOf(x), null);
      if (at > hit.clip.startMs && at < clipEndMs(hit.clip)) void onCommand({ type: 'clip.split', clipId: hit.clip.id, atMs: at });
      return;
    }
    if (hit.track.locked) return;
    store.select([hit.clip.id], e.shiftKey);
    const d: DragState = { kind: hit.zone, clipId: hit.clip.id, startX: x, startY: y, originStartMs: hit.clip.startMs, originEndMs: clipEndMs(hit.clip), originTrackId: hit.track.id, currentStartMs: hit.clip.startMs, currentEndMs: clipEndMs(hit.clip), currentTrackId: hit.track.id, moved: false, alt: e.altKey };
    dragRef.current = d;
    setDrag(d);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const d = dragRef.current;
    if (!d) {
      const hit = x >= HEADER_W && y >= RULER_H ? hitClip(x, y) : null;
      setHover(hit ? { clipId: hit.clip.id, zone: hit.zone } : null);
      return;
    }
    if (d.kind === 'scrub') {
      store.setPlayhead(Math.max(0, msOf(x)));
      return;
    }
    const dx = x - d.startX;
    const deltaMs = dx / store.pxPerMs;
    if (!d.moved && Math.abs(dx) < 3) return;
    d.moved = true;
    d.alt = e.altKey;
    const dur = d.originEndMs - d.originStartMs;
    if (d.kind === 'move') {
      const s = snap(d.originStartMs + deltaMs, d.clipId);
      d.currentStartMs = s;
      d.currentEndMs = s + dur;
      const ti = trackAtY(y);
      const originKind = tracks.find((tr) => tr.id === d.originTrackId)?.kind;
      if (ti >= 0 && tracks[ti]!.kind === originKind && !tracks[ti]!.locked) d.currentTrackId = tracks[ti]!.id;
    } else if (d.kind === 'trim-start') {
      d.currentStartMs = Math.min(d.originEndMs - 40, snap(d.originStartMs + deltaMs, d.clipId));
    } else {
      d.currentEndMs = Math.max(d.originStartMs + 40, snap(d.originEndMs + deltaMs, d.clipId));
    }
    setDrag({ ...d });
  };

  const onPointerUp = () => {
    const d = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    if (!d || d.kind === 'scrub' || !d.moved || !d.clipId) return;
    if (d.kind === 'move') {
      if (d.currentStartMs !== d.originStartMs || d.currentTrackId !== d.originTrackId) void onCommand({ type: 'clip.move', clipId: d.clipId, trackId: d.currentTrackId ?? undefined, startMs: d.currentStartMs, mode: d.alt ? 'insert' : 'overwrite' });
    } else if (d.kind === 'trim-start') {
      if (d.currentStartMs !== d.originStartMs) void onCommand({ type: 'clip.trim', clipId: d.clipId, edge: 'start', toMs: d.currentStartMs, ripple: d.alt });
    } else if (d.currentEndMs !== d.originEndMs) void onCommand({ type: 'clip.trim', clipId: d.clipId, edge: 'end', toMs: d.currentEndMs, ripple: d.alt });
  };

  const onWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const factor = Math.exp(-e.deltaY * 0.0015);
      store.setZoom(store.pxPerMs * factor, msOf(x), x - HEADER_W);
    } else {
      const delta = (e.deltaX || e.deltaY) / store.pxPerMs;
      store.setScroll(store.scrollMs + delta);
    }
  };

  const onDrop = (e: React.DragEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const assetId = e.dataTransfer.getData('application/x-sevenvid-asset');
    if (!assetId) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const ti = trackAtY(y);
    onDropAsset(assetId, ti >= 0 ? tracks[ti]!.id : null, Math.max(0, snap(msOf(x), null)));
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const W = size.w;
    const H = Math.max(size.h, contentH);
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const colors = { bg: cssVar('--bg'), surface: cssVar('--surface'), surface2: cssVar('--surface-2'), border: cssVar('--border'), text: cssVar('--text'), muted: cssVar('--text-muted'), accent: cssVar('--accent'), danger: cssVar('--danger'), success: cssVar('--success'), info: cssVar('--info') };
    ctx.fillStyle = colors.bg;
    ctx.fillRect(0, 0, W, H);
    const visibleStart = store.scrollMs;
    const visibleEnd = msOf(W);

    // lanes
    tracks.forEach((track, i) => {
      const top = trackTop(i);
      const h = TRACK_H[track.kind];
      ctx.fillStyle = colors.surface;
      ctx.fillRect(HEADER_W, top, W - HEADER_W, h);
      if (track.locked) {
        ctx.fillStyle = 'rgba(128,128,128,0.08)';
        ctx.fillRect(HEADER_W, top, W - HEADER_W, h);
      }
    });

    // ruler
    ctx.fillStyle = colors.surface2;
    ctx.fillRect(HEADER_W, 0, W - HEADER_W, RULER_H);
    const steps = [100, 250, 500, 1000, 2000, 5000, 10000, 30000, 60000, 300000];
    const step = steps.find((s) => s * store.pxPerMs >= 90) ?? 300000;
    ctx.font = '11px Inter, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    for (let ms = Math.floor(visibleStart / step) * step; ms <= visibleEnd; ms += step) {
      const x = xOf(ms);
      ctx.fillStyle = colors.border;
      ctx.fillRect(x, RULER_H - 8, 1, 8);
      ctx.fillRect(x, RULER_H, 1, H - RULER_H);
      ctx.fillStyle = colors.muted;
      ctx.fillText(formatMs(ms, { millis: false }), x + 4, RULER_H / 2);
      const sub = step / 5;
      for (let k = 1; k < 5; k++) {
        ctx.fillStyle = colors.border;
        ctx.fillRect(xOf(ms + sub * k), RULER_H - 4, 1, 4);
      }
    }
    // in/out shading
    if (store.inMs != null || store.outMs != null) {
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      if (store.inMs != null) ctx.fillRect(HEADER_W, RULER_H, Math.max(0, xOf(store.inMs) - HEADER_W), H - RULER_H);
      if (store.outMs != null) ctx.fillRect(xOf(store.outMs), RULER_H, W, H - RULER_H);
      ctx.fillStyle = colors.info;
      if (store.inMs != null) ctx.fillRect(xOf(store.inMs) - 1, 0, 2, RULER_H);
      if (store.outMs != null) ctx.fillRect(xOf(store.outMs) - 1, 0, 2, RULER_H);
    }
    // markers
    for (const m of doc.markers) {
      const x = xOf(m.tMs);
      ctx.fillStyle = m.color || colors.accent;
      ctx.beginPath();
      ctx.moveTo(x - 5, 2);
      ctx.lineTo(x + 5, 2);
      ctx.lineTo(x, 10);
      ctx.closePath();
      ctx.fill();
      if (m.label) {
        ctx.fillStyle = colors.text;
        ctx.fillText(m.label, x + 7, 8);
      }
    }

    // clips
    const dragState = drag;
    tracks.forEach((track, i) => {
      const top = trackTop(i);
      const h = TRACK_H[track.kind];
      for (const clip of track.clips) {
        let start = clip.startMs;
        let end = clipEndMs(clip);
        let laneTop = top;
        if (dragState && dragState.clipId === clip.id && dragState.moved) {
          start = dragState.currentStartMs;
          end = dragState.currentEndMs;
          if (dragState.kind === 'move' && dragState.currentTrackId) {
            const ti = tracks.findIndex((tr) => tr.id === dragState.currentTrackId);
            if (ti >= 0) laneTop = trackTop(ti);
          }
        }
        if (end < visibleStart || start > visibleEnd) continue;
        const x0 = xOf(start);
        const x1 = xOf(end);
        const w = Math.max(2, x1 - x0);
        const selected = store.selection.includes(clip.id);
        const asset = doc.assets[clip.assetId];
        const base = track.kind === 'audio' ? 'rgba(46,212,122,0.18)' : track.kind === 'overlay' ? 'rgba(79,163,255,0.18)' : 'rgba(124,92,255,0.22)';
        ctx.save();
        ctx.beginPath();
        ctx.roundRect(x0, laneTop + 2, w, h - 4, 6);
        ctx.clip();
        ctx.fillStyle = base;
        ctx.fillRect(x0, laneTop + 2, w, h - 4);
        const headH = 16;
        // thumbnails
        if (asset?.hasVideo && track.kind !== 'audio') {
          const sprite = ensureSprite(clip.assetId);
          const thumbTop = laneTop + 2 + headH;
          const thumbH = h - 4 - headH - (asset.hasAudio ? 10 : 0);
          if (sprite && sprite !== 'loading' && thumbH > 8) {
            const tw = (sprite.meta.tileWidth / sprite.meta.tileHeight) * thumbH;
            const span = clip.sourceOutMs - clip.sourceInMs;
            for (let px = 0; px < w; px += tw) {
              const frac = clip.durationMs > 0 ? px / (clip.durationMs * store.pxPerMs) : 0;
              const srcMs = clip.freeze ? clip.freeze.atSourceMs : clip.sourceInMs + (clip.reverse ? 1 - frac : frac) * span;
              const idx = Math.max(0, Math.min(sprite.meta.count - 1, Math.floor(srcMs / sprite.meta.intervalMs)));
              const sx = (idx % sprite.meta.cols) * sprite.meta.tileWidth;
              const sy = Math.floor(idx / sprite.meta.cols) * sprite.meta.tileHeight;
              ctx.drawImage(sprite.img, sx, sy, sprite.meta.tileWidth, sprite.meta.tileHeight, x0 + px, thumbTop, tw, thumbH);
            }
          }
        }
        // waveform
        if (asset?.hasAudio && !clip.audio.muted) {
          const wave = ensureWave(clip.assetId);
          if (wave && wave !== 'loading') {
            const waveH = track.kind === 'audio' ? h - 4 - headH : 10;
            const waveTop = laneTop + h - 2 - waveH;
            ctx.fillStyle = track.kind === 'audio' ? 'rgba(46,212,122,0.7)' : 'rgba(255,255,255,0.5)';
            const span = clip.sourceOutMs - clip.sourceInMs;
            const startPx = Math.max(0, xOf(visibleStart) - x0);
            for (let px = startPx; px < w; px += 2) {
              const frac = px / (clip.durationMs * store.pxPerMs);
              const srcMs = clip.sourceInMs + (clip.reverse ? 1 - frac : frac) * span;
              const idx = Math.min(wave.peaks.length - 1, Math.max(0, Math.floor((srcMs / 1000) * wave.samplesPerSecond)));
              const p = wave.peaks[idx] ?? 0;
              const bh = Math.max(1, p * waveH);
              ctx.fillRect(x0 + px, waveTop + (waveH - bh) / 2, 1.5, bh);
              if (x0 + px > W) break;
            }
          }
        }
        // header
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.fillRect(x0, laneTop + 2, w, headH);
        ctx.fillStyle = colors.text;
        ctx.font = '11px Inter, "IBM Plex Sans Arabic", sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        const label = `${clip.name}${clip.speed !== 1 ? ` · ${clip.speed}x` : ''}${clip.reverse ? ' · ⟲' : ''}${clip.freeze ? ' · ❄' : ''}`;
        ctx.fillText(label, x0 + 6, laneTop + 2 + headH / 2, Math.max(0, w - 10));
        ctx.restore();
        ctx.strokeStyle = selected ? colors.accent : 'rgba(255,255,255,0.12)';
        ctx.lineWidth = selected ? 2 : 1;
        ctx.beginPath();
        ctx.roundRect(x0 + 0.5, laneTop + 2.5, w - 1, h - 5, 6);
        ctx.stroke();
        if (hover?.clipId === clip.id && hover.zone !== 'move') {
          ctx.fillStyle = colors.accent;
          ctx.fillRect(hover.zone === 'trim-start' ? x0 : x1 - 3, laneTop + 2, 3, h - 4);
        }
      }
    });
    if (tracks.every((tr) => tr.clips.length === 0)) {
      ctx.fillStyle = colors.muted;
      ctx.font = '13px Inter, "IBM Plex Sans Arabic", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(t('editor.emptyTimeline'), HEADER_W + (W - HEADER_W) / 2, RULER_H + 40);
    }
    // playhead
    const px = xOf(store.playheadMs);
    if (px >= HEADER_W) {
      ctx.fillStyle = colors.danger;
      ctx.fillRect(px - 0.5, 0, 1.5, H);
      ctx.beginPath();
      ctx.moveTo(px - 6, 0);
      ctx.lineTo(px + 6, 0);
      ctx.lineTo(px, 9);
      ctx.closePath();
      ctx.fill();
    }
    // header column background
    ctx.fillStyle = colors.surface2;
    ctx.fillRect(0, 0, HEADER_W, H);
    ctx.fillStyle = colors.border;
    ctx.fillRect(HEADER_W - 1, 0, 1, H);
  });

  const cursor = store.tool === 'razor' ? 'crosshair' : hover?.zone === 'trim-start' || hover?.zone === 'trim-end' ? 'ew-resize' : hover ? 'grab' : 'default';
  return (
    <div ref={wrapRef} className="relative h-full w-full overflow-auto bg-bg" data-testid="timeline">
      <canvas ref={canvasRef} style={{ cursor }} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onWheel={onWheel} onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }} onDrop={onDrop} />
      <div className="pointer-events-none absolute start-0 top-0" style={{ width: HEADER_W }}>
        {tracks.map((track, i) => (
          <div key={track.id} className="pointer-events-auto absolute start-0 flex items-center gap-1.5 px-2" style={{ top: trackTop(i), height: TRACK_H[track.kind], width: HEADER_W }} data-testid="timeline-track-header">
            {track.kind === 'video' ? <Film className="size-3.5 text-accent" /> : track.kind === 'audio' ? <Volume2 className="size-3.5 text-success" /> : <Layers className="size-3.5 text-info" />}
            <span className="min-w-0 flex-1 truncate text-[12px] font-medium">{track.name}</span>
            <button type="button" data-action="track.mute" title={t('editor.mute')} className={cn('rounded p-0.5 hover:bg-surface-3', track.muted ? 'text-danger' : 'text-faint')} onClick={() => void onCommand({ type: 'track.update', trackId: track.id, patch: { muted: !track.muted } })}>{track.muted ? <VolumeX className="size-3.5" /> : <Volume2 className="size-3.5" />}</button>
            <button type="button" data-action="track.solo" title={t('editor.solo')} className={cn('rounded px-1 text-[10px] font-bold hover:bg-surface-3', track.solo ? 'text-warning' : 'text-faint')} onClick={() => void onCommand({ type: 'track.update', trackId: track.id, patch: { solo: !track.solo } })}>S</button>
            <button type="button" data-action="track.lock" title={t('editor.lock')} className={cn('rounded p-0.5 hover:bg-surface-3', track.locked ? 'text-warning' : 'text-faint')} onClick={() => void onCommand({ type: 'track.update', trackId: track.id, patch: { locked: !track.locked } })}>{track.locked ? <Lock className="size-3.5" /> : <LockOpen className="size-3.5" />}</button>
          </div>
        ))}
      </div>
    </div>
  );
}
