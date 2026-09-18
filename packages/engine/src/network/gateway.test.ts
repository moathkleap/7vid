import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createEngine, type Engine } from '../api/createEngine';
import { MODEL_REGISTRY } from '../models/registry';
import { cleanup, tempDir, testHost } from '../test/helpers';

let dir: string;
let engine: Engine;
let server: http.Server | null = null;

afterEach(async () => {
  await engine?.dispose();
  server?.close();
  server = null;
  cleanup(dir);
});

function serve(body: Buffer, onRequest: (req: http.IncomingMessage) => void = () => undefined): Promise<string> {
  return new Promise((resolve) => {
    server = http.createServer((req, res) => {
      onRequest(req);
      if (req.url === '/missing') {
        res.writeHead(404);
        res.end('nope');
        return;
      }
      if (req.url === '/redirect') {
        res.writeHead(302, { location: '/file.bin' });
        res.end();
        return;
      }
      const range = /bytes=(\d+)-/.exec(req.headers.range ?? '');
      if (range) {
        const from = Number(range[1]);
        res.writeHead(206, { 'content-length': body.length - from, 'content-range': `bytes ${from}-${body.length - 1}/${body.length}` });
        res.end(body.subarray(from));
        return;
      }
      res.writeHead(200, { 'content-length': body.length });
      res.end(body);
    });
    server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${(server!.address() as { port: number }).port}`));
  });
}

describe('network gateway and model downloads', () => {
  it('downloads, resumes, logs, and honors the privacy switch', async () => {
    dir = tempDir();
    engine = createEngine({ host: testHost(), paths: { userData: dir, resources: path.join(dir, 'res') }, logLevel: 'warn' });
    const body = crypto.randomBytes(300_000);
    const seen: string[] = [];
    const base = await serve(body, (req) => seen.push(req.headers.range ?? 'full'));
    const out = path.join(dir, 'dl', 'file.bin');
    const r = await engine.gateway.fetchToFile(`${base}/file.bin`, { purpose: 'model:test', providerId: null, toFile: out });
    expect(r.bytes).toBe(body.length);
    expect(fs.readFileSync(out).equals(body)).toBe(true);
    // resume: keep the first 100 000 bytes and fetch again → Range request, identical result
    fs.writeFileSync(out, body.subarray(0, 100_000));
    const r2 = await engine.gateway.fetchToFile(`${base}/file.bin`, { purpose: 'model:test', providerId: null, toFile: out });
    expect(r2.bytes).toBe(body.length);
    expect(seen.at(-1)).toBe('bytes=100000-');
    expect(fs.readFileSync(out).equals(body)).toBe(true);
    // redirects are followed, 404 fails clearly
    fs.rmSync(out, { force: true });
    await engine.gateway.fetchToFile(`${base}/redirect`, { purpose: 'model:test', providerId: null, toFile: out });
    expect(fs.statSync(out).size).toBe(body.length);
    await expect(engine.gateway.fetchToFile(`${base}/missing`, { purpose: 'model:test', providerId: null, toFile: path.join(dir, 'x.bin') })).rejects.toMatchObject({ info: { code: 'NETWORK_FAILED' } });
    const log = engine.db.networkLog.recent(10);
    expect(log[0]!.status).toBe('failed');
    expect(log.some((e) => e.status === 'ok' && e.bytesIn === body.length)).toBe(true);
    // privacy switch blocks before any connection is made
    engine.settings.update({ privacy: { allowModelDownloads: false } });
    const before = seen.length;
    await expect(engine.gateway.fetchToFile(`${base}/file.bin`, { purpose: 'model:test', providerId: null, toFile: path.join(dir, 'y.bin') })).rejects.toMatchObject({ info: { code: 'NETWORK_BLOCKED' } });
    expect(seen.length).toBe(before);
    expect(engine.db.networkLog.recent(1)[0]!.status).toBe('blocked');
    // plain http to a remote host is never allowed
    engine.settings.update({ privacy: { allowModelDownloads: true } });
    await expect(engine.gateway.fetchToFile('http://example.com/model.bin', { purpose: 'model:test', providerId: null, toFile: path.join(dir, 'z.bin') })).rejects.toMatchObject({ info: { code: 'NETWORK_BLOCKED' } });
  });

  it('installs a registry model through the task queue with sha256 verification', async () => {
    dir = tempDir();
    engine = createEngine({ host: testHost(), paths: { userData: dir, resources: path.join(dir, 'res') }, logLevel: 'warn' });
    const body = crypto.randomBytes(50_000);
    const base = await serve(body);
    const sha = crypto.createHash('sha256').update(body).digest('hex');
    const spec = { id: 'test/tiny', name: 'Tiny test model', capability: 'audio.vad', providerId: 'test', version: '1', kind: 'local', files: [{ url: `${base}/file.bin`, path: 'tiny.bin', sha256: sha, sizeBytes: body.length }], sizeBytes: body.length, vramMb: null, ramMb: 10, requiresGpu: false, languages: [], license: 'MIT', description: 'test', descriptionAr: 'اختبار', host: '127.0.0.1', recommended: 'optional' } as (typeof MODEL_REGISTRY)[number];
    const bad = { ...spec, id: 'test/bad', files: [{ ...spec.files[0]!, sha256: 'deadbeef'.repeat(8) }] };
    MODEL_REGISTRY.push(spec, bad);
    try {
      expect(engine.models.isInstalled('test/tiny')).toBe(false);
      const task = engine.models.startDownload('test/tiny');
      const done = await engine.tasks.wait(task.id);
      expect(done.status, JSON.stringify(done.error)).toBe('done');
      expect(engine.models.isInstalled('test/tiny')).toBe(true);
      const status = (await engine.invoke('models.get', { modelId: 'test/tiny' }));
      expect(status.status).toBe('installed');
      expect(status.checksumOk).toBe(true);
      expect(status.downloadable).toBe(false); // plain http test server; real registry entries are https
      const badTask = engine.models.startDownload('test/bad');
      const failed = await engine.tasks.wait(badTask.id);
      expect(failed.status).toBe('failed');
      expect(failed.error?.code).toBe('MODEL_CHECKSUM_MISMATCH');
      expect(engine.models.isInstalled('test/bad')).toBe(false);
      expect((await engine.invoke('models.remove', { modelId: 'test/tiny' })).removed).toBe(true);
      expect(engine.models.isInstalled('test/tiny')).toBe(false);
    } finally {
      MODEL_REGISTRY.splice(MODEL_REGISTRY.indexOf(spec), 1);
      MODEL_REGISTRY.splice(MODEL_REGISTRY.indexOf(bad), 1);
    }
  });

  it('exposes hardware fit and download status for the registry', async () => {
    dir = tempDir();
    engine = createEngine({ host: testHost(), paths: { userData: dir, resources: path.join(dir, 'res') }, logLevel: 'warn' });
    await engine.start();
    const list = await engine.invoke('models.list');
    expect(list.length).toBeGreaterThan(10);
    const wan = list.find((m) => m.spec.id === 'wan/2.1-t2v-1.3b')!;
    expect(wan.downloadable).toBe(false);
    expect(wan.spec.requiresGpu).toBe(true);
    const yunet = list.find((m) => m.spec.id === 'opencv/yunet-2023mar')!;
    expect(yunet.downloadable).toBe(true);
    expect(yunet.fit.ok).toBe(true);
    expect(['available', 'installed']).toContain(yunet.status);
  });
});
