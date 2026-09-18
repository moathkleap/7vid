import { useTranslation } from 'react-i18next';
import { Bot, X } from 'lucide-react';
import { useAppStore } from '@/store/appStore';
import { IconButton } from '@/components/ui/Button';
import { PhaseNotice } from '@/components/CapabilityGate';

/** Global assistant drawer. The planner, execution engine and conversation arrive in Phase 4. */
export function AssistantPanel() {
  const { t } = useTranslation();
  const setOpen = useAppStore((s) => s.setAssistantOpen);
  return (
    <aside className="flex w-[380px] shrink-0 flex-col border-s border-border bg-surface animate-fade-in" data-testid="assistant-panel">
      <div className="flex h-12 items-center justify-between border-b border-border px-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold"><Bot className="size-4 text-accent" />{t('assistant.title')}</h2>
        <IconButton action="assistant.close" label={t('common.close')} size="sm" onClick={() => setOpen(false)}><X /></IconButton>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        <PhaseNotice phase={4} feature={t('assistant.title')} />
        <p className="mt-4 text-[12.5px] text-muted">{t('assistant.hint')}</p>
      </div>
    </aside>
  );
}
