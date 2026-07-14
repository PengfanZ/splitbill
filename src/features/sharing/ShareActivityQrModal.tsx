import { Copy, ScanQrCode, ShieldCheck } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { ModalShell } from '../../components/AppShell'

export function ShareActivityQrModal({ groupName, url, onClose, onCopy }: {
  groupName: string
  url: string
  onClose: () => void
  onCopy: () => void
}) {
  return (
    <ModalShell eyebrow="Share activity" title={`Scan to open ${groupName}`} onClose={onClose}>
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
        <div className="qr-instructions"><ScanQrCode size={20} /><span><b>Scan with a phone camera</b><small>The code opens a read-only snapshot of this activity on Tally.</small></span></div>
        <div className="split-note qr-privacy"><ShieldCheck size={18} /><span><b>Anyone with the code can view it</b><small>Names and expense details are stored inside this QR code. It is not encrypted.</small></span></div>
        <div className="modal-actions"><button type="button" className="outline-button" onClick={onClose}>Close</button><button type="button" className="confirm-button qr-copy-button" onClick={onCopy}><Copy size={16} />Copy link</button></div>
      </div>
    </ModalShell>
  )
}
