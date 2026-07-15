import { Copy, ScanQrCode, Share2, ShieldCheck } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { ModalShell } from '../../components/AppShell'

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
  return (
    <ModalShell eyebrow={live ? `Live activity${activityCode ? ` · ${activityCode}` : ''}` : 'Share activity'} title={`Scan to ${live ? 'join' : 'open'} ${groupName}`} onClose={onClose}>
      <div className="qr-share">
        <div className="qr-code" aria-label={`${groupName} shared activity QR code`}>
          <QRCodeSVG
            value={url}
            size={280}
            level="M"
            marginSize={4}
            title={`${groupName} shared activity QR code`}
          />
        </div>
        <div className="qr-instructions"><ScanQrCode size={20} /><span><b>Scan with a phone camera</b><small>{live ? 'The code opens the same editable activity on Tally.' : 'The code opens a read-only snapshot of this activity on Tally.'}</small></span></div>
        <div className="split-note qr-privacy"><ShieldCheck size={18} /><span><b>{live ? 'Anyone with the link can edit' : 'Anyone with the code can view it'}</b><small>{live ? 'The link contains a private edit token. Share it only with people in this activity.' : 'Names and expense details are stored inside this QR code. It is not encrypted.'}</small></span></div>
        <div className="modal-actions"><button type="button" className="outline-button qr-copy-button" onClick={onCopy}><Copy size={16} />Copy link</button><button type="button" className="confirm-button qr-copy-button" onClick={onShare}><Share2 size={16} />Share link</button></div>
      </div>
    </ModalShell>
  )
}
