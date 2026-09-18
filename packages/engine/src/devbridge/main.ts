import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createEngine } from '../api/createEngine';
import { createBrowserHost } from './browserHost';
import { startDevBridge } from './server';

/** Standalone entry: runs the full engine as a Node process and serves the IPC contract over WebSocket. */
async function main(): Promise<void> {
  const port = Number(process.env.SEVENVID_DEVBRIDGE_PORT ?? 7777);
  const token = process.env.SEVENVID_DEVBRIDGE_TOKEN ?? crypto.randomBytes(12).toString('hex');
  const root = process.env.SEVENVID_REPO_ROOT ?? path.resolve(process.cwd());
  const userData = process.env.SEVENVID_USER_DATA ?? path.join(root, '.sevenvid-dev', 'userData');
  const resources = process.env.SEVENVID_RESOURCES ?? path.join(root, 'resources');
  const version = readVersion(root);
  const engine = createEngine({ host: createBrowserHost({ appVersion: version, onQuit: () => shutdown(), mediaUrl: (p) => `http://127.0.0.1:${port}/media/${token}/${encodeURIComponent(p)}` }), paths: { userData, resources }, logToConsole: process.env.SEVENVID_LOG_CONSOLE === '1' });
  const bridge = await startDevBridge(engine, { port, token });
  await engine.start();
  const info = { port: bridge.port, token, url: bridge.url, userData };
  fs.writeFileSync(path.join(userData, 'devbridge.json'), JSON.stringify(info, null, 2));
  process.stdout.write(`DEVBRIDGE_READY ${JSON.stringify(info)}\n`);

  let closing = false;
  async function shutdown(): Promise<void> {
    if (closing) return;
    closing = true;
    await bridge.close();
    await engine.dispose();
    process.exit(0);
  }
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
  process.on('uncaughtException', (err) => {
    engine.logger.fatal({ err }, 'uncaught exception');
  });
  process.on('unhandledRejection', (err) => {
    engine.logger.error({ err }, 'unhandled rejection');
  });
}

function readVersion(root: string): string {
  try {
    return (JSON.parse(fs.readFileSync(path.join(root, 'apps/desktop/package.json'), 'utf8')) as { version: string }).version;
  } catch {
    return '0.0.0-dev';
  }
}

main().catch((err) => {
  process.stderr.write(`devbridge failed: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exit(1);
});
