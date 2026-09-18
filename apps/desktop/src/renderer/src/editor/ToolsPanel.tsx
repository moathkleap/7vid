import { useTranslation } from 'react-i18next';
import { AudioLines, Captions, ScanFace, ScanText, SlidersHorizontal, Sparkles } from 'lucide-react';
import type { Command, ProjectDocument } from '@sevenvid/core';
import { useEditorStore, type ToolTab } from '@/store/editorStore';
import { cn } from '@/lib/cn';
import { Inspector } from './Inspector';
import { AudioPanel } from './panels/AudioPanel';
import { EnhancePanel } from './panels/EnhancePanel';
import { PrivacyPanel } from './panels/PrivacyPanel';
import { SubtitlesPanel } from './panels/SubtitlesPanel';
import { TextPanel } from './panels/TextPanel';

const TABS: Array<{ id: ToolTab; icon: typeof SlidersHorizontal }> = [
  { id: 'inspector', icon: SlidersHorizontal },
  { id: 'privacy', icon: ScanFace },
  { id: 'audio', icon: AudioLines },
  { id: 'subtitles', icon: Captions },
  { id: 'text', icon: ScanText },
  { id: 'enhance', icon: Sparkles },
];

/** Right-hand column of the editor: inspector plus the AI/processing tool panels, one at a time. */
export function ToolsPanel({ doc, onCommand }: { doc: ProjectDocument; onCommand: (cmd: Command) => Promise<unknown> }) {
  const { t } = useTranslation();
  const tab = useEditorStore((s) => s.toolTab);
  const setTab = useEditorStore((s) => s.setToolTab);
  const selection = useEditorStore((s) => s.selection);
  const clipId = selection[0] ?? null;
  if (tab === 'inspector') {
    return (
      <div className="flex h-full w-[300px] shrink-0 flex-col border-s border-border bg-surface" data-testid="tools-panel">
        <TabStrip tab={tab} setTab={setTab} t={t} />
        <div className="min-h-0 flex-1 overflow-y-auto"><Inspector doc={doc} onCommand={onCommand} embedded /></div>
      </div>
    );
  }
  return (
    <div className="flex h-full w-[300px] shrink-0 flex-col border-s border-border bg-surface" data-testid="tools-panel">
      <TabStrip tab={tab} setTab={setTab} t={t} />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
        {tab === 'privacy' ? <PrivacyPanel doc={doc} clipId={clipId} onCommand={onCommand} /> : null}
        {tab === 'audio' ? <AudioPanel doc={doc} clipId={clipId} onCommand={onCommand} /> : null}
        {tab === 'subtitles' ? <SubtitlesPanel doc={doc} clipId={clipId} onCommand={onCommand} /> : null}
        {tab === 'text' ? <TextPanel doc={doc} clipId={clipId} /> : null}
        {tab === 'enhance' ? <EnhancePanel doc={doc} clipId={clipId} onCommand={onCommand} /> : null}
      </div>
    </div>
  );
}

function TabStrip({ tab, setTab, t }: { tab: ToolTab; setTab: (t: ToolTab) => void; t: (k: string) => string }) {
  return (
    <div className="flex shrink-0 items-center border-b border-border" role="tablist" data-testid="tool-tabs">
      {TABS.map(({ id, icon: Icon }) => (
        <button key={id} type="button" role="tab" aria-selected={tab === id} data-action={`tools.${id}`} data-testid={`tool-tab-${id}`} title={t(`tools.${id}`)} onClick={() => setTab(id)} className={cn('focus-ring flex flex-1 flex-col items-center gap-0.5 border-b-2 px-1 py-2 text-[10px] transition-colors', tab === id ? 'border-accent text-text' : 'border-transparent text-muted hover:text-text')}>
          <Icon className="size-4" />
          <span className="truncate">{t(`tools.${id}`)}</span>
        </button>
      ))}
    </div>
  );
}
