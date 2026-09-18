import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { Search } from 'lucide-react';
import type { SearchResult } from '@sevenvid/ipc';
import { getApi } from '@/api/client';
import { useAppStore } from '@/store/appStore';
import { useSessionStore } from '@/store/sessionStore';
import { Badge } from '../ui/Badge';
import { Dialog } from '../ui/Dialog';
import { Input } from '../ui/Input';

export function GlobalSearch() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const open = useAppStore((s) => s.searchOpen);
  const setOpen = useAppStore((s) => s.setSearchOpen);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const timer = useRef<number | null>(null);
  useEffect(() => {
    if (!open || !q.trim()) return;
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      getApi().invoke('search.query', { q, limit: 30 }).then(setResults).catch(() => setResults([]));
    }, 120);
  }, [q, open]);
  if (!open) return null;
  const shown = q.trim() ? results : [];
  const go = async (r: SearchResult) => {
    setOpen(false);
    setQ('');
    if (r.type === 'project') {
      await useSessionStore.getState().open(r.id);
      navigate(`/editor/${r.id}`);
    } else if (r.type === 'asset') navigate('/media');
    else if (r.type === 'model') navigate('/models');
    else if (r.type === 'template') navigate('/templates');
    else if (r.projectId) {
      await useSessionStore.getState().open(r.projectId);
      navigate(`/${r.type === 'operation' ? 'editor' : 'creator'}/${r.projectId}`);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => { setOpen(o); if (!o) setQ(''); }} title={t('search.hint')} size="md">
      <div className="relative">
        <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
        <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('search.placeholder')} className="ps-9" data-testid="search-input" />
      </div>
      <ul className="mt-3 flex max-h-80 flex-col gap-1 overflow-y-auto" data-testid="search-results">
        {q.trim() && shown.length === 0 ? <li className="px-2 py-6 text-center text-[13px] text-muted">{t('search.noResults')}</li> : null}
        {shown.map((r) => (
          <li key={`${r.type}:${r.id}`}>
            <button type="button" data-action="search.result" className="focus-ring flex w-full items-center gap-3 rounded-lg px-3 py-2 text-start hover:bg-surface-2" onClick={() => void go(r)}>
              <Badge tone="neutral">{t(`search.types.${r.type}`)}</Badge>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-text">{r.title}</span>
                {r.subtitle ? <span className="block truncate text-[12px] text-muted">{r.subtitle}</span> : null}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
