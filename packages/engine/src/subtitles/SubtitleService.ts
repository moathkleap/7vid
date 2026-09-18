import fs from 'node:fs';
import path from 'node:path';
import { createSubtitleTrack, getDocumentDurationMs, newId, type ProjectDocument, type SubtitleCue } from '@sevenvid/core';
import type { SessionState, TaskInfo, TranscribeResult } from '@sevenvid/ipc';
import type { AudioService } from '../audio/AudioService';
import type { CapabilityRegistry } from '../capabilities/CapabilityRegistry';
import type { AppDatabase } from '../db/database';
import { AppError } from '../errors';
import type { Logger } from '../logging/logger';
import type { ModelManager } from '../models/ModelManager';
import type { AppPaths } from '../paths/AppPaths';
import type { ProjectService } from '../project/ProjectService';
import type { SessionManager } from '../project/SessionManager';
import type { SearchService } from '../search/SearchService';
import type { TaskManager } from '../tasks/TaskManager';
import type { WorkerService } from '../worker/WorkerService';
import { parseSubtitles, toAss, toSrt, toVtt } from './writers';

type Ctx = { progress: (v: number, m?: string | null) => void; signal: AbortSignal };

export interface TranscribeOptions {
  projectId: string;
  clipId?: string | null;
  language?: 'auto' | 'ar' | 'en';
  modelId?: string;
}

export const STT_MODEL_IDS = ['whisper/large-v3-turbo-ct2', 'whisper/medium-ct2', 'whisper/small-ct2'] as const;

const ARABIC = /[؀-ۿ]/;

/** Speech-to-text into subtitle tracks, SRT/VTT/ASS import and export with re-parse verification. */
export class SubtitleService {
  constructor(
    private readonly db: AppDatabase,
    private readonly paths: AppPaths,
    private readonly tasks: TaskManager,
    private readonly projects: ProjectService,
    private readonly sessions: SessionManager,
    private readonly worker: WorkerService,
    private readonly models: ModelManager,
    private readonly audio: AudioService,
    private readonly capabilities: CapabilityRegistry,
    private readonly search: SearchService,
    private readonly logger: Logger,
  ) {
    tasks.registerKind<TranscribeOptions, TranscribeResult>({ kind: 'subtitles.transcribe', lane: 'default', title: () => 'Transcribe speech', run: (ctx) => this.transcribe(ctx.params, ctx) });
  }

  private doc(projectId: string): ProjectDocument {
    return this.sessions.isOpen(projectId) ? this.sessions.get(projectId).document : this.projects.loadLatestDocument(projectId);
  }

  installedSttModel(preferred?: string): string | null {
    if (preferred && this.models.isInstalled(preferred)) return preferred;
    return STT_MODEL_IDS.find((id) => this.models.isInstalled(id)) ?? null;
  }

  startTranscribe(opts: TranscribeOptions): TaskInfo {
    this.sessions.get(opts.projectId);
    const modelId = this.installedSttModel(opts.modelId);
    if (!modelId) throw new AppError({ code: 'MODEL_NOT_INSTALLED', operation: 'subtitles.transcribe', message: 'No speech-recognition model is installed (install a Whisper model from AI Models)', details: { candidates: STT_MODEL_IDS } });
    if (!this.capabilities.isAvailable('stt')) {
      const cap = this.capabilities.status('stt');
      throw new AppError({ code: cap.status === 'needs-runtime' ? 'WORKER_UNAVAILABLE' : 'MODEL_NOT_INSTALLED', operation: 'subtitles.transcribe', message: `Speech recognition is not available (${cap.status})`, details: { capability: cap } });
    }
    return this.tasks.enqueue({ kind: 'subtitles.transcribe', params: { ...opts, modelId }, projectId: opts.projectId, priority: 3 });
  }

  private async transcribe(opts: TranscribeOptions, ctx: Ctx): Promise<TranscribeResult> {
    const session = this.sessions.get(opts.projectId);
    const doc = session.document;
    const total = getDocumentDurationMs(doc);
    if (total <= 0) throw new AppError({ code: 'VALIDATION_FAILED', operation: 'subtitles.transcribe', message: 'The timeline is empty' });
    const modelId = this.installedSttModel(opts.modelId);
    if (!modelId) throw new AppError({ code: 'MODEL_NOT_INSTALLED', operation: 'subtitles.transcribe', message: 'No speech-recognition model is installed' });
    let range = { startMs: 0, endMs: total };
    let clipName: string | null = null;
    if (opts.clipId) {
      const clip = doc.tracks.flatMap((t) => t.clips).find((c) => c.id === opts.clipId);
      if (!clip) throw new AppError({ code: 'COMMAND_FAILED', operation: 'subtitles.transcribe', message: `Clip ${opts.clipId} not found` });
      range = { startMs: clip.startMs, endMs: clip.startMs + clip.durationMs };
      clipName = clip.name;
    }
    const dir = path.join(this.projects.get(opts.projectId).dataDir, 'cache', 'audio');
    fs.mkdirSync(dir, { recursive: true });
    const wav = path.join(dir, `stt-${newId()}.wav`);
    try {
      ctx.progress(0.02, 'render audio');
      await this.audio.renderAudio(doc, opts.projectId, range, wav, { sampleRate: 16000, channels: 1, signal: ctx.signal, onProgress: (r) => ctx.progress(0.02 + r * 0.18, 'render audio') });
      ctx.progress(0.2, 'transcribe');
      const res = await this.worker.transcribe(wav, { modelId, language: opts.language ?? 'auto', signal: ctx.signal, onProgress: (r, m) => ctx.progress(0.2 + r * 0.7, m) });
      if (res.segments.length === 0) throw new AppError({ code: 'NO_SPEECH_FOUND', operation: 'subtitles.transcribe', message: 'No speech was recognized in the selected range', details: { range, modelId } });
      const cues: SubtitleCue[] = res.segments
        .filter((s) => s.text.trim().length > 0)
        .map((s) => ({ id: newId('cue'), startMs: Math.round(range.startMs + s.start_ms), endMs: Math.round(range.startMs + Math.max(s.end_ms, s.start_ms + 300)), text: s.text.trim(), speaker: null }));
      const language = res.language === 'ar' || res.language === 'en' ? res.language : ARABIC.test(cues.map((c) => c.text).join(' ')) ? 'ar' : res.language;
      const track = createSubtitleTrack({ language, source: 'stt', name: clipName ? `${clipName} (${language})` : `Subtitles (${language})` });
      track.cues = cues;
      ctx.progress(0.92, 'verify');
      let speechOverlap: number | null = null;
      if (this.capabilities.isAvailable('audio.vad')) {
        try {
          const vad = await this.worker.vad(wav, { signal: ctx.signal });
          const speech = vad.speech.map((s) => ({ a: range.startMs + s.start_ms, b: range.startMs + s.end_ms }));
          let overlap = 0;
          let cueTotal = 0;
          for (const c of cues) {
            cueTotal += c.endMs - c.startMs;
            for (const s of speech) overlap += Math.max(0, Math.min(c.endMs, s.b) - Math.max(c.startMs, s.a));
          }
          speechOverlap = cueTotal > 0 ? Math.min(1, overlap / cueTotal) : null;
        } catch (err) {
          this.logger.warn({ module: 'subtitles', err }, 'speech overlap check skipped');
        }
      }
      const sorted = cues.every((c, i) => i === 0 || c.startMs >= cues[i - 1]!.startMs);
      const withinDuration = cues.every((c) => c.startMs >= 0 && c.endMs <= total + 500);
      session.execute({ type: 'subtitle.addTrack', track }, 'ai');
      const transcript = this.db.transcripts.insert({ id: newId('trs'), assetId: null, projectId: opts.projectId, language, providerId: 'faster-whisper', modelId, segments: res.segments.map((s) => ({ startMs: Math.round(range.startMs + s.start_ms), endMs: Math.round(range.startMs + s.end_ms), text: s.text.trim(), words: s.words.map((w) => ({ startMs: w.start_ms, endMs: w.end_ms, word: w.word, probability: w.probability })) })), text: cues.map((c) => c.text).join('\n') });
      this.search.index({ type: 'project', id: opts.projectId, projectId: opts.projectId, title: doc.name, body: transcript.text });
      ctx.progress(1, null);
      this.logger.info({ module: 'subtitles', operation: 'transcribe', projectId: opts.projectId, cues: cues.length, language, modelId, device: res.device }, 'transcription complete');
      return { trackId: track.id, language, languageProbability: res.language_probability, cues: cues.length, durationMs: range.endMs - range.startMs, device: res.device, modelId, words: res.segments.reduce((n, s) => n + s.words.length, 0), verification: { sorted, withinDuration, speechOverlap } };
    } finally {
      fs.rmSync(wav, { force: true });
    }
  }

  /** Imports an SRT/VTT file as a new subtitle track. */
  import(projectId: string, file: string, language?: string): SessionState {
    const session = this.sessions.get(projectId);
    if (!fs.existsSync(file)) throw new AppError({ code: 'FILE_NOT_FOUND', operation: 'subtitles.import', message: `File not found: ${file}`, details: { path: file } });
    const text = fs.readFileSync(file, 'utf8');
    const cues = parseSubtitles(text, () => newId('cue'));
    if (cues.length === 0) throw new AppError({ code: 'MEDIA_UNSUPPORTED', operation: 'subtitles.import', message: `No subtitle cues found in ${path.basename(file)} (SRT and WebVTT are supported)` });
    const lang = language ?? (ARABIC.test(cues.map((c) => c.text).join(' ')) ? 'ar' : 'en');
    const track = createSubtitleTrack({ language: lang, source: 'imported', name: path.basename(file) });
    track.cues = cues;
    return session.execute({ type: 'subtitle.addTrack', track }, 'command');
  }

  /** Writes a subtitle track to SRT/VTT/ASS and verifies the written file by parsing it back. */
  export(projectId: string, trackId: string, format: 'srt' | 'vtt' | 'ass', outputPath?: string | null): { path: string; cues: number } {
    const doc = this.doc(projectId);
    const track = doc.subtitles.find((s) => s.id === trackId);
    if (!track) throw new AppError({ code: 'COMMAND_FAILED', operation: 'subtitles.export', message: `Subtitle track ${trackId} not found` });
    if (track.cues.length === 0) throw new AppError({ code: 'VALIDATION_FAILED', operation: 'subtitles.export', message: 'The subtitle track has no cues' });
    const body = format === 'srt' ? toSrt(track.cues) : format === 'vtt' ? toVtt(track.cues) : toAss(track, doc.settings);
    const dir = outputPath ? path.dirname(outputPath) : this.paths.exports;
    fs.mkdirSync(dir, { recursive: true });
    const file = outputPath ?? path.join(dir, `${doc.name.replace(/[\\/:*?"<>|]+/g, '-')}-${track.language}.${format}`);
    fs.writeFileSync(file, body, 'utf8');
    if (format !== 'ass') {
      const back = parseSubtitles(fs.readFileSync(file, 'utf8'), () => 'x');
      if (back.length !== track.cues.length) throw new AppError({ code: 'EXPORT_VALIDATION_FAILED', operation: 'subtitles.export', message: `Written file contains ${back.length} cues, expected ${track.cues.length}`, details: { file } });
    } else if (!fs.readFileSync(file, 'utf8').includes('[Events]')) {
      throw new AppError({ code: 'EXPORT_VALIDATION_FAILED', operation: 'subtitles.export', message: 'ASS file is missing its events section', details: { file } });
    }
    this.logger.info({ module: 'subtitles', operation: 'export', file, format, cues: track.cues.length }, 'subtitles exported');
    return { path: file, cues: track.cues.length };
  }
}
