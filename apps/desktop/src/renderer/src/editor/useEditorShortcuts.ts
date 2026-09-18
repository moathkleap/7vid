import { useEffect } from 'react';
import { clipEndMs, eventToCombo, resolveShortcuts, type Command, type ProjectDocument, type ShortcutAction } from '@sevenvid/core';
import { useAppStore } from '@/store/appStore';
import { useEditorStore } from '@/store/editorStore';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

export interface EditorActions {
  split: () => void;
  remove: (ripple: boolean) => void;
  duplicate: () => void;
  selectAll: () => void;
  addMarker: () => void;
  zoomFit: () => void;
}

/** Editor-scoped shortcuts (NLE style). Global shortcuts are handled by useShortcuts. */
export function useEditorShortcuts(doc: ProjectDocument | null, actions: EditorActions): void {
  const settings = useAppStore((s) => s.settings);
  useEffect(() => {
    if (!doc) return;
    const map = resolveShortcuts(settings?.shortcuts ?? {});
    const byCombo = new Map<string, ShortcutAction>();
    for (const [action, combos] of map) for (const c of combos) byCombo.set(c, action);
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) return;
      const combo = eventToCombo(e, isMac);
      const action = byCombo.get(combo) ?? (e.shiftKey ? byCombo.get(combo.replace('Shift+', '')) : undefined);
      if (!action) return;
      const s = useEditorStore.getState();
      switch (action) {
        case 'playback.toggle': s.togglePlay(); break;
        case 'playback.stop': s.stop(); break;
        case 'playback.shuttleBack': s.setRate(s.rate < 0 ? Math.max(-8, s.rate * 2) : -1); break;
        case 'playback.shuttleForward': s.setRate(s.rate > 0 && s.playing ? Math.min(8, s.rate * 2) : 1); break;
        case 'playback.stepBack': s.stepFrames(e.shiftKey ? -10 : -1); break;
        case 'playback.stepForward': s.stepFrames(e.shiftKey ? 10 : 1); break;
        case 'playback.goStart': s.setPlayhead(0); break;
        case 'playback.goEnd': s.setPlayhead(s.durationMs); break;
        case 'timeline.setIn': s.setInOut(s.playheadMs, s.outMs); break;
        case 'timeline.setOut': s.setInOut(s.inMs, s.playheadMs); break;
        case 'timeline.split': actions.split(); break;
        case 'timeline.delete': actions.remove(false); break;
        case 'timeline.rippleDelete': actions.remove(true); break;
        case 'timeline.duplicate': actions.duplicate(); break;
        case 'timeline.selectAll': actions.selectAll(); break;
        case 'timeline.zoomIn': s.setZoom(s.pxPerMs * 1.4); break;
        case 'timeline.zoomOut': s.setZoom(s.pxPerMs / 1.4); break;
        case 'timeline.zoomFit': actions.zoomFit(); break;
        case 'timeline.toggleSnap': s.toggleSnap(); break;
        case 'timeline.addMarker': actions.addMarker(); break;
        case 'timeline.nextEdit':
        case 'timeline.prevEdit': {
          const points = new Set<number>([0, s.durationMs]);
          for (const t of doc.tracks) {
            for (const c of t.clips) {
              points.add(c.startMs);
              points.add(clipEndMs(c));
            }
          }
          const sorted = [...points].sort((a, b) => a - b);
          const next = action === 'timeline.nextEdit' ? sorted.find((p) => p > s.playheadMs + 1) : [...sorted].reverse().find((p) => p < s.playheadMs - 1);
          if (next != null) s.setPlayhead(next);
          break;
        }
        default:
          return;
      }
      e.preventDefault();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [doc, settings?.shortcuts, actions]);
}

/** Splits the selected clip (or the clip under the playhead on any unlocked track) at the playhead. */
export function splitCommandAt(doc: ProjectDocument, selection: string[], playheadMs: number): Command | null {
  const candidates = doc.tracks.filter((t) => !t.locked).flatMap((t) => t.clips.filter((c) => c.startMs < playheadMs && clipEndMs(c) > playheadMs));
  const selected = candidates.filter((c) => selection.includes(c.id));
  const targets = selected.length ? selected : candidates.slice(0, 1);
  if (targets.length === 0) return null;
  const commands: Command[] = targets.map((c) => ({ type: 'clip.split', clipId: c.id, atMs: playheadMs }));
  return commands.length === 1 ? commands[0]! : { type: 'batch', commands, label: 'split' };
}
