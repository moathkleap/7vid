export type ErrorModule =
  | 'app'
  | 'db'
  | 'project'
  | 'media'
  | 'ffmpeg'
  | 'render'
  | 'export'
  | 'audio'
  | 'subtitles'
  | 'vision'
  | 'ocr'
  | 'ai'
  | 'planner'
  | 'creator'
  | 'providers'
  | 'models'
  | 'worker'
  | 'tasks'
  | 'hardware'
  | 'network'
  | 'ipc'
  | 'fs';

export type RecoveryKind =
  | 'retry'
  | 'open-settings'
  | 'open-models'
  | 'setup-runtime'
  | 'free-disk'
  | 'relink-media'
  | 'reduce-quality'
  | 'use-cpu'
  | 'enable-provider'
  | 'check-logs';

export interface RecoveryHint {
  kind: RecoveryKind;
  labelKey: string;
  target: string | null;
}

/** Serializable error information shown to the user and stored in logs. */
export interface AppErrorInfo {
  errorId: string;
  code: string;
  module: ErrorModule;
  operation: string;
  /** Technical message (English, for logs and diagnostics). */
  message: string;
  /** i18n key for the user-facing explanation. */
  userMessageKey: string;
  userMessageParams: Record<string, string | number>;
  retryable: boolean;
  recovery: RecoveryHint[];
  logRef: string | null;
  cause: string | null;
  details: Record<string, unknown>;
  at: string;
}
