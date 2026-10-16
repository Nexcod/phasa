import { t } from '../i18n';
import type { BackgroundStatus } from './useBackgroundStatus';

export function statusText(status: BackgroundStatus): string {
  switch (status.state) {
    case 'connecting':
      return t('statusConnecting');
    case 'connected':
      return t('statusConnected', String(status.schemaVersion));
    case 'error':
      return t('statusError', status.message);
  }
}

export function StatusLine({
  status,
  className,
}: {
  status: BackgroundStatus;
  className?: string;
}) {
  return (
    <p className={className} data-testid="phasa-status" data-state={status.state} role="status">
      {statusText(status)}
    </p>
  );
}
