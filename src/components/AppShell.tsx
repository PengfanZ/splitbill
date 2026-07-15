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

  return (
    <>
      <button className="mobile-menu" aria-label="Open navigation" onClick={() => setMobileOpen(true)}><Menu /></button>
      <aside className={`sidebar ${mobileOpen ? 'sidebar--open' : ''}`}>
        <div className="sidebar-top">
          <div className="brand">Tally<span>.</span></div>
          <button className="sidebar-close" aria-label="Close navigation" onClick={() => setMobileOpen(false)}><X /></button>
        </div>
        <div className="sidebar-actions">
          <button className="add-button" onClick={() => { onCreate(); setMobileOpen(false) }}><Plus size={20} />New activity</button>
          <button className="outline-button join-button" onClick={() => { onJoin(); setMobileOpen(false) }}><Link2 size={17} />Join activity</button>
        </div>
        <div className="group-section">
          <p className="section-label">Your activities</p>
          {groups.length ? groups.map(group => (
            <div key={group.id} className={`group-row ${group.id === selectedId ? 'is-selected' : ''}`}>
              <button className="group-select" aria-label={`Open ${group.name} activity`} onClick={() => { onSelect(group.id); setMobileOpen(false) }}>
                <span className="group-icon green">{group.emoji}</span>
                <span><b>{group.name}</b><small>{liveActivityCodes[group.id] ? `Live · ${liveActivityCodes[group.id]}` : `${group.memberIds.length} ${group.memberIds.length === 1 ? 'person' : 'people'}`}</small></span>
                <ChevronRight size={15} />
              </button>
              <button className="group-delete" aria-label={`Delete ${group.name} activity`} title="Delete activity" onClick={() => onDelete(group)}><Trash2 size={15} /></button>
            </div>
          )) : <p className="sidebar-empty">No activities yet.</p>}
        </div>
        <div className="sidebar-footer">
          <a className="source-link" href="https://github.com/PengfanZ/splitbill" target="_blank" rel="noreferrer"><Github size={16} />Source &amp; feedback</a>
          {groups.length ? <button className="reset-button" onClick={onReset}>Reset local data</button> : null}
        </div>
      </aside>
      {mobileOpen ? <button className="backdrop" aria-label="Close navigation" onClick={() => setMobileOpen(false)} /> : null}
    </>
  )
}

export function Topbar({ query, setQuery, onSettings }: { query: string; setQuery: (value: string) => void; onSettings?: () => void }) {
  return (
    <header className="topbar">
      <div className="search-box"><Search size={18} /><input aria-label="Search expenses" placeholder="Search this activity…" value={query} onChange={event => setQuery(event.target.value)} />{query ? <button onClick={() => setQuery('')} aria-label="Clear search"><X size={16} /></button> : null}</div>
      <button className="icon-button" aria-label="Settings" onClick={onSettings}><Settings size={20} /></button>
    </header>
  )
}

export function FreshStart({ onCreate, onJoin }: { onCreate: () => void; onJoin: () => void }) {
  return (
    <main className="fresh-start">
      <div className="fresh-illustration"><span><Users size={32} /></span><i /><i /><i /></div>
      <p className="fresh-kicker">A clean slate</p>
      <h1>Start your first activity</h1>
      <p>Create a group for a trip, home, dinner, or anything you share. Add friends now or invite them later.</p>
      <div className="fresh-actions"><button className="confirm-button fresh-button" onClick={onCreate}><Plus size={18} />Create an activity</button><button className="outline-button fresh-button" onClick={onJoin}><Link2 size={17} />Join from a link</button></div>
      <div className="fresh-steps"><span><b>1</b>Name the activity</span><span><b>2</b>Add your friends</span><span><b>3</b>Split expenses fairly</span></div>
    </main>
  )
}

export function ModalShell({ eyebrow, title, onClose, children }: { eyebrow: string; title: string; onClose?: () => void; children: ReactNode }) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (onClose && event.currentTarget === event.target) onClose() }}>
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <div className="modal-header"><div><span>{eyebrow}</span><h2 id="modal-title">{title}</h2></div>{onClose ? <button aria-label="Close" onClick={onClose}><X size={20} /></button> : null}</div>
        <div className="modal-body">{children}</div>
      </section>
    </div>
  )
}
