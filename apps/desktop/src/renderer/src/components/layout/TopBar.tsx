import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { Bot, Cloud, Download, Redo2, Save, Search, Undo2 } from 'lucide-react';
import { useAppStore } from '@/store/appStore';
import { useSessionStore } from '@/store/sessionStore';
import { Badge } from '../ui/Badge';
import { Button, IconButton } from '../ui/Button';
import { Kbd } from '../ui/Input';
import { Tooltip } from '../ui/Misc';

export function TopBar() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const session = useSessionStore();
  const settings = useAppStore((s) => s.settings);
  const setAssistantOpen = useAppStore((s) => s.setAssistantOpen);
  const assistantOpen = useAppStore((s) => s.assistantOpen);
  const setSearchOpen = useAppStore((s) => s.setSearchOpen);
  const state = session.state;
  const saveLabel = !state ? null : state.save.saving ? t('topbar.saving') : state.save.lastError ? t('topbar.saveFailed') : state.save.dirty ? t('topbar.unsaved') : t('topbar.saved');
  const saveTone = !state ? 'neutral' : state.save.lastError ? 'danger' : state.save.dirty ? 'warning' : 'success';
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-surface px-4">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-text" data-testid="topbar-project-name">{state ? state.document.name : t('topbar.noProject')}</div>
        </div>
        {saveLabel ? <Badge tone={saveTone} dot>{saveLabel}</Badge> : null}
        {settings?.privacy.allowExternalProviders ? (
          <Tooltip content={t('topbar.externalProcessingHint')}>
            <span>
              <Badge tone="warning"><Cloud className="size-3" />{t('topbar.externalProcessing')}</Badge>
            </span>
          </Tooltip>
        ) : null}
      </div>
      <div className="flex items-center gap-1">
        <Tooltip content={<span className="flex items-center gap-2">{t('topbar.undo')} <Kbd>Mod+Z</Kbd></span>}>
          <IconButton action="edit.undo" label={t('topbar.undo')} disabled={!state?.history.canUndo} onClick={() => void session.undo()}>
            <Undo2 />
          </IconButton>
        </Tooltip>
        <Tooltip content={<span className="flex items-center gap-2">{t('topbar.redo')} <Kbd>Mod+Shift+Z</Kbd></span>}>
          <IconButton action="edit.redo" label={t('topbar.redo')} disabled={!state?.history.canRedo} onClick={() => void session.redo()}>
            <Redo2 />
          </IconButton>
        </Tooltip>
        <Tooltip content={<span className="flex items-center gap-2">{t('topbar.save')} <Kbd>Mod+S</Kbd></span>}>
          <IconButton action="project.save" label={t('topbar.save')} disabled={!state || (!state.save.dirty && !state.save.lastError)} onClick={() => void session.save()}>
            <Save />
          </IconButton>
        </Tooltip>
        <Tooltip content={<span className="flex items-center gap-2">{t('nav.diagnostics')} <Kbd>Mod+P</Kbd></span>}>
          <IconButton action="app.search" label={t('search.hint')} onClick={() => setSearchOpen(true)}>
            <Search />
          </IconButton>
        </Tooltip>
        <div className="mx-1 h-6 w-px bg-border" />
        <Button action="app.assistant" variant={assistantOpen ? 'primary' : 'secondary'} icon={<Bot />} onClick={() => setAssistantOpen(!assistantOpen)}>
          {t('topbar.assistant')}
        </Button>
        <Button action="project.export" variant="primary" icon={<Download />} disabled={!state} onClick={() => navigate('/export')}>
          {t('topbar.export')}
        </Button>
      </div>
    </header>
  );
}
