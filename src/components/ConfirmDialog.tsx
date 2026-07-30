import { AlertTriangle } from 'lucide-react'
import { useLocalization } from '../i18n/LocalizationContext'
import { Button } from './Button'
import { ModalShell } from './Dialog'

export function ConfirmDialog({
  busy = false,
  confirmLabel,
  description,
  onCancel,
  onConfirm,
  title,
  variant = 'danger',
}: {
  busy?: boolean
  confirmLabel: string
  description: string
  onCancel: () => void
  onConfirm: () => void | Promise<void>
  title: string
  variant?: 'danger' | 'primary'
}) {
  const { t } = useLocalization()

  return (
    <ModalShell
      eyebrow={t('confirm.eyebrow')}
      title={title}
      onClose={busy ? undefined : onCancel}
      mobilePlacement="center"
      bodyClassName="confirm-dialog"
    >
      <div className="confirm-dialog-message">
        <span className={`confirm-dialog-icon confirm-dialog-icon--${variant}`} aria-hidden="true">
          <AlertTriangle size={22} />
        </span>
        <p>{description}</p>
      </div>
      <div className="modal-actions">
        <Button onClick={onCancel} disabled={busy}>{t('common.cancel')}</Button>
        <Button variant={variant === 'danger' ? 'danger' : 'primary'} onClick={() => void onConfirm()} disabled={busy}>
          {busy ? t('common.loading') : confirmLabel}
        </Button>
      </div>
    </ModalShell>
  )
}
