import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Upload } from 'lucide-react';
import type { AssetInfo } from '@sevenvid/ipc';
import { useMediaStore } from '@/store/mediaStore';
import { usePickFiles } from '@/hooks/usePickFiles';
import { useAppStore } from '@/store/appStore';
import { formatDuration } from '@/lib/format';
import { Badge } from '@/components/ui/Badge';
import { Button, IconButton } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/Misc';
import { FileBrowserDialog } from '@/components/dialogs/FileBrowserDialog';
import { AssetThumb } from '@/screens/MediaScreen';

/** Compact project media list inside the editor: import, drag to timeline, one-click add. */
export function MediaPanel({ projectId, onAdd }: { projectId: string; onAdd: (asset: AssetInfo) => void }) {
  const { t } = useTranslation();
  const media = useMediaStore();
  const reportError = useAppStore((s) => s.reportError);
  const { pick, browserOpen, onBrowserSelect, onBrowserClose } = usePickFiles();
  useEffect(() => {
    if (media.loadedFor !== projectId) void media.load(projectId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);
  const assets = useMemo(() => Object.values(media.assets).sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [media.assets]);
  const doImport = async () => {
    const paths = await pick('media', true);
    if (paths.length === 0) return;
    try {
      await media.importPaths(paths, projectId);
    } catch (err) {
      reportError(err);
    }
  };
  return (
    <aside className="flex h-full w-[240px] shrink-0 flex-col border-e border-border bg-surface" data-testid="media-panel">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="text-sm font-semibold">{t('editor.mediaPanel')}</span>
        <Button action="editor.import" size="sm" variant="ghost" icon={<Upload />} onClick={() => void doImport()}>{t('media.import')}</Button>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {assets.length === 0 ? <EmptyState title={t('editor.noAssets')} className="py-6" /> : assets.map((a) => (
          <div key={a.id} draggable={a.analysisStatus === 'ready' && !a.missing} onDragStart={(e) => { e.dataTransfer.setData('application/x-sevenvid-asset', a.id); e.dataTransfer.effectAllowed = 'copy'; }} className="mb-2 flex gap-2 rounded-lg border border-border bg-surface-2 p-1.5" data-testid="media-panel-item">
            <div className="w-16 shrink-0"><AssetThumb asset={a} /></div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[12px] font-medium">{a.name}</div>
              <div className="text-[11px] text-muted">{a.durationMs != null ? formatDuration(a.durationMs) : a.kind}</div>
              {a.analysisStatus !== 'ready' ? <Badge tone={a.analysisStatus === 'failed' ? 'danger' : 'accent'} dot>{a.analysisStatus === 'failed' ? t('media.analysisFailed') : t('media.analyzing')}</Badge> : null}
            </div>
            <IconButton action="editor.addAsset" label={t('media.addToTimeline')} size="sm" disabled={a.analysisStatus !== 'ready' || a.missing} onClick={() => onAdd(a)}><Plus /></IconButton>
          </div>
        ))}
      </div>
      <FileBrowserDialog open={browserOpen} onClose={onBrowserClose} onSelect={onBrowserSelect} />
    </aside>
  );
}
