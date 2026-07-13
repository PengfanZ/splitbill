import { useState, type ReactNode } from 'react'
import {
  Activity,
  Bell,
  ChevronRight,
  LayoutDashboard,
  Menu,
  Plus,
  Search,
  Settings,
  Users,
  WalletCards,
  X,
} from 'lucide-react'
import type { ActivityGroup, Member } from '../domain/models'

export function Avatar({ member, size = 'md' }: { member: Member; size?: 'sm' | 'md' | 'lg' }) {
  return <span className={`avatar avatar--${size}`} style={{ background: member.color }}>{member.initials}</span>
}

export function Sidebar({ groups, selectedId, onSelect, onCreate, onReset }: {
  groups: ActivityGroup[]
  selectedId: string | null
  onSelect: (id: string) => void
  onCreate: () => void
  onReset: () => void
}) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const items = [[LayoutDashboard, 'Overview'], [Activity, 'Activity'], [Users, 'Groups'], [WalletCards, 'Friends']] as const

  return (
    <>
      <button className="mobile-menu" aria-label="Open navigation" onClick={() => setMobileOpen(true)}><Menu /></button>
      <aside className={`sidebar ${mobileOpen ? 'sidebar--open' : ''}`}>
        <div className="sidebar-top">
          <div className="brand">Tally<span>.</span></div>
          <button className="sidebar-close" aria-label="Close navigation" onClick={() => setMobileOpen(false)}><X /></button>
        </div>
        <nav aria-label="Primary navigation">
          {items.map(([Icon, label], index) => (
            <button key={label} className={`nav-item ${index === 0 ? 'is-active' : ''}`} onClick={() => setMobileOpen(false)}>
              <Icon size={19} strokeWidth={1.8} /><span>{label}</span>
            </button>
          ))}
        </nav>
        <button className="add-button" onClick={() => { onCreate(); setMobileOpen(false) }}><Plus size={20} />New activity</button>
        <div className="group-section">
          <p className="section-label">Your activities</p>
          {groups.length ? groups.map(group => (
            <button key={group.id} className={`group-row group-row--button ${group.id === selectedId ? 'is-selected' : ''}`} onClick={() => { onSelect(group.id); setMobileOpen(false) }}>
              <span className="group-icon green">{group.emoji}</span>
              <span><b>{group.name}</b><small>{group.memberIds.length} {group.memberIds.length === 1 ? 'person' : 'people'}</small></span>
              <ChevronRight size={15} />
            </button>
          )) : <p className="sidebar-empty">No activities yet.</p>}
        </div>
        {groups.length ? <button className="reset-button" onClick={onReset}>Reset local data</button> : null}
      </aside>
      {mobileOpen ? <button className="backdrop" aria-label="Close navigation" onClick={() => setMobileOpen(false)} /> : null}
    </>
  )
}

export function Topbar({ query, setQuery }: { query: string; setQuery: (value: string) => void }) {
  return (
    <header className="topbar">
      <div className="search-box"><Search size={18} /><input aria-label="Search expenses" placeholder="Search this activity…" value={query} onChange={event => setQuery(event.target.value)} />{query ? <button onClick={() => setQuery('')} aria-label="Clear search"><X size={16} /></button> : null}</div>
      <button className="icon-button" aria-label="Notifications"><Bell size={20} /><i /></button>
      <button className="icon-button" aria-label="Settings"><Settings size={20} /></button>
    </header>
  )
}

export function FreshStart({ onCreate }: { onCreate: () => void }) {
  return (
    <main className="fresh-start">
      <div className="fresh-illustration"><span><Users size={32} /></span><i /><i /><i /></div>
      <p className="fresh-kicker">A clean slate</p>
      <h1>Start your first activity</h1>
      <p>Create a group for a trip, home, dinner, or anything you share. Add friends now or invite them later.</p>
      <button className="confirm-button fresh-button" onClick={onCreate}><Plus size={18} />Create an activity</button>
      <div className="fresh-steps"><span><b>1</b>Name the activity</span><span><b>2</b>Add your friends</span><span><b>3</b>Split expenses fairly</span></div>
    </main>
  )
}

export function ModalShell({ eyebrow, title, onClose, children }: { eyebrow: string; title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.currentTarget === event.target) onClose() }}>
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <div className="modal-header"><div><span>{eyebrow}</span><h2 id="modal-title">{title}</h2></div><button aria-label="Close" onClick={onClose}><X size={20} /></button></div>
        {children}
      </section>
    </div>
  )
}
