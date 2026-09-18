import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, ScanText, ShieldCheck } from 'lucide-react';
import { formatMs, type ProjectDocument } from '@sevenvid/core';
import type { OcrResult } from '@sevenvid/ipc';
import { getApi } from '@/api/client';
import { CapabilityGate, useCapability } from '@/components/CapabilityGate';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Field, Select } from '@/components/ui/Input';
import { useTaskRunner } from '@/hooks/useTaskRunner';
import { useAppStore } from '@/store/appStore';
import { useEditorStore } from '@/store/editorStore';
import { Hint, SectionTitle, TaskStatus } from './shared';

export function TextPanel({ doc, clipId }: { doc: ProjectDocument; clipId: string | null }) {
  const { t } = useTranslation();
  const pushToast = useAppStore((s) => s.pushToast);
  const reportError = useAppStore((s) => s.reportError);
  const setPlayhead = useEditorStore((s) => s.setPlayhead);
  const ocr = useCapability('ocr');
  const clip = clipId ? doc.tracks.flatMap((tr) => tr.clips).find((c) => c.id === clipId) : undefined;
  const videoClip = clip && doc.assets[clip.assetId]?.hasVideo ? clip : null;
  const [langs, setLangs] = useState<Array<'ar' | 'en'>>(['ar', 'en']);
  const [sampleFps, setSampleFps] = useState(1);
  const [selected, setSelected] = useState<number[]>([]);
  const [result, setResult] = useState<OcrResult | null>(null);
  const detect = useTaskRunner<OcrResult>((r) => {
    setResult(r);
    setSelected([]);
  });
  const load = useCallback((id: string) => {
    getApi().invoke('analysis.get', { projectId: doc.id, clipId: id, kind: 'ocr' }).then((r) => setResult((r as OcrResult | null) ?? null)).catch(() => setResult(null));
  }, [doc.id]);
  useEffect(() => {
    if (videoClip) load(videoClip.id);
  }, [videoClip, load]);
  const installed = (ocr?.reasonParams?.languages ? String(ocr.reasonParams.languages).split(', ') : ['ar', 'en']) as Array<'ar' | 'en'>;
  const createMasks = async (kind: 'blur' | 'pixelate', indexes?: number[]) => {
    if (!videoClip) return;
    try {
      await getApi().invoke('ocr.createMasks', { projectId: doc.id, clipId: videoClip.id, kind, trackIndexes: indexes });
      pushToast({ level: 'success', titleKey: 'ocrPanel.masked', messageKey: null, params: { count: indexes?.length ?? result?.tracks.length ?? 0 }, errorId: null, taskId: null });
    } catch (err) {
      reportError(err);
    }
  };
  const copyText = async () => {
    if (!result?.text) return;
    try {
      await navigator.clipboard.writeText(result.text);
      pushToast({ level: 'info', titleKey: 'common.copied', messageKey: null, params: {}, errorId: null, taskId: null });
    } catch (err) {
      reportError(err);
    }
  };
  const current = result && result.clipId === videoClip?.id ? result : null;
  return (
    <div data-testid="text-panel">
      <SectionTitle>{t('ocrPanel.title')}</SectionTitle>
      <Hint>{t('ocrPanel.engine')}</Hint>
      {!videoClip ? <Hint>{t('tools.selectClip')}</Hint> : null}
      <CapabilityGate id="ocr" compact>
        <Field label={t('ocrPanel.languages')}>
          <div className="flex gap-1.5">
            {(['ar', 'en'] as const).map((l) => (
              <Button key={l} action={`ocr.lang.${l}`} size="sm" variant={langs.includes(l) ? 'primary' : 'outline'} disabled={!installed.includes(l)} onClick={() => setLangs((cur) => (cur.includes(l) ? (cur.length > 1 ? cur.filter((x) => x !== l) : cur) : [...cur, l]))}>{l === 'ar' ? t('subtitlesPanel.langAr') : t('subtitlesPanel.langEn')}</Button>
            ))}
          </div>
        </Field>
        <Field label={t('ocrPanel.sampleRate')}>
          <Select value={String(sampleFps)} data-action="ocr.sampleFps" onChange={(e) => setSampleFps(Number(e.target.value))} className="w-28">
            {[0.5, 1, 2].map((f) => <option key={f} value={f}>{f} fps</option>)}
          </Select>
        </Field>
        <Button action="ocr.detect" size="sm" variant="primary" icon={<ScanText />} disabled={!videoClip || detect.running} loading={detect.running} onClick={() => videoClip && void detect.run(() => getApi().invoke('ocr.detect', { projectId: doc.id, clipId: videoClip.id, languages: langs, sampleFps }))} data-testid="ocr-detect">{t('ocrPanel.detect')}</Button>
        <TaskStatus running={detect.running} progress={detect.progress} message={detect.message ?? t('ocrPanel.detecting')} error={detect.error} />
      </CapabilityGate>
      {current ? (
        <div className="mt-2" data-testid="ocr-result">
          <div className="flex items-center justify-between text-[12.5px] text-muted"><span>{current.tracks.length === 0 ? t('ocrPanel.noText') : t('ocrPanel.results', { count: current.tracks.length, frames: current.framesAnalyzed })}</span></div>
          {current.tracks.length > 0 ? (
            <>
              <div className="my-2 flex flex-wrap gap-1.5">
                <Button action="ocr.blurAll" size="sm" icon={<ShieldCheck />} onClick={() => void createMasks('blur')} data-testid="ocr-blur-all">{t('ocrPanel.blurAll')}</Button>
                <Button action="ocr.pixelateAll" size="sm" onClick={() => void createMasks('pixelate')}>{t('ocrPanel.pixelateAll')}</Button>
                <Button action="ocr.blurSelected" size="sm" disabled={selected.length === 0} onClick={() => void createMasks('blur', selected)}>{t('ocrPanel.blurSelected')}</Button>
                <Button action="ocr.copy" size="sm" variant="ghost" icon={<Copy />} onClick={() => void copyText()}>{t('ocrPanel.copyText')}</Button>
              </div>
              <div className="flex max-h-[40vh] flex-col gap-1.5 overflow-y-auto pe-1" data-testid="ocr-tracks">
                {current.tracks.map((tr) => (
                  <label key={tr.index} className={`flex cursor-pointer items-start gap-2 rounded-lg border px-2.5 py-2 text-[12.5px] ${selected.includes(tr.index) ? 'border-accent bg-accent-soft/40' : 'border-border bg-surface-2'}`} data-testid="ocr-track">
                    <input type="checkbox" data-action="ocr.selectTrack" checked={selected.includes(tr.index)} onChange={(e) => setSelected((cur) => (e.target.checked ? [...cur, tr.index] : cur.filter((i) => i !== tr.index)))} className="mt-0.5 accent-[var(--accent)]" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium" dir="auto">{tr.text}</span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-muted">
                        <button type="button" data-action="ocr.seek" className="font-mono hover:text-text" dir="ltr" onClick={() => setPlayhead(tr.startMs)}>{formatMs(tr.startMs)} → {formatMs(tr.endMs)}</button>
                        <Badge>{tr.language}</Badge>
                        <span>{t('ocrPanel.confidence', { value: tr.confidence })}</span>
                        <span>{t('ocrPanel.frames', { count: tr.frames })}</span>
                      </span>
                    </span>
                  </label>
                ))}
              </div>
              <SectionTitle>{t('ocrPanel.extractedText')}</SectionTitle>
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-surface-2 p-2 font-sans text-[12.5px]" dir="auto" data-testid="ocr-text">{current.text}</pre>
            </>
          ) : null}
        </div>
      ) : videoClip && !detect.running ? <div className="mt-1 text-[12px] text-faint">{t('ocrPanel.notDetected')}</div> : null}
    </div>
  );
}
