import { useTranslation } from 'react-i18next';
import { PhaseNotice } from '@/components/CapabilityGate';
import { PageHeader } from '@/components/ui/Misc';

export function CreatorScreen() {
  const { t } = useTranslation();
  return (
    <div className="mx-auto max-w-6xl px-8 py-8">
      <PageHeader title={t('creator.title')} subtitle={t('creator.subtitle')} />
      <PhaseNotice phase={5} feature={t('creator.title')} />
    </div>
  );
}
