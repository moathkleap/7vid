import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import { isChannel, type ChannelName } from '@sevenvid/ipc';
import { AppError } from '../errors';
import type { Engine } from '../api/createEngine';

export interface DevBridgeOptions {
  port: number;
  host?: string;
  token: string;
}

export interface DevBridge {
  port: number;
  url: string;
  close(): Promise<void>;
}

type ClientMessage = { t: 'invoke'; id: string; channel: string; input?: unknown } | { t: 'ping' };

/**
 * Exposes the exact IPC contract over a local WebSocket so the renderer can run in a plain browser
 * (development and end-to-end tests). Requires a per-run token; binds to loopback only.
 */
export async function startDevBridge(engine: Engine, opts: DevBridgeOptions): Promise<DevBridge> {
  const host = opts.host ?? '127.0.0.1';
  const server = http.createServer((req, res) => {
    if (req.url?.startsWith('/health')) {
      res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
      res.end(JSON.stringify({ ok: true, mode: 'browser', at: new Date().toISOString() }));
      return;
    }
    if (req.url?.startsWith('/media/')) {
      serveMedia(engine, opts.token, req, res);
      return;
    }
    res.writeHead(404);
    res.end();
  });
  const wss = new WebSocketServer({ server });
  const clients = new Set<WebSocket>();

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url ?? '/', `http://${host}`);
    if (url.searchParams.get('token') !== opts.token) {
      ws.close(4401, 'unauthorized');
      return;
    }
    clients.add(ws);
    ws.on('close', () => clients.delete(ws));
    ws.on('message', async (raw) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(String(raw)) as ClientMessage;
      } catch {
        return;
      }
      if (msg.t === 'ping') {
        ws.send(JSON.stringify({ t: 'pong' }));
        return;
      }
      if (msg.t !== 'invoke') return;
      if (!isChannel(msg.channel)) {
        ws.send(JSON.stringify({ t: 'result', id: msg.id, ok: false, error: new AppError({ code: 'INVALID_INPUT', operation: msg.channel, message: `Unknown channel ${msg.channel}` }).info }));
        return;
      }
      try {
        const data = await engine.invoke(msg.channel as ChannelName, msg.input as never);
        ws.send(JSON.stringify({ t: 'result', id: msg.id, ok: true, data: data ?? null }));
      } catch (err) {
        const info = AppError.from(err, { code: 'UNKNOWN', operation: msg.channel }).info;
        ws.send(JSON.stringify({ t: 'result', id: msg.id, ok: false, error: info }));
      }
    });
  });

  const unsubscribe = engine.bus.onAny((event, payload) => {
    const frame = JSON.stringify({ t: 'event', event, payload });
    for (const c of clients) if (c.readyState === c.OPEN) c.send(frame);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port, host, () => resolve());
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : opts.port;
  engine.logger.info({ module: 'devbridge', port }, 'dev bridge listening');
  return {
    port,
    url: `ws://${host}:${port}/?token=${opts.token}`,
    async close() {
      unsubscribe();
      for (const c of clients) c.close();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

const MIME: Record<string, string> = { mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska', avi: 'video/x-msvideo', mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac', ogg: 'audio/ogg', opus: 'audio/ogg', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', json: 'application/json' };

/** Serves local files the engine allows (assets and derived cache files) with HTTP Range support for seeking. */
function serveMedia(engine: Engine, token: string, req: http.IncomingMessage, res: http.ServerResponse): void {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  const parts = url.pathname.split('/');
  const reqToken = parts[2];
  const file = decodeURIComponent(parts.slice(3).join('/'));
  const abs = file.startsWith('/') || /^[A-Za-z]:/.test(file) ? file : `/${file}`;
  if (reqToken !== token || !engine.media.isPathAllowed(abs) || !fs.existsSync(abs)) {
    res.writeHead(404, { 'access-control-allow-origin': '*' });
    res.end();
    return;
  }
  const stat = fs.statSync(abs);
  const mime = MIME[path.extname(abs).slice(1).toLowerCase()] ?? 'application/octet-stream';
  const headers: Record<string, string> = { 'content-type': mime, 'accept-ranges': 'bytes', 'access-control-allow-origin': '*', 'cache-control': 'no-cache' };
  const range = req.headers.range;
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    let start = m && m[1] ? Number(m[1]) : 0;
    let end = m && m[2] ? Number(m[2]) : stat.size - 1;
    if (Number.isNaN(start) || start >= stat.size) {
      res.writeHead(416, { 'content-range': `bytes */${stat.size}` });
      res.end();
      return;
    }
    end = Math.min(end, stat.size - 1);
    if (m && !m[1] && m[2]) {
      start = Math.max(0, stat.size - Number(m[2]));
      end = stat.size - 1;
    }
    res.writeHead(206, { ...headers, 'content-range': `bytes ${start}-${end}/${stat.size}`, 'content-length': String(end - start + 1) });
    if (req.method === 'HEAD') return void res.end();
    fs.createReadStream(abs, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, { ...headers, 'content-length': String(stat.size) });
  if (req.method === 'HEAD') return void res.end();
  fs.createReadStream(abs).pipe(res);
}
