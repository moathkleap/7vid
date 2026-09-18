import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { Copy, History, MoreHorizontal, Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { DropdownMenu } from 'radix-ui';
import type { ProjectSummary, ProjectVersion } from '@sevenvid/ipc';
import { PLATFORM_PRESETS } from '@sevenvid/core';
import { getApi } from '@/api/client';
import { useAppStore } from '@/store/appStore';
import { useSessionStore } from '@/store/sessionStore';
import { formatDate, formatDuration } from '@/lib/format';
import { Badge } from '@/components/ui/Badge';
import { Button, IconButton } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Field, Input, Select, Switch } from '@/components/ui/Input';
import { EmptyState, PageHeader } from '@/components/ui/Misc';

export function CreateProjectDialog(props: { open: boolean; onClose: () => void; templateId?: string | null; defaults?: { platformPreset?: string; kind?: 'editor' | 'creator' } }) {
  if (!props.open) return null;
  return <CreateProjectDialogInner {...props} />;
}

function CreateProjectDialogInner({ open, onClose, templateId, defaults }: { open: boolean; onClose: () => void; templateId?: string | null; defaults?: { platformPreset?: string; kind?: 'editor' | 'creator' } }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const settings = useAppStore((s) => s.settings);
  const reportError = useAppStore((s) => s.reportError);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'editor' | 'creator'>(defaults?.kind ?? settings?.general.defaultProjectKind ?? 'editor');
  const [platform, setPlatform] = useState(defaults?.platformPreset ?? 'youtube');
  const [busy, setBusy] = useState(false);
  const create = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const summary = await getApi().invoke('projects.create', { name: name.trim(), kind, platformPreset: platform, templateId: templateId ?? null });
      await useAppStore.getState().refreshProjects();
      await useSessionStore.getState().open(summary.id);
      onClose();
      navigate(`/${kind === 'creator' ? 'creator' : 'editor'}/${summary.id}`);
    } catch (err) {
      reportError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title={t('projects.createTitle')} size="sm"
      footer={
        <>
          <Button action="projects.create.cancel" variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
          <Button action="projects.create.submit" variant="primary" loading={busy} disabled={!name.trim()} onClick={() => void create()}>{t('projects.create')}</Button>
        </>
      }
    >
      <form onSubmit={(e) => { e.preventDefault(); void create(); }}>
        <Field label={t('projects.name')}>
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={t('projects.namePlaceholder')} data-testid="project-name-input" />
        </Field>
        <Field label={t('projects.kind')}>
          <Select value={kind} onChange={(e) => setKind(e.target.value as 'editor' | 'creator')} data-testid="project-kind-select">
            <option value="editor">{t('projects.kindEditor')}</option>
            <option value="creator">{t('projects.kindCreator')}</option>
          </Select>
        </Field>
        <Field label={t('projects.platform')}>
          <Select value={platform} onChange={(e) => setPlatform(e.target.value)} data-testid="project-platform-select">
            {Object.values(PLATFORM_PRESETS).map((p) => (
              <option key={p.id} value={p.id}>{t(p.nameKey)} · {p.width}×{p.height}</option>
            ))}
            <option value="custom">{t('presets.platform.custom')}</option>
          </Select>
        </Field>
      </form>
    </Dialog>
  );
}

function VersionsDialog({ project, onClose }: { project: ProjectSummary; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const reportError = useAppStore((s) => s.reportError);
  const [versions, setVersions] = useState<ProjectVersion[]>([]);
  const [label, setLabel] = useState('');
  const load = () => getApi().invoke('projects.versions.list', { projectId: project.id }).then(setVersions).catch(reportError);
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);
  const restore = async (versionId: string) => {
    try {
      await useSessionStore.getState().open(project.id);
      await getApi().invoke('projects.versions.restore', { projectId: project.id, versionId });
      await useSessionStore.getState().refresh();
      onClose();
      navigate(`/editor/${project.id}`);
    } catch (err) {
      reportError(err);
    }
  };
  const createVersion = async () => {
    try {
      await useSessionStore.getState().open(project.id);
      await getApi().invoke('projects.versions.create', { projectId: project.id, label: label.trim() || 'Snapshot' });
      setLabel('');
      await load();
    } catch (err) {
      reportError(err);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={t('projects.versionsTitle', { name: project.name })} size="md">
      <div className="mb-3 flex items-end gap-2">
        <Field label={t('projects.versionLabel')}>
          <Input value={label} onChange={(e) => setLabel(e.target.value)} data-testid="version-label-input" />
        </Field>
        <Button action="versions.create" variant="secondary" className="mb-2" onClick={() => void createVersion()}>{t('projects.createVersion')}</Button>
      </div>
      <ul className="divide-y divide-border rounded-lg border border-border" data-testid="versions-list">
        {versions.map((v) => (
          <li key={v.id} className="flex items-center gap-3 px-3 py-2">
            <Badge tone={v.reason === 'manual' ? 'accent' : v.reason === 'recovery' ? 'warning' : 'neutral'}>{t(`projects.reason.${v.reason}`)}</Badge>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm">{v.label ?? `#${v.seq}`}</div>
              <div className="text-[12px] text-muted">{formatDate(v.createdAt, i18n.language)} · {Math.round(v.sizeBytes / 1024)} KB</div>
            </div>
            <Button action="versions.restore" size="sm" variant="outline" icon={<RotateCcw />} onClick={() => void restore(v.id)}>{t('projects.restoreVersion')}</Button>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}

export function ProjectsScreen() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const projects = useAppStore((s) => s.projects);
  const refreshProjects = useAppStore((s) => s.refreshProjects);
  const reportError = useAppStore((s) => s.reportError);
  const [showDeleted, setShowDeleted] = useState(false);
  const [all, setAll] = useState<ProjectSummary[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [renaming, setRenaming] = useState<ProjectSummary | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [versionsFor, setVersionsFor] = useState<ProjectSummary | null>(null);
  const [confirm, setConfirm] = useState<{ project: ProjectSummary; permanent: boolean } | null>(null);
  useEffect(() => {
    if (showDeleted) getApi().invoke('projects.list', { includeDeleted: true }).then(setAll).catch(reportError);
  }, [showDeleted, projects, reportError]);
  const list = showDeleted ? all : projects;
  const open = async (p: ProjectSummary) => {
    await useSessionStore.getState().open(p.id);
    navigate(`/${p.kind === 'creator' ? 'creator' : 'editor'}/${p.id}`);
  };
  const call = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      await refreshProjects();
    } catch (err) {
      reportError(err);
    }
  };
  return (
    <div className="mx-auto max-w-6xl px-8 py-8">
      <PageHeader title={t('projects.title')} subtitle={t('projects.subtitle')} actions={
        <>
          <label className="flex items-center gap-2 text-[13px] text-muted"><Switch action="projects.showDeleted" checked={showDeleted} onCheckedChange={setShowDeleted} label={t('projects.showDeleted')} />{t('projects.showDeleted')}</label>
          <Button action="projects.new" variant="primary" icon={<Plus />} onClick={() => setCreateOpen(true)}>{t('projects.newProject')}</Button>
        </>
      } />
      {list.length === 0 ? (
        <EmptyState title={t('projects.empty')} action={<Button action="projects.newEmpty" variant="primary" icon={<Plus />} onClick={() => setCreateOpen(true)}>{t('projects.newProject')}</Button>} />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border">
          <table className="w-full text-sm" data-testid="projects-table">
            <thead className="bg-surface-2 text-[12px] uppercase tracking-wide text-faint">
              <tr>
                <th className="px-4 py-2.5 text-start font-medium">{t('common.name')}</th>
                <th className="px-4 py-2.5 text-start font-medium">{t('projects.kind')}</th>
                <th className="px-4 py-2.5 text-start font-medium">{t('editor.resolution')}</th>
                <th className="px-4 py-2.5 text-start font-medium">{t('projects.duration')}</th>
                <th className="px-4 py-2.5 text-start font-medium">{t('projects.updated')}</th>
                <th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border bg-surface">
              {list.map((p) => (
                <tr key={p.id} className="hover:bg-surface-2" data-testid="project-row">
                  <td className="px-4 py-2.5">
                    <button type="button" data-action="projects.open" className="focus-ring font-medium text-text hover:underline" onClick={() => void open(p)} disabled={Boolean(p.deletedAt)}>{p.name}</button>
                    {p.deletedAt ? <Badge tone="danger" className="ms-2">{t('projects.deletedBadge')}</Badge> : null}
                  </td>
                  <td className="px-4 py-2.5 text-muted">{t(p.kind === 'creator' ? 'projects.kindCreator' : 'projects.kindEditor')}</td>
                  <td className="px-4 py-2.5 text-muted">{p.width}×{p.height}</td>
                  <td className="px-4 py-2.5 text-muted">{formatDuration(p.durationMs)}</td>
                  <td className="px-4 py-2.5 text-muted">{formatDate(p.updatedAt, i18n.language)}</td>
                  <td className="px-2 py-2.5 text-end">
                    {p.deletedAt ? (
                      <div className="flex justify-end gap-1">
                        <Button action="projects.restore" size="sm" variant="outline" onClick={() => void call(() => getApi().invoke('projects.restoreDeleted', { projectId: p.id }))}>{t('projects.restore')}</Button>
                        <Button action="projects.deletePermanently" size="sm" variant="danger" onClick={() => setConfirm({ project: p, permanent: true })}>{t('projects.deletePermanently')}</Button>
                      </div>
                    ) : (
                      <DropdownMenu.Root>
                        <DropdownMenu.Trigger asChild>
                          <IconButton action="projects.menu" label={t('common.select')} size="sm"><MoreHorizontal /></IconButton>
                        </DropdownMenu.Trigger>
                        <DropdownMenu.Portal>
                          <DropdownMenu.Content align="end" sideOffset={4} className="z-50 min-w-44 rounded-lg border border-border bg-surface p-1 shadow-[var(--shadow)] animate-fade-in">
                            <MenuItem action="projects.menu.open" icon={<Pencil />} onSelect={() => void open(p)}>{t('projects.open')}</MenuItem>
                            <MenuItem action="projects.menu.rename" icon={<Pencil />} onSelect={() => { setRenaming(p); setRenameValue(p.name); }}>{t('projects.rename')}</MenuItem>
                            <MenuItem action="projects.menu.duplicate" icon={<Copy />} onSelect={() => void call(() => getApi().invoke('projects.duplicate', { projectId: p.id }))}>{t('projects.duplicate')}</MenuItem>
                            <MenuItem action="projects.menu.versions" icon={<History />} onSelect={() => setVersionsFor(p)}>{t('projects.versions')}</MenuItem>
                            <DropdownMenu.Separator className="my-1 h-px bg-border" />
                            <MenuItem action="projects.menu.delete" icon={<Trash2 />} danger onSelect={() => setConfirm({ project: p, permanent: false })}>{t('projects.delete')}</MenuItem>
                          </DropdownMenu.Content>
                        </DropdownMenu.Portal>
                      </DropdownMenu.Root>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <CreateProjectDialog open={createOpen} onClose={() => setCreateOpen(false)} />
      {renaming ? (
        <Dialog open onOpenChange={(o) => !o && setRenaming(null)} title={t('projects.renameTitle')} size="sm" footer={
          <>
            <Button action="projects.rename.cancel" variant="ghost" onClick={() => setRenaming(null)}>{t('common.cancel')}</Button>
            <Button action="projects.rename.submit" variant="primary" disabled={!renameValue.trim()} onClick={() => void call(async () => { await getApi().invoke('projects.rename', { projectId: renaming.id, name: renameValue.trim() }); setRenaming(null); })}>{t('common.save')}</Button>
          </>
        }>
          <Field label={t('projects.name')}><Input autoFocus value={renameValue} onChange={(e) => setRenameValue(e.target.value)} data-testid="rename-input" /></Field>
        </Dialog>
      ) : null}
      {versionsFor ? <VersionsDialog project={versionsFor} onClose={() => setVersionsFor(null)} /> : null}
      {confirm ? (
        <Dialog open onOpenChange={(o) => !o && setConfirm(null)} title={confirm.permanent ? t('projects.deletePermanently') : t('projects.delete')} description={t(confirm.permanent ? 'projects.confirmDeletePermanent' : 'projects.confirmDelete', { name: confirm.project.name })} size="sm" footer={
          <>
            <Button action="projects.delete.cancel" variant="ghost" onClick={() => setConfirm(null)}>{t('common.cancel')}</Button>
            <Button action="projects.delete.confirm" variant="danger" onClick={() => void call(async () => { if (useSessionStore.getState().projectId === confirm.project.id) await useSessionStore.getState().close(); await getApi().invoke('projects.delete', { projectId: confirm.project.id, permanent: confirm.permanent }); setConfirm(null); })}>{t('common.delete')}</Button>
          </>
        } />
      ) : null}
    </div>
  );
}

function MenuItem({ action, icon, children, onSelect, danger }: { action: string; icon: React.ReactNode; children: React.ReactNode; onSelect: () => void; danger?: boolean }) {
  return (
    <DropdownMenu.Item data-action={action} onSelect={onSelect} className={`flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-[13px] outline-none data-[highlighted]:bg-surface-2 [&>svg]:size-4 ${danger ? 'text-danger' : 'text-text'}`}>
      {icon}
      {children}
    </DropdownMenu.Item>
  );
}
