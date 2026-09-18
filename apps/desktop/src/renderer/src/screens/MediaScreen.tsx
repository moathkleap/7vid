import { useEffect, useMemo, useState } from 'react';
import { useSyncedState } from '@/hooks/useSyncedState';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { FileAudio, FileImage, FileVideo, Heart, Link2, Plus, RefreshCw, Search, Trash2, Upload, X } from 'lucide-react';
import type { AssetInfo } from '@sevenvid/ipc';
import { getApi } from '@/api/client';
import { useAppStore } from '@/store/appStore';
import { useMediaStore } from '@/store/mediaStore';
import { useSessionStore } from '@/store/sessionStore';
import { useMediaUrl } from '@/hooks/useMediaUrl';
import { usePickFiles } from '@/hooks/usePickFiles';
import { formatBytes, formatDuration } from '@/lib/format';
import { cn } from '@/lib/cn';
import { Badge } from '@/components/ui/Badge';
import { Button, IconButton } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { EmptyState, PageHeader, Spinner, StatRow } from '@/components/ui/Misc';
import { CapabilityGate } from '@/components/CapabilityGate';
import { FileBrowserDialog } from '@/components/dialogs/FileBrowserDialog';

type Category = 'all' | 'video' | 'image' | 'audio' | 'music' | 'voice' | 'character' | 'generated' | 'favorites';
const CATEGORIES: Category[] = ['all', 'video', 'image', 'audio', 'music', 'voice', 'character', 'generated', 'favorites'];

export function AssetThumb({ asset, className }: { asset: AssetInfo; className?: string }) {
  const url = useMediaUrl(asset.thumbnailPath);
  const Icon = asset.kind === 'image' ? FileImage : asset.kind === 'audio' || asset.kind === 'music' || asset.kind === 'voice' ? FileAudio : FileVideo;
  return (
    <div className={cn('relative grid aspect-video w-full place-items-center overflow-hidden rounded-lg bg-surface-3', className)}>
      {url ? <img src={url} alt="" className="size-full object-cover" draggable={false} /> : <Icon className="size-8 text-faint" />}
      {asset.durationMs != null ? <span className="absolute bottom-1.5 end-1.5 rounded bg-black/70 px-1.5 py-0.5 font-mono text-[11px] text-white" dir="ltr">{formatDuration(asset.durationMs)}</span> : null}
      {asset.missing ? <span className="absolute inset-0 grid place-items-center bg-danger/30 text-[12px] font-medium text-white">{'missing'}</span> : null}
    </div>
  );
}

export function MediaScreen() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const projectId = useSessionStore((s) => s.projectId);
  const media = useMediaStore();
  const tasks = useAppStore((s) => s.tasks);
  const reportError = useAppStore((s) => s.reportError);
  const pushToast = useAppStore((s) => s.pushToast);
  const { pick, browserOpen, onBrowserSelect, onBrowserClose } = usePickFiles();
  const [category, setCategory] = useState<Category>('all');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  useEffect(() => {
    if (media.loadedFor !== projectId) void media.load(projectId ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);
  const assets = useMemo(() => {
    const q = query.trim().toLowerCase();
    return Object.values(media.assets)
      .filter((a) => (category === 'all' ? true : category === 'favorites' ? a.favorite : a.kind === category))
      .filter((a) => (!q ? true : a.name.toLowerCase().includes(q) || a.tags.some((x) => x.toLowerCase().includes(q))))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [media.assets, category, query]);
  const doImport = async (paths: string[]) => {
    if (paths.length === 0) return;
    setImporting(true);
    try {
      const r = await media.importPaths(paths, projectId ?? null);
      pushToast({ level: r.imported > 0 ? 'success' : 'warning', titleKey: 'media.imported', messageKey: r.skipped.length ? 'media.skipped' : null, params: { count: r.imported, skipped: r.skipped.length }, errorId: null, taskId: null });
    } catch (err) {
      reportError(err);
    } finally {
      setImporting(false);
    }
  };
  const importClick = async () => doImport(await pick('media', true));
  const current = selected ? media.assets[selected] : null;
  return (
    <div className="flex h-full">
      <div className="min-w-0 flex-1 overflow-y-auto px-8 py-8">
        <PageHeader title={t('media.title')} subtitle={t('media.subtitle')} actions={
          <CapabilityGate id="media.import" compact>
            <Button action="media.import" variant="primary" icon={<Upload />} loading={importing} onClick={() => void importClick()}>{t('media.import')}</Button>
          </CapabilityGate>
        } />
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-1">
            {CATEGORIES.map((c) => (
              <button key={c} type="button" data-action={`media.category.${c}`} onClick={() => setCategory(c)} className={cn('focus-ring rounded-full px-3 py-1 text-[12.5px]', category === c ? 'bg-accent-soft text-text' : 'text-muted hover:bg-surface-2')}>
                {t(`media.categories.${c}`)}
              </button>
            ))}
          </div>
          <div className="relative ms-auto w-64">
            <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('media.search')} className="ps-9" data-testid="media-search" />
          </div>
        </div>
        {media.loading ? <div className="grid place-items-center py-16"><Spinner /></div> : assets.length === 0 ? (
          <EmptyState icon={<Upload />} title={t('media.empty')} description={t('media.emptyHint')} action={<Button action="media.importEmpty" variant="primary" icon={<Upload />} onClick={() => void importClick()}>{t('media.import')}</Button>} />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" data-testid="media-grid">
            {assets.map((a) => {
              const analyzing = a.analysisStatus === 'pending' || a.analysisStatus === 'running';
              const task = Object.values(tasks).find((x) => (x.kind === 'media.analyze' || x.kind === 'media.proxy') && x.params.assetId === a.id && (x.status === 'running' || x.status === 'queued'));
              return (
                <button key={a.id} type="button" data-action="media.select" data-asset-id={a.id} data-testid="media-card" onClick={() => setSelected(a.id)} draggable onDragStart={(e) => { e.dataTransfer.setData('application/x-sevenvid-asset', a.id); e.dataTransfer.effectAllowed = 'copy'; }} className={cn('focus-ring flex flex-col gap-2 rounded-xl border bg-surface p-2 text-start transition-colors hover:border-border-strong', selected === a.id ? 'border-accent' : 'border-border')}>
                  <AssetThumb asset={a} />
                  <div className="flex items-center gap-2 px-1">
                    <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{a.name}</span>
                    {a.favorite ? <Heart className="size-3.5 fill-danger text-danger" /> : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-1 px-1 pb-1">
                    <Badge tone="neutral">{a.kind}</Badge>
                    {a.width && a.height ? <Badge tone="neutral">{a.width}×{a.height}</Badge> : null}
                    {analyzing ? <Badge tone="accent" dot>{t('media.analyzing')}</Badge> : a.analysisStatus === 'failed' ? <Badge tone="danger" dot>{t('media.analysisFailed')}</Badge> : null}
                    {a.proxyStatus === 'running' || a.proxyStatus === 'pending' ? <Badge tone="info" dot>{t('media.proxy')} {task?.kind === 'media.proxy' ? `${Math.round(task.progress * 100)}%` : ''}</Badge> : a.proxyStatus === 'ready' ? <Badge tone="success">{t('media.proxyReady')}</Badge> : null}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
      {current ? <AssetDetails asset={current} onClose={() => setSelected(null)} onOpenEditor={() => navigate(projectId ? `/editor/${projectId}` : '/editor')} /> : null}
      <FileBrowserDialog open={browserOpen} onClose={onBrowserClose} onSelect={(paths) => { onBrowserSelect(paths); }} />
    </div>
  );
}

function AssetDetails({ asset, onClose, onOpenEditor }: { asset: AssetInfo; onClose: () => void; onOpenEditor: () => void }) {
  const { t, i18n } = useTranslation();
  const projectId = useSessionStore((s) => s.projectId);
  const reportError = useAppStore((s) => s.reportError);
  const showError = useAppStore((s) => s.showError);
  const pushToast = useAppStore((s) => s.pushToast);
  const refreshOne = useMediaStore((s) => s.refreshOne);
  const { pick, browserOpen, onBrowserSelect, onBrowserClose } = usePickFiles();
  const [name, setName] = useSyncedState(asset.name);
  const [tags, setTags] = useSyncedState(asset.tags.join(', '));
  const call = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      await refreshOne(asset.id);
    } catch (err) {
      reportError(err);
    }
  };
  const addToTimeline = async () => {
    if (!projectId) return;
    try {
      await getApi().invoke('media.addToTimeline', { projectId, assetId: asset.id });
      await useSessionStore.getState().refresh();
      pushToast({ level: 'success', titleKey: 'media.addedToTimeline', messageKey: null, params: { name: asset.name }, errorId: null, taskId: null });
    } catch (err) {
      reportError(err);
    }
  };
  const relink = async () => {
    const paths = await pick(asset.kind === 'image' ? 'image' : asset.kind === 'audio' ? 'audio' : 'video', false);
    if (paths[0]) await call(() => getApi().invoke('media.relink', { assetId: asset.id, path: paths[0]! }));
  };
  const remove = async () => {
    if (!window.confirm(t('media.confirmRemove', { name: asset.name }))) return;
    try {
      await getApi().invoke('media.remove', { assetId: asset.id });
      onClose();
    } catch (err) {
      reportError(err);
    }
  };
  return (
    <aside className="flex w-80 shrink-0 flex-col overflow-y-auto border-s border-border bg-surface p-4" data-testid="media-details">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold">{t('media.details')}</h2>
        <IconButton action="media.details.close" label={t('common.close')} size="sm" onClick={onClose}><X /></IconButton>
      </div>
      <AssetThumb asset={asset} className="mb-3" />
      <Input value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name !== asset.name && void call(() => getApi().invoke('media.update', { assetId: asset.id, patch: { name: name.trim() } }))} className="mb-2" data-testid="media-name-input" />
      <Input value={tags} placeholder={t('media.tagsPlaceholder')} onChange={(e) => setTags(e.target.value)} onBlur={() => void call(() => getApi().invoke('media.update', { assetId: asset.id, patch: { tags: tags.split(',').map((x) => x.trim()).filter(Boolean) } }))} className="mb-3" data-testid="media-tags-input" />
      <div className="mb-3 flex flex-wrap gap-2">
        <Button action="media.addToTimeline" size="sm" variant="primary" icon={<Plus />} disabled={!projectId || asset.analysisStatus !== 'ready' || asset.missing} onClick={() => void addToTimeline()}>{t('media.addToTimeline')}</Button>
        {projectId ? <Button action="media.openEditor" size="sm" variant="ghost" onClick={onOpenEditor}>{t('nav.editor')}</Button> : null}
        <Button action="media.favorite" size="sm" variant={asset.favorite ? 'primary' : 'outline'} icon={<Heart />} onClick={() => void call(() => getApi().invoke('media.update', { assetId: asset.id, patch: { favorite: !asset.favorite } }))}>{t('media.favorite')}</Button>
        <Button action="media.relink" size="sm" variant="outline" icon={<Link2 />} onClick={() => void relink()}>{t('media.relink')}</Button>
        <Button action="media.reanalyze" size="sm" variant="outline" icon={<RefreshCw />} onClick={() => void call(() => getApi().invoke('media.reanalyze', { assetId: asset.id }))}>{t('media.reanalyze')}</Button>
        <Button action="media.remove" size="sm" variant="danger" icon={<Trash2 />} onClick={() => void remove()}>{t('media.remove')}</Button>
      </div>
      {asset.analysisError ? (
        <button type="button" data-action="media.analysisError" className="mb-3 rounded-lg border border-danger/40 bg-danger/10 p-2 text-start text-[12.5px] text-danger" onClick={() => showError(asset.analysisError)}>
          {t(asset.analysisError.userMessageKey, asset.analysisError.userMessageParams)} · {asset.analysisError.errorId}
        </button>
      ) : null}
      <div className="rounded-lg border border-border bg-surface-2 px-3 py-1 text-[12.5px]">
        <StatRow label={t('media.meta.path')} value={<span className="break-all font-mono text-[11px]" dir="ltr">{asset.sourcePath}</span>} />
        <StatRow label={t('media.meta.size')} value={formatBytes(asset.sizeBytes, i18n.language)} />
        <StatRow label={t('media.meta.container')} value={asset.container ?? '—'} mono />
        {asset.durationMs != null ? <StatRow label={t('editor.duration')} value={formatDuration(asset.durationMs)} mono /> : null}
        {asset.width ? <StatRow label={t('editor.resolution')} value={`${asset.width}×${asset.height}`} mono /> : null}
        {asset.fps ? <StatRow label={t('editor.fps')} value={(asset.fps.num / asset.fps.den).toFixed(3).replace(/\.?0+$/, '')} mono /> : null}
        {asset.videoCodec ? <StatRow label={t('media.meta.videoCodec')} value={asset.videoCodec} mono /> : null}
        {asset.audioCodec ? <StatRow label={t('media.meta.audioCodec')} value={`${asset.audioCodec} · ${asset.channels}ch · ${asset.sampleRate} Hz`} mono /> : null}
        <StatRow label={t('media.meta.proxy')} value={t(`media.proxyStatus.${asset.proxyStatus}`)} />
      </div>
      <FileBrowserDialog open={browserOpen} onClose={onBrowserClose} onSelect={onBrowserSelect} multiple={false} />
    </aside>
  );
}
