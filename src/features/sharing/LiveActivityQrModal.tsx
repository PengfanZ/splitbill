import { Copy, ScanQrCode, Share2, ShieldCheck } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { ModalShell } from '../../components/AppShell'
import { Button } from '../../components/Button'
import { useLocalization } from '../../i18n/LocalizationContext'

export function LiveActivityQrModal({ groupName, url, activityCode, onClose, onCopy, onShare }: {
  groupName: string
  url: string
  activityCode?: string
  onClose: () => void
  onCopy: () => void
  onShare: () => void
}) {
  const { t } = useLocalization()
  const codeSuffix = activityCode ? ` · ${activityCode}` : ''
  const qrLabel = t('qr.codeLabel', { name: groupName })
  return (
    <ModalShell eyebrow={t('qr.liveEyebrow', { code: codeSuffix })} title={t('qr.scanJoin', { name: groupName })} onClose={onClose}>
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
        <div className="qr-instructions"><ScanQrCode size={20} /><span><b>{t('qr.scanPhone')}</b><small>{t('qr.liveDescription')}</small></span></div>
        <div className="split-note qr-privacy"><ShieldCheck size={18} /><span><b>{t('qr.livePrivacyTitle')}</b><small>{t('qr.livePrivacyText')}</small></span></div>
        <div className="modal-actions"><Button className="qr-copy-button" onClick={onCopy}><Copy size={16} />{t('qr.copy')}</Button><Button variant="primary" className="qr-copy-button" onClick={onShare}><Share2 size={16} />{t('qr.share')}</Button></div>
      </div>
    </ModalShell>
  )
}
