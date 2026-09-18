import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LayoutTemplate, Save, Trash2 } from 'lucide-react';
import type { TemplateInfo } from '@sevenvid/ipc';
import { getApi } from '@/api/client';
import { useAppStore } from '@/store/appStore';
import { useSessionStore } from '@/store/sessionStore';
import { formatDuration } from '@/lib/format';
import { Badge } from '@/components/ui/Badge';
import { Button, IconButton } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Field, Input } from '@/components/ui/Input';
import { EmptyState, PageHeader } from '@/components/ui/Misc';
import { CreateProjectDialog } from './ProjectsScreen';

export function TemplatesScreen() {
  const { t, i18n } = useTranslation();
  const reportError = useAppStore((s) => s.reportError);
  const session = useSessionStore((s) => s.state);
  const [templates, setTemplates] = useState<TemplateInfo[]>([]);
  const [useTemplate, setUseTemplate] = useState<TemplateInfo | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState('');
  const load = useCallback(() => getApi().invoke('templates.list').then(setTemplates).catch(reportError), [reportError]);
  useEffect(() => {
    void load();
  }, [load]);
  const ar = i18n.language === 'ar';
  const remove = async (tpl: TemplateInfo) => {
    if (!window.confirm(t('templates.deleteConfirm', { name: tpl.name }))) return;
    try {
      await getApi().invoke('templates.delete', { templateId: tpl.id });
      await load();
    } catch (err) {
      reportError(err);
    }
  };
  const save = async () => {
    if (!session || !saveName.trim()) return;
    try {
      await getApi().invoke('templates.saveFromProject', { projectId: session.projectId, name: saveName.trim(), category: 'custom' });
      setSaveOpen(false);
      setSaveName('');
      await load();
    } catch (err) {
      reportError(err);
    }
  };
  return (
    <div className="mx-auto max-w-6xl px-8 py-8">
      <PageHeader title={t('templates.title')} subtitle={t('templates.subtitle')} actions={<Button action="templates.saveCurrent" icon={<Save />} disabled={!session} onClick={() => setSaveOpen(true)}>{t('templates.saveCurrent')}</Button>} />
      {templates.length === 0 ? <EmptyState icon={<LayoutTemplate />} title={t('templates.empty')} /> : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {templates.map((tpl) => (
            <div key={tpl.id} className="flex flex-col rounded-xl border border-border bg-surface p-5" data-testid="template-card">
              <div className="mb-3 flex items-center justify-between gap-2">
                <Badge tone="accent">{t(`templates.category.${tpl.category}`, { defaultValue: tpl.category })}</Badge>
                <div className="flex items-center gap-1">
                  <Badge tone="neutral">{tpl.builtin ? t('templates.builtin') : t('templates.custom')}</Badge>
                  {!tpl.builtin ? <IconButton action="templates.delete" label={t('common.delete')} size="sm" onClick={() => void remove(tpl)}><Trash2 /></IconButton> : null}
                </div>
              </div>
              <h3 className="text-[15px] font-semibold">{ar && tpl.nameAr ? tpl.nameAr : tpl.name}</h3>
              <p className="mt-1 flex-1 text-[13px] text-muted">{ar && tpl.descriptionAr ? tpl.descriptionAr : tpl.description}</p>
              <div className="mt-3 text-[12px] text-faint">
                {tpl.settings ? `${tpl.settings.width}×${tpl.settings.height} · ${tpl.settings.fps} fps` : '—'}
                {tpl.targetDurationMs ? ` · ${t('templates.targetDuration')} ${formatDuration(tpl.targetDurationMs)}` : ''}
              </div>
              <Button action="templates.use" data-template={tpl.id} variant="primary" size="sm" className="mt-4" onClick={() => setUseTemplate(tpl)}>{t('templates.use')}</Button>
            </div>
          ))}
        </div>
      )}
      <CreateProjectDialog open={Boolean(useTemplate)} onClose={() => setUseTemplate(null)} templateId={useTemplate?.id ?? null} defaults={{ platformPreset: useTemplate?.platformPreset ?? 'custom' }} />
      <Dialog open={saveOpen} onOpenChange={setSaveOpen} title={t('templates.saveCurrent')} size="sm" footer={
        <>
          <Button action="templates.save.cancel" variant="ghost" onClick={() => setSaveOpen(false)}>{t('common.cancel')}</Button>
          <Button action="templates.save.submit" variant="primary" disabled={!saveName.trim()} onClick={() => void save()}>{t('common.save')}</Button>
        </>
      }>
        <Field label={t('common.name')}><Input autoFocus value={saveName} onChange={(e) => setSaveName(e.target.value)} /></Field>
      </Dialog>
    </div>
  );
}
