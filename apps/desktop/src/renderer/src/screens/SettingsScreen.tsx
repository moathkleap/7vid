import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router';
import { DEFAULT_SHORTCUTS, EXPORT_PRESETS, eventToCombo, resolveShortcuts, type AppSettings, type DeepPartial } from '@sevenvid/core';
import { useAppStore } from '@/store/appStore';
import { Button } from '@/components/ui/Button';
import { Field, Input, Kbd, Select, Switch } from '@/components/ui/Input';
import { PageHeader } from '@/components/ui/Misc';
import { PhaseNotice } from '@/components/CapabilityGate';
import { cn } from '@/lib/cn';

const SECTIONS = ['general', 'appearance', 'language', 'ai', 'models', 'gpu', 'storage', 'export', 'shortcuts', 'privacy', 'providers', 'notifications', 'performance'] as const;
type Section = (typeof SECTIONS)[number];
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

export function SettingsScreen() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { section } = useParams();
  const settings = useAppStore((s) => s.settings);
  const update = useAppStore((s) => s.updateSettings);
  const reportError = useAppStore((s) => s.reportError);
  const active: Section = SECTIONS.includes(section as Section) ? (section as Section) : 'general';
  if (!settings) return null;
  const reset = async () => {
    try {
      const api = (await import('@/api/client')).getApi();
      const next = await api.invoke('settings.reset', { section: active === 'language' ? 'general' : active === 'models' || active === 'providers' ? null : active });
      useAppStore.setState({ settings: next });
    } catch (err) {
      reportError(err);
    }
  };
  return (
    <div className="mx-auto max-w-6xl px-8 py-8">
      <PageHeader title={t('settings.title')} />
      <div className="flex gap-8">
        <nav className="w-52 shrink-0" aria-label="settings">
          {SECTIONS.map((s) => (
            <button key={s} type="button" data-action={`tab.${s}`} onClick={() => navigate(`/settings/${s}`)} className={cn('focus-ring mb-0.5 block w-full rounded-lg px-3 py-2 text-start text-[13.5px]', active === s ? 'bg-accent-soft text-text font-medium' : 'text-muted hover:bg-surface-2 hover:text-text')}>
              {t(`settings.sections.${s}`)}
            </button>
          ))}
        </nav>
        <div className="min-w-0 flex-1 rounded-xl border border-border bg-surface px-6 py-2">
          <SectionBody section={active} s={settings} update={update} />
          {active !== 'models' && active !== 'providers' ? (
            <div className="border-t border-border py-4">
              <Button action="settings.reset" variant="ghost" size="sm" onClick={() => void reset()}>{t('settings.resetSection')}</Button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function SectionBody({ section, s, update }: { section: Section; s: AppSettings; update: (p: DeepPartial<AppSettings>) => Promise<void> }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  switch (section) {
    case 'general':
      return (
        <div className="divide-y divide-border">
          <Field inline label={t('settings.general.autosave')} hint={t('settings.general.autosaveHint')}>
            <Select value={String(s.general.autosaveIntervalMs)} onChange={(e) => void update({ general: { autosaveIntervalMs: Number(e.target.value) } })} className="w-32" data-testid="settings-autosave-select">
              {[1000, 2000, 5000, 10000, 30000, 60000].map((v) => <option key={v} value={v}>{t('settings.general.seconds', { value: v / 1000 })}</option>)}
            </Select>
          </Field>
          <Field inline label={t('settings.general.confirmDestructive')}><Switch action="settings.confirmDestructive" checked={s.general.confirmDestructiveActions} onCheckedChange={(v) => void update({ general: { confirmDestructiveActions: v } })} /></Field>
          <Field inline label={t('settings.general.reopenLast')}><Switch action="settings.reopenLast" checked={s.general.reopenLastProject} onCheckedChange={(v) => void update({ general: { reopenLastProject: v } })} /></Field>
          <Field inline label={t('settings.general.defaultKind')}>
            <Select value={s.general.defaultProjectKind} onChange={(e) => void update({ general: { defaultProjectKind: e.target.value as 'editor' | 'creator' } })} className="w-40">
              <option value="editor">{t('projects.kindEditor')}</option>
              <option value="creator">{t('projects.kindCreator')}</option>
            </Select>
          </Field>
        </div>
      );
    case 'appearance':
      return (
        <div className="divide-y divide-border">
          <Field inline label={t('settings.appearance.theme')}>
            <Select value={s.appearance.theme} onChange={(e) => void update({ appearance: { theme: e.target.value as AppSettings['appearance']['theme'] } })} className="w-40" data-testid="settings-theme-select">
              <option value="dark">{t('common.theme.dark')}</option>
              <option value="light">{t('common.theme.light')}</option>
              <option value="system">{t('common.theme.system')}</option>
            </Select>
          </Field>
          <Field inline label={t('settings.appearance.density')}>
            <Select value={s.appearance.density} onChange={(e) => void update({ appearance: { density: e.target.value as 'comfortable' | 'compact' } })} className="w-40">
              <option value="comfortable">{t('settings.appearance.comfortable')}</option>
              <option value="compact">{t('settings.appearance.compact')}</option>
            </Select>
          </Field>
          <Field inline label={t('settings.appearance.accent')}>
            <div className="flex gap-2">
              {(['violet', 'blue', 'emerald', 'amber'] as const).map((a) => (
                <button key={a} type="button" data-action={`settings.accent.${a}`} aria-label={t(`settings.appearance.${a}`)} title={t(`settings.appearance.${a}`)} onClick={() => void update({ appearance: { accent: a } })} className={cn('size-7 rounded-full border-2', s.appearance.accent === a ? 'border-text' : 'border-transparent')} style={{ background: { violet: '#7c5cff', blue: '#3b82f6', emerald: '#10b981', amber: '#f59e0b' }[a] }} />
              ))}
            </div>
          </Field>
          <Field inline label={t('settings.appearance.reduceMotion')}><Switch action="settings.reduceMotion" checked={s.appearance.reduceMotion} onCheckedChange={(v) => void update({ appearance: { reduceMotion: v } })} /></Field>
        </div>
      );
    case 'language':
      return (
        <div className="divide-y divide-border">
          <Field inline label={t('settings.language.ui')} hint={t('settings.language.rtlHint')}>
            <Select value={s.general.language} onChange={(e) => void update({ general: { language: e.target.value as 'system' | 'ar' | 'en' } })} className="w-44" data-testid="settings-language-select">
              <option value="system">{t('settings.language.system')}</option>
              <option value="ar">{t('common.language.ar')}</option>
              <option value="en">{t('common.language.en')}</option>
            </Select>
          </Field>
        </div>
      );
    case 'ai':
      return (
        <div className="divide-y divide-border">
          <Field inline label={t('settings.ai.planningMode')}>
            <Select value={s.ai.planningMode} onChange={(e) => void update({ ai: { planningMode: e.target.value as 'deterministic-first' | 'model-first' } })} className="w-72">
              <option value="deterministic-first">{t('settings.ai.deterministicFirst')}</option>
              <option value="model-first">{t('settings.ai.modelFirst')}</option>
            </Select>
          </Field>
          <Field inline label={t('settings.ai.alwaysConfirm')}><Switch action="settings.alwaysConfirm" checked={s.ai.alwaysConfirmPlans} onCheckedChange={(v) => void update({ ai: { alwaysConfirmPlans: v } })} /></Field>
          <Field inline label={t('settings.ai.responseLanguage')}>
            <Select value={s.ai.responseLanguage} onChange={(e) => void update({ ai: { responseLanguage: e.target.value as 'auto' | 'ar' | 'en' } })} className="w-44">
              <option value="auto">{t('settings.ai.auto')}</option>
              <option value="ar">{t('common.language.ar')}</option>
              <option value="en">{t('common.language.en')}</option>
            </Select>
          </Field>
        </div>
      );
    case 'models':
      return <div className="py-4"><Button action="settings.openModels" variant="outline" onClick={() => navigate('/models')}>{t('nav.models')}</Button></div>;
    case 'gpu':
      return (
        <div className="divide-y divide-border">
          <Field inline label={t('settings.gpu.hwEncode')}><Switch action="settings.hwEncode" checked={s.gpu.preferHardwareEncoding} onCheckedChange={(v) => void update({ gpu: { preferHardwareEncoding: v } })} /></Field>
          <Field inline label={t('settings.gpu.hwDecode')}><Switch action="settings.hwDecode" checked={s.gpu.preferHardwareDecoding} onCheckedChange={(v) => void update({ gpu: { preferHardwareDecoding: v } })} /></Field>
          <Field inline label={t('settings.gpu.cpuFallback')}><Switch action="settings.cpuFallback" checked={s.gpu.allowCpuFallbackForAi} onCheckedChange={(v) => void update({ gpu: { allowCpuFallbackForAi: v } })} /></Field>
          <Field inline label={t('settings.gpu.maxVram')}>
            <Select value={String(s.gpu.maxVramUsagePercent)} onChange={(e) => void update({ gpu: { maxVramUsagePercent: Number(e.target.value) } })} className="w-28">
              {[50, 60, 70, 80, 90, 100].map((v) => <option key={v} value={v}>{v}%</option>)}
            </Select>
          </Field>
        </div>
      );
    case 'storage':
      return (
        <div className="divide-y divide-border">
          <Field inline label={t('settings.storage.cacheLimit')}>
            <Select value={String(s.storage.cacheLimitGb)} onChange={(e) => void update({ storage: { cacheLimitGb: Number(e.target.value) } })} className="w-32">
              {[5, 10, 20, 50, 100, 200].map((v) => <option key={v} value={v}>{t('settings.storage.gb', { value: v })}</option>)}
            </Select>
          </Field>
          <Field inline label={t('settings.storage.proxyHeight')}>
            <Select value={String(s.storage.proxyHeight)} onChange={(e) => void update({ storage: { proxyHeight: Number(e.target.value) as 360 | 540 | 720 } })} className="w-32">
              {[360, 540, 720].map((v) => <option key={v} value={v}>{v}p</option>)}
            </Select>
          </Field>
          <Field inline label={t('settings.storage.autoProxies')}><Switch action="settings.autoProxies" checked={s.storage.autoGenerateProxies} onCheckedChange={(v) => void update({ storage: { autoGenerateProxies: v } })} /></Field>
          <PathField key={s.storage.projectsDir ?? ''} label={t('settings.storage.projectsDir')} value={s.storage.projectsDir} onChange={(v) => void update({ storage: { projectsDir: v } })} action="settings.projectsDir" />
          <PathField key={s.storage.exportsDir ?? ''} label={t('settings.storage.exportsDir')} value={s.storage.exportsDir} onChange={(v) => void update({ storage: { exportsDir: v } })} action="settings.exportsDir" />
          <PathField key={s.storage.modelsDir ?? ''} label={t('settings.storage.modelsDir')} value={s.storage.modelsDir} onChange={(v) => void update({ storage: { modelsDir: v } })} action="settings.modelsDir" />
        </div>
      );
    case 'export':
      return (
        <div className="divide-y divide-border">
          <Field inline label={t('settings.export.defaultPreset')}>
            <Select value={s.export.defaultPresetId} onChange={(e) => void update({ export: { defaultPresetId: e.target.value } })} className="w-56">
              {EXPORT_PRESETS.map((p) => <option key={p.id} value={p.id}>{t(p.nameKey)}</option>)}
            </Select>
          </Field>
          <Field inline label={t('settings.export.validate')}><Switch action="settings.validateExport" checked={s.export.validateAfterExport} onCheckedChange={(v) => void update({ export: { validateAfterExport: v } })} /></Field>
          <Field inline label={t('settings.export.openFolder')}><Switch action="settings.openFolder" checked={s.export.openFolderWhenDone} onCheckedChange={(v) => void update({ export: { openFolderWhenDone: v } })} /></Field>
        </div>
      );
    case 'shortcuts':
      return <ShortcutsEditor s={s} update={update} />;
    case 'privacy':
      return (
        <div className="divide-y divide-border">
          <Field inline label={t('settings.privacy.external')} hint={t('settings.privacy.externalHint')}><Switch action="settings.allowExternal" checked={s.privacy.allowExternalProviders} onCheckedChange={(v) => void update({ privacy: { allowExternalProviders: v } })} /></Field>
          <Field inline label={t('settings.privacy.downloads')}><Switch action="settings.allowDownloads" checked={s.privacy.allowModelDownloads} onCheckedChange={(v) => void update({ privacy: { allowModelDownloads: v } })} /></Field>
          <Field inline label={t('settings.privacy.askDownloads')}><Switch action="settings.askDownloads" checked={s.privacy.askBeforeEveryDownload} onCheckedChange={(v) => void update({ privacy: { askBeforeEveryDownload: v } })} /></Field>
          <Field inline label={t('settings.privacy.networkLog')}><Switch action="settings.networkLog" checked={s.privacy.networkLogging} onCheckedChange={(v) => void update({ privacy: { networkLogging: v } })} /></Field>
          <Field inline label={t('settings.privacy.telemetry')} hint={t('settings.privacy.telemetryHint')}><Switch action="settings.telemetry" checked={false} disabled onCheckedChange={() => undefined} /></Field>
        </div>
      );
    case 'providers':
      return <div className="py-4"><PhaseNotice phase={6} feature={t('settings.sections.providers')} /></div>;
    case 'notifications':
      return (
        <div className="divide-y divide-border">
          <Field inline label={t('settings.notifications.onDone')}><Switch action="settings.notifyDone" checked={s.notifications.onTaskComplete} onCheckedChange={(v) => void update({ notifications: { onTaskComplete: v } })} /></Field>
          <Field inline label={t('settings.notifications.onError')}><Switch action="settings.notifyError" checked={s.notifications.onError} onCheckedChange={(v) => void update({ notifications: { onError: v } })} /></Field>
          <Field inline label={t('settings.notifications.sound')}><Switch action="settings.notifySound" checked={s.notifications.sound} onCheckedChange={(v) => void update({ notifications: { sound: v } })} /></Field>
        </div>
      );
    case 'performance':
      return (
        <div className="divide-y divide-border">
          <Field inline label={t('settings.performance.maxTasks')}>
            <Select value={String(s.performance.maxConcurrentTasks)} onChange={(e) => void update({ performance: { maxConcurrentTasks: Number(e.target.value) } })} className="w-24">{[1, 2, 3, 4, 6, 8].map((v) => <option key={v} value={v}>{v}</option>)}</Select>
          </Field>
          <Field inline label={t('settings.performance.maxRenders')}>
            <Select value={String(s.performance.maxConcurrentRenders)} onChange={(e) => void update({ performance: { maxConcurrentRenders: Number(e.target.value) } })} className="w-24">{[1, 2, 3, 4].map((v) => <option key={v} value={v}>{v}</option>)}</Select>
          </Field>
          <Field inline label={t('settings.performance.previewQuality')}>
            <Select value={s.performance.previewQuality} onChange={(e) => void update({ performance: { previewQuality: e.target.value as AppSettings['performance']['previewQuality'] } })} className="w-32">{['auto', 'full', 'half', 'quarter'].map((v) => <option key={v} value={v}>{v}</option>)}</Select>
          </Field>
          <Field inline label={t('settings.performance.useProxies')}><Switch action="settings.useProxies" checked={s.performance.useProxiesForPreview} onCheckedChange={(v) => void update({ performance: { useProxiesForPreview: v } })} /></Field>
          <Field inline label={t('settings.performance.threads')}>
            <Input type="number" min={0} max={64} value={s.performance.ffmpegThreads} onChange={(e) => void update({ performance: { ffmpegThreads: Math.max(0, Math.min(64, Number(e.target.value) || 0)) } })} className="w-24" />
          </Field>
        </div>
      );
  }
}

function PathField({ label, value, onChange, action }: { label: string; value: string | null; onChange: (v: string | null) => void; action: string }) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(value ?? '');
  return (
    <Field inline label={label}>
      <div className="flex items-center gap-2">
        <Input value={draft} placeholder={t('settings.storage.default')} onChange={(e) => setDraft(e.target.value)} onBlur={() => onChange(draft.trim() || null)} className="w-72" dir="ltr" data-action={action} />
      </div>
    </Field>
  );
}

function ShortcutsEditor({ s, update }: { s: AppSettings; update: (p: DeepPartial<AppSettings>) => Promise<void> }) {
  const { t } = useTranslation();
  const [capturing, setCapturing] = useState<string | null>(null);
  const map = resolveShortcuts(s.shortcuts);
  const onKey = (action: string) => (e: React.KeyboardEvent) => {
    e.preventDefault();
    if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;
    const combo = eventToCombo(e.nativeEvent, isMac);
    void update({ shortcuts: { [action]: combo } });
    setCapturing(null);
  };
  return (
    <div>
      <p className="py-3 text-[12.5px] text-muted">{t('settings.shortcuts.hint')}</p>
      <table className="w-full text-sm">
        <tbody className="divide-y divide-border">
          {DEFAULT_SHORTCUTS.map((def) => (
            <tr key={def.action}>
              <td className="py-2 pe-4">{t(def.labelKey)}</td>
              <td className="py-2 text-[12px] text-faint">{t(def.scope === 'global' ? 'settings.shortcuts.scopeGlobal' : 'settings.shortcuts.scopeEditor')}</td>
              <td className="py-2 text-end">
                <button type="button" data-action={`shortcut.${def.action}`} onClick={() => setCapturing(def.action)} onKeyDown={capturing === def.action ? onKey(def.action) : undefined} onBlur={() => setCapturing(null)} className="focus-ring rounded-md px-2 py-1 hover:bg-surface-2">
                  {capturing === def.action ? <span className="text-accent">{t('settings.shortcuts.pressKeys')}</span> : (map.get(def.action) ?? []).map((k) => <Kbd key={k}>{k}</Kbd>)}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="py-3"><Button action="shortcuts.reset" size="sm" variant="ghost" onClick={() => void update({ shortcuts: Object.fromEntries(DEFAULT_SHORTCUTS.map((d) => [d.action, d.keys.join(',')])) })}>{t('settings.shortcuts.reset')}</Button></div>
    </div>
  );
}
