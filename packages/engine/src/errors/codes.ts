import type { ErrorModule, RecoveryHint } from '@sevenvid/core';

export interface ErrorCodeSpec {
  module: ErrorModule;
  userMessageKey: string;
  retryable: boolean;
  recovery: RecoveryHint[];
}

const r = (kind: RecoveryHint['kind'], labelKey: string, target: string | null = null): RecoveryHint => ({ kind, labelKey, target });

export const ERROR_CODES = {
  UNKNOWN: { module: 'app', userMessageKey: 'errors.unknown', retryable: true, recovery: [r('retry', 'errors.recovery.retry'), r('check-logs', 'errors.recovery.checkLogs')] },
  INVALID_INPUT: { module: 'ipc', userMessageKey: 'errors.invalidInput', retryable: false, recovery: [] },
  NOT_IMPLEMENTED: { module: 'app', userMessageKey: 'errors.notImplemented', retryable: false, recovery: [] },
  DB_OPEN_FAILED: { module: 'db', userMessageKey: 'errors.dbOpenFailed', retryable: true, recovery: [r('retry', 'errors.recovery.retry'), r('check-logs', 'errors.recovery.checkLogs')] },
  DB_QUERY_FAILED: { module: 'db', userMessageKey: 'errors.dbQueryFailed', retryable: true, recovery: [r('retry', 'errors.recovery.retry')] },
  PROJECT_NOT_FOUND: { module: 'project', userMessageKey: 'errors.projectNotFound', retryable: false, recovery: [] },
  PROJECT_NOT_OPEN: { module: 'project', userMessageKey: 'errors.projectNotOpen', retryable: false, recovery: [] },
  PROJECT_DATA_CORRUPT: { module: 'project', userMessageKey: 'errors.projectDataCorrupt', retryable: false, recovery: [r('check-logs', 'errors.recovery.checkLogs')] },
  PROJECT_SAVE_FAILED: { module: 'project', userMessageKey: 'errors.projectSaveFailed', retryable: true, recovery: [r('retry', 'errors.recovery.retry'), r('free-disk', 'errors.recovery.freeDisk')] },
  VERSION_NOT_FOUND: { module: 'project', userMessageKey: 'errors.versionNotFound', retryable: false, recovery: [] },
  COMMAND_FAILED: { module: 'project', userMessageKey: 'errors.commandFailed', retryable: false, recovery: [] },
  VALIDATION_FAILED: { module: 'project', userMessageKey: 'errors.validationFailed', retryable: false, recovery: [] },
  TASK_NOT_FOUND: { module: 'tasks', userMessageKey: 'errors.taskNotFound', retryable: false, recovery: [] },
  TASK_KIND_UNKNOWN: { module: 'tasks', userMessageKey: 'errors.taskKindUnknown', retryable: false, recovery: [] },
  TASK_NOT_CANCELLABLE: { module: 'tasks', userMessageKey: 'errors.taskNotCancellable', retryable: false, recovery: [] },
  TASK_NOT_PAUSABLE: { module: 'tasks', userMessageKey: 'errors.taskNotPausable', retryable: false, recovery: [] },
  TASK_INVALID_STATE: { module: 'tasks', userMessageKey: 'errors.taskInvalidState', retryable: false, recovery: [] },
  TASK_CANCELLED: { module: 'tasks', userMessageKey: 'errors.taskCancelled', retryable: true, recovery: [r('retry', 'errors.recovery.retry')] },
  TASK_INTERRUPTED: { module: 'tasks', userMessageKey: 'errors.taskInterrupted', retryable: true, recovery: [r('retry', 'errors.recovery.retry')] },
  FILE_NOT_FOUND: { module: 'fs', userMessageKey: 'errors.fileNotFound', retryable: false, recovery: [r('relink-media', 'errors.recovery.relinkMedia')] },
  FILE_ACCESS_DENIED: { module: 'fs', userMessageKey: 'errors.fileAccessDenied', retryable: false, recovery: [] },
  DISK_FULL: { module: 'fs', userMessageKey: 'errors.diskFull', retryable: true, recovery: [r('free-disk', 'errors.recovery.freeDisk'), r('retry', 'errors.recovery.retry')] },
  PATH_NOT_ALLOWED: { module: 'fs', userMessageKey: 'errors.pathNotAllowed', retryable: false, recovery: [] },
  FFMPEG_NOT_FOUND: { module: 'ffmpeg', userMessageKey: 'errors.ffmpegNotFound', retryable: false, recovery: [r('open-settings', 'errors.recovery.openSettings', 'system')] },
  FFMPEG_FAILED: { module: 'ffmpeg', userMessageKey: 'errors.ffmpegFailed', retryable: true, recovery: [r('retry', 'errors.recovery.retry'), r('check-logs', 'errors.recovery.checkLogs')] },
  MEDIA_UNSUPPORTED: { module: 'media', userMessageKey: 'errors.mediaUnsupported', retryable: false, recovery: [] },
  MEDIA_ANALYSIS_FAILED: { module: 'media', userMessageKey: 'errors.mediaAnalysisFailed', retryable: true, recovery: [r('retry', 'errors.recovery.retry')] },
  ASSET_NOT_FOUND: { module: 'media', userMessageKey: 'errors.assetNotFound', retryable: false, recovery: [] },
  RENDER_FAILED: { module: 'render', userMessageKey: 'errors.renderFailed', retryable: true, recovery: [r('retry', 'errors.recovery.retry'), r('reduce-quality', 'errors.recovery.reduceQuality'), r('check-logs', 'errors.recovery.checkLogs')] },
  EXPORT_VALIDATION_FAILED: { module: 'export', userMessageKey: 'errors.exportValidationFailed', retryable: true, recovery: [r('retry', 'errors.recovery.retry'), r('check-logs', 'errors.recovery.checkLogs')] },
  MODEL_NOT_INSTALLED: { module: 'models', userMessageKey: 'errors.modelNotInstalled', retryable: false, recovery: [r('open-models', 'errors.recovery.openModels')] },
  MODEL_DOWNLOAD_FAILED: { module: 'models', userMessageKey: 'errors.modelDownloadFailed', retryable: true, recovery: [r('retry', 'errors.recovery.retry')] },
  MODEL_CHECKSUM_MISMATCH: { module: 'models', userMessageKey: 'errors.modelChecksumMismatch', retryable: true, recovery: [r('retry', 'errors.recovery.retry')] },
  PROVIDER_DISABLED: { module: 'providers', userMessageKey: 'errors.providerDisabled', retryable: false, recovery: [r('enable-provider', 'errors.recovery.enableProvider')] },
  PROVIDER_UNAVAILABLE: { module: 'providers', userMessageKey: 'errors.providerUnavailable', retryable: true, recovery: [r('open-settings', 'errors.recovery.openSettings', 'providers')] },
  PROVIDER_FAILED: { module: 'providers', userMessageKey: 'errors.providerFailed', retryable: true, recovery: [r('retry', 'errors.recovery.retry')] },
  WORKER_UNAVAILABLE: { module: 'worker', userMessageKey: 'errors.workerUnavailable', retryable: false, recovery: [r('setup-runtime', 'errors.recovery.setupRuntime')] },
  WORKER_CRASHED: { module: 'worker', userMessageKey: 'errors.workerCrashed', retryable: true, recovery: [r('retry', 'errors.recovery.retry'), r('check-logs', 'errors.recovery.checkLogs')] },
  WORKER_FAILED: { module: 'worker', userMessageKey: 'errors.workerFailed', retryable: true, recovery: [r('retry', 'errors.recovery.retry')] },
  HARDWARE_INSUFFICIENT: { module: 'hardware', userMessageKey: 'errors.hardwareInsufficient', retryable: false, recovery: [r('use-cpu', 'errors.recovery.useCpu'), r('reduce-quality', 'errors.recovery.reduceQuality')] },
  GPU_UNAVAILABLE: { module: 'hardware', userMessageKey: 'errors.gpuUnavailable', retryable: false, recovery: [r('use-cpu', 'errors.recovery.useCpu')] },
  NETWORK_BLOCKED: { module: 'network', userMessageKey: 'errors.networkBlocked', retryable: false, recovery: [r('open-settings', 'errors.recovery.openSettings', 'privacy')] },
  NETWORK_FAILED: { module: 'network', userMessageKey: 'errors.networkFailed', retryable: true, recovery: [r('retry', 'errors.recovery.retry')] },
  AI_PLAN_INVALID: { module: 'planner', userMessageKey: 'errors.aiPlanInvalid', retryable: false, recovery: [] },
  AI_NOT_UNDERSTOOD: { module: 'planner', userMessageKey: 'errors.aiNotUnderstood', retryable: false, recovery: [] },
  AI_OPERATION_FAILED: { module: 'ai', userMessageKey: 'errors.aiOperationFailed', retryable: true, recovery: [r('retry', 'errors.recovery.retry')] },
  AI_VERIFICATION_FAILED: { module: 'ai', userMessageKey: 'errors.aiVerificationFailed', retryable: true, recovery: [r('retry', 'errors.recovery.retry')] },
  NO_FACES_FOUND: { module: 'vision', userMessageKey: 'errors.noFacesFound', retryable: false, recovery: [] },
  NO_SPEECH_FOUND: { module: 'audio', userMessageKey: 'errors.noSpeechFound', retryable: false, recovery: [] },
  TRACKING_LOST: { module: 'vision', userMessageKey: 'errors.trackingLost', retryable: true, recovery: [r('retry', 'errors.recovery.retry')] },
} as const satisfies Record<string, ErrorCodeSpec>;

export type ErrorCode = keyof typeof ERROR_CODES;
