import { contextBridge, ipcRenderer } from 'electron';
import type { AppErrorInfo } from '@sevenvid/core';
import type { ChannelName, EventName, IpcResponse, SevenvidApi } from '@sevenvid/ipc';

class RemoteError extends Error {
  constructor(readonly info: AppErrorInfo) {
    super(info.message);
    this.name = 'AppError';
  }
}

const api: SevenvidApi = {
  mode: 'electron',
  async invoke(channel: ChannelName, input?: unknown) {
    const res = (await ipcRenderer.invoke('sevenvid:api', channel, input ?? null)) as IpcResponse<unknown>;
    if (res.ok) return res.data as never;
    throw new RemoteError(res.error);
  },
  subscribe(event: EventName, handler) {
    const listener = (_e: Electron.IpcRendererEvent, payload: unknown) => handler(payload as never);
    ipcRenderer.on(`sevenvid:event:${event}`, listener);
    return () => ipcRenderer.removeListener(`sevenvid:event:${event}`, listener);
  },
};

contextBridge.exposeInMainWorld('sevenvid', api);
