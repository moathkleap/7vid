import fs from 'node:fs';
import type { ApiHandlers, ModelStatusInfo, RuntimeStatus } from '@sevenvid/ipc';
import type { HardwareSnapshot } from '@sevenvid/ipc';
import type { EngineServices } from './createEngine';
import type { ModelStatus } from '../models/ModelManager';
import type { ModelSpec } from '../models/registry';

export type Phase3Channel =
  | 'render.compare'
  | 'models.list' | 'models.get' | 'models.download' | 'models.remove' | 'models.test'
  | 'runtime.status' | 'runtime.setup' | 'runtime.restart'
  | 'vision.detectFaces' | 'vision.detectObjects' | 'vision.blurFaces' | 'vision.trackTarget' | 'vision.verifyMask' | 'analysis.get'
  | 'audio.detectSilence' | 'audio.removeSilence' | 'audio.measure' | 'audio.applyPreset' | 'audio.previewEnhance'
  | 'subtitles.transcribe' | 'subtitles.import' | 'subtitles.export'
  | 'ocr.detect' | 'ocr.createMasks'
  | 'enhance.upscale';

const EXTRAS: Array<{ id: string; approxMb: number; capability: string }> = [
  { id: 'vision', approxMb: 420, capability: 'faces' },
  { id: 'audio', approxMb: 90, capability: 'audio' },
  { id: 'stt', approxMb: 260, capability: 'stt' },
  { id: 'tts', approxMb: 60, capability: 'tts' },
  { id: 'upscale', approxMb: 80, capability: 'upscale' },
  { id: 'gen', approxMb: 6500, capability: 'gen' },
];

/** Hardware fit of a model against the latest hardware snapshot (RAM/VRAM/GPU requirements). */
export function modelFit(spec: ModelSpec, hw: HardwareSnapshot | null): ModelStatusInfo['fit'] {
  if (!hw) return { ok: true, reasonKey: null, params: {} };
  const maxVram = hw.gpus.reduce((m, g) => Math.max(m, g.vramMb ?? 0), 0);
  if (spec.requiresGpu && hw.gpus.length === 0) return { ok: false, reasonKey: 'models.fit.needsGpu', params: {} };
  if (spec.vramMb && maxVram > 0 && maxVram < spec.vramMb) return { ok: false, reasonKey: 'models.fit.lowVram', params: { needed: spec.vramMb, have: maxVram } };
  if (spec.requiresGpu && spec.vramMb && maxVram === 0) return { ok: false, reasonKey: 'models.fit.needsGpu', params: { needed: spec.vramMb } };
  if (spec.ramMb && hw.memory.totalMb < spec.ramMb) return { ok: false, reasonKey: 'models.fit.lowRam', params: { needed: spec.ramMb, have: hw.memory.totalMb } };
  return { ok: true, reasonKey: null, params: {} };
}

export function isDownloadable(spec: ModelSpec): boolean {
  return spec.files.every((f) => f.url.startsWith('https://') && !(f.url.startsWith('https://huggingface.co/') && !/\/resolve\//.test(f.url)));
}

export function createPhase3Handlers(s: EngineServices): Pick<ApiHandlers, Phase3Channel> {
  const enrich = (st: ModelStatus): ModelStatusInfo => {
    const task = s.tasks.list().find((t) => t.kind === 'models.download' && t.params.modelId === st.spec.id && (t.status === 'queued' || t.status === 'running' || t.status === 'paused'));
    return { ...st, downloadTaskId: task?.id ?? null, fit: modelFit(st.spec, s.hardware.current), downloadable: isDownloadable(st.spec) };
  };
  const runtimeStatus = async (probe: boolean): Promise<RuntimeStatus> => {
    const py = await s.runtime.detect(probe);
    const hello = probe ? await s.worker.probe() : s.worker.hello;
    const caps = hello?.capabilities ?? {};
    const setup = s.tasks.list().find((t) => t.kind === 'runtime.setup' && (t.status === 'queued' || t.status === 'running'));
    return {
      python: py ? { path: py.path, version: py.version, source: py.source, venvReady: py.venvReady, workerInstalled: py.workerInstalled } : null,
      worker: hello ? { running: true, version: hello.version, device: hello.device, capabilities: Object.fromEntries(Object.entries(caps).map(([k, v]) => [k, { available: Boolean(v.available), reason: v.reason ?? null }])) } : null,
      workerSourceDir: s.runtime.workerSourceDir,
      venvDir: s.paths.venv,
      lastError: s.worker.error,
      setupTaskId: setup?.id ?? null,
      extras: EXTRAS.map((e) => ({ id: e.id, approxMb: e.approxMb, installed: e.id === 'tts' ? Boolean(caps.tts?.engines?.piper?.available) : Boolean(caps[e.capability]?.available) })),
    };
  };
  return {
    'render.compare': ({ projectId, startMs, endMs }) => s.previews.compareTask(projectId, startMs, endMs),
    'models.list': () => s.models.list().map(enrich),
    'models.get': ({ modelId }) => enrich(s.models.status(modelId)),
    'models.download': ({ modelId }) => s.models.startDownload(modelId),
    'models.remove': ({ modelId }) => ({ removed: s.models.remove(modelId) }),
    'models.test': ({ modelId }) => s.models.test(modelId),
    'runtime.status': (input) => runtimeStatus(Boolean(input?.probe)),
    'runtime.setup': ({ extras }) => s.runtime.startSetupTask(extras),
    'runtime.restart': async () => {
      await s.worker.restart();
      await s.capabilities.refresh();
      return runtimeStatus(true);
    },
    'vision.detectFaces': (p) => s.vision.startDetectFaces(p),
    'vision.detectObjects': (p) => s.vision.startDetectObjects(p),
    'vision.blurFaces': (p) => s.vision.startBlurFaces(p),
    'vision.trackTarget': (p) => s.vision.startTrackTarget(p),
    'vision.verifyMask': (p) => s.vision.startVerifyMask(p),
    'analysis.get': ({ projectId, clipId, kind }) => s.vision.readAnalysis(projectId, clipId, kind),
    'audio.detectSilence': (p) => s.audio.startDetectSilence(p),
    'audio.removeSilence': (p) => s.audio.startRemoveSilence(p),
    'audio.measure': (p) => s.audio.startMeasure(p),
    'audio.applyPreset': ({ projectId, clipIds, presetId }) => s.audio.applyPreset(projectId, clipIds, presetId),
    'audio.previewEnhance': (p) => s.audio.startPreviewEnhance(p),
    'subtitles.transcribe': (p) => s.subtitles.startTranscribe({ ...p, clipId: p.clipId ?? null }),
    'subtitles.import': ({ projectId, path: file, language }) => s.subtitles.import(projectId, file, language),
    'subtitles.export': ({ projectId, trackId, format, outputPath }) => s.subtitles.export(projectId, trackId, format, outputPath),
    'ocr.detect': (p) => s.ocr.startDetect(p),
    'ocr.createMasks': ({ projectId, clipId, kind, trackIndexes }) => s.ocr.createMasks(projectId, clipId, kind, trackIndexes),
    'enhance.upscale': (p) => s.enhance.startUpscale(p),
  };
}

export function fileExists(p: string): boolean {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}
