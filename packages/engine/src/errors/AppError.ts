import { newId, type AppErrorInfo, type ErrorModule, type RecoveryHint } from '@sevenvid/core';
import { ERROR_CODES, type ErrorCode } from './codes';

export interface AppErrorInit {
  code: ErrorCode;
  message: string;
  operation?: string;
  module?: ErrorModule;
  userMessageKey?: string;
  userMessageParams?: Record<string, string | number>;
  retryable?: boolean;
  recovery?: RecoveryHint[];
  cause?: unknown;
  details?: Record<string, unknown>;
  logRef?: string | null;
}

/** Central application error: carries a stable code, module, user-facing message key and recovery hints. */
export class AppError extends Error {
  readonly info: AppErrorInfo;

  constructor(init: AppErrorInit) {
    super(init.message);
    this.name = 'AppError';
    const spec = ERROR_CODES[init.code];
    const causeMessage = init.cause instanceof Error ? init.cause.message : init.cause != null ? String(init.cause) : null;
    this.info = {
      errorId: newId('err'),
      code: init.code,
      module: init.module ?? spec.module,
      operation: init.operation ?? 'unknown',
      message: init.message,
      userMessageKey: init.userMessageKey ?? spec.userMessageKey,
      userMessageParams: init.userMessageParams ?? {},
      retryable: init.retryable ?? spec.retryable,
      recovery: init.recovery ?? [...spec.recovery],
      logRef: init.logRef ?? null,
      cause: causeMessage,
      details: sanitize(init.details ?? {}),
      at: new Date().toISOString(),
    };
    if (init.cause instanceof Error && init.cause.stack) this.stack = `${this.stack}\nCaused by: ${init.cause.stack}`;
  }

  static is(err: unknown): err is AppError {
    return err instanceof AppError || (typeof err === 'object' && err !== null && (err as { name?: string }).name === 'AppError' && 'info' in err);
  }

  /** Wraps any thrown value into an AppError, preserving AppErrors as-is. */
  static from(err: unknown, defaults: Omit<AppErrorInit, 'message' | 'cause'> & { message?: string }): AppError {
    if (AppError.is(err)) return err;
    const message = defaults.message ?? (err instanceof Error ? err.message : String(err));
    const classified = classifyNodeError(err);
    const code = defaults.code && defaults.code !== 'UNKNOWN' ? defaults.code : classified;
    return new AppError({ ...defaults, code, message, cause: err });
  }

  toJSON(): AppErrorInfo {
    return this.info;
  }
}

/** Maps common Node.js error codes to application error codes. */
export function classifyNodeError(err: unknown): ErrorCode {
  const code = (err as { code?: string } | null)?.code;
  switch (code) {
    case 'ENOENT':
      return 'FILE_NOT_FOUND';
    case 'EACCES':
    case 'EPERM':
      return 'FILE_ACCESS_DENIED';
    case 'ENOSPC':
      return 'DISK_FULL';
    default:
      return 'UNKNOWN';
  }
}

export function errorToInfo(err: unknown, operation = 'unknown'): AppErrorInfo {
  return AppError.from(err, { code: classifyNodeError(err), operation }).info;
}

function sanitize(details: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(details)) {
    if (v === undefined) continue;
    if (v instanceof Error) out[k] = { name: v.name, message: v.message };
    else if (typeof v === 'bigint') out[k] = Number(v);
    else out[k] = v;
  }
  return out;
}
