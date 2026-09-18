import { create } from 'zustand';
import type { Command } from '@sevenvid/core';
import type { SessionState } from '@sevenvid/ipc';
import { getApi } from '../api/client';
import { useAppStore } from './appStore';

interface SessionStoreState {
  projectId: string | null;
  state: SessionState | null;
  opening: boolean;
  open(projectId: string): Promise<SessionState | null>;
  close(): Promise<void>;
  execute(command: Command): Promise<SessionState | null>;
  undo(): Promise<void>;
  redo(): Promise<void>;
  save(label?: string): Promise<void>;
  refresh(): Promise<void>;
}

let subscribed = false;

export const useSessionStore = create<SessionStoreState>((set, get) => ({
  projectId: null,
  state: null,
  opening: false,
  async open(projectId) {
    if (!subscribed) {
      subscribed = true;
      getApi().subscribe('session.updated', (e) => {
        if (e.projectId === get().projectId) set({ state: e.state });
      });
      getApi().subscribe('session.closed', (e) => {
        if (e.projectId === get().projectId) set({ projectId: null, state: null });
      });
    }
    if (get().projectId === projectId && get().state) return get().state;
    set({ opening: true });
    try {
      const state = await getApi().invoke('projects.open', { projectId });
      set({ projectId, state, opening: false });
      return state;
    } catch (err) {
      set({ opening: false });
      useAppStore.getState().reportError(err);
      return null;
    }
  },
  async close() {
    const id = get().projectId;
    if (!id) return;
    try {
      await getApi().invoke('projects.close', { projectId: id });
    } finally {
      set({ projectId: null, state: null });
    }
  },
  async execute(command) {
    const id = get().projectId;
    if (!id) return null;
    try {
      const state = await getApi().invoke('session.command', { projectId: id, command });
      set({ state });
      return state;
    } catch (err) {
      useAppStore.getState().reportError(err);
      return null;
    }
  },
  async undo() {
    const id = get().projectId;
    if (!id) return;
    try {
      set({ state: await getApi().invoke('session.undo', { projectId: id }) });
    } catch (err) {
      useAppStore.getState().reportError(err);
    }
  },
  async redo() {
    const id = get().projectId;
    if (!id) return;
    try {
      set({ state: await getApi().invoke('session.redo', { projectId: id }) });
    } catch (err) {
      useAppStore.getState().reportError(err);
    }
  },
  async save(label) {
    const id = get().projectId;
    if (!id) return;
    try {
      set({ state: await getApi().invoke('session.save', { projectId: id, label }) });
    } catch (err) {
      useAppStore.getState().reportError(err);
    }
  },
  async refresh() {
    const id = get().projectId;
    if (!id) return;
    set({ state: await getApi().invoke('session.state', { projectId: id }) });
  },
}));
