import { defineConfig } from '@playwright/test';
import path from 'node:path';

const root = path.resolve(__dirname, '..');
const webPort = 5177;
const bridgePort = 7778;
const token = 'e2e-token';
const userData = path.join(root, '.sevenvid-dev', 'e2e-userData');

/**
 * Browser-mode end-to-end tests: the real engine runs as a Node process behind the WebSocket dev bridge
 * and the real renderer runs in Chromium. Only Electron's native window/dialog layer is not exercised here.
 */
export default defineConfig({
  testDir: path.join(__dirname, 'e2e'),
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: path.join(root, 'tests', 'results', 'html') }]],
  outputDir: path.join(root, 'tests', 'results', 'artifacts'),
  use: {
    baseURL: `http://127.0.0.1:${webPort}/`,
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: `rm -rf "${userData}" && SEVENVID_USER_DATA="${userData}" SEVENVID_REPO_ROOT="${root}" SEVENVID_DEVBRIDGE_PORT=${bridgePort} SEVENVID_DEVBRIDGE_TOKEN=${token} SEVENVID_DEV_MEDIA_DIR="${path.join(root, 'tests', 'fixtures', 'generated')}" SEVENVID_MODELS_DIR="${path.join(root, '.sevenvid-dev', 'userData', 'models')}" pnpm exec tsx packages/engine/src/devbridge/main.ts`,
      cwd: root,
      url: `http://127.0.0.1:${bridgePort}/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: `SEVENVID_WEB_PORT=${webPort} SEVENVID_DEVBRIDGE_URL="ws://127.0.0.1:${bridgePort}/?token=${token}" pnpm --filter @sevenvid/desktop exec vite --config vite.browser.config.ts`,
      cwd: root,
      url: `http://127.0.0.1:${webPort}/`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
