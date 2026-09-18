import path from 'node:path';
import type { CapabilityId } from '@sevenvid/core';
import type { CapabilityRegistry, CapabilityReport } from '../capabilities/CapabilityRegistry';
import { AppError } from '../errors';
import type { FfmpegLocation } from '../ffmpeg/locator';
import type { HardwareMonitor } from '../hardware/HardwareMonitor';
import type { Logger } from '../logging/logger';
import type { ModelManager } from '../models/ModelManager';
import type { AppPaths } from '../paths/AppPaths';
import type { PythonRuntime } from './PythonRuntime';
import { WorkerClient, type WorkerHello } from './WorkerClient';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FaceDetection extends Box {
  score: number;
  landmarks: number[][];
}

export interface FacesResult {
  frames: Array<{ t_ms: number; faces: FaceDetection[] }>;
  width: number;
  height: number;
  fps: number;
  duration_ms: number;
  sample_fps: number;
  total_faces: number;
}

export interface ObjectsResult {
  frames: Array<{ t_ms: number; objects: Array<Box & { score: number; label: string }> }>;
  width: number;
  height: number;
  fps: number;
  duration_ms: number;
}

export interface TrackResult {
  keyframes: Array<Box & { t_ms: number; confidence: number }>;
  status: 'ok' | 'partial' | 'lost';
  lost_ranges: Array<{ start_ms: number; end_ms: number }>;
  covered_end_ms: number;
  width: number;
  height: number;
  fps: number;
}

export interface VadResult {
  speech: Array<{ start_ms: number; end_ms: number; kind: 'speech' }>;
  silence: Array<{ start_ms: number; end_ms: number; kind: 'silence' }>;
  duration_ms: number;
  speech_ratio: number;
}

export interface SttResult {
  language: string;
  language_probability: number;
  duration_ms: number;
  segments: Array<{ start_ms: number; end_ms: number; text: string; words: Array<{ start_ms: number; end_ms: number; word: string; probability: number }>; no_speech_prob: number }>;
  device: string;
  compute_type: string;
}

type Progress = (ratio: number, message: string | null) => void;

/** High-level, typed access to the Python worker plus capability reporting derived from real probes. */
export class WorkerService {
  private client: WorkerClient | null = null;
  private lastHello: WorkerHello | null = null;
  private lastError: string | null = null;

  constructor(
    private readonly paths: AppPaths,
    private readonly runtime: PythonRuntime,
    private readonly models: ModelManager,
    private readonly ffmpeg: FfmpegLocation,
    private readonly capabilities: CapabilityRegistry,
    private readonly hardware: HardwareMonitor,
    private readonly logger: Logger,
  ) {
    hardware.setPythonProbe(async () => {
      const py = await runtime.detect();
      return { available: Boolean(py), version: py?.version ?? null, path: py?.path ?? null, venvReady: Boolean(py?.workerInstalled), device: this.lastHello?.device ?? null };
    });
    this.registerCapabilities();
  }

  get hello(): WorkerHello | null {
    return this.lastHello;
  }

  /** Last start/probe failure, for the runtime status screen. */
  get error(): string | null {
    return this.lastError;
  }

  /** Stops the worker, re-detects Python and starts it again. */
  async restart(): Promise<WorkerHello | null> {
    await this.stop();
    this.lastHello = null;
    await this.runtime.detect(true);
    return this.probe();
  }

  upscaleImage(src: string, outPath: string, opts: { factor?: number; signal?: AbortSignal } = {}): Promise<{ out_path: string; width: number; height: number }> {
    return this.call('upscale.image', { path: src, out_path: outPath, model: 0, factor: opts.factor ?? 4 }, { signal: opts.signal, timeoutMs: 600_000 });
  }

  /** Starts (or reuses) the worker. Throws WORKER_UNAVAILABLE with setup guidance when Python is missing. */
  async ensure(): Promise<WorkerClient> {
    if (this.client?.running) return this.client;
    const py = await this.runtime.detect();
    if (!py || !py.workerInstalled) {
      throw new AppError({ code: 'WORKER_UNAVAILABLE', operation: 'worker.ensure', message: py ? `Python ${py.version} found at ${py.path} but the 7vid worker is not installed` : 'No Python ≥ 3.10 interpreter found', details: { python: py?.path ?? null } });
    }
    const env: Record<string, string> = { SEVENVID_FFMPEG_PATH: this.ffmpeg.ffmpeg ?? '' };
    if (!py.venvReady) env.PYTHONPATH = this.runtime.workerSourceDir;
    const client = new WorkerClient(py.path, this.runtime.workerSourceDir, env, this.logger);
    try {
      this.lastHello = await client.start();
      this.lastError = null;
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
      throw err;
    }
    this.client = client;
    void this.capabilities.refresh();
    return client;
  }

  async probe(): Promise<WorkerHello | null> {
    try {
      await this.ensure();
      return this.lastHello;
    } catch (err) {
      this.logger.info({ module: 'worker', err: err instanceof Error ? err.message : String(err) }, 'worker probe: unavailable');
      return null;
    }
  }

  private async call<T>(method: string, params: Record<string, unknown>, opts: { signal?: AbortSignal; onProgress?: Progress; timeoutMs?: number } = {}): Promise<T> {
    const client = await this.ensure();
    try {
      return await client.request<T>(method, { ...params, ffmpeg: this.ffmpeg.ffmpeg }, opts);
    } catch (err) {
      if (AppError.is(err) && err.info.code === 'WORKER_CRASHED' && !opts.signal?.aborted) {
        this.logger.warn({ module: 'worker', method }, 'worker crashed; restarting once');
        await client.restart();
        return client.request<T>(method, { ...params, ffmpeg: this.ffmpeg.ffmpeg }, opts);
      }
      throw err;
    }
  }

  private modelPath(id: string, operation: string): string {
    const p = this.models.pathFor(id);
    if (!p) throw new AppError({ code: 'MODEL_NOT_INSTALLED', operation, message: `Model ${id} is not installed`, details: { modelId: id } });
    return p;
  }

  detectFaces(file: string, opts: { sampleFps?: number; startMs?: number; endMs?: number; scoreThreshold?: number; signal?: AbortSignal; onProgress?: Progress } = {}): Promise<FacesResult> {
    return this.call<FacesResult>('faces.detect', { path: file, model_path: this.modelPath('opencv/yunet-2023mar', 'vision.faces'), sample_fps: opts.sampleFps ?? 4, start_ms: opts.startMs ?? 0, end_ms: opts.endMs ?? null, score_threshold: opts.scoreThreshold ?? 0.7 }, opts);
  }

  detectFacesInImage(file: string): Promise<{ faces: FaceDetection[]; width: number; height: number }> {
    return this.call('faces.detectImage', { path: file, model_path: this.modelPath('opencv/yunet-2023mar', 'vision.faces') });
  }

  detectObjects(file: string, opts: { sampleFps?: number; startMs?: number; endMs?: number; scoreThreshold?: number; categories?: string[]; signal?: AbortSignal; onProgress?: Progress } = {}): Promise<ObjectsResult> {
    return this.call<ObjectsResult>('objects.detect', { path: file, model_path: this.modelPath('mediapipe/efficientdet-lite0', 'vision.objects'), sample_fps: opts.sampleFps ?? 2, start_ms: opts.startMs ?? 0, end_ms: opts.endMs ?? null, score_threshold: opts.scoreThreshold ?? 0.4, categories: opts.categories ?? null }, opts);
  }

  track(file: string, opts: { startMs: number; endMs: number; box: Box; detector?: 'face' | null; signal?: AbortSignal; onProgress?: Progress }): Promise<TrackResult> {
    const vit = this.models.pathFor('opencv/vittrack-2023sep');
    return this.call<TrackResult>('track.run', { path: file, start_ms: opts.startMs, end_ms: opts.endMs, box: opts.box, detector: opts.detector ?? null, face_model_path: opts.detector === 'face' ? this.modelPath('opencv/yunet-2023mar', 'vision.tracking') : null, tracker: 'csrt', vit_model_path: vit, keyframe_every: 1 }, opts);
  }

  vad(file: string, opts: { startMs?: number; endMs?: number; minSilenceMs?: number; minSpeechMs?: number; threshold?: number; signal?: AbortSignal; onProgress?: Progress } = {}): Promise<VadResult> {
    return this.call<VadResult>('vad.detect', { path: file, model_path: this.modelPath('silero/vad-v5', 'audio.vad'), start_ms: opts.startMs ?? null, end_ms: opts.endMs ?? null, min_silence_ms: opts.minSilenceMs ?? 500, min_speech_ms: opts.minSpeechMs ?? 250, threshold: opts.threshold ?? 0.5 }, opts);
  }

  blurMetric(file: string, samples: Array<{ t_ms: number; box: Box | null }>): Promise<{ samples: Array<{ t_ms: number; sharpness: number; mean: number }> }> {
    return this.call('verify.blurMetric', { path: file, samples });
  }

  compareFrames(a: string, b: string, samples: Array<{ t_ms: number; box: Box | null }>): Promise<{ samples: Array<{ t_ms: number; mean_abs_diff: number; sharpness_a: number; sharpness_b: number }> }> {
    return this.call('verify.compare', { a, b, samples });
  }

  measureAudio(file: string, opts: { startMs?: number; endMs?: number } = {}): Promise<{ lufs: number | null; peak_dbfs: number | null; rms_dbfs: number | null; duration_ms: number }> {
    return this.call('audio.measure', { path: file, start_ms: opts.startMs ?? null, end_ms: opts.endMs ?? null });
  }

  denoiseAudio(file: string, outPath: string, strength: number, opts: { signal?: AbortSignal; onProgress?: Progress } = {}): Promise<{ out_path: string; duration_ms: number }> {
    return this.call('audio.denoise', { path: file, out_path: outPath, strength }, opts);
  }

  synthesize(text: string, outPath: string, opts: { engine: 'espeak' | 'piper'; voice?: string; modelId?: string; rate?: number; signal?: AbortSignal }): Promise<{ out_path: string; duration_ms: number; engine: string }> {
    const modelPath = opts.engine === 'piper' && opts.modelId ? this.models.pathFor(opts.modelId) : null;
    return this.call('tts.synthesize', { text, out_path: outPath, engine: opts.engine, voice: opts.voice ?? null, model_path: modelPath, model_id: opts.modelId ?? null, rate: opts.rate ?? 165 }, { signal: opts.signal, timeoutMs: 600_000 });
  }

  transcribe(file: string, opts: { modelId: string; language?: 'ar' | 'en' | 'auto'; signal?: AbortSignal; onProgress?: Progress }): Promise<SttResult> {
    const dir = path.dirname(this.modelPath(opts.modelId, 'stt'));
    return this.call<SttResult>('stt.transcribe', { path: file, model_dir: dir, language: opts.language ?? 'auto', word_timestamps: true }, { signal: opts.signal, onProgress: opts.onProgress });
  }

  embedFaces(imagePath: string): Promise<{ faces: Array<{ box: Box; score: number; embedding: number[] }> }> {
    return this.call('faces.embedImage', { path: imagePath, det_model_path: this.modelPath('opencv/yunet-2023mar', 'vision.faceEmbedding'), rec_model_path: this.modelPath('opencv/sface-2021dec', 'vision.faceEmbedding') });
  }

  async stop(): Promise<void> {
    await this.client?.stop();
    this.client = null;
  }

  private registerCapabilities(): void {
    const runtimeGate = async (): Promise<Partial<CapabilityReport> | null> => {
      const py = await this.runtime.detect();
      if (!py) return { status: 'needs-runtime', reasonKey: 'capabilities.pythonMissing', action: { type: 'setup-runtime', target: null } };
      if (!py.workerInstalled) return { status: 'needs-runtime', reasonKey: 'capabilities.workerNotInstalled', reasonParams: { python: py.path }, action: { type: 'setup-runtime', target: null } };
      return null;
    };
    const workerCap = (name: string, modelIds: string[], id: CapabilityId, external = false) => {
      this.capabilities.register(id, async () => {
        const gate = await runtimeGate();
        if (gate) return gate;
        const hello = this.lastHello ?? (await this.probe());
        if (!hello) return { status: 'needs-runtime', reasonKey: 'capabilities.workerFailed', reasonParams: { error: this.lastError ?? '' }, action: { type: 'setup-runtime', target: null } };
        const cap = hello.capabilities[name];
        if (!cap?.available) return { status: 'needs-runtime', reasonKey: 'capabilities.workerModuleMissing', reasonParams: { module: name, reason: cap?.reason ?? '' }, action: { type: 'setup-runtime', target: null } };
        const missing = modelIds.filter((m) => !this.models.isInstalled(m));
        if (missing.length) return { status: 'needs-model', reasonKey: 'capabilities.modelMissing', reasonParams: { models: missing.join(', ') }, action: { type: 'open-models', target: missing[0]! } };
        return { status: 'available', providerId: `worker-${name}`, external, reasonParams: { device: hello.device } };
      });
    };
    workerCap('vad', ['silero/vad-v5'], 'audio.vad');
    workerCap('faces', ['opencv/yunet-2023mar'], 'vision.faces');
    workerCap('objects', ['mediapipe/efficientdet-lite0'], 'vision.objects');
    workerCap('tracking', ['opencv/yunet-2023mar'], 'vision.tracking');
    workerCap('faceembed', ['opencv/yunet-2023mar', 'opencv/sface-2021dec'], 'vision.faceEmbedding');
    this.capabilities.register('vision.segmentation', async () => {
      const gate = await runtimeGate();
      if (gate) return gate;
      return this.models.isInstalled('mediapipe/selfie-segmenter') ? { status: 'available', providerId: 'worker-vision' } : { status: 'needs-model', reasonKey: 'capabilities.modelMissing', reasonParams: { models: 'mediapipe/selfie-segmenter' }, action: { type: 'open-models', target: 'mediapipe/selfie-segmenter' } };
    });
    this.capabilities.register('python.runtime', async () => {
      const gate = await runtimeGate();
      if (gate) return gate;
      const hello = this.lastHello ?? (await this.probe());
      return hello ? { status: 'available', providerId: 'python', reasonParams: { device: hello.device, python: hello.python } } : { status: 'needs-runtime', reasonKey: 'capabilities.workerFailed', reasonParams: { error: this.lastError ?? '' }, action: { type: 'setup-runtime', target: null } };
    });
    this.capabilities.register('stt', async () => {
      const gate = await runtimeGate();
      if (gate) return gate;
      const hello = this.lastHello ?? (await this.probe());
      if (!hello?.capabilities.stt?.available) return { status: 'needs-runtime', reasonKey: 'capabilities.workerModuleMissing', reasonParams: { module: 'stt', reason: hello?.capabilities.stt?.reason ?? '' }, action: { type: 'setup-runtime', target: null } };
      const installed = ['whisper/small-ct2', 'whisper/medium-ct2', 'whisper/large-v3-turbo-ct2'].filter((m) => this.models.isInstalled(m));
      if (installed.length === 0) return { status: 'needs-model', reasonKey: 'capabilities.modelMissing', reasonParams: { models: 'whisper/small-ct2' }, action: { type: 'open-models', target: 'whisper/small-ct2' } };
      return { status: 'available', providerId: 'faster-whisper', reasonParams: { models: installed.join(', '), device: hello.device } };
    });
    this.capabilities.register('tts', async () => {
      const gate = await runtimeGate();
      if (gate) return gate;
      const hello = this.lastHello ?? (await this.probe());
      const engines = hello?.capabilities.tts?.engines ?? {};
      const piperReady = engines.piper?.available && ['piper/ar-kareem-medium', 'piper/en-lessac-medium'].some((m) => this.models.isInstalled(m));
      if (piperReady) return { status: 'available', providerId: 'piper' };
      if (engines.espeak?.available) return { status: 'available', providerId: 'espeak', reasonParams: { quality: 'basic' } };
      return { status: 'needs-runtime', reasonKey: 'capabilities.workerModuleMissing', reasonParams: { module: 'tts', reason: hello?.capabilities.tts?.reason ?? '' }, action: { type: 'setup-runtime', target: null } };
    });
    this.capabilities.register('upscale.ai', async () => {
      const gate = await runtimeGate();
      if (gate) return gate;
      const hello = this.lastHello ?? (await this.probe());
      const cap = hello?.capabilities.upscale;
      if (!cap?.available) return { status: cap?.reason?.includes('Vulkan') ? 'needs-hardware' : 'needs-runtime', reasonKey: 'capabilities.upscaleUnavailable', reasonParams: { reason: cap?.reason ?? '' }, action: { type: 'setup-runtime', target: null } };
      return { status: 'available', providerId: 'realesrgan' };
    });
    for (const id of ['gen.image', 'gen.video'] as const) {
      this.capabilities.register(id, async () => {
        const gate = await runtimeGate();
        if (gate) return gate;
        const hello = this.lastHello ?? (await this.probe());
        const cap = hello?.capabilities.gen;
        if (!cap?.available) return { status: 'needs-runtime', reasonKey: 'capabilities.genUnavailable', reasonParams: { reason: cap?.reason ?? '' }, action: { type: 'setup-runtime', target: null } };
        const modelId = id === 'gen.image' ? 'sd/sdxl-turbo' : 'wan/2.1-t2v-1.3b';
        if (!this.models.isInstalled(modelId)) return { status: 'needs-model', reasonKey: 'capabilities.modelMissing', reasonParams: { models: modelId }, action: { type: 'open-models', target: modelId } };
        if (!(cap as { gpu?: boolean }).gpu) return { status: 'needs-hardware', reasonKey: 'capabilities.genNeedsGpu', action: { type: 'none', target: null } };
        return { status: 'available', providerId: 'diffusers' };
      });
    }
  }
}
