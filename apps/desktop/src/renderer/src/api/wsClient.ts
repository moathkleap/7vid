import type { AppErrorInfo } from '@sevenvid/core';
import type { ChannelName, EventName, SevenvidApi } from '@sevenvid/ipc';

export class RemoteError extends Error {
  constructor(readonly info: AppErrorInfo) {
    super(info.message);
    this.name = 'AppError';
  }
}

type Pending = { resolve: (v: unknown) => void; reject: (e: unknown) => void };
type Status = 'connecting' | 'connected' | 'disconnected';

/** Browser-mode implementation of the IPC contract over the dev bridge WebSocket. */
export class WsClient implements SevenvidApi {
  readonly mode = 'browser' as const;
  private ws: WebSocket | null = null;
  private pending = new Map<string, Pending>();
  private queue: string[] = [];
  private seq = 0;
  private handlers = new Map<string, Set<(payload: unknown) => void>>();
  private statusHandlers = new Set<(s: Status) => void>();
  private attempts = 0;
  status: Status = 'connecting';

  constructor(private readonly url: string) {
    this.connect();
  }

  onStatus(handler: (s: Status) => void): () => void {
    this.statusHandlers.add(handler);
    return () => this.statusHandlers.delete(handler);
  }

  private setStatus(s: Status): void {
    this.status = s;
    for (const h of this.statusHandlers) h(s);
  }

  private connect(): void {
    this.setStatus('connecting');
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.onopen = () => {
      this.attempts = 0;
      this.setStatus('connected');
      for (const frame of this.queue) ws.send(frame);
      this.queue = [];
    };
    ws.onmessage = (ev) => {
      let msg: { t: string; id?: string; ok?: boolean; data?: unknown; error?: AppErrorInfo; event?: string; payload?: unknown };
      try {
        msg = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      if (msg.t === 'result' && msg.id) {
        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);
        if (msg.ok) p.resolve(msg.data);
        else p.reject(new RemoteError(msg.error!));
      } else if (msg.t === 'event' && msg.event) {
        for (const h of this.handlers.get(msg.event) ?? []) h(msg.payload);
      }
    };
    ws.onclose = () => {
      this.setStatus('disconnected');
      for (const [id, p] of this.pending) {
        p.reject(new RemoteError({ errorId: `err_ws_${id}`, code: 'NETWORK_FAILED', module: 'ipc', operation: 'ws', message: 'Connection to the engine was lost', userMessageKey: 'errors.bridgeDisconnected', userMessageParams: {}, retryable: true, recovery: [{ kind: 'retry', labelKey: 'errors.recovery.retry', target: null }], logRef: null, cause: null, details: {}, at: new Date().toISOString() }));
      }
      this.pending.clear();
      const delay = Math.min(10_000, 500 * 2 ** this.attempts++);
      setTimeout(() => this.connect(), delay);
    };
    ws.onerror = () => undefined;
  }

  invoke<C extends ChannelName>(channel: C, input?: unknown): Promise<never> {
    const id = String(++this.seq);
    const frame = JSON.stringify({ t: 'invoke', id, channel, input: input ?? null });
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(frame);
      else this.queue.push(frame);
    }) as Promise<never>;
  }

  subscribe<E extends EventName>(event: E, handler: (payload: never) => void): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler as (payload: unknown) => void);
    return () => set!.delete(handler as (payload: unknown) => void);
  }
}
