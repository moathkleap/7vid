import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pause, Play, X } from 'lucide-react';
import { formatMs } from '@sevenvid/core';
import { Badge } from '@/components/ui/Badge';
import { Button, IconButton } from '@/components/ui/Button';
import { useEditorStore, type CompareState } from '@/store/editorStore';

/** Split before/after playback of two rendered files with a draggable divider. */
export function CompareView({ compare }: { compare: CompareState }) {
  const { t } = useTranslation();
  const setCompare = useEditorStore((s) => s.setCompare);
  const beforeRef = useRef<HTMLVideoElement>(null);
  const afterRef = useRef<HTMLVideoElement>(null);
  const [split, setSplit] = useState(50);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    const a = beforeRef.current;
    const b = afterRef.current;
    if (!a || !b) return;
    const sync = () => {
      if (Math.abs(a.currentTime - b.currentTime) > 0.08) b.currentTime = a.currentTime;
    };
    const onEnd = () => setPlaying(false);
    a.addEventListener('timeupdate', sync);
    a.addEventListener('ended', onEnd);
    return () => {
      a.removeEventListener('timeupdate', sync);
      a.removeEventListener('ended', onEnd);
    };
  }, [compare]);
  const toggle = () => {
    const a = beforeRef.current;
    const b = afterRef.current;
    if (!a || !b) return;
    if (playing) {
      a.pause();
      b.pause();
      setPlaying(false);
    } else {
      b.currentTime = a.currentTime;
      void Promise.all([a.play(), b.play()]).then(() => setPlaying(true)).catch(() => setPlaying(false));
    }
  };
  return (
    <div className="relative h-full w-full" data-testid="compare-view">
      <video ref={beforeRef} src={compare.beforeUrl} className="absolute inset-0 h-full w-full object-contain" preload="auto" muted={false} playsInline />
      <video ref={afterRef} src={compare.afterUrl} className="absolute inset-0 h-full w-full object-contain" preload="auto" muted playsInline style={{ clipPath: `inset(0 0 0 ${split}%)` }} />
      <div className="pointer-events-none absolute inset-y-0 w-0.5 bg-accent" style={{ left: `${split}%` }} />
      <div className="pointer-events-none absolute start-3 top-3 flex gap-2"><Badge tone="neutral">{t('editor.compareBefore')}</Badge></div>
      <div className="pointer-events-none absolute end-3 top-3 flex gap-2"><Badge tone="success">{t('editor.compareAfter')}</Badge></div>
      <div className="absolute inset-x-0 bottom-0 flex items-center gap-2 bg-black/60 px-3 py-2">
        <IconButton action="compare.toggle" label={playing ? t('editor.pause') : t('editor.play')} size="sm" onClick={toggle}>{playing ? <Pause /> : <Play />}</IconButton>
        <input type="range" min={0} max={100} value={split} data-action="compare.split" onChange={(e) => setSplit(Number(e.target.value))} className="flex-1 accent-[var(--accent)]" dir="ltr" aria-label={t('enhancePanel.slider')} />
        <span className="font-mono text-[11px] text-white/80" dir="ltr">{formatMs(compare.startMs)} – {formatMs(compare.endMs)}</span>
        <Button action="compare.close" size="sm" variant="ghost" icon={<X />} onClick={() => setCompare(null)}>{t('common.close')}</Button>
      </div>
    </div>
  );
}
