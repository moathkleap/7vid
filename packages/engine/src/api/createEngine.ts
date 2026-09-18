import fs from 'node:fs';
import path from 'node:path';
import { channels, type ApiHandlers, type ChannelInput, type ChannelName, type ChannelOutput } from '@sevenvid/ipc';
import { CapabilityRegistry, type CapabilityReport } from '../capabilities/CapabilityRegistry';
import { openDatabase, type AppDatabase } from '../db/database';
import { AppError } from '../errors';
import { ErrorLog } from '../errors/ErrorLog';
import { EventBus } from '../events/EventBus';
import { locateFfmpeg, type FfmpegLocation } from '../ffmpeg/locator';
import { FsService } from '../fs/FsService';
import { HardwareMonitor } from '../hardware/HardwareMonitor';
import { LogHub, type Logger } from '../logging/logger';
import { NotificationService } from '../notifications/NotificationService';
import { ensureAppDirs, resolveAppPaths, type AppPaths, type ResolvePathsOptions } from '../paths/AppPaths';
import { ProjectService } from '../project/ProjectService';
import { SessionManager } from '../project/SessionManager';
import { TemplateService } from '../project/TemplateService';
import { MediaService } from '../media/MediaService';
import { ExportService } from '../export/ExportService';
import { PreviewRenderService } from '../render/PreviewRenderService';
import { PythonRuntime } from '../worker/PythonRuntime';
import { WorkerService } from '../worker/WorkerService';
import { ModelManager } from '../models/ModelManager';
import type { ModelSpec } from '../models/registry';
import { NetworkGateway } from '../network/NetworkGateway';
import { AudioService } from '../audio/AudioService';
import { VisionService } from '../vision/VisionService';
import { SubtitleService } from '../subtitles/SubtitleService';
import { OcrService } from '../ocr/OcrService';
import { EnhanceService } from '../enhance/EnhanceService';
import { SearchService } from '../search/SearchService';
import { SettingsService } from '../settings/SettingsService';
import { TaskManager } from '../tasks/TaskManager';
import { createCoreHandlers } from './handlers';
import { createPhase3Handlers } from './handlers3';
import type { EngineHost } from './host';

export interface EngineOptions {
  host: EngineHost;
  paths?: ResolvePathsOptions;
  logLevel?: string;
  logToConsole?: boolean;
}

export interface EngineServices {
  host: EngineHost;
  paths: AppPaths;
  logs: LogHub;
  logger: Logger;
  bus: EventBus;
  db: AppDatabase;
  settings: SettingsService;
  tasks: TaskManager;
  projects: ProjectService;
  sessions: SessionManager;
  hardware: HardwareMonitor;
  capabilities: CapabilityRegistry;
  search: SearchService;
  fs: FsService;
  errors: ErrorLog;
  notifications: NotificationService;
  ffmpeg: FfmpegLocation;
  templates: TemplateService;
  media: MediaService;
  exports: ExportService;
  previews: PreviewRenderService;
  runtime: PythonRuntime;
  worker: WorkerService;
  models: ModelManager;
  gateway: NetworkGateway;
  audio: AudioService;
  vision: VisionService;
  subtitles: SubtitleService;
  ocr: OcrService;
  enhance: EnhanceService;
}

export interface Engine extends EngineServices {
  handlers: ApiHandlers;
  /** Validates input against the contract, runs the handler and normalizes errors. */
  invoke<C extends ChannelName>(channel: C, input?: ChannelInput<C>): Promise<ChannelOutput<C>>;
  start(): Promise<void>;
  dispose(): Promise<void>;
  /** Registers handlers for channels added by later phases. */
  extend(handlers: Partial<ApiHandlers>): void;
}

export function createEngine(opts: EngineOptions): Engine {
  const paths = resolveAppPaths(opts.paths);
  ensureAppDirs(paths);
  const bus = new EventBus();
  const logs = new LogHub({ dir: paths.logs, level: opts.logLevel ?? (opts.host.isDev ? 'debug' : 'info'), console: opts.logToConsole ?? false, onEntry: (e) => bus.emit('log', e) });
  const logger = logs.child({ module: 'engine' });
  const db = openDatabase(paths.db, logger);
  const settings = new SettingsService(db.settings, bus, logs.child({ module: 'settings' }));
  const ffmpeg = locateFfmpeg(paths);
  logger.info({ operation: 'ffmpeg.locate', path: ffmpeg.ffmpeg, version: ffmpeg.version, source: ffmpeg.source, hwEncoders: ffmpeg.hwEncoders }, ffmpeg.ffmpeg ? 'ffmpeg found' : 'ffmpeg not found');
  const tasks = new TaskManager(db.tasks, bus, logs.child({ module: 'tasks' }));
  const perf = settings.get().performance;
  tasks.setConcurrency('default', perf.maxConcurrentTasks);
  tasks.setConcurrency('render', perf.maxConcurrentRenders);
  settings.onChange((s) => {
    tasks.setConcurrency('default', s.performance.maxConcurrentTasks);
    tasks.setConcurrency('render', s.performance.maxConcurrentRenders);
  });
  const search = new SearchService(db);
  const projects = new ProjectService(db, paths, bus, logs.child({ module: 'project' }), search);
  const sessions = new SessionManager(db, projects, settings, bus, logs.child({ module: 'project' }));
  const hardware = new HardwareMonitor(paths, bus, logs.child({ module: 'hardware' }), ffmpeg);
  const capabilities = new CapabilityRegistry(bus, logs.child({ module: 'capabilities' }));
  const fsService = new FsService(paths);
  const errors = new ErrorLog(bus);
  const notifications = new NotificationService(bus, settings);
  const templates = new TemplateService(db, projects, search);
  const media = new MediaService(db, paths, ffmpeg, tasks, sessions, settings, search, bus, logs.child({ module: 'media' }));
  const exportsService = new ExportService(db, paths, ffmpeg, tasks, projects, sessions, settings, bus, logs.child({ module: 'export' }));
  const previews = new PreviewRenderService(paths, ffmpeg, tasks, projects, sessions, exportsService, logs.child({ module: 'render' }));
  const runtime = new PythonRuntime(paths, tasks, logs.child({ module: 'worker' }));
  const models = new ModelManager(db, paths, tasks, bus, logs.child({ module: 'models' }));
  const gateway = new NetworkGateway(db, settings, logs.child({ module: 'network' }));
  models.setFetcher(gateway.fetchToFile);
  const worker = new WorkerService(paths, runtime, models, ffmpeg, capabilities, hardware, logs.child({ module: 'worker' }));
  const audio = new AudioService(ffmpeg, tasks, projects, sessions, worker, capabilities, logs.child({ module: 'audio' }));
  const vision = new VisionService(ffmpeg, tasks, projects, sessions, worker, previews, logs.child({ module: 'vision' }));
  const subtitles = new SubtitleService(db, paths, tasks, projects, sessions, worker, models, audio, capabilities, search, logs.child({ module: 'subtitles' }));
  const ocr = new OcrService(paths, ffmpeg, tasks, projects, sessions, models, vision, capabilities, search, logs.child({ module: 'ocr' }));
  const enhance = new EnhanceService(ffmpeg, tasks, projects, sessions, media, hardware, capabilities, worker, logs.child({ module: 'render' }));

  const services: EngineServices = { host: opts.host, paths, logs, logger, bus, db, settings, tasks, projects, sessions, hardware, capabilities, search, fs: fsService, errors, notifications, ffmpeg, templates, media, exports: exportsService, previews, runtime, worker, models, gateway, audio, vision, subtitles, ocr, enhance };
  registerCoreCapabilities(services);
  models.setTester((spec, dir) => testModel(services, spec, dir));
  bus.on('models.changed', () => void capabilities.refresh());

  const handlers = { ...createCoreHandlers(services), ...createPhase3Handlers(services) } as ApiHandlers;
  let started = false;

  const engine: Engine = {
    ...services,
    handlers,
    extend(more) {
      Object.assign(handlers, more);
    },
    async invoke(channel, input) {
      const spec = channels[channel];
      if (!spec) throw new AppError({ code: 'INVALID_INPUT', operation: String(channel), message: `Unknown channel ${String(channel)}` });
      const parsed = spec.input.safeParse(input);
      if (!parsed.success) {
        throw new AppError({ code: 'INVALID_INPUT', operation: String(channel), message: `Invalid input for ${String(channel)}: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`, details: { issues: parsed.error.issues } });
      }
      const handler = handlers[channel] as (i: unknown) => unknown;
      if (!handler) throw new AppError({ code: 'NOT_IMPLEMENTED', operation: String(channel), message: `Channel ${String(channel)} has no handler` });
      const t0 = Date.now();
      try {
        const result = await handler(parsed.data);
        if (opts.host.isDev) {
          const out = spec.output.safeParse(result);
          if (!out.success) logger.warn({ operation: String(channel), issues: out.error.issues.slice(0, 3) }, 'handler output does not match contract');
        }
        return result as ChannelOutput<typeof channel>;
      } catch (err) {
        const appErr = AppError.from(err, { code: 'UNKNOWN', operation: String(channel) });
        logger.error({ operation: String(channel), err: appErr.info, errorId: appErr.info.errorId, durationMs: Date.now() - t0, status: 'failed' }, appErr.message);
        throw appErr;
      }
    },
    async start() {
      if (started) return;
      started = true;
      const wasOpen = sessions.markStarted();
      tasks.recoverFromPreviousRun();
      seedBuiltinTemplates(services);
      sessions.checkRecovery(wasOpen);
      await hardware.snapshot(true).catch((err) => logger.warn({ err }, 'initial hardware snapshot failed'));
      hardware.start(5000);
      await capabilities.refresh();
      logger.info({ operation: 'start', wasOpen }, 'engine started');
    },
    async dispose() {
      hardware.stop();
      try {
        sessions.closeAll();
      } catch (err) {
        logger.error({ err }, 'closing sessions failed');
      }
      await tasks.shutdown();
      await worker.stop();
      await ocr.dispose();
      sessions.markCleanShutdown();
      db.close();
      logs.flush();
    },
  };
  return engine;
}

function registerCoreCapabilities(s: EngineServices): void {
  const ffmpegOk = () => Boolean(s.ffmpeg.ffmpeg && s.ffmpeg.ffprobe);
  const ffmpegGate = (): Partial<CapabilityReport> =>
    ffmpegOk()
      ? { status: 'available', providerId: 'ffmpeg', external: false, action: { type: 'none', target: null } }
      : { status: 'needs-runtime', reasonKey: 'capabilities.ffmpegMissing', action: { type: 'open-settings', target: 'system' }, external: false };
  for (const id of ['media.import', 'media.proxy', 'edit.basic', 'render.export', 'audio.enhance', 'enhance.video', 'stabilize', 'interpolate', 'upscale.lanczos'] as const) {
    s.capabilities.register(id, ffmpegGate);
  }
  s.capabilities.register('render.hwencode', () =>
    !ffmpegOk()
      ? { status: 'needs-runtime', reasonKey: 'capabilities.ffmpegMissing', action: { type: 'open-settings', target: 'system' } }
      : s.ffmpeg.hwEncoders.length > 0
        ? { status: 'available', providerId: 'ffmpeg', reasonParams: { encoders: s.ffmpeg.hwEncoders.join(', ') } }
        : { status: 'needs-hardware', reasonKey: 'capabilities.noHardwareEncoder', action: { type: 'none', target: null } },
  );
  s.capabilities.register('planner.deterministic', () => ({ status: 'available', providerId: 'deterministic-planner', external: false }));
  // Language-model based capabilities arrive with the assistant phase; until then their status is derived honestly from installed models.
  s.capabilities.register('llm.text', () => {
    const installed = ['llm/qwen2.5-3b-instruct-q4', 'llm/qwen2.5-7b-instruct-q4'].filter((m) => s.models.isInstalled(m));
    if (installed.length === 0) return { status: 'needs-model', reasonKey: 'capabilities.modelMissing', reasonParams: { models: 'llm/qwen2.5-3b-instruct-q4' }, action: { type: 'open-models', target: 'llm/qwen2.5-3b-instruct-q4' } };
    return { status: 'unavailable', reasonKey: 'capabilities.notImplemented', reasonParams: { models: installed.join(', ') }, action: { type: 'none', target: null } };
  });
  s.capabilities.register('translate', () => ({ status: 'needs-provider', reasonKey: 'capabilities.needsTextProvider', action: { type: 'open-models', target: 'llm/qwen2.5-3b-instruct-q4' } }));
  s.capabilities.register('gen.music', () => ({ status: 'needs-provider', reasonKey: 'capabilities.needsMusicProvider', action: { type: 'open-providers', target: null } }));
}

/** Real smoke test per model family, run on bundled sample media. Never reports success without an actual inference. */
async function testModel(s: EngineServices, spec: ModelSpec, dir: string): Promise<{ ok: boolean; message: string }> {
  const sample = (name: string): string => {
    const p = path.join(s.paths.resources, 'test', name);
    if (!fs.existsSync(p)) throw new AppError({ code: 'FILE_NOT_FOUND', operation: 'models.test', message: `Test sample ${name} is missing from the application resources` });
    return p;
  };
  switch (spec.id) {
    case 'opencv/yunet-2023mar': {
      const r = await s.worker.detectFacesInImage(sample('face-sample.jpg'));
      return { ok: r.faces.length >= 1, message: `${r.faces.length} face(s) detected in the sample photo` };
    }
    case 'opencv/sface-2021dec': {
      const r = await s.worker.embedFaces(sample('face-sample.jpg'));
      const dims = r.faces[0]?.embedding.length ?? 0;
      return { ok: r.faces.length >= 1 && dims >= 64, message: `${r.faces.length} face(s), ${dims}-dimensional embedding` };
    }
    case 'opencv/vittrack-2023sep': {
      const r = await s.worker.track(sample('face-sample.jpg'), { startMs: 0, endMs: 100, box: { x: 0.3, y: 0.2, w: 0.3, h: 0.4 }, detector: null });
      return { ok: r.keyframes.length >= 1, message: `tracker initialized (${r.status})` };
    }
    case 'mediapipe/efficientdet-lite0':
    case 'mediapipe/efficientdet-lite2': {
      const r = await s.worker.detectObjects(sample('face-sample.jpg'), { sampleFps: 1 });
      const labels = r.frames.flatMap((f) => f.objects.map((o) => o.label));
      return { ok: labels.length >= 1, message: labels.length ? `detected: ${[...new Set(labels)].join(', ')}` : 'no objects detected in the sample image' };
    }
    case 'silero/vad-v5': {
      const r = await s.worker.vad(sample('speech-sample.wav'));
      return { ok: r.speech.length >= 1 && r.speech_ratio > 0.2, message: `${r.speech.length} speech segment(s), ${Math.round(r.speech_ratio * 100)}% speech` };
    }
    case 'tesseract/eng-fast': {
      const r = await s.ocr.recognizeFile(sample('text-sample.png'), ['en']);
      return { ok: /OPEN/i.test(r.text), message: r.text ? `recognized: ${r.text.replace(/\n/g, ' | ').slice(0, 80)}` : 'no text recognized' };
    }
    case 'tesseract/ara-fast': {
      const r = await s.ocr.recognizeFile(sample('text-sample.png'), ['ar']);
      return { ok: /[؀-ۿ]/.test(r.text), message: r.text ? `recognized: ${r.text.replace(/\n/g, ' | ').slice(0, 80)}` : 'no Arabic text recognized' };
    }
    case 'whisper/small-ct2':
    case 'whisper/medium-ct2':
    case 'whisper/large-v3-turbo-ct2': {
      const r = await s.worker.transcribe(sample('speech-sample.wav'), { modelId: spec.id, language: 'en' });
      const text = r.segments.map((x) => x.text).join(' ').trim();
      return { ok: /speech|sample|seven/i.test(text), message: text ? `heard: "${text.slice(0, 80)}" (${r.device})` : 'nothing transcribed' };
    }
    case 'piper/ar-kareem-medium':
    case 'piper/en-lessac-medium': {
      const out = path.join(s.paths.tmp, `tts-test-${Date.now()}.wav`);
      try {
        const r = await s.worker.synthesize(spec.id.startsWith('piper/ar') ? 'مرحبا بكم في سفن فيد' : 'Welcome to seven vid', out, { engine: 'piper', modelId: spec.id });
        return { ok: r.duration_ms > 300, message: `synthesized ${Math.round(r.duration_ms)} ms of speech` };
      } finally {
        fs.rmSync(out, { force: true });
      }
    }
    case 'realesrgan/x4plus': {
      const out = path.join(s.paths.tmp, `upscale-test-${Date.now()}.png`);
      try {
        const r = await s.worker.upscaleImage(sample('text-sample.png'), out, { factor: 4 });
        return { ok: r.width > 0, message: `upscaled sample to ${r.width}×${r.height}` };
      } finally {
        fs.rmSync(out, { force: true });
      }
    }
    default:
      return { ok: false, message: `Files present in ${dir}; a runtime test for this model family is not available in this build yet` };
  }
}

function seedBuiltinTemplates(s: EngineServices): void {
  const dir = path.join(s.paths.resources, 'templates');
  if (!fs.existsSync(dir)) return;
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    try {
      const t = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as { id: string; name: string; category: string; [k: string]: unknown };
      if (!t.id || !t.name || !t.category) continue;
      s.db.templates.upsert({ id: t.id, name: t.name, category: t.category, builtin: true, template: t, thumbnailPath: null });
      s.search.index({ type: 'template', id: t.id, projectId: null, title: t.name, body: `${t.category} ${String(t.description ?? '')}` });
    } catch (err) {
      s.logger.warn({ operation: 'seedTemplates', file: f, err }, 'invalid template file');
    }
  }
}
