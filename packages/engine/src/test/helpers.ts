import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createEngine, type Engine } from '../api/createEngine';
import type { EngineHost } from '../api/host';

export function tempDir(prefix = 'sevenvid-test-'): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function testHost(): EngineHost {
  return {
    mode: 'browser',
    appVersion: '0.0.0-test',
    electronVersion: null,
    isDev: true,
    dialogs: {
      pickFiles: async () => ({ paths: [], native: false }),
      pickDirectory: async () => ({ path: null, native: false }),
      saveFile: async () => ({ path: null, native: false }),
    },
    shell: { openPath: async () => '', showInFolder: () => undefined, openExternal: async () => undefined },
    quit: () => undefined,
    mediaUrl: (p) => `file://${p}`,
  };
}

export function testEngine(userData = tempDir()): Engine {
  return createEngine({ host: testHost(), paths: { userData, resources: path.join(userData, 'resources') }, logLevel: 'debug' });
}

export function cleanup(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}
