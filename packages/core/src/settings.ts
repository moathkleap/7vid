import { z } from 'zod';

export const LANGUAGES = ['ar', 'en'] as const;
export type Language = (typeof LANGUAGES)[number];

export const SettingsSchema = z.object({
  general: z.object({
    language: z.enum(['system', 'ar', 'en']).default('system'),
    autosaveIntervalMs: z.number().int().min(1000).max(600000).default(2000),
    confirmDestructiveActions: z.boolean().default(true),
    reopenLastProject: z.boolean().default(true),
    defaultProjectKind: z.enum(['editor', 'creator']).default('editor'),
  }),
  appearance: z.object({
    theme: z.enum(['dark', 'light', 'system']).default('dark'),
    density: z.enum(['comfortable', 'compact']).default('comfortable'),
    reduceMotion: z.boolean().default(false),
    accent: z.enum(['violet', 'blue', 'emerald', 'amber']).default('violet'),
  }),
  ai: z.object({
    planningMode: z.enum(['deterministic-first', 'model-first']).default('deterministic-first'),
    alwaysConfirmPlans: z.boolean().default(true),
    preferredTextProvider: z.string().nullable().default(null),
    preferredSttProvider: z.string().nullable().default(null),
    preferredTtsProvider: z.string().nullable().default(null),
    preferredImageProvider: z.string().nullable().default(null),
    preferredVideoProvider: z.string().nullable().default(null),
    responseLanguage: z.enum(['auto', 'ar', 'en']).default('auto'),
  }),
  gpu: z.object({
    preferHardwareEncoding: z.boolean().default(true),
    preferHardwareDecoding: z.boolean().default(true),
    allowCpuFallbackForAi: z.boolean().default(true),
    maxVramUsagePercent: z.number().int().min(10).max(100).default(90),
  }),
  storage: z.object({
    cacheLimitGb: z.number().min(1).max(2000).default(20),
    proxyHeight: z.union([z.literal(360), z.literal(540), z.literal(720)]).default(540),
    autoGenerateProxies: z.boolean().default(true),
    projectsDir: z.string().nullable().default(null),
    exportsDir: z.string().nullable().default(null),
    modelsDir: z.string().nullable().default(null),
  }),
  export: z.object({
    defaultPresetId: z.string().default('youtube-1080p'),
    validateAfterExport: z.boolean().default(true),
    openFolderWhenDone: z.boolean().default(false),
  }),
  privacy: z.object({
    allowExternalProviders: z.boolean().default(false),
    allowModelDownloads: z.boolean().default(true),
    askBeforeEveryDownload: z.boolean().default(true),
    networkLogging: z.boolean().default(true),
    telemetry: z.literal(false).default(false),
  }),
  notifications: z.object({
    onTaskComplete: z.boolean().default(true),
    onError: z.boolean().default(true),
    sound: z.boolean().default(false),
  }),
  performance: z.object({
    maxConcurrentTasks: z.number().int().min(1).max(16).default(2),
    maxConcurrentRenders: z.number().int().min(1).max(4).default(1),
    previewQuality: z.enum(['auto', 'full', 'half', 'quarter']).default('auto'),
    useProxiesForPreview: z.boolean().default(true),
    ffmpegThreads: z.number().int().min(0).max(64).default(0),
  }),
  shortcuts: z.record(z.string(), z.string()).default({}),
});

export type AppSettings = z.infer<typeof SettingsSchema>;

export function defaultSettings(): AppSettings {
  return SettingsSchema.parse({
    general: {},
    appearance: {},
    ai: {},
    gpu: {},
    storage: {},
    export: {},
    privacy: {},
    notifications: {},
    performance: {},
  });
}

/** Deep-merges a partial settings object over the defaults, validating the result. */
export function mergeSettings(base: AppSettings, patch: DeepPartial<AppSettings>): AppSettings {
  const merged = deepMerge(base as unknown as Record<string, unknown>, patch as Record<string, unknown>);
  return SettingsSchema.parse(merged);
}

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

function deepMerge(a: Record<string, unknown>, b: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...a };
  for (const [k, v] of Object.entries(b)) {
    if (v === undefined) continue;
    const prev = out[k];
    if (isPlainObject(prev) && isPlainObject(v)) out[k] = deepMerge(prev, v);
    else out[k] = v;
  }
  return out;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
