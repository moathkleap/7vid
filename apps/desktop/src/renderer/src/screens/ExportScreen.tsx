import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, Download, FolderOpen, Play, XCircle, Zap } from 'lucide-react';
import { EXPORT_PRESETS, getExportPreset, type ExportSettings } from '@sevenvid/core';
import type { ExportInfo } from '@sevenvid/ipc';
import { getApi } from '@/api/client';
import { useEvent } from '@/api/hooks';
import { useAppStore } from '@/store/appStore';
import { useSessionStore } from '@/store/sessionStore';
import { formatBytes, formatDate, formatEta } from '@/lib/format';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Field, Input, Progress, Select, Switch } from '@/components/ui/Input';
import { EmptyState, PageHeader, StatRow } from '@/components/ui/Misc';
import { CapabilityGate } from '@/components/CapabilityGate';

const tone: Record<ExportInfo['status'], BadgeTone> = { queued: 'neutral', running: 'accent', validating: 'info', done: 'success', failed: 'danger', cancelled: 'neutral' };

export function ExportScreen() {
  const { t, i18n } = useTranslation();
  const session = useSessionStore((s) => s.state);
  const settings = useAppStore((s) => s.settings);
  const tasks = useAppStore((s) => s.tasks);
  const reportError = useAppStore((s) => s.reportError);
  const showError = useAppStore((s) => s.showError);
  const [presetId, setPresetId] = useState<ExportSettings['presetId']>((settings?.export.defaultPresetId as ExportSettings['presetId']) ?? 'youtube-1080p');
  const [custom, setCustom] = useState<Partial<ExportSettings>>({});
  const [fileNameDraft, setFileName] = useState<string | null>(null);
  const fileName = fileNameDraft ?? session?.document.name ?? '';
  const [outputDir, setOutputDir] = useState<string | null>(null);
  const [exports, setExports] = useState<ExportInfo[]>([]);
  const [encoders, setEncoders] = useState<{ available: string[]; hardware: string[]; verified: Record<string, { ok: boolean; error: string | null; ms: number }> } | null>(null);
  const [verifying, setVerifying] = useState(false);
  const resolved = useMemo(() => ({ ...getExportPreset(presetId).settings, ...custom, presetId }), [presetId, custom]);
  const load = () => getApi().invoke('exports.list', { limit: 50 }).then(setExports).catch(reportError);
  useEffect(() => {
    void load();
    getApi().invoke('export.encoders', {}).then(setEncoders).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEvent('exports.changed', () => void load());
  const set = <K extends keyof ExportSettings>(k: K, v: ExportSettings[K]) => setCustom((c) => ({ ...c, [k]: v }));
  const start = async () => {
    if (!session) return;
    try {
      await getApi().invoke('export.start', { projectId: session.projectId, settings: { ...resolved, presetId: presetId === 'custom' || Object.keys(custom).length ? 'custom' : presetId }, outputPath: outputDir ? `${outputDir}/${fileName || session.document.name}.${resolved.container}` : null, fileName: fileName || null });
      await load();
    } catch (err) {
      reportError(err);
    }
  };
  const pickDir = async () => {
    try {
      const r = await getApi().invoke('dialog.pickDirectory', {});
      if (r.path) setOutputDir(r.path);
    } catch (err) {
      reportError(err);
    }
  };
  const verify = async () => {
    setVerifying(true);
    try {
      setEncoders(await getApi().invoke('export.encoders', { verify: true }));
    } catch (err) {
      reportError(err);
    } finally {
      setVerifying(false);
    }
  };
  const seqLabel = session ? `${session.document.settings.width}×${session.document.settings.height}` : '';
  return (
    <div className="mx-auto max-w-6xl px-8 py-8">
      <PageHeader title={t('export.title')} subtitle={t('export.subtitle')} />
      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader title={session ? session.document.name : t('export.noProject')} subtitle={session ? `${seqLabel} · ${session.document.settings.fps.num / session.document.settings.fps.den} fps` : undefined} />
          <CardBody>
            <CapabilityGate id="render.export">
              <div className="grid grid-cols-2 gap-x-4">
                <Field label={t('export.preset')}>
                  <Select value={presetId} data-testid="export-preset" onChange={(e) => { setPresetId(e.target.value as ExportSettings['presetId']); setCustom({}); }}>
                    {EXPORT_PRESETS.map((p) => <option key={p.id} value={p.id}>{t(p.nameKey)}</option>)}
                  </Select>
                </Field>
                <Field label={t('export.container')}>
                  <Select value={resolved.container} onChange={(e) => { const c = e.target.value as ExportSettings['container']; set('container', c); if (c === 'webm') { set('videoCodec', 'vp9'); set('audioCodec', 'opus'); } else if (resolved.videoCodec === 'vp9') { set('videoCodec', 'h264'); set('audioCodec', 'aac'); } }}>
                    {['mp4', 'mov', 'webm'].map((c) => <option key={c} value={c}>{c.toUpperCase()}</option>)}
                  </Select>
                </Field>
                <Field label={t('export.videoCodec')}>
                  <Select value={resolved.videoCodec} onChange={(e) => set('videoCodec', e.target.value as ExportSettings['videoCodec'])}>
                    {(resolved.container === 'webm' ? ['vp9', 'av1'] : ['h264', 'h265', 'av1']).map((c) => <option key={c} value={c}>{c.toUpperCase()}</option>)}
                  </Select>
                </Field>
                <Field label={t('export.audioCodec')}>
                  <Select value={resolved.audioCodec} onChange={(e) => set('audioCodec', e.target.value as ExportSettings['audioCodec'])}>
                    {(resolved.container === 'webm' ? ['opus'] : ['aac', 'mp3', 'opus']).map((c) => <option key={c} value={c}>{c.toUpperCase()}</option>)}
                  </Select>
                </Field>
                <Field label={t('export.resolution')}>
                  <Select value={resolved.width && resolved.height ? `${resolved.width}x${resolved.height}` : 'sequence'} onChange={(e) => { if (e.target.value === 'sequence') { set('width', null); set('height', null); } else { const [w, h] = e.target.value.split('x').map(Number); set('width', w!); set('height', h!); } }}>
                    <option value="sequence">{t('export.sequence')} ({seqLabel})</option>
                    {['3840x2160', '2560x1440', '1920x1080', '1280x720', '1080x1920', '1080x1080', '1080x1350', '854x480'].map((r) => <option key={r} value={r}>{r.replace('x', '×')}</option>)}
                  </Select>
                </Field>
                <Field label={t('export.fps')}>
                  <Select value={resolved.fps ? String(resolved.fps.num / resolved.fps.den) : 'sequence'} onChange={(e) => set('fps', e.target.value === 'sequence' ? null : { num: Math.round(Number(e.target.value) * 1000), den: 1000 })}>
                    <option value="sequence">{t('export.sequence')}</option>
                    {[24, 25, 30, 50, 60].map((f) => <option key={f} value={f}>{f}</option>)}
                  </Select>
                </Field>
                <Field label={t('export.quality')}>
                  <Select value={resolved.qualityMode} onChange={(e) => set('qualityMode', e.target.value as ExportSettings['qualityMode'])}>
                    <option value="crf">CRF</option>
                    <option value="bitrate">Bitrate</option>
                  </Select>
                </Field>
                {resolved.qualityMode === 'crf' ? (
                  <Field label={t('export.crf')}><Input type="number" min={0} max={51} value={resolved.crf} onChange={(e) => set('crf', Number(e.target.value))} dir="ltr" /></Field>
                ) : (
                  <Field label={t('export.bitrate')}><Input type="number" min={200} max={200000} step={500} value={resolved.videoBitrateKbps} onChange={(e) => set('videoBitrateKbps', Number(e.target.value))} dir="ltr" /></Field>
                )}
                <Field label={t('export.audioBitrate')}>
                  <Select value={String(resolved.audioBitrateKbps)} onChange={(e) => set('audioBitrateKbps', Number(e.target.value))}>{[96, 128, 160, 192, 256, 320].map((b) => <option key={b} value={b}>{b}</option>)}</Select>
                </Field>
                <Field label={t('export.speed')}>
                  <Select value={resolved.speedPreset} onChange={(e) => set('speedPreset', e.target.value as ExportSettings['speedPreset'])}>{['ultrafast', 'veryfast', 'fast', 'medium', 'slow', 'slower'].map((s) => <option key={s} value={s}>{s}</option>)}</Select>
                </Field>
              </div>
              <Field inline label={t('export.hardware')} hint={t('export.hardwareHint')}><Switch action="export.hardware" checked={resolved.hardwareAcceleration === 'auto'} onCheckedChange={(v) => set('hardwareAcceleration', v ? 'auto' : 'off')} /></Field>
              <Field inline label={t('export.burnSubtitles')}><Switch action="export.burnSubtitles" checked={resolved.burnSubtitles} onCheckedChange={(v) => set('burnSubtitles', v)} /></Field>
              <div className="grid grid-cols-2 gap-x-4">
                <Field label={t('export.fileName')}><Input value={fileName} onChange={(e) => setFileName(e.target.value)} data-testid="export-filename" /></Field>
                <Field label={t('export.outputDir')}>
                  <div className="flex gap-2">
                    <Input value={outputDir ?? ''} placeholder={settings?.storage.exportsDir ?? t('settings.storage.default')} onChange={(e) => setOutputDir(e.target.value || null)} dir="ltr" data-testid="export-outputdir" />
                    <Button action="export.pickDir" icon={<FolderOpen />} onClick={() => void pickDir()} />
                  </div>
                </Field>
              </div>
              <div className="mt-2 flex items-center gap-3">
                <Button action="export.start" variant="primary" size="lg" icon={<Download />} disabled={!session} onClick={() => void start()} data-testid="export-start">{t('export.start')}</Button>
                {!session ? <span className="text-[13px] text-muted">{t('export.noProject')}</span> : null}
              </div>
            </CapabilityGate>
          </CardBody>
        </Card>
        <div className="flex flex-col gap-4 lg:col-span-2">
          <Card>
            <CardHeader title={t('export.encoders')} actions={<Button action="export.verifyEncoders" size="sm" variant="outline" icon={<Zap />} loading={verifying} disabled={!encoders || encoders.hardware.length === 0} onClick={() => void verify()}>{t('export.verifyEncoders')}</Button>} />
            <CardBody>
              <div className="flex flex-wrap gap-1.5" data-testid="export-encoders">
                {encoders?.available.map((e) => {
                  const hw = encoders.hardware.includes(e);
                  const v = encoders.verified[e];
                  return <Badge key={e} tone={hw ? (v ? (v.ok ? 'success' : 'danger') : 'info') : 'neutral'} dot={hw}>{e}{hw ? ` · ${v ? (v.ok ? t('export.verified') : v.error) : t('export.notVerified')}` : ''}</Badge>;
                })}
              </div>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title={t('export.history')} />
            <CardBody>
              {exports.length === 0 ? <EmptyState title={t('export.empty')} className="py-6" /> : (
                <ul className="flex flex-col gap-2" data-testid="exports-list">
                  {exports.map((e) => {
                    const task = e.taskId ? tasks[e.taskId] : undefined;
                    const validation = e.validation as { ok?: boolean; checks?: Array<{ name: string; ok: boolean; detail: string }>; encoder?: string; warnings?: string[] } | null;
                    return (
                      <li key={e.id} className="rounded-lg border border-border bg-surface-2 p-3" data-testid="export-row" data-status={e.status}>
                        <div className="flex items-center gap-2">
                          <Badge tone={tone[e.status]} dot>{t(`export.${e.status === 'running' ? 'progress' : e.status}`)}</Badge>
                          <span className="min-w-0 flex-1 truncate font-mono text-[11.5px]" dir="ltr" title={e.outputPath}>{e.outputPath.split(/[\\/]/).pop()}</span>
                          <span className="text-[11.5px] text-faint">{formatDate(e.createdAt, i18n.language)}</span>
                        </div>
                        {(e.status === 'running' || e.status === 'queued' || e.status === 'validating') && task ? (
                          <div className="mt-2">
                            <Progress value={task.progress} />
                            <div className="mt-1 flex justify-between text-[11.5px] text-muted"><span>{task.progressMessage ?? ''}</span><span>{Math.round(task.progress * 100)}% {task.etaMs != null ? `· ${formatEta(task.etaMs)}` : ''}</span></div>
                            <Button action="export.cancel" size="sm" variant="ghost" className="mt-1" onClick={() => void getApi().invoke('tasks.cancel', { taskId: task.id }).catch(reportError)}>{t('tasks.cancel')}</Button>
                          </div>
                        ) : null}
                        {e.status === 'done' ? (
                          <div className="mt-2 text-[12px]">
                            <StatRow label={t('export.estimatedSize')} value={formatBytes(e.sizeBytes, i18n.language)} />
                            {validation?.encoder ? <StatRow label={t('export.encoder')} value={validation.encoder} mono /> : null}
                            <ul className="mt-1 flex flex-wrap gap-1" data-testid="export-validation">
                              {validation?.checks?.map((c) => <li key={c.name} className={`flex items-center gap-1 rounded px-1.5 py-0.5 ${c.ok ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger'}`} title={c.detail}>{c.ok ? <CheckCircle2 className="size-3" /> : <XCircle className="size-3" />}{c.name}</li>)}
                            </ul>
                            {validation?.warnings?.length ? <div className="mt-1 text-warning">{t('export.warnings')}: {validation.warnings.join('; ')}</div> : null}
                            <div className="mt-2 flex gap-1">
                              <Button action="export.open" size="sm" variant="outline" icon={<Play />} onClick={() => void getApi().invoke('shell.openPath', { path: e.outputPath }).catch(reportError)}>{t('export.open')}</Button>
                              <Button action="export.showInFolder" size="sm" variant="ghost" icon={<FolderOpen />} onClick={() => void getApi().invoke('shell.showInFolder', { path: e.outputPath }).catch(reportError)}>{t('export.showInFolder')}</Button>
                            </div>
                          </div>
                        ) : null}
                        {e.error ? <button type="button" data-action="export.error" className="mt-2 text-start text-[12px] text-danger hover:underline" onClick={() => showError(e.error)}>{t(e.error.userMessageKey, e.error.userMessageParams)} · {e.error.errorId}</button> : null}
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
