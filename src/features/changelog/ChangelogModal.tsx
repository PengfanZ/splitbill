import {
  BadgeCheck,
  Radio,
  Share2,
  SlidersHorizontal,
  type LucideIcon,
} from 'lucide-react'
import { ModalShell } from '../../components/AppShell'
import { useLocalization } from '../../i18n/LocalizationContext'
import {
  CHANGELOG_ENTRIES,
  formatChangelogDate,
  type ChangelogIcon,
} from './changelog'

const CHANGELOG_ICONS: Record<ChangelogIcon, LucideIcon> = {
  live: Radio,
  share: Share2,
  settle: BadgeCheck,
  polish: SlidersHorizontal,
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
        <button className="confirm-button changelog-confirm" onClick={onClose}>
          {t('changelog.confirm')}
        </button>
      </div>
    </ModalShell>
  )
}
