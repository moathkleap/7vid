/**
 * Runs the engine (dev bridge) and the renderer (Vite) together for browser-mode development:
 * open the printed URL in any Chromium-based browser. Electron-only features (native dialogs) fall back
 * to the in-app file browser.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';

const root = path.resolve(__dirname, '..');
const port = Number(process.env.SEVENVID_DEVBRIDGE_PORT ?? 7777);
const webPort = Number(process.env.SEVENVID_WEB_PORT ?? 5177);
const token = process.env.SEVENVID_DEVBRIDGE_TOKEN ?? 'dev';

const bridge = spawn('pnpm', ['exec', 'tsx', 'packages/engine/src/devbridge/main.ts'], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, SEVENVID_REPO_ROOT: root, SEVENVID_DEVBRIDGE_PORT: String(port), SEVENVID_DEVBRIDGE_TOKEN: token, SEVENVID_LOG_CONSOLE: '1' },
});
const web = spawn('pnpm', ['--filter', '@sevenvid/desktop', 'exec', 'vite', '--config', 'vite.browser.config.ts'], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, SEVENVID_WEB_PORT: String(webPort), SEVENVID_DEVBRIDGE_URL: `ws://127.0.0.1:${port}/?token=${token}` },
});
const url = `http://127.0.0.1:${webPort}/`;
setTimeout(() => console.log(`\n  7vid browser mode → ${url}\n`), 2500);

function stop(): void {
  bridge.kill('SIGINT');
  web.kill('SIGINT');
  process.exit(0);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
