import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { eventToCombo, resolveShortcuts, type ShortcutAction } from '@sevenvid/core';
import { useAppStore } from '@/store/appStore';
import { useSessionStore } from '@/store/sessionStore';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/** Global keyboard shortcuts (editor-scoped shortcuts are handled by the editor itself). */
export function useShortcuts(): void {
  const navigate = useNavigate();
  const settings = useAppStore((s) => s.settings);
  useEffect(() => {
    const map = resolveShortcuts(settings?.shortcuts ?? {});
    const byCombo = new Map<string, ShortcutAction>();
    for (const [action, combos] of map) for (const c of combos) byCombo.set(c, action);
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      const combo = eventToCombo(e, isMac);
      const action = byCombo.get(combo);
      if (!action) return;
      if (typing && !combo.includes('Mod')) return;
      const app = useAppStore.getState();
      const session = useSessionStore.getState();
      switch (action) {
        case 'edit.undo':
          if (session.state?.history.canUndo) void session.undo();
          break;
        case 'edit.redo':
          if (session.state?.history.canRedo) void session.redo();
          break;
        case 'project.save':
          if (session.state) void session.save();
          break;
        case 'project.export':
          if (session.state) navigate('/export');
          break;
        case 'app.assistant':
          app.setAssistantOpen(!app.assistantOpen);
          break;
        case 'app.search':
          app.setSearchOpen(true);
          break;
        case 'app.settings':
          navigate('/settings');
          break;
        case 'app.toggleTheme': {
          const current = app.settings?.appearance.theme ?? 'dark';
          void app.updateSettings({ appearance: { theme: current === 'dark' ? 'light' : 'dark' } });
          break;
        }
        default:
          return;
      }
      e.preventDefault();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [settings?.shortcuts, settings?.appearance.theme, navigate]);
}
