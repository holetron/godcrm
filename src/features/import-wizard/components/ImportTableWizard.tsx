import { Modal } from '@/shared/components/ui/Modal';
import { Button } from '@/shared/components/ui/Button';
import { useLanguage } from '@/shared/i18n/LanguageContext';

interface ImportTableWizardProps {
  workspaceId: string;
  projectId?: string;
  onClose: () => void;
  onSuccess: () => void;
}

// STUB — the full table-import wizard is WIP and excluded from the public repo
// (the real implementation lives in *.impl.tsx + ./steps, ./hooks, ./types,
// all gitignored). Ships as a "coming soon" surface until the feature lands.
export function ImportTableWizard({ onClose }: ImportTableWizardProps) {
  const { language } = useLanguage();

  return (
    <Modal
      open={true}
      onOpenChange={onClose}
      title={language === 'ru' ? 'Импорт таблицы' : 'Import Table'}
      size="md"
    >
      <div className="flex min-h-[220px] flex-col items-center justify-center gap-4 text-center">
        <span aria-hidden className="text-4xl">🚧</span>
        <p className="font-mono text-sm font-black uppercase tracking-widest text-[var(--text-secondary)]">
          {language === 'ru' ? 'Скоро' : 'Coming soon'}
        </p>
        <Button variant="secondary" onClick={onClose}>
          {language === 'ru' ? 'Закрыть' : 'Close'}
        </Button>
      </div>
    </Modal>
  );
}
