import { Copy, ScanQrCode, Share2, ShieldCheck } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { ModalShell } from '../../components/AppShell'
import { useLocalization } from '../../i18n/LocalizationContext'

export function ShareActivityQrModal({ groupName, url, mode = 'snapshot', activityCode, onClose, onCopy, onShare }: {
  groupName: string
  url: string
  mode?: 'snapshot' | 'live'
  activityCode?: string
  onClose: () => void
  onCopy: () => void
  onShare: () => void
}) {
  const live = mode === 'live'
  const { t } = useLocalization()
  const codeSuffix = activityCode ? ` · ${activityCode}` : ''
  const qrLabel = t('qr.codeLabel', { name: groupName })
  return (
    <ModalShell eyebrow={live ? t('qr.liveEyebrow', { code: codeSuffix }) : t('qr.shareEyebrow')} title={t(live ? 'qr.scanJoin' : 'qr.scanOpen', { name: groupName })} onClose={onClose}>
      <div className="qr-share">
        <div className="qr-code" aria-label={qrLabel}>
          <QRCodeSVG
            value={url}
            size={280}
            level="M"
            marginSize={4}
            title={qrLabel}
          />
        </div>
        <div className="qr-instructions"><ScanQrCode size={20} /><span><b>{t('qr.scanPhone')}</b><small>{t(live ? 'qr.liveDescription' : 'qr.snapshotDescription')}</small></span></div>
        <div className="split-note qr-privacy"><ShieldCheck size={18} /><span><b>{t(live ? 'qr.livePrivacyTitle' : 'qr.snapshotPrivacyTitle')}</b><small>{t(live ? 'qr.livePrivacyText' : 'qr.snapshotPrivacyText')}</small></span></div>
        <div className="modal-actions"><button type="button" className="outline-button qr-copy-button" onClick={onCopy}><Copy size={16} />{t('qr.copy')}</button><button type="button" className="confirm-button qr-copy-button" onClick={onShare}><Share2 size={16} />{t('qr.share')}</button></div>
      </div>
    </ModalShell>
  )
}
