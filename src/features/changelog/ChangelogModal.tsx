import {
  BadgeCheck,
  ListChecks,
  MessageSquareText,
  Mic2,
  Radio,
  ReceiptText,
  Share2,
  SlidersHorizontal,
  SunMoon,
  type LucideIcon,
} from 'lucide-react'
import { ModalShell } from '../../components/Dialog'
import { Button } from '../../components/Button'
import { useLocalization } from '../../i18n/LocalizationContext'
import {
  CHANGELOG_ENTRIES,
  formatChangelogDate,
  type ChangelogIcon,
} from './changelog'

const CHANGELOG_ICONS: Record<ChangelogIcon, LucideIcon> = {
  aiText: MessageSquareText,
  aiVoice: Mic2,
  aiReview: ListChecks,
  live: Radio,
  share: Share2,
  settle: BadgeCheck,
  polish: SlidersHorizontal,
  theme: SunMoon,
  receipt: ReceiptText,
}

export function ChangelogModal({ onClose }: { onClose: () => void }) {
  const { locale, t } = useLocalization()

  return (
    <ModalShell
      eyebrow={t('changelog.eyebrow')}
      title={t('changelog.title')}
      onClose={onClose}
      mobilePlacement="center"
    >
      <div className="changelog">
        {CHANGELOG_ENTRIES.map(entry => (
          <article className="changelog-release" key={entry.id}>
            <time dateTime={entry.releasedOn}>{formatChangelogDate(entry.releasedOn, locale)}</time>
            <h3>{t(entry.titleKey)}</h3>
            <p className="changelog-summary">{t(entry.summaryKey)}</p>
            <ul className="changelog-list">
              {entry.items.map(item => {
                const Icon = CHANGELOG_ICONS[item.icon]
                return (
                  <li className="changelog-item" key={item.titleKey}>
                    <span className="changelog-icon"><Icon size={18} /></span>
                    <span>
                      <b>{t(item.titleKey)}</b>
                      <small>{t(item.descriptionKey)}</small>
                    </span>
                  </li>
                )
              })}
            </ul>
          </article>
        ))}
        <Button variant="primary" className="changelog-confirm" onClick={onClose}>
          {t('changelog.confirm')}
        </Button>
      </div>
    </ModalShell>
  )
}
