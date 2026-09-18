import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowUp, FileAudio, FileImage, FileVideo, Folder } from 'lucide-react';
import type { DirEntry } from '@sevenvid/ipc';
import { getApi } from '@/api/client';
import { useAppStore } from '@/store/appStore';
import { formatBytes } from '@/lib/format';
import { cn } from '@/lib/cn';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { EmptyState } from '../ui/Misc';

/**
 * In-app file browser backed by the engine's filesystem service. Used when native dialogs are not
 * available (browser mode) and as a fallback everywhere else.
 */
export function FileBrowserDialog(props: { open: boolean; onClose: () => void; onSelect: (paths: string[]) => void; multiple?: boolean; mediaOnly?: boolean }) {
  if (!props.open) return null;
  return <FileBrowserDialogInner {...props} />;
}

function FileBrowserDialogInner({ onClose, onSelect, multiple = true, mediaOnly = true }: { open: boolean; onClose: () => void; onSelect: (paths: string[]) => void; multiple?: boolean; mediaOnly?: boolean }) {
  const { t, i18n } = useTranslation();
  const reportError = useAppStore((s) => s.reportError);
  const [roots, setRoots] = useState<Array<{ label: string; path: string }>>([]);
  const [dir, setDir] = useState<{ path: string; parent: string | null; entries: DirEntry[] } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const load = async (p: string | null) => {
    try {
      setDir(await getApi().invoke('fs.listDir', { path: p, mediaOnly }));
    } catch (err) {
      reportError(err);
    }
  };
  useEffect(() => {
    getApi().invoke('fs.roots').then((r) => { setRoots(r); void load(r[0]?.path ?? null); }).catch(reportError);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const toggle = (e: DirEntry) => {
    if (e.isDirectory) return void load(e.path);
    const next = new Set(multiple ? selected : []);
    if (next.has(e.path)) next.delete(e.path);
    else next.add(e.path);
    setSelected(next);
  };
  const Icon = ({ e }: { e: DirEntry }) => (e.isDirectory ? <Folder className="size-4 text-warning" /> : e.mediaKind === 'video' ? <FileVideo className="size-4 text-accent" /> : e.mediaKind === 'image' ? <FileImage className="size-4 text-info" /> : <FileAudio className="size-4 text-success" />);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={t('fileBrowser.title')} size="lg"
      footer={
        <>
          <span className="me-auto text-[12.5px] text-muted">{t('fileBrowser.selected', { count: selected.size })}</span>
          <Button action="fileBrowser.cancel" variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
          <Button action="fileBrowser.select" variant="primary" disabled={selected.size === 0} onClick={() => onSelect([...selected])}>{t('fileBrowser.select', { count: selected.size })}</Button>
        </>
      }
    >
      <div className="flex h-[52vh] gap-4">
        <aside className="w-44 shrink-0 border-e border-border pe-3">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-faint">{t('fileBrowser.roots')}</div>
          {roots.map((r) => (
            <button key={r.path} type="button" data-action="fileBrowser.root" className={cn('focus-ring mb-0.5 block w-full truncate rounded-md px-2 py-1.5 text-start text-[13px] hover:bg-surface-2', dir?.path === r.path && 'bg-accent-soft text-text')} onClick={() => void load(r.path)} title={r.path}>
              {r.label}
            </button>
          ))}
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="mb-2 flex items-center gap-2">
            <Button action="fileBrowser.up" size="sm" variant="ghost" icon={<ArrowUp />} disabled={!dir?.parent} onClick={() => void load(dir?.parent ?? null)}>{t('fileBrowser.up')}</Button>
            <span className="truncate font-mono text-[12px] text-muted" dir="ltr">{dir?.path}</span>
          </div>
          <ul className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-border" data-testid="file-browser-list">
            {dir && dir.entries.length === 0 ? <li className="p-4"><EmptyState title={t('fileBrowser.noMedia')} /></li> : null}
            {dir?.entries.map((e) => (
              <li key={e.path}>
                <button type="button" data-action={e.isDirectory ? 'fileBrowser.openDir' : 'fileBrowser.toggleFile'} onDoubleClick={() => !e.isDirectory && onSelect([e.path])} onClick={() => toggle(e)} className={cn('focus-ring flex w-full items-center gap-3 px-3 py-1.5 text-start text-[13px] hover:bg-surface-2', selected.has(e.path) && 'bg-accent-soft')}>
                  <Icon e={e} />
                  <span className="min-w-0 flex-1 truncate">{e.name}</span>
                  {!e.isDirectory ? <span className="text-[12px] text-faint">{formatBytes(e.sizeBytes, i18n.language)}</span> : null}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Dialog>
  );
}
