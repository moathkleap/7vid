export type ShortcutAction =
  | 'playback.toggle'
  | 'playback.stop'
  | 'playback.stepBack'
  | 'playback.stepForward'
  | 'playback.shuttleBack'
  | 'playback.shuttleForward'
  | 'playback.goStart'
  | 'playback.goEnd'
  | 'timeline.setIn'
  | 'timeline.setOut'
  | 'timeline.split'
  | 'timeline.delete'
  | 'timeline.rippleDelete'
  | 'timeline.duplicate'
  | 'timeline.selectAll'
  | 'timeline.zoomIn'
  | 'timeline.zoomOut'
  | 'timeline.zoomFit'
  | 'timeline.toggleSnap'
  | 'timeline.addMarker'
  | 'timeline.nextEdit'
  | 'timeline.prevEdit'
  | 'edit.undo'
  | 'edit.redo'
  | 'project.save'
  | 'project.export'
  | 'app.assistant'
  | 'app.search'
  | 'app.settings'
  | 'app.toggleTheme';

export interface ShortcutDefinition {
  action: ShortcutAction;
  /** Key combo using 'Mod' for Ctrl (Windows/Linux) or Cmd (macOS). */
  keys: string[];
  labelKey: string;
  scope: 'global' | 'editor';
}

export const DEFAULT_SHORTCUTS: ShortcutDefinition[] = [
  { action: 'playback.toggle', keys: ['Space'], labelKey: 'shortcuts.playbackToggle', scope: 'editor' },
  { action: 'playback.stop', keys: ['K'], labelKey: 'shortcuts.playbackStop', scope: 'editor' },
  { action: 'playback.shuttleBack', keys: ['J'], labelKey: 'shortcuts.shuttleBack', scope: 'editor' },
  { action: 'playback.shuttleForward', keys: ['L'], labelKey: 'shortcuts.shuttleForward', scope: 'editor' },
  { action: 'playback.stepBack', keys: ['ArrowLeft'], labelKey: 'shortcuts.stepBack', scope: 'editor' },
  { action: 'playback.stepForward', keys: ['ArrowRight'], labelKey: 'shortcuts.stepForward', scope: 'editor' },
  { action: 'playback.goStart', keys: ['Home'], labelKey: 'shortcuts.goStart', scope: 'editor' },
  { action: 'playback.goEnd', keys: ['End'], labelKey: 'shortcuts.goEnd', scope: 'editor' },
  { action: 'timeline.setIn', keys: ['I'], labelKey: 'shortcuts.setIn', scope: 'editor' },
  { action: 'timeline.setOut', keys: ['O'], labelKey: 'shortcuts.setOut', scope: 'editor' },
  { action: 'timeline.split', keys: ['S'], labelKey: 'shortcuts.split', scope: 'editor' },
  { action: 'timeline.delete', keys: ['Delete', 'Backspace'], labelKey: 'shortcuts.delete', scope: 'editor' },
  { action: 'timeline.rippleDelete', keys: ['Shift+Delete'], labelKey: 'shortcuts.rippleDelete', scope: 'editor' },
  { action: 'timeline.duplicate', keys: ['Mod+D'], labelKey: 'shortcuts.duplicate', scope: 'editor' },
  { action: 'timeline.selectAll', keys: ['Mod+A'], labelKey: 'shortcuts.selectAll', scope: 'editor' },
  { action: 'timeline.zoomIn', keys: ['=', '+'], labelKey: 'shortcuts.zoomIn', scope: 'editor' },
  { action: 'timeline.zoomOut', keys: ['-'], labelKey: 'shortcuts.zoomOut', scope: 'editor' },
  { action: 'timeline.zoomFit', keys: ['Shift+Z'], labelKey: 'shortcuts.zoomFit', scope: 'editor' },
  { action: 'timeline.toggleSnap', keys: ['N'], labelKey: 'shortcuts.toggleSnap', scope: 'editor' },
  { action: 'timeline.addMarker', keys: ['M'], labelKey: 'shortcuts.addMarker', scope: 'editor' },
  { action: 'timeline.nextEdit', keys: ['ArrowDown'], labelKey: 'shortcuts.nextEdit', scope: 'editor' },
  { action: 'timeline.prevEdit', keys: ['ArrowUp'], labelKey: 'shortcuts.prevEdit', scope: 'editor' },
  { action: 'edit.undo', keys: ['Mod+Z'], labelKey: 'shortcuts.undo', scope: 'global' },
  { action: 'edit.redo', keys: ['Mod+Shift+Z', 'Mod+Y'], labelKey: 'shortcuts.redo', scope: 'global' },
  { action: 'project.save', keys: ['Mod+S'], labelKey: 'shortcuts.save', scope: 'global' },
  { action: 'project.export', keys: ['Mod+E'], labelKey: 'shortcuts.export', scope: 'global' },
  { action: 'app.assistant', keys: ['Mod+K'], labelKey: 'shortcuts.assistant', scope: 'global' },
  { action: 'app.search', keys: ['Mod+P'], labelKey: 'shortcuts.search', scope: 'global' },
  { action: 'app.settings', keys: ['Mod+,'], labelKey: 'shortcuts.settings', scope: 'global' },
  { action: 'app.toggleTheme', keys: ['Mod+Shift+T'], labelKey: 'shortcuts.toggleTheme', scope: 'global' },
];

/** Builds the effective action→keys map from defaults and user overrides ("action": "Key+Combo,Alt+Combo"). */
export function resolveShortcuts(overrides: Record<string, string>): Map<ShortcutAction, string[]> {
  const map = new Map<ShortcutAction, string[]>();
  for (const def of DEFAULT_SHORTCUTS) {
    const custom = overrides[def.action];
    map.set(def.action, custom ? custom.split(',').map((s) => s.trim()).filter(Boolean) : def.keys);
  }
  return map;
}

/** Normalizes a KeyboardEvent-like object into the combo format used above. */
export function eventToCombo(e: { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean; code?: string }, isMac: boolean): string {
  const parts: string[] = [];
  const mod = isMac ? e.metaKey : e.ctrlKey;
  if (mod) parts.push('Mod');
  if (!isMac && e.metaKey) parts.push('Meta');
  if (isMac && e.ctrlKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  let key = e.key;
  if (key === ' ') key = 'Space';
  else if (key.length === 1) key = key.toUpperCase();
  parts.push(key);
  return parts.join('+');
}
