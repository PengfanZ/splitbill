import { useState } from 'react'
import {
  ChevronRight,
  Github,
  Link2,
  Menu,
  Plus,
  Search,
  Settings,
  Sparkles,
  Trash2,
  Users,
  X,
} from 'lucide-react'
import type { ActivityGroup, Member } from '../domain/models'
import { useLocalization } from '../i18n/LocalizationContext'
import { Button, IconButton } from './Button'

const EMPTY_LIVE_ACTIVITY_CODES: Record<string, string> = {}

export function Avatar({ member, size = 'md' }: { member: Member; size?: 'sm' | 'md' | 'lg' }) {
  return <span className={`avatar avatar--${size}`} style={{ background: member.color }}>{member.initials}</span>
}

export function Sidebar({ groups, selectedId, liveActivityCodes = EMPTY_LIVE_ACTIVITY_CODES, onSelect, onCreate, onJoin, onShowChangelog, onDelete, onReset, hasUnreadChangelog = false }: {
  groups: ActivityGroup[]
  selectedId: string | null
  liveActivityCodes?: Record<string, string>
  onSelect: (id: string) => void
  onCreate: () => void
  onJoin: () => void
  onShowChangelog: () => void
  onDelete: (group: ActivityGroup) => void
  onReset: () => void
  hasUnreadChangelog?: boolean
}) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const { t } = useLocalization()

  return (
    <>
      <IconButton className="mobile-menu" label={t('nav.open')} onClick={() => setMobileOpen(true)}><Menu /></IconButton>
      <aside className={`sidebar ${mobileOpen ? 'sidebar--open' : ''}`}>
        <div className="sidebar-top">
          <div className="brand">Tally<span>.</span></div>
          <IconButton className="sidebar-close" label={t('nav.close')} onClick={() => setMobileOpen(false)}><X /></IconButton>
        </div>
        <div className="sidebar-actions">
          <Button variant="primary" className="add-button" onClick={() => { onCreate(); setMobileOpen(false) }}><Plus size={20} />{t('nav.newActivity')}</Button>
          <Button className="join-button" onClick={() => { onJoin(); setMobileOpen(false) }}><Link2 size={17} />{t('nav.joinActivity')}</Button>
        </div>
        <div className="group-section">
          <p className="section-label">{t('nav.yourActivities')}</p>
          {groups.length ? groups.map(group => (
            <div key={group.id} className={`group-row ${group.id === selectedId ? 'is-selected' : ''}`}>
              <button className="group-select" aria-label={t('nav.openActivity', { name: group.name })} onClick={() => { onSelect(group.id); setMobileOpen(false) }}>
                <span className="group-icon green">{group.emoji}</span>
                <span><b>{group.name}</b><small>{liveActivityCodes[group.id]
                  ? t('nav.liveCode', { code: liveActivityCodes[group.id] })
                  : t('nav.memberCount', { count: group.memberIds.length, unit: t(group.memberIds.length === 1 ? 'common.person' : 'common.people') })}</small></span>
                <ChevronRight size={15} />
              </button>
              <IconButton className="group-delete" tone="danger" label={t('nav.deleteActivity', { name: group.name })} title={t('nav.deleteActivityTitle')} onClick={() => onDelete(group)}><Trash2 size={15} /></IconButton>
            </div>
          )) : <p className="sidebar-empty">{t('nav.noActivities')}</p>}
        </div>
        <div className="sidebar-footer">
          <button className="source-link changelog-link" onClick={() => { onShowChangelog(); setMobileOpen(false) }}>
            <Sparkles size={16} />{t('nav.whatsNew')}
            {hasUnreadChangelog ? <span className="changelog-unread" aria-label={t('nav.newUpdates')} /> : null}
          </button>
          <a className="source-link" href="https://github.com/PengfanZ/splitbill" target="_blank" rel="noreferrer"><Github size={16} />{t('nav.sourceFeedback')}</a>
          {groups.length ? <button className="reset-button" onClick={onReset}>{t('nav.resetData')}</button> : null}
        </div>
      </aside>
      {mobileOpen ? <button className="backdrop" aria-label={t('nav.close')} onClick={() => setMobileOpen(false)} /> : null}
    </>
  )
}

export function Topbar({ query, setQuery, onSettings, activityName, activityDetail, activityEmoji }: {
  query: string
  setQuery: (value: string) => void
  onSettings?: () => void
  activityName?: string
  activityDetail?: string
  activityEmoji?: string
}) {
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false)
  const { t } = useLocalization()
  return (
    <header className="topbar">
      {activityName ? <div className={`topbar-context${mobileSearchOpen ? ' topbar-context--hidden' : ''}`}><span>{activityEmoji}</span><div><b>{activityName}</b>{activityDetail ? <small>{activityDetail}</small> : null}</div></div> : null}
      <div className={`search-box${mobileSearchOpen ? ' search-box--mobile-open' : ''}`}><Search size={18} /><input aria-label={t('topbar.searchLabel')} placeholder={t('topbar.searchPlaceholder')} value={query} onChange={event => setQuery(event.target.value)} />{query || mobileSearchOpen ? <button onClick={() => { setQuery(''); setMobileSearchOpen(false) }} aria-label={query ? t('topbar.clearSearch') : t('topbar.closeSearch')}><X size={16} /></button> : null}</div>
      <IconButton className="mobile-search-toggle" label={t('topbar.openSearch')} onClick={() => setMobileSearchOpen(true)}><Search size={20} /></IconButton>
      <IconButton label={t('topbar.settings')} onClick={onSettings}><Settings size={20} /></IconButton>
    </header>
  )
}

export function FreshStart({ onCreate, onJoin }: { onCreate: () => void; onJoin: () => void }) {
  const { t } = useLocalization()
  return (
    <main className="fresh-start">
      <div className="fresh-illustration"><span><Users size={32} /></span><i /><i /><i /></div>
      <p className="fresh-kicker">{t('fresh.kicker')}</p>
      <h1>{t('fresh.title')}</h1>
      <p>{t('fresh.description')}</p>
      <div className="fresh-actions"><Button variant="primary" className="fresh-button" onClick={onCreate}><Plus size={18} />{t('fresh.create')}</Button><Button className="fresh-button" onClick={onJoin}><Link2 size={17} />{t('fresh.join')}</Button></div>
      <div className="fresh-steps"><span><b>1</b>{t('fresh.stepName')}</span><span><b>2</b>{t('fresh.stepFriends')}</span><span><b>3</b>{t('fresh.stepSplit')}</span></div>
    </main>
  )
}
