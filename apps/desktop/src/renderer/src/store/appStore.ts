import { create } from 'zustand';
import type { AppSettings, CapabilityMap, AppErrorInfo, DeepPartial } from '@sevenvid/core';
import type { AppInfo, HardwareSnapshot, NotificationInfo, ProjectSummary, RecoveryInfo, TaskInfo } from '@sevenvid/ipc';
import { getApi, getBridge } from '../api/client';
import { applyLanguage, detectLanguage } from '../i18n';

export type BridgeStatus = 'connecting' | 'connected' | 'disconnected' | 'electron';

export interface ToastItem {
  id: string;
  level: 'info' | 'success' | 'warning' | 'error';
  titleKey: string;
  messageKey: string | null;
  params: Record<string, string | number>;
  errorId: string | null;
  taskId: string | null;
  at: string;
}

interface AppState {
  ready: boolean;
  bootError: AppErrorInfo | null;
  info: AppInfo | null;
  settings: AppSettings | null;
  capabilities: CapabilityMap | null;
  hardware: HardwareSnapshot | null;
  tasks: Record<string, TaskInfo>;
  projects: ProjectSummary[];
  recovery: RecoveryInfo[];
  toasts: ToastItem[];
  errors: AppErrorInfo[];
  errorDialog: AppErrorInfo | null;
  tasksPanelOpen: boolean;
  assistantOpen: boolean;
  searchOpen: boolean;
  bridge: BridgeStatus;
  bootstrap(): Promise<void>;
  refreshProjects(): Promise<void>;
  refreshHardware(): Promise<void>;
  refreshCapabilities(): Promise<void>;
  updateSettings(patch: DeepPartial<AppSettings>): Promise<void>;
  setTasksPanelOpen(open: boolean): void;
  setAssistantOpen(open: boolean): void;
  setSearchOpen(open: boolean): void;
  showError(info: AppErrorInfo | null): void;
  reportError(err: unknown): void;
  dismissToast(id: string): void;
  pushToast(t: Omit<ToastItem, 'id' | 'at'>): void;
  setRecovery(list: RecoveryInfo[]): void;
}

function applyAppearance(settings: AppSettings): void {
  const theme = settings.appearance.theme === 'system' ? (window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : settings.appearance.theme;
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.accent = settings.appearance.accent;
  document.documentElement.dataset.density = settings.appearance.density;
  document.documentElement.dataset.reduceMotion = String(settings.appearance.reduceMotion);
  applyLanguage(detectLanguage(settings.general.language));
}

export function isAppError(err: unknown): err is { info: AppErrorInfo } {
  return typeof err === 'object' && err !== null && 'info' in err && typeof (err as { info: unknown }).info === 'object';
}

let bootstrapStarted = false;

export const useAppStore = create<AppState>((set, get) => ({
  ready: false,
  bootError: null,
  info: null,
  settings: null,
  capabilities: null,
  hardware: null,
  tasks: {},
  projects: [],
  recovery: [],
  toasts: [],
  errors: [],
  errorDialog: null,
  tasksPanelOpen: false,
  assistantOpen: false,
  searchOpen: false,
  bridge: 'connecting',

  async bootstrap() {
    if (bootstrapStarted) return;
    bootstrapStarted = true;
    const api = getApi();
    const bridge = getBridge();
    if (bridge) {
      set({ bridge: bridge.status });
      bridge.onStatus((s) => set({ bridge: s }));
    } else {
      set({ bridge: 'electron' });
    }
    api.subscribe('task.updated', (task) => set((s) => ({ tasks: { ...s.tasks, [task.id]: task } })));
    api.subscribe('task.progress', (p) => set((s) => (s.tasks[p.taskId] ? { tasks: { ...s.tasks, [p.taskId]: { ...s.tasks[p.taskId]!, progress: p.progress, progressMessage: p.message, etaMs: p.etaMs } } } : s)));
    api.subscribe('settings.updated', (settings) => {
      applyAppearance(settings);
      set({ settings });
    });
    api.subscribe('capabilities.updated', (capabilities) => set({ capabilities: capabilities as CapabilityMap }));
    api.subscribe('hardware.updated', (hardware) => set({ hardware }));
    api.subscribe('projects.changed', () => void get().refreshProjects());
    api.subscribe('recovery.available', (list) => set({ recovery: list }));
    api.subscribe('error', (info) => set((s) => ({ errors: [info, ...s.errors].slice(0, 100) })));
    api.subscribe('notification', (n: NotificationInfo) => get().pushToast({ level: n.level, titleKey: n.titleKey, messageKey: n.messageKey, params: n.params, errorId: n.errorId, taskId: n.taskId }));
    const load = () =>
      Promise.all([
        api.invoke('app.info'),
        api.invoke('settings.get'),
        api.invoke('capabilities.get'),
        api.invoke('hardware.snapshot', {}),
        api.invoke('tasks.list', { includeFinished: true, limit: 200 }),
        api.invoke('projects.list', {}),
        api.invoke('projects.recovery.check'),
        api.invoke('errors.recent', { limit: 50 }),
      ]);
    try {
      let attempt = 0;
      let result: Awaited<ReturnType<typeof load>> | null = null;
      while (result === null) {
        try {
          result = await load();
        } catch (err) {
          attempt++;
          const transient = isAppError(err) && err.info.code === 'NETWORK_FAILED';
          if (!transient || attempt >= 6) throw err;
          await new Promise((r) => setTimeout(r, 400 * attempt));
        }
      }
      const [info, settings, capabilities, hardware, tasks, projects, recovery, errors] = result;
      applyAppearance(settings);
      set({ ready: true, info, settings, capabilities: capabilities as CapabilityMap, hardware, tasks: Object.fromEntries(tasks.map((t) => [t.id, t])), projects, recovery, errors });
    } catch (err) {
      set({ bootError: isAppError(err) ? err.info : { errorId: 'boot', code: 'UNKNOWN', module: 'app', operation: 'bootstrap', message: String(err), userMessageKey: 'errors.unknown', userMessageParams: {}, retryable: true, recovery: [], logRef: null, cause: null, details: {}, at: new Date().toISOString() } });
    }
  },
  async refreshProjects() {
    set({ projects: await getApi().invoke('projects.list', {}) });
  },
  async refreshHardware() {
    set({ hardware: await getApi().invoke('hardware.snapshot', { refresh: true }) });
  },
  async refreshCapabilities() {
    set({ capabilities: (await getApi().invoke('capabilities.refresh')) as CapabilityMap });
  },
  async updateSettings(patch) {
    try {
      const settings = await getApi().invoke('settings.update', { patch: patch as Record<string, unknown> });
      applyAppearance(settings);
      set({ settings });
    } catch (err) {
      get().reportError(err);
    }
  },
  setTasksPanelOpen: (open) => set({ tasksPanelOpen: open }),
  setAssistantOpen: (open) => set({ assistantOpen: open }),
  setSearchOpen: (open) => set({ searchOpen: open }),
  showError: (info) => set({ errorDialog: info }),
  reportError(err) {
    const info: AppErrorInfo = isAppError(err)
      ? err.info
      : { errorId: `err_ui_${Date.now()}`, code: 'UNKNOWN', module: 'app', operation: 'ui', message: err instanceof Error ? err.message : String(err), userMessageKey: 'errors.unknown', userMessageParams: {}, retryable: false, recovery: [], logRef: null, cause: null, details: {}, at: new Date().toISOString() };
    set((s) => ({ errors: [info, ...s.errors].slice(0, 100) }));
    get().pushToast({ level: 'error', titleKey: info.userMessageKey, messageKey: null, params: info.userMessageParams, errorId: info.errorId, taskId: null });
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  pushToast(t) {
    const item: ToastItem = { ...t, id: `toast_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, at: new Date().toISOString() };
    set((s) => ({ toasts: [...s.toasts.slice(-4), item] }));
    setTimeout(() => get().dismissToast(item.id), t.level === 'error' ? 9000 : 5000);
  },
  setRecovery: (list) => set({ recovery: list }),
}));
