import { useState, type ReactNode } from 'react'
import {
  ChevronRight,
  Github,
  Link2,
  Menu,
  Plus,
  Search,
  Settings,
  Trash2,
  Users,
  X,
} from 'lucide-react'
import type { ActivityGroup, Member } from '../domain/models'
import { useLocalization } from '../i18n/LocalizationContext'

const EMPTY_LIVE_ACTIVITY_CODES: Record<string, string> = {}

export function Avatar({ member, size = 'md' }: { member: Member; size?: 'sm' | 'md' | 'lg' }) {
  return <span className={`avatar avatar--${size}`} style={{ background: member.color }}>{member.initials}</span>
}

export function Sidebar({ groups, selectedId, liveActivityCodes = EMPTY_LIVE_ACTIVITY_CODES, onSelect, onCreate, onJoin, onDelete, onReset }: {
  groups: ActivityGroup[]
  selectedId: string | null
  liveActivityCodes?: Record<string, string>
  onSelect: (id: string) => void
  onCreate: () => void
  onJoin: () => void
  onDelete: (group: ActivityGroup) => void
  onReset: () => void
}) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const { t } = useLocalization()

  return (
    <>
      <button className="mobile-menu" aria-label={t('nav.open')} onClick={() => setMobileOpen(true)}><Menu /></button>
      <aside className={`sidebar ${mobileOpen ? 'sidebar--open' : ''}`}>
        <div className="sidebar-top">
          <div className="brand">Tally<span>.</span></div>
          <button className="sidebar-close" aria-label={t('nav.close')} onClick={() => setMobileOpen(false)}><X /></button>
        </div>
        <div className="sidebar-actions">
          <button className="add-button" onClick={() => { onCreate(); setMobileOpen(false) }}><Plus size={20} />{t('nav.newActivity')}</button>
          <button className="outline-button join-button" onClick={() => { onJoin(); setMobileOpen(false) }}><Link2 size={17} />{t('nav.joinActivity')}</button>
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
              <button className="group-delete" aria-label={t('nav.deleteActivity', { name: group.name })} title={t('nav.deleteActivityTitle')} onClick={() => onDelete(group)}><Trash2 size={15} /></button>
            </div>
          )) : <p className="sidebar-empty">{t('nav.noActivities')}</p>}
        </div>
        <div className="sidebar-footer">
          <a className="source-link" href="https://github.com/PengfanZ/splitbill" target="_blank" rel="noreferrer"><Github size={16} />{t('nav.sourceFeedback')}</a>
          {groups.length ? <button className="reset-button" onClick={onReset}>{t('nav.resetData')}</button> : null}
        </div>
      </aside>
      {mobileOpen ? <button className="backdrop" aria-label={t('nav.close')} onClick={() => setMobileOpen(false)} /> : null}
    </>
  )
}

export function Topbar({ query, setQuery, onSettings }: { query: string; setQuery: (value: string) => void; onSettings?: () => void }) {
  const { t } = useLocalization()
  return (
    <header className="topbar">
      <div className="search-box"><Search size={18} /><input aria-label={t('topbar.searchLabel')} placeholder={t('topbar.searchPlaceholder')} value={query} onChange={event => setQuery(event.target.value)} />{query ? <button onClick={() => setQuery('')} aria-label={t('topbar.clearSearch')}><X size={16} /></button> : null}</div>
      <button className="icon-button" aria-label={t('topbar.settings')} onClick={onSettings}><Settings size={20} /></button>
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
      <div className="fresh-actions"><button className="confirm-button fresh-button" onClick={onCreate}><Plus size={18} />{t('fresh.create')}</button><button className="outline-button fresh-button" onClick={onJoin}><Link2 size={17} />{t('fresh.join')}</button></div>
      <div className="fresh-steps"><span><b>1</b>{t('fresh.stepName')}</span><span><b>2</b>{t('fresh.stepFriends')}</span><span><b>3</b>{t('fresh.stepSplit')}</span></div>
    </main>
  )
}

export function ModalShell({ eyebrow, title, onClose, children, mobilePlacement = 'sheet' }: {
  eyebrow: string
  title: string
  onClose?: () => void
  children: ReactNode
  mobilePlacement?: 'sheet' | 'center'
}) {
  const { t } = useLocalization()
  return (
    <div className={`modal-backdrop modal-backdrop--${mobilePlacement}`} role="presentation" onMouseDown={event => { if (onClose && event.currentTarget === event.target) onClose() }}>
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <div className="modal-header"><div><span>{eyebrow}</span><h2 id="modal-title">{title}</h2></div>{onClose ? <button aria-label={t('common.close')} onClick={onClose}><X size={20} /></button> : null}</div>
        <div className="modal-body">{children}</div>
      </section>
    </div>
  )
}
