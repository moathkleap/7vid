/** Host-specific services injected by the Electron main process or the browser dev bridge. */
export interface EngineHost {
  mode: 'electron' | 'browser';
  appVersion: string;
  electronVersion: string | null;
  isDev: boolean;
  dialogs: {
    pickFiles(opts: { kind: 'media' | 'video' | 'image' | 'audio' | 'subtitle' | 'any'; multiple?: boolean; title?: string }): Promise<{ paths: string[]; native: boolean }>;
    pickDirectory(opts: { title?: string }): Promise<{ path: string | null; native: boolean }>;
    saveFile(opts: { defaultPath?: string; filters?: Array<{ name: string; extensions: string[] }> }): Promise<{ path: string | null; native: boolean }>;
  };
  shell: {
    openPath(path: string): Promise<string>;
    showInFolder(path: string): void;
    openExternal(url: string): Promise<void>;
  };
  quit(): void;
  /** Builds a URL the renderer can load for a local file (custom protocol in Electron, HTTP in browser mode). */
  mediaUrl(path: string): string | null;
}

export const EXTERNAL_URL_ALLOWLIST = [
  'github.com',
  'huggingface.co',
  'ffmpeg.org',
  'www.python.org',
  'python.org',
  'ollama.com',
  'www.anthropic.com',
  'docs.anthropic.com',
  'console.anthropic.com',
  'platform.openai.com',
  'developers.google.com',
  'ai.google.dev',
];

export function isExternalUrlAllowed(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return false;
    return EXTERNAL_URL_ALLOWLIST.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`));
  } catch {
    return false;
  }
}
