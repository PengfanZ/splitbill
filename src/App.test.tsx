import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent, { type UserEvent } from '@testing-library/user-event'
import { StrictMode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import type { AnalyticsClient } from './analytics'
import { Avatar, FreshStart, Sidebar, Topbar } from './components/AppShell'
import { ModalShell } from './components/Dialog'
import { ACTIVITY_IDENTITY_KEY } from './data/activityIdentity'
import { IDENTITY_KEY } from './data/identity'
import { EMPTY_STATE, loadState, parseState, saveState, STORAGE_KEY } from './data/storage'
import { CURRENT_USER } from './domain/members'
import type { ActivityGroup, Expense, Member, PersistedState } from './domain/models'
import { ActivitySummary, ExpenseList, GroupDashboard, MembersRail, SettlementDirections } from './features/activity/ActivityDashboard'
import { AddFriendModal, CreateGroupModal, ExpenseModal, SettleUpModal } from './features/activity/ActivityModals'
import { CHANGELOG_SEEN_STORAGE_KEY, LATEST_CHANGELOG_ID } from './features/changelog/changelog'
import { RATING_PROMPT_STORAGE_KEY } from './features/feedback/ratingPromptStorage'
import { LiveActivityApiError, type LiveActivityRecord } from './features/liveSharing/liveActivityApi'
import type { LiveActivityClient } from './features/liveSharing/liveActivityConfig'
import { buildLiveActivityUrl, LIVE_ACTIVITY_HASH_PREFIX } from './features/liveSharing/liveActivityLink'
import { liveActivityErrorMessage } from './features/liveSharing/useLiveActivitySession'
import { LIVE_ACTIVITY_BOOKMARKS_KEY } from './features/liveSharing/useLiveActivityBookmarks'
import { LIVE_ACTIVITY_MIRRORS_KEY, createLiveActivityMirror } from './features/liveSharing/useLiveActivityMirrors'
import { LIVE_ACTIVITY_POLL_INTERVAL_MS } from './features/liveSharing/liveActivityQuery'
import { buildShareSummary, calculateSummaryCardLayout, createSummaryCard, exportActivitySummary, renderLiveQrSvg, SHARE_MESSAGES, shareActivitySummary } from './features/sharing/shareActivity'
import { LiveActivityIdentityModal } from './features/sharing/LiveActivityIdentityModal'
import { createSharedActivity, type SharedActivity } from './features/sharing/sharedActivity'
import { LocalizationProvider } from './i18n/LocalizationContext'

const maya: Member = { id: 'maya', name: 'Maya Chen', initials: 'MC', color: '#abc' }
const jordan: Member = { id: 'jordan', name: 'Jordan', initials: 'J', color: '#def' }
const group: ActivityGroup = { id: 'trip', name: 'Trip', emoji: '✦', memberIds: ['me', 'maya', 'jordan'] }

const expense = (overrides: Partial<Expense> = {}): Expense => ({
  id: 'expense-1',
  groupId: 'trip',
  title: 'Dinner',
  amount: 30,
  payerId: 'me',
  splitMethod: 'equal',
  shares: { me: 10, maya: 10, jordan: 10 },
  createdAt: '2026-07-14T01:00:00.000Z',
  ...overrides,
})

const storedState = (overrides: Partial<PersistedState> = {}): PersistedState => ({
  groups: [group],
  friends: [maya, jordan],
  expenses: [],
  selectedGroupId: group.id,
  ...overrides,
})

beforeEach(() => {
  vi.restoreAllMocks()
  window.history.replaceState(null, '', '/')
  localStorage.setItem(IDENTITY_KEY, JSON.stringify(CURRENT_USER))
  localStorage.removeItem(ACTIVITY_IDENTITY_KEY)
  localStorage.removeItem(RATING_PROMPT_STORAGE_KEY)
  localStorage.setItem(CHANGELOG_SEEN_STORAGE_KEY, LATEST_CHANGELOG_ID)
  Object.defineProperty(navigator, 'share', { configurable: true, value: undefined })
  Object.defineProperty(navigator, 'canShare', { configurable: true, value: undefined })
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined })
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
})

function mockCanvas(blob: Blob | null = new Blob(['png'], { type: 'image/png' })) {
  const context = {
    fillStyle: '',
    font: '',
    textAlign: 'left',
    beginPath: vi.fn(),
    drawImage: vi.fn(),
    fill: vi.fn(),
    fillRect: vi.fn(),
    fillText: vi.fn(),
    roundRect: vi.fn(),
  }
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D)
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(callback => callback(blob))
  return context
}

function mockSummaryDownload() {
  mockCanvas()
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn().mockReturnValue('blob:summary') })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
  return vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
}

async function chooseShareAction(user: UserEvent, actionName: string) {
  await user.click(screen.getByRole('button', { name: 'Share' }))
  const menu = screen.getByRole('dialog', { name: 'Share activity' })
  await user.click(within(menu).getByRole('button', { name: new RegExp(`^${actionName}`) }))
}

async function chooseActivityCurrency(user: UserEvent, currentCurrency: string, nextCurrency: string) {
  await user.click(screen.getByRole('button', { name: `Activity currency, ${currentCurrency}` }))
  await user.click(screen.getByRole('option', { name: nextCurrency }))
}

async function chooseSelectOption(user: UserEvent, label: string | RegExp, option: string) {
  await user.click(screen.getByRole('button', { name: label }))
  await user.click(screen.getByRole('option', { name: option }))
}

async function confirmDialogAction(user: UserEvent, action: 'Delete' | 'Reset data') {
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: action }))
}

describe('state and formatting helpers', () => {
  it('uses the default English live-activity error translator', () => {
    expect(liveActivityErrorMessage(new Error('unexpected'))).toBe('The live activity could not be updated. Please try again.')
  })

  it('parses valid state and chooses a selected group fallback', () => {
    expect(parseState(null)).toBe(EMPTY_STATE)
    expect(parseState(JSON.stringify(storedState()))).toEqual(storedState())
    expect(parseState(JSON.stringify(storedState({ selectedGroupId: null })))).toMatchObject({ selectedGroupId: 'trip' })
    expect(parseState(JSON.stringify({ groups: [], friends: [], expenses: [], selectedGroupId: null }))).toMatchObject({ selectedGroupId: null })
  })

  it.each([
    '{',
    JSON.stringify({ groups: {}, friends: [], expenses: [] }),
    JSON.stringify({ groups: [], friends: {}, expenses: [] }),
    JSON.stringify({ groups: [], friends: [], expenses: {} }),
  ])('rejects malformed persisted state: %s', value => {
    expect(parseState(value)).toBe(EMPTY_STATE)
  })

  it('loads and saves state defensively', () => {
    const state = storedState()
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    expect(loadState()).toEqual(state)

    const setItem = vi.spyOn(localStorage, 'setItem')
    saveState(state)
    expect(setItem).not.toHaveBeenCalled()
    saveState(storedState({ expenses: [expense()] }))
    expect(setItem).toHaveBeenCalledOnce()

    setItem.mockImplementation(() => { throw new Error('blocked') })
    expect(() => saveState(EMPTY_STATE)).not.toThrow()
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    expect(loadState()).toBe(EMPTY_STATE)
    expect(() => saveState(EMPTY_STATE)).not.toThrow()
  })

  it('builds readable summaries for empty, equal, exact, and unknown-payer data', () => {
    const empty = buildShareSummary(group, [CURRENT_USER, maya, jordan], [])
    expect(empty).toContain('Total spent: $0.00')
    expect(empty).toContain('• No expenses yet.')
    expect(empty).toContain('• No settlement payments recorded.')
    expect(empty).toContain('• Everyone is settled.')
    expect(empty).toContain('Shared from Tally · https://pengfanz.github.io/splitbill/')
    expect(empty).not.toContain('Open and edit the Live activity:')

    const populated = buildShareSummary(group, [CURRENT_USER, maya, jordan], [
      expense(),
      expense({ id: 'e2', title: 'Taxi', amount: 15, payerId: 'missing', splitMethod: 'exact', shares: {} }),
      expense({ id: 'payment', kind: 'settlement', title: 'Settlement payment', amount: 5, payerId: 'maya', splitMethod: 'exact', shares: { me: 5 } }),
    ])
    expect(populated).toContain('Total spent: $45.00')
    expect(populated).toContain('Dinner — $30.00, paid by You (split equally)')
    expect(populated).toContain('Taxi — $15.00, paid by Unknown (exact split)')
    expect(populated).toContain('Maya Chen paid You $5.00')
    expect(populated).toContain('Maya Chen pays You $5.00')
    expect(populated).toContain('Jordan pays You $10.00')
    const liveUrl = `https://example.com/splitbill/#live=A1B2C3D4E5.${'a'.repeat(64)}`
    const liveSummary = buildShareSummary(group, [CURRENT_USER, maya, jordan], [expense()], { liveUrl })
    expect(liveSummary).toContain(`Open and edit the Live activity:\n${liveUrl}`)
    expect(buildShareSummary({ ...group, currency: 'CNY' }, [CURRENT_USER, maya, jordan], [expense()]))
      .toContain('Dinner — ¥30.00')

    const malformedPayments = buildShareSummary(group, [CURRENT_USER], [
      expense({ id: 'missing-payer', kind: 'settlement', title: 'Settlement payment', amount: 5, payerId: 'missing', splitMethod: 'exact', shares: {} }),
      expense({ id: 'missing-recipient', kind: 'settlement', title: 'Settlement payment', amount: 5, payerId: 'missing', splitMethod: 'exact', shares: { missing: 5 } }),
    ])
    expect(malformedPayments.match(/Unknown paid Unknown \$5\.00/g)).toHaveLength(2)
  })

  it('renders populated and empty PNG cards', async () => {
    const context = mockCanvas()
    const card = await createSummaryCard(group, [CURRENT_USER], [])
    expect(card.type).toBe('image/png')
    let drawnText = context.fillText.mock.calls.map(call => call[0])
    expect(drawnText).toContain('1 person sharing expenses')
    expect(drawnText).toContain('Everyone is settled')
    expect(drawnText).toContain('No activity yet.')
    expect(drawnText).toContain('Shared from Tally · https://pengfanz.github.io/splitbill/')
    await createSummaryCard(group, [CURRENT_USER, maya, jordan], [expense()])

    vi.restoreAllMocks()
    const populatedContext = mockCanvas()
    const manyExpenses = [
      expense(),
      expense({ id: 'e2', title: 'Taxi', payerId: 'missing', splitMethod: 'exact', shares: {} }),
      expense({ id: 'payment', kind: 'settlement', title: 'Settlement payment', amount: 5, payerId: 'maya', splitMethod: 'exact', shares: { me: 5 } }),
      ...Array.from({ length: 5 }, (_, index) => expense({ id: `extra-${index}`, title: `Extra ${index}`, payerId: 'missing', shares: {} })),
    ]
    await createSummaryCard(group, [CURRENT_USER, maya, jordan], manyExpenses)
    drawnText = populatedContext.fillText.mock.calls.map(call => call[0])
    expect(drawnText).toContain('3 people sharing expenses')
    expect(drawnText).toContain('Maya Chen pays You')
    expect(drawnText).toContain('Unknown paid · Exact split')
    expect(drawnText).toContain('Maya Chen paid You')
    expect(drawnText).toContain('Settlement payment')
    expect(drawnText).toEqual(expect.arrayContaining(['Extra 0', 'Extra 1', 'Extra 2', 'Extra 3', 'Extra 4']))
    expect(populatedContext.fillRect.mock.calls.filter(([, , , height]) => height <= 2)).toHaveLength(0)
    expect(populatedContext.roundRect).toHaveBeenCalled()
    expect(calculateSummaryCardLayout(manyExpenses.length, 2, false).height).toBeGreaterThan(1350)

    await createSummaryCard(group, [CURRENT_USER], [
      expense({ id: 'missing-payer', kind: 'settlement', title: 'Settlement payment', amount: 5, payerId: 'missing', splitMethod: 'exact', shares: {} }),
      expense({ id: 'missing-recipient', kind: 'settlement', title: 'Settlement payment', amount: 5, payerId: 'missing', splitMethod: 'exact', shares: { missing: 5 } }),
    ])
    drawnText = populatedContext.fillText.mock.calls.map(call => call[0])
    expect(drawnText.filter(text => text === 'Unknown paid Unknown')).toHaveLength(2)
  })

  it('adds a scannable Live QR panel only when a Live URL is provided', async () => {
    const context = mockCanvas()
    const createObjectURL = vi.fn().mockReturnValue('blob:live-qr')
    const revokeObjectURL = vi.fn()
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL })
    const OriginalImage = globalThis.Image
    class LoadedImage {
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      set src(_value: string) {
        queueMicrotask(() => this.onload?.())
      }
    }
    Object.defineProperty(globalThis, 'Image', { configurable: true, value: LoadedImage })

    try {
      const liveUrl = `https://example.com/splitbill/#live=A1B2C3D4E5.${'a'.repeat(64)}`
      await createSummaryCard(group, [CURRENT_USER, maya, jordan], [expense()], { liveUrl })
      const drawnText = context.fillText.mock.calls.map(call => call[0])
      expect(context.drawImage).toHaveBeenCalledOnce()
      expect(drawnText).toContain('Scan to open the latest activity')
      expect(drawnText).toContain('Anyone with this QR code can edit.')
      expect(calculateSummaryCardLayout(1, 1, true).liveQrPanelY).not.toBeNull()
      expect(calculateSummaryCardLayout(1, 1, false).liveQrPanelY).toBeNull()
      expect(createObjectURL).toHaveBeenCalledWith(expect.objectContaining({ type: 'image/svg+xml' }))
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:live-qr')
    } finally {
      Object.defineProperty(globalThis, 'Image', { configurable: true, value: OriginalImage })
    }
  })

  it('rejects invalid or unloadable Live QR images without leaking object URLs', async () => {
    const liveUrl = `https://example.com/splitbill/#live=A1B2C3D4E5.${'a'.repeat(64)}`
    const querySelector = vi.spyOn(HTMLDivElement.prototype, 'querySelector').mockReturnValueOnce(null)
    await expect(renderLiveQrSvg(liveUrl)).rejects.toThrow('QR code rendering failed')
    querySelector.mockRestore()

    mockCanvas()
    const createObjectURL = vi.fn().mockReturnValue('blob:broken-live-qr')
    const revokeObjectURL = vi.fn()
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL })
    const OriginalImage = globalThis.Image
    class BrokenImage {
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      set src(_value: string) {
        queueMicrotask(() => this.onerror?.())
      }
    }
    Object.defineProperty(globalThis, 'Image', { configurable: true, value: BrokenImage })

    try {
      await expect(createSummaryCard(group, [CURRENT_USER, maya, jordan], [expense()], { liveUrl }))
        .rejects.toThrow('QR code rendering failed')
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:broken-live-qr')
    } finally {
      Object.defineProperty(globalThis, 'Image', { configurable: true, value: OriginalImage })
    }
  })

  it('reports unavailable canvas and failed PNG encoding', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    await expect(createSummaryCard(group, [CURRENT_USER], [])).rejects.toThrow('Canvas is unavailable')
    vi.restoreAllMocks()
    mockCanvas(null)
    await expect(createSummaryCard(group, [CURRENT_USER], [])).rejects.toThrow('PNG generation failed')
  })

  it('shares a PNG natively and respects cancellation', async () => {
    const image = new Blob(['png'], { type: 'image/png' })
    const nativeShare = vi.fn().mockResolvedValue(undefined)
    const canShare = vi.fn().mockReturnValue(true)
    const onNativeShareStart = vi.fn()
    Object.defineProperty(navigator, 'share', { configurable: true, value: nativeShare })
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: canShare })
    expect(await shareActivitySummary('Trip — Tally', 'Summary', image, onNativeShareStart)).toBe('shared')
    const expectedFile = expect.objectContaining({ name: 'trip-tally.png', type: 'image/png' })
    expect(canShare).toHaveBeenCalledWith({ files: [expectedFile] })
    expect(nativeShare).toHaveBeenCalledWith({ files: [expectedFile] })
    expect(nativeShare.mock.calls[0][0]).not.toHaveProperty('text')
    expect(nativeShare.mock.calls[0][0]).not.toHaveProperty('url')
    expect(nativeShare.mock.calls[0][0]).not.toHaveProperty('title')
    expect(onNativeShareStart).toHaveBeenCalledOnce()

    nativeShare.mockRejectedValueOnce(new DOMException('cancelled', 'AbortError'))
    expect(await shareActivitySummary('Trip — Tally', 'Summary', image)).toBe('cancelled')
  })

  it('downloads PNG cards when file sharing is unsupported or fails', async () => {
    const image = new Blob(['png'], { type: 'image/png' })
    const anchor = document.createElement('a')
    const click = vi.spyOn(anchor, 'click').mockImplementation(() => {})
    vi.spyOn(document, 'createElement').mockReturnValue(anchor)
    const createObjectURL = vi.fn().mockReturnValue('blob:summary')
    const revokeObjectURL = vi.fn()
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL })

    expect(await shareActivitySummary('Trip — Tally', 'Summary', image)).toBe('downloaded')
    expect(anchor.download).toBe('trip-tally.png')
    Object.defineProperty(navigator, 'share', { configurable: true, value: vi.fn() })
    expect(await shareActivitySummary('!!!', 'Summary', image)).toBe('downloaded')
    expect(anchor.download).toBe('tally-summary.png')
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: vi.fn().mockReturnValue(false) })
    expect(await shareActivitySummary('Trip', 'Summary', image)).toBe('downloaded')

    Object.defineProperty(navigator, 'canShare', { configurable: true, value: vi.fn(() => { throw new Error('unsupported payload') }) })
    expect(await shareActivitySummary('Trip', 'Summary', image)).toBe('downloaded')

    const failingShare = vi.fn().mockRejectedValue(new Error('unavailable'))
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: vi.fn().mockReturnValue(true) })
    Object.defineProperty(navigator, 'share', { configurable: true, value: failingShare })
    expect(await shareActivitySummary('Trip', 'Summary', image)).toBe('downloaded')
    expect(click).toHaveBeenCalledTimes(5)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:summary')
  })

  it('uses native text and clipboard fallbacks when PNG generation is unavailable', async () => {
    const nativeShare = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'share', { configurable: true, value: nativeShare })
    expect(await shareActivitySummary('Trip', 'Summary', null)).toBe('shared')
    expect(nativeShare).toHaveBeenCalledWith({ title: 'Trip', text: 'Summary' })
    nativeShare.mockRejectedValueOnce(new DOMException('cancelled', 'AbortError'))
    expect(await shareActivitySummary('Trip', 'Summary', null)).toBe('cancelled')

    nativeShare.mockRejectedValueOnce(new Error('unavailable'))
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    expect(await shareActivitySummary('Trip', 'Summary', null)).toBe('copied')
    expect(writeText).toHaveBeenCalledWith('Summary')
    Object.defineProperty(navigator, 'share', { configurable: true, value: undefined })
    writeText.mockRejectedValueOnce(new Error('blocked'))
    expect(await shareActivitySummary('Trip', 'Summary', null)).toBe('failed')
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined })
    expect(await shareActivitySummary('Trip', 'Summary', null)).toBe('failed')
  })

  it('never substitutes text or a URL when PNG delivery fails', async () => {
    const image = new Blob(['png'], { type: 'image/png' })
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => { throw new Error('blocked') }) })
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    expect(await shareActivitySummary('Trip', 'Summary', image)).toBe('failed')
    expect(writeText).not.toHaveBeenCalled()
    expect(SHARE_MESSAGES.failed).toContain('Could not export')
  })

  it('exports a generated PNG and reports a rendering failure without sharing text', async () => {
    mockCanvas()
    const anchor = document.createElement('a')
    vi.spyOn(anchor, 'click').mockImplementation(() => {})
    const originalCreateElement = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation(tag => tag === 'a' ? anchor : originalCreateElement(tag))
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn().mockReturnValue('blob:summary') })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
    expect(await exportActivitySummary(group, [CURRENT_USER], [])).toBe('downloaded')

    vi.restoreAllMocks()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    expect(await exportActivitySummary(group, [CURRENT_USER], [])).toBe('failed')
    expect(await exportActivitySummary(group, [CURRENT_USER], [], { liveUrl: 'https://example.com/#live=code.token' })).toBe('failed')
    expect(writeText).not.toHaveBeenCalled()
  })

  it('still exports a PNG without the Live QR if QR rendering fails', async () => {
    mockCanvas()
    const anchor = document.createElement('a')
    const click = vi.spyOn(anchor, 'click').mockImplementation(() => {})
    const originalCreateElement = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation(tag => tag === 'a' ? anchor : originalCreateElement(tag))
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn().mockReturnValue('blob:summary') })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
    const OriginalImage = globalThis.Image
    class BrokenImage {
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      set src(_value: string) {
        queueMicrotask(() => this.onerror?.())
      }
    }
    Object.defineProperty(globalThis, 'Image', { configurable: true, value: BrokenImage })

    try {
      expect(await exportActivitySummary(group, [CURRENT_USER], [], { liveUrl: 'https://example.com/#live=code.token' })).toBe('downloaded')
      expect(click).toHaveBeenCalledOnce()
    } finally {
      Object.defineProperty(globalThis, 'Image', { configurable: true, value: OriginalImage })
    }
  })
})

describe('small UI building blocks', () => {
  it('renders avatars at default and explicit sizes', () => {
    const { rerender } = render(<Avatar member={maya} />)
    expect(screen.getByText('MC')).toHaveClass('avatar--md')
    rerender(<Avatar member={maya} size="lg" />)
    expect(screen.getByText('MC')).toHaveClass('avatar--lg')
  })

  it('supports activity selection, creation, reset, and mobile sidebar controls', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    const onCreate = vi.fn()
    const onJoin = vi.fn()
    const onShowChangelog = vi.fn()
    const onSendFeedback = vi.fn()
    const onDelete = vi.fn()
    const onReset = vi.fn()
    const { rerender } = render(<Sidebar groups={[]} selectedId={null} onSelect={onSelect} onCreate={onCreate} onJoin={onJoin} onShowChangelog={onShowChangelog} onSendFeedback={onSendFeedback} onDelete={onDelete} onReset={onReset} hasUnreadChangelog />)
    expect(screen.getByText('No activities yet.')).toBeVisible()
    expect(screen.getByLabelText('New updates')).toBeVisible()
    expect(screen.getByRole('link', { name: 'GitHub source' })).toHaveAttribute('href', 'https://github.com/PengfanZ/splitbill')
    expect(screen.getByRole('link', { name: 'GitHub source' })).toHaveAttribute('target', '_blank')
    expect(screen.getByRole('link', { name: 'GitHub source' })).toHaveAttribute('rel', 'noreferrer')
    expect(screen.queryByRole('button', { name: 'Overview' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Open navigation' }))
    await user.click(screen.getAllByRole('button', { name: 'Close navigation' })[0])
    await user.click(screen.getByRole('button', { name: 'New activity' }))
    expect(onCreate).toHaveBeenCalledOnce()
    await user.click(screen.getByRole('button', { name: 'Join activity' }))
    expect(onJoin).toHaveBeenCalledOnce()
    await user.click(screen.getByRole('button', { name: /What’s new/ }))
    expect(onShowChangelog).toHaveBeenCalledOnce()
    await user.click(screen.getByRole('button', { name: 'Send feedback' }))
    expect(onSendFeedback).toHaveBeenCalledOnce()

    const home: ActivityGroup = { id: 'home', name: 'Home', emoji: '⌂', memberIds: ['me'] }
    rerender(<Sidebar groups={[home, group]} selectedId="home" onSelect={onSelect} onCreate={onCreate} onJoin={onJoin} onShowChangelog={onShowChangelog} onSendFeedback={onSendFeedback} onDelete={onDelete} onReset={onReset} />)
    expect(screen.getByText('1 person')).toBeVisible()
    expect(screen.getByText('3 people')).toBeVisible()
    rerender(<Sidebar groups={[home, group]} selectedId={null} liveActivityCodes={{ trip: 'A1B2C3D4E5' }} onSelect={onSelect} onCreate={onCreate} onJoin={onJoin} onShowChangelog={onShowChangelog} onSendFeedback={onSendFeedback} onDelete={onDelete} onReset={onReset} />)
    expect(screen.getByText('Live · A1B2C3D4E5')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Open Trip activity' }))
    expect(onSelect).toHaveBeenCalledWith('trip')
    await user.click(screen.getByRole('button', { name: 'Delete Trip activity' }))
    expect(onDelete).toHaveBeenCalledWith(group)
    await user.click(screen.getByRole('button', { name: 'Reset local data' }))
    expect(onReset).toHaveBeenCalledOnce()
    await user.click(screen.getByRole('button', { name: 'Open navigation' }))
    await user.click(screen.getAllByRole('button', { name: 'Close navigation' })[1])
  })

  it('updates and clears the topbar search', async () => {
    const user = userEvent.setup()
    const setQuery = vi.fn()
    const { rerender } = render(<Topbar query="" setQuery={setQuery} activityName="Trip" activityDetail="3 people" activityEmoji="✦" />)
    expect(screen.queryByRole('button', { name: 'Notifications' })).not.toBeInTheDocument()
    expect(screen.getByText('Trip')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Open expense search' }))
    await user.type(screen.getByRole('textbox', { name: 'Search expenses' }), 'din')
    expect(setQuery).toHaveBeenCalled()
    rerender(<Topbar query="din" setQuery={setQuery} />)
    await user.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(setQuery).toHaveBeenLastCalledWith('')
    rerender(<Topbar query="" setQuery={setQuery} activityName="Trip" />)
    expect(screen.getByText('Trip')).toBeVisible()
  })

  it('renders the fresh start and runs its action', async () => {
    const user = userEvent.setup()
    const onCreate = vi.fn()
    const onJoin = vi.fn()
    render(<FreshStart onCreate={onCreate} onJoin={onJoin} />)
    await user.click(screen.getByRole('button', { name: 'Create an activity' }))
    await user.click(screen.getByRole('button', { name: 'Join from a link' }))
    expect(onCreate).toHaveBeenCalledOnce()
    expect(onJoin).toHaveBeenCalledOnce()
  })

  it('renders positive, negative, and settled summaries', () => {
    const { rerender } = render(<ActivitySummary expenses={[expense()]} />)
    expect(screen.getByText('+$20.00')).toHaveClass('positive')
    rerender(<ActivitySummary expenses={[expense({ payerId: 'maya' })]} />)
    expect(screen.getByText('−$10.00')).toHaveClass('negative')
    rerender(<ActivitySummary expenses={[expense({ shares: {} })]} />)
    expect(screen.getByText('+$30.00')).toHaveClass('positive')
    rerender(<ActivitySummary expenses={[]} />)
    expect(screen.getAllByText('$0.00')[2]).toHaveClass('settled')
    rerender(<ActivitySummary expenses={[expense(), expense({ id: 'payment', kind: 'settlement', title: 'Settlement payment', amount: 5, payerId: 'maya', splitMethod: 'exact', shares: { me: 5 } })]} />)
    const summary = screen.getByLabelText('Activity summary')
    expect(within(summary).getAllByText('$30.00')).toHaveLength(2)
    expect(within(summary).getByText('+$15.00')).toHaveClass('positive')
    rerender(<ActivitySummary expenses={[expense()]} currentUserLabel="Alex" />)
    expect(screen.getByText('Alex is owed')).toBeVisible()
    rerender(<ActivitySummary expenses={[expense({ payerId: 'maya' })]} currentUserLabel="Alex" />)
    expect(screen.getByText('Alex owes')).toBeVisible()
    rerender(<ActivitySummary expenses={[]} currentUserLabel="Alex" />)
    expect(screen.getByText('Alex balance')).toBeVisible()
    rerender(<ActivitySummary expenses={[expense()]} currentMemberId="maya" currentUserLabel="Maya Chen" />)
    expect(screen.getByText('Maya Chen owes')).toBeVisible()
    expect(screen.getByText('−$10.00')).toHaveClass('negative')
    rerender(<ActivitySummary expenses={[expense()]} currentMemberId={null} />)
    expect(screen.getAllByText('Choose who you are')).toHaveLength(2)
    expect(screen.getAllByText('—')).toHaveLength(2)
  })

  it('calculates settlement directions for multiple debtors and the current user', () => {
    const members = [CURRENT_USER, maya, jordan]
    const { rerender } = render(<SettlementDirections members={members} expenses={[]} />)
    expect(screen.getByText('Everyone is settled')).toBeVisible()
    rerender(<SettlementDirections members={members} expenses={[expense({ amount: 30, shares: { me: 0, maya: 10, jordan: 20 } })]} />)
    expect(screen.getByText('Maya Chen owes You')).toBeVisible()
    expect(screen.getByText('Jordan owes You')).toBeVisible()
    rerender(<SettlementDirections members={members} expenses={[expense({ amount: 20, payerId: 'maya', shares: { me: 20, maya: 0, jordan: 0 } })]} />)
    expect(screen.getByText('You owe Maya Chen')).toBeVisible()
    rerender(<SettlementDirections members={members} expenses={[expense()]} currentMemberId="maya" currentUserLabel="Maya Chen" />)
    expect(screen.getByText('Maya Chen owes You')).toBeVisible()
    rerender(<SettlementDirections members={members} expenses={[
      expense({ id: 'a', amount: 10, payerId: 'me', shares: { jordan: 10 } }),
      expense({ id: 'b', amount: 20, payerId: 'maya', shares: { jordan: 20 } }),
    ]} />)
    expect(screen.getByText('Jordan owes You')).toBeVisible()
    expect(screen.getByText('Jordan owes Maya Chen')).toBeVisible()
  })

  it('forwards a suggested direction from its settle-up button', async () => {
    const user = userEvent.setup()
    const onSettleUp = vi.fn()
    render(<SettlementDirections members={[CURRENT_USER, maya]} expenses={[expense({ amount: 20, shares: { maya: 20 } })]} onSettleUp={onSettleUp} />)

    await user.click(screen.getByRole('button', { name: 'Settle up' }))
    expect(onSettleUp).toHaveBeenCalledWith({ from: maya, to: CURRENT_USER, amount: 20 })
  })

  it('filters expenses and handles known and fallback payers', async () => {
    const user = userEvent.setup()
    const onDelete = vi.fn()
    const onEdit = vi.fn()
    const unknownPayer = expense({ id: 'e2', title: 'Taxi', payerId: 'missing', splitMethod: 'exact' })
    const { rerender } = render(<ExpenseList expenses={[expense(), unknownPayer]} members={[CURRENT_USER, maya]} query="" onEditExpense={onEdit} onDeleteExpense={onDelete} />)
    expect(screen.getByText('2 entries')).toBeVisible()
    expect(screen.getByText((_, node) => node?.textContent === 'You paidSplit equally · 3 people')).toBeVisible()
    expect(screen.getByText((_, node) => node?.textContent === 'You paidExact split · 3 people')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Edit Dinner' }))
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ title: 'Dinner' }))
    await user.click(screen.getByRole('button', { name: 'Delete Dinner' }))
    expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({ title: 'Dinner' }))
    rerender(<ExpenseList expenses={[expense()]} members={[CURRENT_USER]} query="zzz" onEditExpense={onEdit} onDeleteExpense={onDelete} />)
    expect(screen.getByText('No expenses match your search.')).toBeVisible()
    rerender(<ExpenseList expenses={[expense({ shares: { me: 30 } })]} members={[CURRENT_USER]} query="" onEditExpense={onEdit} onDeleteExpense={onDelete} />)
    expect(screen.getByText((_, node) => node?.textContent === 'You paidSplit equally · 1 person')).toBeVisible()
    rerender(<ExpenseList expenses={[expense({ createdAt: 'Just now' })]} members={[CURRENT_USER]} query="" onEditExpense={onEdit} onDeleteExpense={onDelete} />)
    expect(screen.getByText('Time not recorded')).toBeVisible()
    rerender(<ExpenseList expenses={[expense({ createdAt: 'Today' })]} members={[CURRENT_USER]} query="" onEditExpense={onEdit} onDeleteExpense={onDelete} />)
    expect(screen.getByText('Today')).toBeVisible()
    rerender(<ExpenseList expenses={[]} members={[CURRENT_USER]} query="" onEditExpense={onEdit} onDeleteExpense={onDelete} />)
    expect(screen.getByText('No expenses yet. Add the first one when you’re ready.')).toBeVisible()

    const payment = expense({ id: 'payment', kind: 'settlement', title: 'Settlement payment', amount: 10, payerId: 'maya', splitMethod: 'exact', shares: { me: 10 } })
    rerender(<ExpenseList expenses={[payment]} members={[CURRENT_USER, maya]} query="maya" onEditExpense={onEdit} onDeleteExpense={onDelete} />)
    expect(screen.getByText('Maya Chen paid You')).toBeVisible()
    expect(screen.getByText('Settlement payment')).toBeVisible()
    expect(screen.queryByRole('button', { name: /Edit/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Delete Maya Chen payment to You' }))
    expect(onDelete).toHaveBeenCalledWith(payment)
    rerender(<ExpenseList expenses={[payment]} members={[CURRENT_USER, maya]} query="you" onEditExpense={onEdit} onDeleteExpense={onDelete} />)
    expect(screen.getByText('Maya Chen paid You')).toBeVisible()

    const missingRecipient = expense({ ...payment, id: 'missing-recipient', payerId: 'missing', shares: { missing: 10 } })
    rerender(<ExpenseList expenses={[missingRecipient]} members={[CURRENT_USER, maya]} query="unknown" onEditExpense={onEdit} onDeleteExpense={onDelete} />)
    expect(screen.getByText('No expenses match your search.')).toBeVisible()
    const malformedPayment = expense({ ...payment, id: 'malformed', payerId: 'missing', shares: {} })
    rerender(<ExpenseList expenses={[malformedPayment]} members={[CURRENT_USER, maya]} query="" onEditExpense={onEdit} onDeleteExpense={onDelete} />)
    expect(screen.getByText('You paid Unknown')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Delete You payment to Unknown' }))
    expect(onDelete).toHaveBeenCalledWith(malformedPayment)
  })

  it('renders members and forwards rail and dashboard actions', async () => {
    const user = userEvent.setup()
    const addFriend = vi.fn()
    const addExpense = vi.fn()
    const share = vi.fn()
    const shareQr = vi.fn()
    const shareLive = vi.fn()
    const editExpense = vi.fn()
    const deleteExpense = vi.fn()
    const settleUp = vi.fn()
    const { rerender } = render(<MembersRail members={[CURRENT_USER, maya]} onAddFriend={addFriend} />)
    expect(screen.queryByText('Friend')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Current local identity')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Add friend' }))
    expect(addFriend).toHaveBeenCalledOnce()

    rerender(<MembersRail members={[CURRENT_USER, maya]} currentMemberId="maya" onAddFriend={addFriend} />)
    expect(screen.getByLabelText('Current local identity').closest('.member-row')).toHaveTextContent('Maya Chen')

    rerender(<GroupDashboard group={group} members={[CURRENT_USER, maya, jordan]} expenses={[expense()]} query="" activityFeedback="Summary copied." statusLabel="Local" onShareSummary={share} onShareLive={shareLive} onAddFriend={addFriend} onAddExpense={addExpense} onSettleUp={settleUp} onEditExpense={editExpense} onDeleteExpense={deleteExpense} />)
    expect(screen.getByRole('status')).toHaveTextContent('Summary copied.')
    expect(screen.getByText('Local')).toBeVisible()
    await chooseShareAction(user, 'Start live activity')
    await chooseShareAction(user, 'Export full summary')
    await user.click(screen.getByRole('button', { name: 'Add friend' }))
    await user.click(screen.getByRole('button', { name: 'Add expense' }))
    await user.click(screen.getAllByRole('button', { name: 'Settle up' })[0])
    await user.click(screen.getByRole('button', { name: 'Edit Dinner' }))
    expect(addFriend).toHaveBeenCalledTimes(2)
    expect(addExpense).toHaveBeenCalledOnce()
    expect(share).toHaveBeenCalledOnce()
    expect(shareLive).toHaveBeenCalledOnce()
    expect(editExpense).toHaveBeenCalledWith(expect.objectContaining({ title: 'Dinner' }))
    expect(settleUp).toHaveBeenCalledWith(expect.objectContaining({ amount: 10 }))

    rerender(<GroupDashboard group={group} members={[CURRENT_USER, maya, jordan]} expenses={[expense()]} query="" activityFeedback={null} statusLabel="Live · revision 2" onShareQr={shareQr} onCopyShareLink={vi.fn()} />)
    expect(screen.getByText('Live · revision 2')).toBeVisible()
    await chooseShareAction(user, 'Show live QR')
    expect(shareQr).toHaveBeenCalledOnce()

    rerender(<GroupDashboard group={group} members={[CURRENT_USER, maya]} expenses={[]} query="" activityFeedback={null} onAddExpense={addExpense} />)
    expect(screen.getByText('No expenses yet')).toBeVisible()
    expect(screen.queryByLabelText('Activity summary')).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Add expense' })).toHaveLength(1)
    expect(screen.queryByRole('button', { name: 'Share' })).not.toBeInTheDocument()
    expect(screen.queryByText('Live · revision 2')).not.toBeInTheDocument()

    rerender(<GroupDashboard group={group} members={[CURRENT_USER, maya]} expenses={[]} query="" activityFeedback={null} readOnly onAddExpense={addExpense} />)
    expect(screen.queryByRole('button', { name: 'Add expense' })).not.toBeInTheDocument()

    rerender(<GroupDashboard group={group} members={[CURRENT_USER, maya]} expenses={[expense()]} query="" activityFeedback={null} readOnly />)
    expect(screen.getByText('Read only')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Share' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add friend' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit Dinner' })).not.toBeInTheDocument()
  })
})

describe('modals', () => {
  it('closes from its button and backdrop but not its panel', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const { container } = render(<ModalShell eyebrow="Test" title="Dialog" onClose={onClose}><button>Inside</button></ModalShell>)
    expect(container.querySelector('.modal-backdrop')).toHaveClass('modal-backdrop--sheet')
    fireEvent.mouseDown(screen.getByRole('dialog'))
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.mouseDown(container.querySelector('.modal-backdrop')!)
    expect(onClose).toHaveBeenCalledOnce()
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('validates and submits activity creation', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const onSave = vi.fn()
    const { container } = render(<CreateGroupModal onClose={onClose} onSave={onSave} />)
    expect(container.querySelector('.modal-backdrop')).toHaveClass('modal-backdrop--center')
    fireEvent.submit(container.querySelector('form')!)
    expect(onSave).not.toHaveBeenCalled()
    await user.type(screen.getByLabelText('Activity name'), '  Beach trip  ')
    await user.type(screen.getByLabelText(/Add friends/), ' Maya， Jordan ')
    await user.click(screen.getByRole('button', { name: 'Create activity' }))
    expect(onSave).toHaveBeenCalledWith('Beach trip', ['Maya', 'Jordan'], 'USD')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('localizes activity currency options in Chinese without changing saved codes', async () => {
    const user = userEvent.setup()
    const onCurrencySelect = vi.fn()
    const onSave = vi.fn()
    render(
      <LocalizationProvider initialLocale="zh-CN">
        <CreateGroupModal onClose={vi.fn()} onCurrencySelect={onCurrencySelect} onSave={onSave} />
      </LocalizationProvider>,
    )

    const currency = screen.getByRole('button', { name: /活动币种/ })
    expect(currency).toHaveValue('CNY')
    await user.click(currency)
    expect(screen.getByRole('option', { name: '人民币' })).toBeVisible()
    expect(screen.getByRole('option', { name: '美元' })).toBeVisible()
    expect(screen.queryByRole('option', { name: 'CNY' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('option', { name: '人民币' }))
    expect(onCurrencySelect).not.toHaveBeenCalled()
    await user.click(currency)
    await user.click(screen.getByRole('option', { name: '美元' }))
    expect(onCurrencySelect).toHaveBeenCalledWith('USD')
    await user.type(screen.getByLabelText('活动名称'), '纽约旅行')
    await user.click(screen.getByRole('button', { name: '创建活动' }))
    expect(onSave).toHaveBeenCalledWith('纽约旅行', [], 'USD')
  })

  it('validates and submits friend names', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const onSave = vi.fn()
    const { container, rerender } = render(<AddFriendModal existingExpenseCount={0} onClose={onClose} onSave={onSave} />)
    expect(container.querySelector('.modal-backdrop')).toHaveClass('modal-backdrop--center')
    expect(screen.queryByText('Future expenses only')).not.toBeInTheDocument()
    fireEvent.submit(container.querySelector('form')!)
    expect(onSave).not.toHaveBeenCalled()
    await user.type(screen.getByLabelText(/Friend names/), ' Sam，Taylor ')
    await user.click(screen.getByRole('button', { name: 'Add friends' }))
    expect(onSave).toHaveBeenCalledWith(['Sam', 'Taylor'])
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalledOnce()

    rerender(<AddFriendModal existingExpenseCount={2} onClose={onClose} onSave={onSave} />)
    expect(screen.getByText('Future expenses only')).toBeVisible()
    expect(screen.getByText('2 existing expenses will stay unchanged.')).toBeVisible()
  })

  it('creates equal splits for selected people down to the cent and supports any payer', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    const onClose = vi.fn()
    const { container } = render(<ExpenseModal group={group} members={[CURRENT_USER, maya, jordan]} onClose={onClose} onSave={onSave} />)
    expect(container.querySelector('.modal-backdrop')).toHaveClass('modal-backdrop--sheet')
    fireEvent.submit(container.querySelector('form')!)
    expect(onSave).not.toHaveBeenCalled()
    await user.type(screen.getByLabelText('Description'), 'Lunch')
    await user.type(screen.getByLabelText('Amount'), '10')
    await chooseSelectOption(user, 'Paid by', 'Maya Chen')
    expect(screen.getByText('3 of 3 selected')).toBeVisible()
    expect(screen.getByText('$3.33')).toBeVisible()
    await user.click(screen.getByLabelText('Include Jordan in equal split'))
    expect(screen.getByText('2 of 3 selected')).toBeVisible()
    expect(screen.getByText('$5.00')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Save expense' }))
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Lunch',
      amount: 10,
      payerId: 'maya',
      shares: { me: 5, maya: 5 },
      createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    }))
    expect(onSave.mock.calls[0][0].updatedAt).toBeUndefined()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('records full or partial settlements and rejects invalid payment amounts', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    const onClose = vi.fn()
    const settlement = { from: maya, to: CURRENT_USER, amount: 10 }
    const { container } = render(<SettleUpModal group={group} settlement={settlement} onClose={onClose} onSave={onSave} />)
    expect(container.querySelector('.modal-backdrop')).toHaveClass('modal-backdrop--center')

    expect(screen.getByLabelText('Maya Chen pays You')).toBeVisible()
    expect(screen.getByLabelText('Payment amount')).toHaveValue(10)
    await user.clear(screen.getByLabelText('Payment amount'))
    await user.type(screen.getByLabelText('Payment amount'), '10.01')
    expect(screen.getByRole('alert')).toHaveTextContent('between $0.01 and $10.00')
    expect(screen.getByRole('button', { name: 'Record payment' })).toBeDisabled()
    fireEvent.submit(container.querySelector('form')!)
    expect(onSave).not.toHaveBeenCalled()

    await user.clear(screen.getByLabelText('Payment amount'))
    await user.type(screen.getByLabelText('Payment amount'), '4.25')
    await user.click(screen.getByRole('button', { name: 'Record payment' }))
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'settlement',
      groupId: group.id,
      amount: 4.25,
      payerId: maya.id,
      shares: { me: 4.25 },
    }), settlement)
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('validates exact splits for left, over, and balanced totals', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(<ExpenseModal group={group} members={[CURRENT_USER, maya]} onClose={vi.fn()} onSave={onSave} />)
    await user.type(screen.getByLabelText('Description'), 'Hotel')
    await user.type(screen.getByLabelText('Amount'), '20')
    await chooseSelectOption(user, 'Split method', 'Exact amounts')
    expect(screen.getByLabelText('You share').closest('.share-input')).toBeTruthy()
    expect(screen.getByLabelText('Maya Chen share').closest('.share-input')).toBeTruthy()
    expect(screen.getByText('$20.00 left')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Save expense' })).toBeDisabled()
    await user.type(screen.getByLabelText('You share'), '25')
    expect(screen.getByText('$5.00 over')).toBeVisible()
    await user.clear(screen.getByLabelText('You share'))
    await user.type(screen.getByLabelText('You share'), '20')
    await user.click(screen.getByRole('button', { name: 'Save expense' }))
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ splitMethod: 'exact', shares: { me: 20, maya: 0 } }))
  })

  it('prefills and updates an existing exact expense with every current member', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    const existing = expense({
      id: 'hotel',
      title: 'Hotel',
      amount: 30,
      payerId: 'maya',
      splitMethod: 'exact',
      shares: { me: 10, maya: 20 },
      createdAt: 'Friday',
    })
    render(<ExpenseModal group={group} members={[CURRENT_USER, maya, jordan]} expense={existing} onClose={vi.fn()} onSave={onSave} />)

    expect(screen.getByRole('heading', { name: 'Edit expense' })).toBeVisible()
    expect(screen.getByLabelText('Description')).toHaveValue('Hotel')
    expect(screen.getByLabelText('Amount')).toHaveValue(30)
    expect(screen.getByRole('button', { name: 'Paid by' })).toHaveValue('maya')
    expect(screen.getByRole('button', { name: 'Split method' })).toHaveValue('exact')
    expect(screen.getByLabelText('You share')).toHaveValue(10)
    expect(screen.getByLabelText('Maya Chen share')).toHaveValue(20)
    expect(screen.getByLabelText('Jordan share')).toHaveValue(null)
    expect(screen.getByText('Saving replaces this expense’s split using all 3 current activity members.')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(onSave).toHaveBeenCalledWith({
      ...existing,
      shares: { me: 10, maya: 20, jordan: 0 },
      updatedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    })
  })

  it('requires at least one person for an equal split', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(<ExpenseModal group={group} members={[]} onClose={vi.fn()} onSave={onSave} />)
    expect(screen.getByText('$0.00')).toBeVisible()
    expect(screen.getByRole('alert')).toHaveTextContent('Select at least one person')
    expect(screen.getByRole('button', { name: 'Save expense' })).toBeDisabled()
    await user.type(screen.getByLabelText('Description'), 'Fee')
    await user.type(screen.getByLabelText('Amount'), '1')
    fireEvent.submit(screen.getByLabelText('Description').closest('form')!)
    expect(onSave).not.toHaveBeenCalled()
  })

  it('lets a Live participant choose their identity for a local copy', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const onSave = vi.fn()
    const { container: sharedIdentityContainer, rerender, unmount } = render(<LiveActivityIdentityModal members={[CURRENT_USER, maya]} mode="live-copy" onClose={onClose} onSave={onSave} />)

    expect(sharedIdentityContainer.querySelector('.modal-backdrop')).toHaveClass('modal-backdrop--center')
    expect(screen.getByRole('button', { name: 'Your participant' })).toHaveValue('me')
    await chooseSelectOption(user, 'Your participant', 'Maya Chen')
    await user.click(screen.getByRole('button', { name: 'Create editable copy' }))
    expect(onSave).toHaveBeenCalledWith(maya.id)
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalledOnce()

    rerender(<LiveActivityIdentityModal members={[CURRENT_USER, maya]} mode="live-recovery" onClose={onClose} onSave={onSave} />)
    expect(screen.getByText(/Live session has ended/)).toBeVisible()
    expect(screen.getByRole('button', { name: 'Save editable activity' })).toBeEnabled()

    unmount()
    const { container } = render(<LiveActivityIdentityModal members={[]} mode="live-copy" onClose={onClose} onSave={onSave} />)
    expect(screen.getByRole('button', { name: 'Create editable copy' })).toBeDisabled()
    fireEvent.submit(container.querySelector('form')!)
    expect(onSave).toHaveBeenCalledOnce()
  })
})

describe('complete app workflows', () => {
  it('localizes feedback for adding several friends with and without earlier expenses', async () => {
    const user = userEvent.setup()
    localStorage.setItem(STORAGE_KEY, JSON.stringify(storedState()))
    const { unmount } = render(<App />)

    await user.click(screen.getAllByRole('button', { name: 'Add friend' })[0])
    await user.type(screen.getByLabelText(/Friend names/), 'Sam, Taylor')
    await user.click(screen.getByRole('button', { name: 'Add friends' }))
    expect(screen.getByRole('status')).toHaveTextContent('Sam and Taylor were added to the activity.')

    unmount()
    localStorage.setItem(STORAGE_KEY, JSON.stringify(storedState({
      expenses: [expense(), expense({ id: 'expense-2', title: 'Taxi' })],
    })))
    render(<App />)
    await user.click(screen.getAllByRole('button', { name: 'Add friend' })[0])
    await user.type(screen.getByLabelText(/Friend names/), 'Sam, Taylor')
    await user.click(screen.getByRole('button', { name: 'Add friends' }))
    expect(screen.getByRole('status')).toHaveTextContent('Sam and Taylor were added for future expenses. 2 earlier expenses were left unchanged.')
  })

  it('switches the complete app to Simplified Chinese and persists the preference', async () => {
    const user = userEvent.setup()
    localStorage.setItem(STORAGE_KEY, JSON.stringify(storedState({
      expenses: [expense({ createdAt: '2026-07-16T12:30:00.000Z' })],
    })))
    const { unmount } = render(<App />)

    await user.click(screen.getByRole('button', { name: 'Settings' }))
    expect(screen.getByText(/Times are shown in/)).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Language, English' }))
    await user.click(screen.getByRole('option', { name: '简体中文' }))

    expect(document.documentElement.lang).toBe('zh-CN')
    expect(document.title).toBe('Tally — 多人分账工具')
    expect(screen.getByRole('heading', { name: '设置' })).toBeVisible()
    expect(screen.getByRole('button', { name: '保存设置' })).toBeVisible()
    expect(screen.getByText(/^创建于 /)).toBeVisible()
    expect(localStorage.getItem('tally:locale:v1')).toBe('zh-CN')

    await user.click(screen.getByRole('button', { name: '保存设置' }))
    unmount()
    render(<App />)
    expect(screen.getByRole('button', { name: '设置' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: '设置' }))
    await user.click(screen.getByRole('button', { name: '语言：简体中文' }))
    await user.click(screen.getByRole('option', { name: 'English' }))
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeVisible()
  })

  it('tracks successful local activity, expense, and settlement outcomes without payload data', async () => {
    const user = userEvent.setup()
    const analyticsClient = { track: vi.fn() } satisfies AnalyticsClient
    render(<StrictMode><App analyticsClient={analyticsClient} /></StrictMode>)

    await waitFor(() => expect(analyticsClient.track).toHaveBeenCalledWith('app_opened', 'local', 'en'))
    await user.click(screen.getByRole('button', { name: 'Create an activity' }))
    await user.type(screen.getByLabelText('Activity name'), 'Analytics trip')
    await user.type(screen.getByLabelText(/Add friends/), 'Maya')
    await user.click(screen.getByRole('button', { name: 'Create activity' }))
    await user.click(screen.getAllByRole('button', { name: 'Add friend' })[0])
    await user.type(screen.getByLabelText(/Friend names/), 'Jordan')
    await user.click(screen.getByRole('button', { name: 'Add friends' }))
    await user.click(screen.getByRole('button', { name: 'Add expense' }))
    await user.type(screen.getByLabelText('Description'), 'Dinner')
    await user.type(screen.getByLabelText('Amount'), '20')
    await user.click(screen.getByRole('button', { name: 'Save expense' }))

    const direction = screen.getByText('Maya owes You').closest('.balance-row') as HTMLElement
    await user.click(within(direction).getByRole('button', { name: 'Settle up' }))
    await user.click(screen.getByRole('button', { name: 'Record payment' }))

    expect(analyticsClient.track.mock.calls).toEqual([
      ['app_opened', 'local', 'en'],
      ['activity_created', 'local', 'en'],
      ['friend_added', 'local', 'en'],
      ['friend_added', 'local', 'en'],
      ['expense_added', 'local', 'en'],
      ['settlement_recorded', 'local', 'en'],
    ])
  })

  it('adds a reviewed AI expense batch to local state in one user action', async () => {
    const user = userEvent.setup()
    const analyticsClient = { track: vi.fn() } satisfies AnalyticsClient
    const parseBatch = vi.fn().mockResolvedValue({
      status: 'ready_batch',
      drafts: [
        {
          status: 'ready',
          title: 'Lunch',
          amountCents: 2400,
          payerId: 'me',
          splitMethod: 'equal',
          participantIds: ['me', 'maya'],
          exactSharesCents: [],
        },
        {
          status: 'ready',
          title: 'Groceries',
          amountCents: 4600,
          payerId: 'maya',
          splitMethod: 'equal',
          participantIds: ['me', 'maya', 'jordan'],
          exactSharesCents: [],
        },
      ],
    })
    localStorage.setItem(STORAGE_KEY, JSON.stringify(storedState()))
    render(<App analyticsClient={analyticsClient} aiExpenseClient={{ parseBatch }} />)

    await user.click(screen.getByRole('button', { name: 'Add expense' }))
    await user.click(screen.getByRole('tab', { name: 'Describe with AI' }))
    await user.type(
      screen.getByLabelText('Expense description'),
      'I paid $24 for lunch and Maya paid $46 for groceries. Split both between everyone.',
    )
    await user.click(screen.getByRole('button', { name: 'Create draft' }))
    await user.click(await screen.findByRole('button', { name: 'Save 2 expenses' }))

    expect(await screen.findByText('Lunch', { exact: true })).toBeVisible()
    expect(screen.getByText('Groceries', { exact: true })).toBeVisible()
    expect(screen.getByRole('status')).toHaveTextContent('2 expenses were added.')
    await waitFor(() => expect(parseState(localStorage.getItem(STORAGE_KEY)).expenses)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ title: 'Lunch' }),
        expect.objectContaining({ title: 'Groceries' }),
      ])))
    expect(analyticsClient.track.mock.calls.filter(([event]) => event === 'expense_added'))
      .toEqual([
        ['expense_added', 'local', 'en'],
      ])
    expect(analyticsClient.track).toHaveBeenCalledWith('expense_input_ai_text_selected', 'local', 'en')
    expect(analyticsClient.track.mock.calls.filter(([event]) => event.startsWith('ai_')))
      .toEqual([
        ['ai_text_requested', 'local', 'en'],
        ['ai_text_ready', 'local', 'en'],
      ])
  })

  it('shows the latest update once to returning users and keeps it available from the sidebar', async () => {
    const user = userEvent.setup()
    localStorage.removeItem(CHANGELOG_SEEN_STORAGE_KEY)
    render(<App />)

    const update = await screen.findByRole('dialog', { name: 'What’s new in Tally' })
    expect(update).toHaveTextContent('Split a receipt by dish')
    expect(screen.getByLabelText('New updates')).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Got it' }))
    expect(screen.queryByRole('dialog', { name: 'What’s new in Tally' })).not.toBeInTheDocument()
    expect(localStorage.getItem(CHANGELOG_SEEN_STORAGE_KEY)).toBe(LATEST_CHANGELOG_ID)
    expect(screen.queryByLabelText('New updates')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'What’s new' }))
    expect(await screen.findByRole('dialog', { name: 'What’s new in Tally' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Close' }))
  })

  it('creates and updates a persistent local identity', async () => {
    const user = userEvent.setup()
    localStorage.removeItem(IDENTITY_KEY)
    localStorage.removeItem(CHANGELOG_SEEN_STORAGE_KEY)
    render(<App />)

    const onboarding = screen.getByRole('dialog', { name: 'What should we call you?' })
    expect(onboarding).toBeVisible()
    expect(onboarding.parentElement).toHaveClass('modal-backdrop--center')
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument()
    fireEvent.submit(onboarding.querySelector('form')!)
    expect(onboarding).toBeVisible()
    await user.type(screen.getByLabelText('Display name'), '  Pengfan Zhang  ')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await waitFor(() => expect(JSON.parse(localStorage.getItem(IDENTITY_KEY)!)).toMatchObject({ name: 'Pengfan Zhang', initials: 'PZ' }))
    expect(localStorage.getItem(CHANGELOG_SEEN_STORAGE_KEY)).toBe(LATEST_CHANGELOG_ID)

    await user.click(screen.getByRole('button', { name: 'Settings' }))
    expect(screen.getByLabelText('Display name')).toHaveValue('Pengfan Zhang')
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Settings' }))
    await user.clear(screen.getByLabelText('Display name'))
    await user.type(screen.getByLabelText('Display name'), 'Pengfan')
    await user.click(screen.getByRole('button', { name: 'Save settings' }))
    await waitFor(() => expect(JSON.parse(localStorage.getItem(IDENTITY_KEY)!)).toMatchObject({ name: 'Pengfan', initials: 'P' }))
  })

  it('opens and closes every app-level dialog', async () => {
    const user = userEvent.setup()
    localStorage.setItem(STORAGE_KEY, JSON.stringify(storedState()))
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'New activity' }))
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await user.click(screen.getAllByRole('button', { name: 'Add friend' })[0])
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Add expense' }))
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Share' }))
    expect(screen.getByRole('dialog', { name: 'Share activity' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Join activity' }))
    expect(screen.getByRole('dialog', { name: 'Join a shared activity' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Close' }))
  })

  it('shows progress while preparing the PNG summary', async () => {
    const user = userEvent.setup()
    localStorage.setItem(STORAGE_KEY, JSON.stringify(storedState()))
    mockSummaryDownload()
    let finishEncoding: BlobCallback | undefined
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(callback => {
      finishEncoding = callback
    })
    render(<App />)

    await chooseShareAction(user, 'Export full summary')
    expect(screen.getByRole('status')).toHaveTextContent('Preparing your PNG summary')

    act(() => finishEncoding?.(new Blob(['png'], { type: 'image/png' })))
    expect(await screen.findByRole('status')).toHaveTextContent('PNG summary downloaded')
  })

  it('shows when the PNG has moved from preparation to the system share sheet', async () => {
    const user = userEvent.setup()
    localStorage.setItem(STORAGE_KEY, JSON.stringify(storedState()))
    mockCanvas()
    let finishSharing: (() => void) | undefined
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: vi.fn().mockReturnValue(true) })
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: vi.fn(() => new Promise<void>(resolve => { finishSharing = resolve })),
    })
    render(<App />)

    await chooseShareAction(user, 'Export full summary')
    expect(await screen.findByRole('status')).toHaveTextContent('Your PNG is ready in the system share sheet')

    act(() => finishSharing?.())
    expect(await screen.findByRole('status')).toHaveTextContent('PNG summary shared')
  })

  it('creates an activity, adds people and expenses, searches, deletes, and resets', async () => {
    const user = userEvent.setup()
    const analyticsClient = { track: vi.fn() } satisfies AnalyticsClient
    mockSummaryDownload()
    render(<App analyticsClient={analyticsClient} />)
    await user.click(screen.getByRole('button', { name: 'Create an activity' }))
    await user.type(screen.getByLabelText('Activity name'), 'Road trip')
    await user.type(screen.getByLabelText(/Add friends/), 'Maya')
    await user.click(screen.getByRole('button', { name: 'Create activity' }))
    expect(screen.getByRole('heading', { name: 'Road trip' })).toBeVisible()

    await user.click(screen.getAllByRole('button', { name: 'Add friend' })[0])
    await user.type(screen.getByLabelText(/Friend names/), 'Jordan')
    await user.click(screen.getByRole('button', { name: 'Add friends' }))
    expect(screen.getByText('3')).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Add expense' }))
    await user.type(screen.getByLabelText('Description'), 'Gas')
    await user.type(screen.getByLabelText('Amount'), '30')
    await user.click(screen.getByRole('button', { name: 'Save expense' }))
    expect(screen.getByText('+$20.00')).toBeVisible()
    expect(screen.getByText(/^Created /)).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Edit Gas' }))
    await user.clear(screen.getByLabelText('Amount'))
    await user.type(screen.getByLabelText('Amount'), '45')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(screen.getAllByText('$45.00').some(element => element.matches('.expense-amount b'))).toBe(true)
    expect(screen.getByText(/^Edited /)).toBeVisible()

    await chooseShareAction(user, 'Export full summary')
    expect(await screen.findByRole('status')).toHaveTextContent('PNG summary downloaded')
    expect(analyticsClient.track).toHaveBeenCalledWith('summary_export_clicked', 'local', 'en')

    await user.type(screen.getByRole('textbox', { name: 'Search expenses' }), 'zzz')
    expect(screen.getByText('No expenses match your search.')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Clear search' }))

    await user.click(screen.getByRole('button', { name: 'Delete Gas' }))
    expect(screen.getByRole('dialog', { name: 'Delete this record?' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByText('Gas')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Delete Gas' }))
    await confirmDialogAction(user, 'Delete')
    expect(screen.queryByText('Gas')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Reset local data' }))
    expect(screen.getByRole('dialog', { name: 'Reset local data?' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('heading', { name: 'Road trip' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Reset local data' }))
    await confirmDialogAction(user, 'Reset data')
    expect(screen.getByRole('heading', { name: 'Start your first activity' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Join from a link' }))
    expect(screen.getByRole('dialog', { name: 'Join a shared activity' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Close' }))
  })

  it('persists one customizable currency per local activity', async () => {
    const user = userEvent.setup()
    const analyticsClient = { track: vi.fn() } satisfies AnalyticsClient
    const { unmount } = render(<App analyticsClient={analyticsClient} />)

    await user.click(screen.getByRole('button', { name: 'Create an activity' }))
    await user.type(screen.getByLabelText('Activity name'), 'Shanghai trip')
    await chooseSelectOption(user, /Activity currency/, 'CNY')
    await user.click(screen.getByRole('button', { name: 'Create activity' }))
    expect(screen.getByRole('button', { name: 'Activity currency, CNY' })).toBeVisible()
    expect(screen.getByText('No expenses yet')).toBeVisible()
    expect(screen.queryByText('¥0.00')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Add expense' }))
    await user.type(screen.getByLabelText('Description'), 'Noodles')
    await user.type(screen.getByLabelText('Amount'), '24')
    await user.click(screen.getByRole('button', { name: 'Save expense' }))
    expect(screen.getAllByText('¥24.00').length).toBeGreaterThan(0)

    await chooseActivityCurrency(user, 'CNY', 'EUR')
    expect(await screen.findByRole('status')).toHaveTextContent('Activity currency changed to EUR')
    expect(screen.getAllByText('€24.00').length).toBeGreaterThan(0)
    await chooseActivityCurrency(user, 'EUR', 'EUR')
    await waitFor(() => expect(parseState(localStorage.getItem(STORAGE_KEY)).groups[0].currency).toBe('EUR'))
    expect(analyticsClient.track.mock.calls.filter(([event]) => event === 'currency_selected')).toEqual([
      ['currency_selected', 'local', 'en', 'CNY'],
      ['currency_selected', 'local', 'en', 'EUR'],
    ])

    unmount()
    render(<App />)
    expect(screen.getByRole('button', { name: 'Activity currency, EUR' })).toBeVisible()
    expect(screen.getAllByText('€24.00').length).toBeGreaterThan(0)
  })

  it('moves a pasted live link into the current app session and can reopen the same link', async () => {
    const user = userEvent.setup()
    const credentials = { code: 'A1B2C3D4E5', editToken: 'a'.repeat(64) }
    const snapshot = createSharedActivity(group, [CURRENT_USER, maya, jordan], [expense()])
    const client = {
      create: vi.fn(),
      load: vi.fn().mockResolvedValue({ code: credentials.code, revision: 1, snapshot, updatedAt: '2026-07-14T01:00:00.000Z' }),
      poll: vi.fn(),
      update: vi.fn(),
    } satisfies LiveActivityClient
    render(<App liveActivityClient={client} />)
    const liveUrl = buildLiveActivityUrl(credentials, 'https://pengfanz.github.io/splitbill/')

    await user.click(screen.getByRole('button', { name: 'Join activity' }))
    await user.type(screen.getByLabelText('Shared activity link'), liveUrl)
    await user.click(screen.getByRole('button', { name: 'Open activity' }))
    expect(await screen.findByText('Live · revision 1')).toBeVisible()
    expect(window.location.hash).toBe(new URL(liveUrl).hash)
    expect(client.load).toHaveBeenCalledOnce()

    await user.click(screen.getByRole('button', { name: 'Join activity' }))
    await user.type(screen.getByLabelText('Shared activity link'), liveUrl)
    await user.click(screen.getByRole('button', { name: 'Open activity' }))
    await waitFor(() => expect(client.load).toHaveBeenCalledTimes(2))
    expect(screen.getByText('Live · revision 1')).toBeVisible()
  })

  it('keeps a Live participant identity local and sends it with first-person AI entry', async () => {
    const user = userEvent.setup()
    const credentials = { code: 'A1B2C3D4E5', editToken: 'a'.repeat(64) }
    const snapshot = createSharedActivity(group, [CURRENT_USER, maya, jordan], [expense()])
    const client = {
      create: vi.fn(),
      load: vi.fn().mockResolvedValue({ code: credentials.code, revision: 1, snapshot, updatedAt: '2026-07-14T01:00:00.000Z' }),
      poll: vi.fn(),
      update: vi.fn(),
    } satisfies LiveActivityClient
    const parseBatch = vi.fn().mockResolvedValue({
      status: 'ready_batch',
      drafts: [{
        status: 'ready',
        title: 'Coffee',
        amountCents: 1800,
        payerId: 'maya',
        splitMethod: 'equal',
        participantIds: ['maya', 'jordan'],
        exactSharesCents: [],
      }],
    })
    localStorage.setItem(IDENTITY_KEY, JSON.stringify({ ...CURRENT_USER, name: 'Guest browser' }))
    const liveUrl = buildLiveActivityUrl(credentials, 'https://pengfanz.github.io/splitbill/')
    window.history.replaceState(null, '', new URL(liveUrl).hash)

    render(<App liveActivityClient={client} aiExpenseClient={{ parseBatch }} />)
    expect(await screen.findByText('Live · revision 1')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Choose who you are' })).toBeVisible()
    await chooseSelectOption(user, 'Choose who you are', 'Maya Chen')
    expect(screen.getByRole('button', { name: 'Selected identity: Maya Chen' })).toBeVisible()
    expect(JSON.parse(localStorage.getItem(ACTIVITY_IDENTITY_KEY)!)).toEqual({
      'live:A1B2C3D4E5': 'maya',
    })
    expect(snapshot.friends).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'maya', name: 'Maya Chen' }),
    ]))

    await user.click(screen.getByRole('button', { name: 'Add expense' }))
    await user.click(screen.getByRole('tab', { name: 'Describe with AI' }))
    await user.type(screen.getByLabelText('Expense description'), 'I paid $18 for coffee with Jordan')
    await user.click(screen.getByRole('button', { name: /Create draft/ }))
    await waitFor(() => expect(parseBatch).toHaveBeenCalledWith(expect.objectContaining({
      viewerMemberId: 'maya',
      text: 'I paid $18 for coffee with Jordan',
    })))
  })

  it('saves an AI expense batch to a Live activity as one revision', async () => {
    const user = userEvent.setup()
    const analyticsClient = { track: vi.fn() } satisfies AnalyticsClient
    const credentials = { code: 'A1B2C3D4E5', editToken: 'a'.repeat(64) }
    const snapshot = createSharedActivity(group, [CURRENT_USER, maya, jordan], [expense()])
    const update = vi.fn().mockImplementation(async (_credentials, nextSnapshot) => ({
      code: credentials.code,
      revision: 2,
      snapshot: nextSnapshot,
      updatedAt: '2026-08-02T12:01:00.000Z',
    }))
    const client = {
      create: vi.fn(),
      load: vi.fn().mockResolvedValue({ code: credentials.code, revision: 1, snapshot, updatedAt: '2026-08-02T12:00:00.000Z' }),
      poll: vi.fn(),
      update,
    } satisfies LiveActivityClient
    const parseBatch = vi.fn().mockResolvedValue({
      status: 'ready_batch',
      drafts: [
        {
          status: 'ready', title: 'Lunch', amountCents: 2400, payerId: 'me', splitMethod: 'equal',
          participantIds: ['me', 'maya'], exactSharesCents: [],
        },
        {
          status: 'ready', title: 'Groceries', amountCents: 4600, payerId: 'maya', splitMethod: 'equal',
          participantIds: ['me', 'maya', 'jordan'], exactSharesCents: [],
        },
      ],
    })
    localStorage.setItem(ACTIVITY_IDENTITY_KEY, JSON.stringify({ [`live:${credentials.code}`]: 'me' }))
    window.history.replaceState(null, '', new URL(buildLiveActivityUrl(credentials, 'https://pengfanz.github.io/splitbill/')).hash)
    render(<App analyticsClient={analyticsClient} liveActivityClient={client} aiExpenseClient={{ parseBatch }} />)

    expect(await screen.findByText('Live · revision 1')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Add expense' }))
    await user.click(screen.getByRole('tab', { name: 'Describe with AI' }))
    await user.type(screen.getByLabelText('Expense description'), 'I paid $24 for lunch and Maya paid $46 for groceries')
    await user.click(screen.getByRole('button', { name: 'Create draft' }))
    await user.click(await screen.findByRole('button', { name: 'Save 2 expenses' }))

    await waitFor(() => expect(update).toHaveBeenCalledOnce())
    expect(update.mock.calls[0][1].expenses.slice(0, 2)).toEqual([
      expect.objectContaining({ title: 'Lunch', amount: 24 }),
      expect.objectContaining({ title: 'Groceries', amount: 46 }),
    ])
    expect(await screen.findByText('Live · revision 2')).toBeVisible()
    expect(screen.getByText('Lunch', { exact: true })).toBeVisible()
    expect(screen.getByText('Groceries', { exact: true })).toBeVisible()
    expect(screen.getByRole('status')).toHaveTextContent('2 expenses were added to the live activity.')
    expect(analyticsClient.track.mock.calls.filter(([event]) => event === 'expense_added')).toEqual([
      ['expense_added', 'live', 'en'],
    ])
    expect(analyticsClient.track).toHaveBeenCalledWith('expense_input_ai_text_selected', 'live', 'en')
    expect(analyticsClient.track.mock.calls.filter(([event]) => event.startsWith('ai_'))).toEqual([
      ['ai_text_requested', 'live', 'en'],
      ['ai_text_ready', 'live', 'en'],
    ])

    update.mockRejectedValueOnce(new LiveActivityApiError('network', 'offline'))
    await user.click(screen.getByRole('button', { name: 'Add expense' }))
    await user.click(screen.getByRole('tab', { name: 'Describe with AI' }))
    await user.type(screen.getByLabelText('Expense description'), 'I paid $24 for lunch and Maya paid $46 for groceries')
    await user.click(screen.getByRole('button', { name: 'Create draft' }))
    await user.click(await screen.findByRole('button', { name: 'Save 2 expenses' }))
    expect(await screen.findByText('Could not reach the live activity service. Check your connection and try again.')).toBeVisible()
    expect(screen.getByRole('dialog', { name: 'Add a shared expense' })).toBeVisible()
  })

  it('does not infer a Live participant before a new browser creates its local profile', async () => {
    const credentials = { code: 'A1B2C3D4E5', editToken: 'a'.repeat(64) }
    const snapshot = createSharedActivity(group, [CURRENT_USER, maya, jordan], [expense()])
    const client = {
      create: vi.fn(),
      load: vi.fn().mockResolvedValue({ code: credentials.code, revision: 1, snapshot, updatedAt: '2026-07-14T01:00:00.000Z' }),
      poll: vi.fn(),
      update: vi.fn(),
    } satisfies LiveActivityClient
    localStorage.removeItem(IDENTITY_KEY)
    window.history.replaceState(null, '', new URL(buildLiveActivityUrl(credentials, 'https://pengfanz.github.io/splitbill/')).hash)

    render(<App liveActivityClient={client} />)
    expect(await screen.findByRole('heading', { name: 'What should we call you?' })).toBeVisible()
    await waitFor(() => expect(client.load).toHaveBeenCalledOnce())
    expect(screen.getByRole('button', { name: 'Choose who you are', hidden: true })).toBeInTheDocument()
  })

  it('selects another activity and synchronizes matching storage events', async () => {
    const user = userEvent.setup()
    const second: ActivityGroup = { id: 'home', name: 'Home', emoji: '⌂', memberIds: ['me'] }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(storedState({ groups: [group, second] })))
    mockSummaryDownload()
    render(<App />)
    await chooseShareAction(user, 'Export full summary')
    expect(await screen.findByRole('status')).toHaveTextContent('PNG summary downloaded')
    await user.click(screen.getByRole('button', { name: 'Open Home activity' }))
    expect(screen.getByRole('heading', { name: 'Home' })).toBeVisible()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    await user.click(screen.getAllByRole('button', { name: 'Add friend' })[0])
    await user.type(screen.getByLabelText(/Friend names/), 'Sam')
    await user.click(screen.getByRole('button', { name: 'Add friends' }))
    fireEvent(window, new StorageEvent('storage', { key: 'other', newValue: null }))
    expect(screen.getByRole('heading', { name: 'Home' })).toBeVisible()
    fireEvent(window, new StorageEvent('storage', { key: STORAGE_KEY, newValue: JSON.stringify(storedState()) }))
    expect(screen.getByRole('heading', { name: 'Trip' })).toBeVisible()
  })

  it('deletes activities, their expenses, and friends unused by remaining activities', async () => {
    const user = userEvent.setup()
    const home: ActivityGroup = { id: 'home', name: 'Home', emoji: '⌂', memberIds: ['me', 'maya'] }
    const cabin: ActivityGroup = { id: 'cabin', name: 'Cabin', emoji: '△', memberIds: ['me', 'sam'] }
    const sam: Member = { id: 'sam', name: 'Sam', initials: 'S', color: '#fed' }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(storedState({
      groups: [group, home, cabin],
      friends: [maya, jordan, sam],
      expenses: [
        expense(),
        expense({ id: 'rent', groupId: 'home', title: 'Rent' }),
        expense({ id: 'wood', groupId: 'cabin', title: 'Firewood' }),
      ],
    })))
    localStorage.setItem(LIVE_ACTIVITY_BOOKMARKS_KEY, JSON.stringify({
      cabin: { code: 'B1C2D3E4F5', editToken: 'b'.repeat(64) },
    }))
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'Delete Cabin activity' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('button', { name: 'Delete Cabin activity' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Delete Cabin activity' }))
    await confirmDialogAction(user, 'Delete')
    expect(screen.getByRole('heading', { name: 'Trip' })).toBeVisible()
    await waitFor(() => {
      const saved = parseState(localStorage.getItem(STORAGE_KEY))
      expect(saved.groups.map(item => item.id)).toEqual(['trip', 'home'])
      expect(saved.friends.map(friend => friend.id)).toEqual(['maya', 'jordan'])
      expect(saved.expenses.map(item => item.title)).toEqual(['Dinner', 'Rent'])
      expect(saved.selectedGroupId).toBe('trip')
      expect(JSON.parse(localStorage.getItem(LIVE_ACTIVITY_BOOKMARKS_KEY)!)).toEqual({})
    })

    await user.type(screen.getByRole('textbox', { name: 'Search expenses' }), 'dinner')
    await user.click(screen.getByRole('button', { name: 'Delete Trip activity' }))
    await confirmDialogAction(user, 'Delete')
    expect(screen.getByRole('heading', { name: 'Home' })).toBeVisible()
    expect(screen.getByRole('textbox', { name: 'Search expenses' })).toHaveValue('')
    await waitFor(() => {
      const saved = parseState(localStorage.getItem(STORAGE_KEY))
      expect(saved.groups).toEqual([home])
      expect(saved.friends).toEqual([maya])
      expect(saved.expenses.map(item => item.title)).toEqual(['Rent'])
      expect(saved.selectedGroupId).toBe('home')
    })

    await user.click(screen.getByRole('button', { name: 'Delete Home activity' }))
    await confirmDialogAction(user, 'Delete')
    expect(screen.getByRole('heading', { name: 'Start your first activity' })).toBeVisible()
    await waitFor(() => expect(parseState(localStorage.getItem(STORAGE_KEY))).toEqual(EMPTY_STATE))
  })

  it('handles a group disappearing while friend and expense dialogs are open', async () => {
    const user = userEvent.setup()
    localStorage.setItem(STORAGE_KEY, JSON.stringify(storedState()))
    render(<App />)
    await user.click(screen.getAllByRole('button', { name: 'Add friend' })[0])
    fireEvent(window, new StorageEvent('storage', { key: STORAGE_KEY, newValue: JSON.stringify(EMPTY_STATE) }))
    await user.type(screen.getByLabelText(/Friend names/), 'Sam')
    await user.click(screen.getByRole('button', { name: 'Add friends' }))
    expect(screen.getByRole('heading', { name: 'Start your first activity' })).toBeVisible()

    fireEvent(window, new StorageEvent('storage', { key: STORAGE_KEY, newValue: JSON.stringify(storedState()) }))
    await user.click(screen.getByRole('button', { name: 'Add expense' }))
    fireEvent(window, new StorageEvent('storage', { key: STORAGE_KEY, newValue: JSON.stringify(EMPTY_STATE) }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('clears retired snapshot fragments without changing local data', async () => {
    const analyticsClient = { track: vi.fn() } satisfies AnalyticsClient
    localStorage.setItem(STORAGE_KEY, JSON.stringify(storedState({ expenses: [expense()] })))
    window.history.replaceState(null, '', '/#share=retired')
    render(<App analyticsClient={analyticsClient} />)

    expect(screen.getByRole('heading', { name: 'Trip' })).toBeVisible()
    expect(screen.getByText('Dinner')).toBeVisible()
    expect(screen.queryByText(/snapshot/i)).not.toBeInTheDocument()
    expect(parseState(localStorage.getItem(STORAGE_KEY)).expenses).toHaveLength(1)
    expect(analyticsClient.track).toHaveBeenCalledWith('app_opened', 'local', 'en')
    await waitFor(() => expect(window.location.hash).toBe(''))

    window.history.replaceState(null, '', '/#share=another-retired-link')
    fireEvent(window, new HashChangeEvent('hashchange'))
    expect(screen.getByRole('heading', { name: 'Trip' })).toBeVisible()
    expect(window.location.hash).toBe('')
  })

  it('moves the creator into the live activity before later edits', async () => {
    const user = userEvent.setup()
    const analyticsClient = { track: vi.fn() } satisfies AnalyticsClient
    const home: ActivityGroup = { id: 'home', name: 'Home', emoji: '⌂', memberIds: ['me'] }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(storedState({ groups: [group, home], expenses: [expense()] })))
    const snapshot = createSharedActivity(group, [CURRENT_USER, maya, jordan], [expense()])
    let latestSnapshot = snapshot
    let revision = 1
    const client = {
      create: vi.fn().mockResolvedValue({ code: 'A1B2C3D4E5', editToken: 'a'.repeat(64), revision: 1, snapshot, updatedAt: '2026-07-14T01:00:00.000Z' }),
      load: vi.fn().mockImplementation(async () => ({ code: 'A1B2C3D4E5', revision, snapshot: latestSnapshot, updatedAt: '2026-07-14T01:00:00.000Z' })),
      poll: vi.fn(),
      update: vi.fn().mockImplementation(async (_credentials, nextSnapshot) => {
        latestSnapshot = nextSnapshot
        revision += 1
        return { code: 'A1B2C3D4E5', revision, snapshot: latestSnapshot, updatedAt: '2026-07-14T01:01:00.000Z' }
      }),
    } satisfies LiveActivityClient
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const { unmount } = render(<App analyticsClient={analyticsClient} liveActivityClient={client} />)

    await chooseShareAction(user, 'Start live activity')
    expect(await screen.findByRole('dialog', { name: 'Scan to join Trip' })).toBeVisible()
    expect(within(screen.getByRole('dialog', { name: 'Scan to join Trip' })).getByText('Live activity · A1B2C3D4E5')).toBeVisible()
    expect(screen.getByText('Live · revision 1')).toBeVisible()
    expect(window.location.hash).toContain(`${LIVE_ACTIVITY_HASH_PREFIX}A1B2C3D4E5.`)
    expect(client.create).toHaveBeenCalledWith(expect.objectContaining({ group: expect.objectContaining({ name: 'Trip' }) }))
    expect(client.load).not.toHaveBeenCalled()
    await waitFor(() => expect(analyticsClient.track).toHaveBeenCalledWith('live_activity_opened', 'live', 'en'))
    expect(analyticsClient.track).toHaveBeenCalledWith('app_opened', 'local', 'en')
    expect(analyticsClient.track).toHaveBeenCalledWith('live_share_clicked', 'local', 'en')
    expect(analyticsClient.track).toHaveBeenCalledWith('live_activity_created', 'local', 'en')

    await chooseShareAction(user, 'Copy live invite link')
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining(`${LIVE_ACTIVITY_HASH_PREFIX}A1B2C3D4E5.`))
    expect(await screen.findByRole('status')).toHaveTextContent('Live activity link copied')

    const nativeShare = vi.fn().mockRejectedValueOnce(new DOMException('cancelled', 'AbortError')).mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'share', { configurable: true, value: nativeShare })
    await user.click(screen.getByRole('button', { name: 'Share link' }))
    expect(screen.getByRole('dialog', { name: 'Scan to join Trip' })).toBeVisible()
    expect(screen.getByRole('status')).toHaveTextContent('Sharing cancelled')
    await user.click(screen.getByRole('button', { name: 'Share link' }))
    expect(nativeShare).toHaveBeenLastCalledWith(expect.objectContaining({ text: 'Join Trip and edit expenses together in Tally.' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Live activity link shared')

    Object.defineProperty(navigator, 'share', { configurable: true, value: undefined })
    await chooseShareAction(user, 'Show live QR')
    await user.click(screen.getByRole('button', { name: 'Copy link' }))
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining(`${LIVE_ACTIVITY_HASH_PREFIX}A1B2C3D4E5.`))
    expect(await screen.findByRole('status')).toHaveTextContent('Live activity link copied')

    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error('blocked')) } })
    await chooseShareAction(user, 'Copy live invite link')
    expect(await screen.findByRole('status')).toHaveTextContent('Could not copy the live activity link')
    await chooseShareAction(user, 'Show live QR')
    await user.click(await screen.findByRole('button', { name: 'Copy link' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Could not copy the live activity link')
    await user.click(screen.getByRole('button', { name: 'Share link' }))
    expect(screen.getByRole('status')).toHaveTextContent('Could not share the live activity link')
    await user.click(screen.getAllByRole('button', { name: 'Close' })[0])

    await user.click(screen.getByRole('button', { name: 'Add expense' }))
    await user.type(screen.getByLabelText('Description'), 'Creator expense')
    await user.type(screen.getByLabelText('Amount'), '12')
    await user.click(screen.getByRole('button', { name: 'Save expense' }))
    expect(await screen.findByText('Creator expense', { exact: true })).toBeVisible()
    expect(screen.getByText('Live · revision 2')).toBeVisible()
    expect(client.update).toHaveBeenCalledWith(expect.objectContaining({ code: 'A1B2C3D4E5' }), expect.objectContaining({ expenses: expect.arrayContaining([expect.objectContaining({ title: 'Creator expense' })]) }), 1)
    expect(analyticsClient.track).toHaveBeenCalledWith('expense_added', 'live', 'en')
    await waitFor(() => expect(JSON.parse(localStorage.getItem(LIVE_ACTIVITY_BOOKMARKS_KEY)!)).toEqual({ trip: { code: 'A1B2C3D4E5', editToken: 'a'.repeat(64) } }))
    await waitFor(() => expect(JSON.parse(localStorage.getItem(LIVE_ACTIVITY_MIRRORS_KEY)!)).toEqual({
      trip: expect.objectContaining({
        code: 'A1B2C3D4E5',
        revision: 2,
        snapshot: expect.objectContaining({
          expenses: expect.arrayContaining([expect.objectContaining({ title: 'Creator expense' })]),
        }),
      }),
    }))

    expect(screen.queryByRole('button', { name: 'Back to my activities' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open Trip activity' }).closest('.group-row')).toHaveClass('is-selected')
    expect(screen.getByText('Live · A1B2C3D4E5')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Open Home activity' }))
    expect(screen.getByRole('heading', { name: 'Home' })).toBeVisible()
    expect(window.location.hash).toBe('')
    await user.click(screen.getByRole('button', { name: 'Open Trip activity' }))
    expect(await screen.findByText('Live · revision 2')).toBeVisible()
    expect(screen.getByText('Creator expense', { exact: true })).toBeVisible()

    unmount()
    window.history.replaceState(null, '', '/')
    render(<App liveActivityClient={client} />)
    expect(await screen.findByText('Live · revision 2')).toBeVisible()
    expect(window.location.hash).toContain(`${LIVE_ACTIVITY_HASH_PREFIX}A1B2C3D4E5.`)
  })

  it('ends a Live capability while preserving the last synced recovery copy', async () => {
    const user = userEvent.setup()
    const credentials = { code: 'A1B2C3D4E5', editToken: 'a'.repeat(64) }
    const snapshot = createSharedActivity(group, [CURRENT_USER, maya, jordan], [expense()])
    const end = vi.fn().mockResolvedValue(undefined)
    const client = {
      create: vi.fn(),
      load: vi.fn().mockResolvedValue({ code: credentials.code, revision: 4, snapshot, updatedAt: '2026-07-14T01:00:00.000Z' }),
      poll: vi.fn(),
      update: vi.fn(),
      end,
    } satisfies LiveActivityClient
    localStorage.setItem(ACTIVITY_IDENTITY_KEY, JSON.stringify({ [`live:${credentials.code}`]: 'me' }))
    window.history.replaceState(null, '', new URL(buildLiveActivityUrl(credentials, 'https://pengfanz.github.io/splitbill/')).hash)
    render(<App liveActivityClient={client} />)

    expect(await screen.findByText('Live · revision 4')).toBeVisible()
    await chooseShareAction(user, 'End live')
    const confirmation = screen.getByRole('dialog', { name: 'End live sharing?' })
    expect(within(confirmation).getByText(/Everyone will immediately lose access/)).toBeVisible()
    await user.click(within(confirmation).getByRole('button', { name: 'End live sharing' }))

    await waitFor(() => expect(end).toHaveBeenCalledWith(credentials))
    expect(await screen.findByText('Live sharing has ended')).toBeVisible()
    expect(screen.getByRole('status')).toHaveTextContent('last synced copy remains safe')
    expect(screen.getByText('Dinner', { exact: true })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Continue locally' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Add expense' })).not.toBeInTheDocument()
  })

  it('opens another saved Live activity after ending the current one', async () => {
    const user = userEvent.setup()
    const endedCredentials = { code: 'A1B2C3D4E5', editToken: 'a'.repeat(64) }
    const activeCredentials = { code: 'F6E5D4C3B2', editToken: 'b'.repeat(64) }
    const cabin: ActivityGroup = { id: 'cabin', name: 'Cabin', emoji: '△', memberIds: ['me', 'maya'] }
    const endedSnapshot = createSharedActivity(group, [CURRENT_USER, maya, jordan], [expense()])
    const activeSnapshot = createSharedActivity(cabin, [CURRENT_USER, maya], [])
    const load = vi.fn().mockImplementation(async (credentials: typeof endedCredentials) => credentials.code === endedCredentials.code
      ? { code: endedCredentials.code, revision: 4, snapshot: endedSnapshot, updatedAt: '2026-07-14T01:00:00.000Z' }
      : { code: activeCredentials.code, revision: 7, snapshot: activeSnapshot, updatedAt: '2026-07-14T02:00:00.000Z' })
    const client = {
      create: vi.fn(),
      load,
      poll: vi.fn(),
      update: vi.fn(),
      end: vi.fn().mockResolvedValue(undefined),
    } satisfies LiveActivityClient
    localStorage.setItem(STORAGE_KEY, JSON.stringify(storedState({ groups: [group, cabin] })))
    localStorage.setItem(LIVE_ACTIVITY_BOOKMARKS_KEY, JSON.stringify({
      [group.id]: endedCredentials,
      [cabin.id]: activeCredentials,
    }))
    localStorage.setItem(ACTIVITY_IDENTITY_KEY, JSON.stringify({
      [`live:${endedCredentials.code}`]: 'me',
      [`live:${activeCredentials.code}`]: 'me',
    }))
    window.history.replaceState(null, '', new URL(buildLiveActivityUrl(endedCredentials, 'https://pengfanz.github.io/splitbill/')).hash)
    render(<App liveActivityClient={client} />)

    expect(await screen.findByText('Live · revision 4')).toBeVisible()
    await chooseShareAction(user, 'End live')
    await user.click(within(screen.getByRole('dialog', { name: 'End live sharing?' })).getByRole('button', { name: 'End live sharing' }))
    expect(await screen.findByText('Live sharing has ended')).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Open Cabin activity' }))

    expect(await screen.findByRole('heading', { name: 'Cabin' })).toBeVisible()
    expect(await screen.findByText('Live · revision 7')).toBeVisible()
    expect(load).toHaveBeenCalledWith(activeCredentials)
  })

  it.each([
    ['network', 'Could not reach the live activity service. Check your connection and try again.'],
    ['invalid-input', 'One of the activity fields is too long or the amount is above the supported limit. Update it and try again.'],
  ] as const)('keeps end confirmation open after a %s failure', async (kind, message) => {
    const user = userEvent.setup()
    const credentials = { code: 'A1B2C3D4E5', editToken: 'a'.repeat(64) }
    const snapshot = createSharedActivity(group, [CURRENT_USER, maya, jordan], [expense()])
    const end = vi.fn().mockRejectedValue(new LiveActivityApiError(kind, 'failed'))
    const client = {
      create: vi.fn(),
      load: vi.fn().mockResolvedValue({ code: credentials.code, revision: 4, snapshot, updatedAt: '2026-07-14T01:00:00.000Z' }),
      poll: vi.fn(),
      update: vi.fn(),
      end,
    } satisfies LiveActivityClient
    localStorage.setItem(ACTIVITY_IDENTITY_KEY, JSON.stringify({ [`live:${credentials.code}`]: 'me' }))
    window.history.replaceState(null, '', new URL(buildLiveActivityUrl(credentials, 'https://pengfanz.github.io/splitbill/')).hash)
    render(<App liveActivityClient={client} />)

    expect(await screen.findByText('Live · revision 4')).toBeVisible()
    await chooseShareAction(user, 'End live')
    const confirmation = screen.getByRole('dialog', { name: 'End live sharing?' })
    await user.click(within(confirmation).getByRole('button', { name: 'End live sharing' }))

    expect(await screen.findByRole('status')).toHaveTextContent(message)
    expect(screen.getByRole('dialog', { name: 'End live sharing?' })).toBeVisible()
    expect(screen.getByText('Dinner', { exact: true })).toBeVisible()
  })

  it('treats an already-ended Live capability as an idempotent success', async () => {
    const user = userEvent.setup()
    const credentials = { code: 'A1B2C3D4E5', editToken: 'a'.repeat(64) }
    const snapshot = createSharedActivity(group, [CURRENT_USER, maya, jordan], [expense()])
    const client = {
      create: vi.fn(),
      load: vi.fn().mockResolvedValue({ code: credentials.code, revision: 4, snapshot, updatedAt: '2026-07-14T01:00:00.000Z' }),
      poll: vi.fn(),
      update: vi.fn(),
      end: vi.fn().mockRejectedValue(new LiveActivityApiError('not-found', 'already ended')),
    } satisfies LiveActivityClient
    localStorage.setItem(ACTIVITY_IDENTITY_KEY, JSON.stringify({ [`live:${credentials.code}`]: 'me' }))
    window.history.replaceState(null, '', new URL(buildLiveActivityUrl(credentials, 'https://pengfanz.github.io/splitbill/')).hash)
    render(<App liveActivityClient={client} />)

    expect(await screen.findByText('Live · revision 4')).toBeVisible()
    await chooseShareAction(user, 'End live')
    await user.click(within(screen.getByRole('dialog', { name: 'End live sharing?' })).getByRole('button', { name: 'End live sharing' }))

    expect(await screen.findByText('Live sharing has ended')).toBeVisible()
    expect(screen.queryByRole('dialog', { name: 'End live sharing?' })).not.toBeInTheDocument()
    expect(screen.getByText('Dinner', { exact: true })).toBeVisible()
  })

  it('shows an offline Live mirror as read-only and creates an explicit editable branch', async () => {
    const user = userEvent.setup()
    const credentials = { code: 'A1B2C3D4E5', editToken: 'a'.repeat(64) }
    const snapshot = createSharedActivity(group, [CURRENT_USER, maya, jordan], [expense()])
    const record = { code: credentials.code, revision: 4, snapshot, updatedAt: '2026-07-14T01:00:00.000Z' }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(storedState()))
    localStorage.setItem(LIVE_ACTIVITY_BOOKMARKS_KEY, JSON.stringify({ trip: credentials }))
    localStorage.setItem(LIVE_ACTIVITY_MIRRORS_KEY, JSON.stringify({ trip: createLiveActivityMirror(record) }))
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
    const client = {
      create: vi.fn(),
      load: vi.fn(),
      poll: vi.fn(),
      update: vi.fn(),
    } satisfies LiveActivityClient

    render(<App liveActivityClient={client} />)

    expect(screen.getByText('You’re offline')).toBeVisible()
    expect(screen.getByText('Dinner', { exact: true })).toBeVisible()
    expect(screen.getByText('Saved · revision 4')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Add expense' })).not.toBeInTheDocument()
    expect(client.load).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Duplicate and edit' }))
    expect(screen.getByRole('dialog', { name: 'Who are you in this copy?' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Duplicate and edit' }))
    await user.click(screen.getByRole('button', { name: 'Create editable copy' }))

    expect(await screen.findByRole('heading', { name: 'Trip copy' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Add expense' })).toBeVisible()
    expect(window.location.hash).toBe('')
    const saved = parseState(localStorage.getItem(STORAGE_KEY))
    expect(saved.groups.map(savedGroup => savedGroup.name)).toEqual(['Trip', 'Trip copy'])
    expect(saved.expenses).toEqual(expect.arrayContaining([expect.objectContaining({ title: 'Dinner' })]))
    expect(JSON.parse(localStorage.getItem(LIVE_ACTIVITY_BOOKMARKS_KEY)!)).toEqual({ trip: credentials })
  })

  it('upgrades an existing bookmark-only Live session after a temporary connection failure', async () => {
    const user = userEvent.setup()
    const credentials = { code: 'A1B2C3D4E5', editToken: 'a'.repeat(64) }
    const snapshot = createSharedActivity(group, [CURRENT_USER, maya, jordan], [expense()])
    localStorage.setItem(STORAGE_KEY, JSON.stringify(storedState()))
    localStorage.setItem(LIVE_ACTIVITY_BOOKMARKS_KEY, JSON.stringify({ trip: credentials }))
    expect(localStorage.getItem(LIVE_ACTIVITY_MIRRORS_KEY)).toBeNull()
    const client = {
      create: vi.fn(),
      load: vi.fn()
        .mockRejectedValueOnce(new LiveActivityApiError('network', 'temporarily unavailable'))
        .mockResolvedValue({
          code: credentials.code,
          revision: 8,
          snapshot,
          updatedAt: '2026-07-25T01:00:00.000Z',
        }),
      poll: vi.fn(),
      update: vi.fn().mockImplementation(async (_credentials, nextSnapshot) => ({
        code: credentials.code,
        revision: 9,
        snapshot: nextSnapshot,
        updatedAt: '2026-07-25T01:01:00.000Z',
      })),
    } satisfies LiveActivityClient

    render(<App liveActivityClient={client} />)

    expect(await screen.findByText('Live activity unavailable')).toBeVisible()
    expect(screen.getByRole('status')).toHaveTextContent('Could not reach the live activity service')
    expect(screen.queryByRole('button', { name: 'Duplicate and edit' })).not.toBeInTheDocument()
    expect(window.location.hash).toContain(`${LIVE_ACTIVITY_HASH_PREFIX}${credentials.code}.${credentials.editToken}`)

    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Live and synced · A1B2C3D4E5')).toBeVisible()
    expect(screen.getByText('Dinner', { exact: true })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Add expense' })).toBeVisible()
    await waitFor(() => expect(JSON.parse(localStorage.getItem(LIVE_ACTIVITY_MIRRORS_KEY)!)).toEqual({
      trip: expect.objectContaining({
        code: credentials.code,
        revision: 8,
        snapshot: expect.objectContaining({
          expenses: expect.arrayContaining([expect.objectContaining({ title: 'Dinner' })]),
        }),
      }),
    }))
    expect(JSON.parse(localStorage.getItem(LIVE_ACTIVITY_BOOKMARKS_KEY)!)).toEqual({ trip: credentials })

    await user.click(screen.getByRole('button', { name: 'Add expense' }))
    await user.type(screen.getByLabelText('Description'), 'Parking')
    await user.type(screen.getByLabelText('Amount'), '15')
    await user.click(screen.getByRole('button', { name: 'Save expense' }))

    expect(await screen.findByText('Live · revision 9')).toBeVisible()
    expect(client.update).toHaveBeenCalledWith(
      credentials,
      expect.objectContaining({
        expenses: expect.arrayContaining([expect.objectContaining({ title: 'Parking' })]),
      }),
      8,
    )
    await waitFor(() => expect(JSON.parse(localStorage.getItem(LIVE_ACTIVITY_MIRRORS_KEY)!).trip).toEqual(expect.objectContaining({
      revision: 9,
      snapshot: expect.objectContaining({
        expenses: expect.arrayContaining([expect.objectContaining({ title: 'Parking' })]),
      }),
    })))
  })

  it('pauses Live editing when the browser goes offline and restores it after reconnecting', async () => {
    const credentials = { code: 'A1B2C3D4E5', editToken: 'a'.repeat(64) }
    const snapshot = createSharedActivity(group, [CURRENT_USER, maya, jordan], [expense()])
    const client = {
      create: vi.fn(),
      load: vi.fn().mockResolvedValue({
        code: credentials.code,
        revision: 1,
        snapshot,
        updatedAt: '2026-07-14T01:00:00.000Z',
      }),
      poll: vi.fn(),
      update: vi.fn(),
    } satisfies LiveActivityClient
    window.history.replaceState(null, '', `/${LIVE_ACTIVITY_HASH_PREFIX}${credentials.code}.${credentials.editToken}`)
    render(<App liveActivityClient={client} />)

    expect(await screen.findByText('Live and synced · A1B2C3D4E5')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Add expense' })).toBeVisible()

    fireEvent(window, new Event('offline'))
    expect(screen.getByText('You’re offline')).toBeVisible()
    expect(screen.getByText('Saved · revision 1')).toBeVisible()
    expect(screen.getByText('Editing paused')).toBeVisible()
    expect(screen.queryByText('Read-only snapshot')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add expense' })).not.toBeInTheDocument()

    fireEvent(window, new Event('online'))
    expect(await screen.findByText('Live and synced · A1B2C3D4E5')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Add expense' })).toBeVisible()
  })

  it('recovers an expired Live mirror locally and can start a fresh Live session', async () => {
    const user = userEvent.setup()
    const credentials = { code: 'A1B2C3D4E5', editToken: 'a'.repeat(64) }
    const nextCredentials = { code: 'F1E2D3C4B5', editToken: 'b'.repeat(64) }
    const snapshot = createSharedActivity(group, [CURRENT_USER, maya, jordan], [expense()])
    const record = { code: credentials.code, revision: 7, snapshot, updatedAt: '2026-01-01T01:00:00.000Z' }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(storedState()))
    localStorage.setItem(LIVE_ACTIVITY_BOOKMARKS_KEY, JSON.stringify({ trip: credentials }))
    localStorage.setItem(LIVE_ACTIVITY_MIRRORS_KEY, JSON.stringify({ trip: createLiveActivityMirror(record) }))
    const client = {
      create: vi.fn().mockImplementation(async (nextSnapshot: SharedActivity) => ({
        ...nextCredentials,
        revision: 1,
        snapshot: nextSnapshot,
        updatedAt: '2026-07-25T01:00:00.000Z',
      })),
      load: vi.fn().mockRejectedValue(new LiveActivityApiError('not-found', 'expired')),
      poll: vi.fn(),
      update: vi.fn(),
    } satisfies LiveActivityClient

    render(<App liveActivityClient={client} />)

    expect(await screen.findByText('Live sharing has ended')).toBeVisible()
    expect(screen.getByText('Dinner', { exact: true })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Add expense' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Continue locally' }))
    expect(screen.getByRole('dialog', { name: 'Who are you in this activity?' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Save editable activity' }))

    expect(await screen.findByRole('heading', { name: 'Trip' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Add expense' })).toBeVisible()
    await waitFor(() => expect(JSON.parse(localStorage.getItem(LIVE_ACTIVITY_BOOKMARKS_KEY)!)).toEqual({}))
    await waitFor(() => expect(JSON.parse(localStorage.getItem(LIVE_ACTIVITY_MIRRORS_KEY)!)).toEqual({}))

    await chooseShareAction(user, 'Start live activity')
    expect(await screen.findByText('Live · revision 1')).toBeVisible()
    expect(window.location.hash).toContain(`${LIVE_ACTIVITY_HASH_PREFIX}${nextCredentials.code}.`)
    expect(client.create).toHaveBeenCalledWith(expect.objectContaining({
      expenses: expect.arrayContaining([expect.objectContaining({ title: 'Dinner' })]),
    }))
  })

  it('saves settlement payments to the canonical live activity', async () => {
    const user = userEvent.setup()
    const analyticsClient = { track: vi.fn() } satisfies AnalyticsClient
    const replacementAnalyticsClient = { track: vi.fn() } satisfies AnalyticsClient
    const credentials = { code: 'A1B2C3D4E5', editToken: 'a'.repeat(64) }
    const snapshot = createSharedActivity(group, [CURRENT_USER, maya, jordan], [expense()])
    const client = {
      create: vi.fn(),
      load: vi.fn().mockResolvedValue({ code: credentials.code, revision: 1, snapshot, updatedAt: '2026-07-14T01:00:00.000Z' }),
      poll: vi.fn(),
      update: vi.fn().mockImplementation(async (_credentials, nextSnapshot) => ({ code: credentials.code, revision: 2, snapshot: nextSnapshot, updatedAt: '2026-07-14T01:01:00.000Z' })),
    } satisfies LiveActivityClient
    window.history.replaceState(null, '', `/${LIVE_ACTIVITY_HASH_PREFIX}${credentials.code}.${credentials.editToken}`)
    const { rerender } = render(<App analyticsClient={analyticsClient} liveActivityClient={client} />)

    expect(await screen.findByText('Live · revision 1')).toBeVisible()
    rerender(<App analyticsClient={replacementAnalyticsClient} liveActivityClient={client} />)
    const direction = screen.getByText('Maya Chen owes You').closest('.balance-row') as HTMLElement
    await user.click(within(direction).getByRole('button', { name: 'Settle up' }))
    await user.click(screen.getByRole('button', { name: 'Record payment' }))

    expect(await screen.findByText('Live · revision 2')).toBeVisible()
    expect(client.update).toHaveBeenCalledWith(credentials, expect.objectContaining({
      expenses: expect.arrayContaining([expect.objectContaining({
        kind: 'settlement',
        payerId: maya.id,
        shares: { me: 10 },
      })]),
    }), 1)
    expect(screen.getByText('Maya Chen paid You')).toBeVisible()
    expect(screen.queryByText('Maya Chen owes You')).not.toBeInTheDocument()
    expect(replacementAnalyticsClient.track).not.toHaveBeenCalledWith('live_activity_opened', 'live', 'en')
    expect(replacementAnalyticsClient.track).toHaveBeenCalledWith('settlement_recorded', 'live', 'en')
  })

  it('synchronizes activity currency changes through a live session', async () => {
    const user = userEvent.setup()
    const analyticsClient = { track: vi.fn() } satisfies AnalyticsClient
    const credentials = { code: 'A1B2C3D4E5', editToken: 'a'.repeat(64) }
    const snapshot = createSharedActivity({ ...group, currency: 'USD' }, [CURRENT_USER, maya, jordan], [expense()])
    const client = {
      create: vi.fn(),
      load: vi.fn().mockResolvedValue({ code: credentials.code, revision: 1, snapshot, updatedAt: '2026-07-14T01:00:00.000Z' }),
      poll: vi.fn(),
      update: vi.fn().mockImplementation(async (_credentials, nextSnapshot) => ({
        code: credentials.code,
        revision: 2,
        snapshot: nextSnapshot,
        updatedAt: '2026-07-14T01:01:00.000Z',
      })),
    } satisfies LiveActivityClient
    window.history.replaceState(null, '', `/${LIVE_ACTIVITY_HASH_PREFIX}${credentials.code}.${credentials.editToken}`)
    render(<App analyticsClient={analyticsClient} liveActivityClient={client} />)

    expect(await screen.findByText('Live · revision 1')).toBeVisible()
    await chooseActivityCurrency(user, 'USD', 'CNY')

    expect(await screen.findByText('Live · revision 2')).toBeVisible()
    expect(client.update).toHaveBeenCalledWith(
      credentials,
      expect.objectContaining({ group: expect.objectContaining({ currency: 'CNY' }) }),
      1,
    )
    expect(screen.getByRole('status')).toHaveTextContent('Activity currency changed to CNY')
    expect(screen.getAllByText('¥30.00').length).toBeGreaterThan(0)
    expect(analyticsClient.track).toHaveBeenCalledWith('currency_selected', 'live', 'en', 'CNY')
  })

  it('automatically loads newer live revisions while the tab is visible', async () => {
    vi.useFakeTimers()
    const credentials = { code: 'A1B2C3D4E5', editToken: 'a'.repeat(64) }
    const initialSnapshot = createSharedActivity(group, [CURRENT_USER, maya, jordan], [expense()])
    const remoteSnapshot = createSharedActivity(group, [CURRENT_USER, maya, jordan], [
      expense({ id: 'remote-expense', title: 'Remote taxi' }),
      expense(),
    ])
    const client = {
      create: vi.fn(),
      load: vi.fn()
        .mockResolvedValueOnce({ code: credentials.code, revision: 1, snapshot: initialSnapshot, updatedAt: '2026-07-14T01:00:00.000Z' })
        .mockResolvedValue({ code: credentials.code, revision: 2, snapshot: remoteSnapshot, updatedAt: '2026-07-14T01:01:00.000Z' }),
      poll: vi.fn()
        .mockResolvedValueOnce({ code: credentials.code, revision: 2, updatedAt: '2026-07-14T01:01:00.000Z' })
        .mockResolvedValueOnce({ code: credentials.code, revision: 2, updatedAt: '2026-07-14T01:01:00.000Z' })
        .mockResolvedValue({ code: credentials.code, revision: 3, updatedAt: '2026-07-14T01:02:00.000Z' }),
      update: vi.fn(),
    } satisfies LiveActivityClient
    window.history.replaceState(null, '', `/${LIVE_ACTIVITY_HASH_PREFIX}${credentials.code}.${credentials.editToken}`)
    const view = render(<App liveActivityClient={client} />)

    try {
      await act(async () => { await vi.advanceTimersByTimeAsync(0) })
      expect(screen.getByText('Live · revision 1')).toBeVisible()
      expect(screen.queryByText('Remote taxi')).not.toBeInTheDocument()

      fireEvent(window, new Event('focus'))
      await act(async () => { await vi.advanceTimersByTimeAsync(0) })
      expect(screen.getByText('Live · revision 2')).toBeVisible()
      expect(screen.getByText('Remote taxi')).toBeVisible()
      expect(screen.getByRole('status')).toHaveTextContent('New shared changes loaded automatically')

      await act(async () => {
        await vi.advanceTimersByTimeAsync(LIVE_ACTIVITY_POLL_INTERVAL_MS + 1)
      })
      expect(client.poll).toHaveBeenCalledTimes(2)
      expect(client.load).toHaveBeenCalledTimes(2)
      expect(screen.getByText('Live · revision 2')).toBeVisible()

      await act(async () => {
        await vi.advanceTimersByTimeAsync(LIVE_ACTIVITY_POLL_INTERVAL_MS)
      })
      expect(client.poll).toHaveBeenCalledTimes(3)
      expect(client.load).toHaveBeenCalledTimes(3)
      expect(screen.getByText('Live · revision 2')).toBeVisible()
    } finally {
      view.unmount()
      vi.useRealTimers()
    }
  })

  it('keeps the settlement dialog open when a live payment cannot be saved', async () => {
    const user = userEvent.setup()
    const credentials = { code: 'A1B2C3D4E5', editToken: 'a'.repeat(64) }
    const snapshot = createSharedActivity(group, [CURRENT_USER, maya, jordan], [expense()])
    const client = {
      create: vi.fn(),
      load: vi.fn().mockResolvedValue({ code: credentials.code, revision: 1, snapshot, updatedAt: '2026-07-14T01:00:00.000Z' }),
      poll: vi.fn(),
      update: vi.fn().mockRejectedValue(new LiveActivityApiError('network', 'offline')),
    } satisfies LiveActivityClient
    window.history.replaceState(null, '', `/${LIVE_ACTIVITY_HASH_PREFIX}${credentials.code}.${credentials.editToken}`)
    render(<App liveActivityClient={client} />)

    expect(await screen.findByText('Live · revision 1')).toBeVisible()
    const direction = screen.getByText('Maya Chen owes You').closest('.balance-row') as HTMLElement
    await user.click(within(direction).getByRole('button', { name: 'Settle up' }))
    await user.click(screen.getByRole('button', { name: 'Record payment' }))

    expect(await screen.findByRole('status')).toHaveTextContent('Could not reach the live activity service')
    expect(screen.getByRole('heading', { name: 'Record a settlement' })).toBeVisible()
    expect(screen.getByText('Saved · revision 1')).toBeVisible()
    expect(screen.getByText('Editing paused')).toBeVisible()
  })

  it('reports backend failures while creating a live activity', async () => {
    const user = userEvent.setup()
    const analyticsClient = { track: vi.fn() } satisfies AnalyticsClient
    localStorage.setItem(STORAGE_KEY, JSON.stringify(storedState()))
    const client = {
      create: vi.fn()
        .mockRejectedValueOnce(new LiveActivityApiError('network', 'offline'))
        .mockRejectedValueOnce(new LiveActivityApiError('rate-limit', 'slow down'))
        .mockRejectedValueOnce(new Error('unexpected'))
        .mockRejectedValueOnce(new LiveActivityApiError('backend', 'broken')),
      load: vi.fn(),
      poll: vi.fn(),
      update: vi.fn(),
    } satisfies LiveActivityClient
    render(<App analyticsClient={analyticsClient} liveActivityClient={client} />)

    await chooseShareAction(user, 'Start live activity')
    expect(await screen.findByRole('status')).toHaveTextContent('Could not reach the live activity service')
    await chooseShareAction(user, 'Start live activity')
    expect(await screen.findByRole('status')).toHaveTextContent('Too many live activity requests')
    await chooseShareAction(user, 'Start live activity')
    expect(await screen.findByRole('status')).toHaveTextContent('could not be updated')
    await chooseShareAction(user, 'Start live activity')
    expect(await screen.findByRole('status')).toHaveTextContent('could not be updated')
    expect(analyticsClient.track.mock.calls.filter(([event]) => event === 'live_share_clicked')).toHaveLength(4)
    expect(analyticsClient.track).not.toHaveBeenCalledWith('live_activity_created', 'local', 'en')
  })

  it('edits, refreshes, shares, and leaves one backend activity from its capability URL', async () => {
    const user = userEvent.setup()
    const credentials = { code: 'A1B2C3D4E5', editToken: 'a'.repeat(64) }
    const snapshot = createSharedActivity(group, [{ ...CURRENT_USER, name: 'Alex', initials: 'A' }, maya, jordan], [expense()])
    let latestSnapshot = snapshot
    let revision = 1
    const client = {
      create: vi.fn(),
      load: vi.fn().mockImplementation(async () => ({ code: credentials.code, revision, snapshot: latestSnapshot, updatedAt: '2026-07-14T01:00:00.000Z' })),
      poll: vi.fn(),
      update: vi.fn().mockImplementation(async (_credentials, nextSnapshot) => {
        latestSnapshot = nextSnapshot
        revision += 1
        return { code: credentials.code, revision, snapshot: latestSnapshot, updatedAt: '2026-07-14T01:01:00.000Z' }
      }),
    } satisfies LiveActivityClient
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    window.history.replaceState(null, '', `/${LIVE_ACTIVITY_HASH_PREFIX}${credentials.code}.${credentials.editToken}`)
    const analyticsClient = { track: vi.fn() } satisfies AnalyticsClient
    const { unmount } = render(<App analyticsClient={analyticsClient} liveActivityClient={client} />)

    expect(await screen.findByLabelText('Live activity')).toBeVisible()
    expect(await screen.findByText('Live · revision 1')).toBeVisible()
    expect(screen.queryByText('Activity creator')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Choose who you are' })).toBeVisible()
    await chooseSelectOption(user, 'Choose who you are', 'Alex')
    expect(screen.getByText('Alex is owed')).toBeVisible()
    await waitFor(() => expect(JSON.parse(localStorage.getItem(LIVE_ACTIVITY_BOOKMARKS_KEY)!)).toEqual({
      'live-a1b2c3d4e5': credentials,
    }))
    expect(parseState(localStorage.getItem(STORAGE_KEY)).groups).toContainEqual(expect.objectContaining({ id: 'live-a1b2c3d4e5', name: 'Trip' }))
    expect(screen.getByText('Live · A1B2C3D4E5')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Back to my activities' })).not.toBeInTheDocument()

    await user.click(screen.getAllByRole('button', { name: 'Add friend' })[0])
    await user.type(screen.getByLabelText(/Friend names/), 'Sam')
    await user.click(screen.getByRole('button', { name: 'Add friends' }))
    expect(await screen.findByText('Sam')).toBeVisible()
    expect(screen.getByText('Live · revision 2')).toBeVisible()
    expect(analyticsClient.track).toHaveBeenCalledWith('friend_added', 'live', 'en')

    await user.click(screen.getByRole('button', { name: 'Add expense' }))
    await user.type(screen.getByLabelText('Description'), 'Parking')
    await user.type(screen.getByLabelText('Amount'), '40')
    await user.click(screen.getByRole('button', { name: 'Save expense' }))
    expect(await screen.findByText('Parking')).toBeVisible()
    expect(screen.getByText('Live · revision 3')).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Edit Parking' }))
    await user.clear(screen.getByLabelText('Amount'))
    await user.type(screen.getByLabelText('Amount'), '80')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByText('$80.00')).toBeVisible()
    expect(screen.getByText('Live · revision 4')).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Delete Parking' }))
    await confirmDialogAction(user, 'Delete')
    await waitFor(() => expect(screen.queryByText('Parking')).not.toBeInTheDocument())
    expect(screen.getByText('Live · revision 5')).toBeVisible()

    await chooseShareAction(user, 'Show live QR')
    expect(await screen.findByRole('dialog', { name: 'Scan to join Trip' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Copy link' }))
    expect(screen.getAllByRole('status').some(status => status.textContent?.includes('Anyone with it can edit'))).toBe(true)

    mockSummaryDownload()
    const OriginalImage = globalThis.Image
    class LoadedImage {
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      set src(_value: string) {
        queueMicrotask(() => this.onload?.())
      }
    }
    Object.defineProperty(globalThis, 'Image', { configurable: true, value: LoadedImage })
    await chooseShareAction(user, 'Export full summary')
    await screen.findByText('PNG summary downloaded.')
    Object.defineProperty(globalThis, 'Image', { configurable: true, value: OriginalImage })
    expect(analyticsClient.track).toHaveBeenCalledWith('summary_export_clicked', 'live', 'en')

    await user.click(screen.getByRole('button', { name: 'Refresh latest' }))
    expect(await screen.findByText('Latest changes loaded.')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'New activity' }))
    expect(window.location.hash).toBe('')
    expect(screen.getByRole('dialog', { name: 'What are you sharing?' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await user.click(screen.getByRole('button', { name: 'Open Trip activity' }))
    expect(await screen.findByText('Live · revision 5')).toBeVisible()

    unmount()
    window.history.replaceState(null, '', '/')
    render(<App analyticsClient={analyticsClient} liveActivityClient={client} />)
    expect(await screen.findByText('Live · revision 5')).toBeVisible()
    expect(window.location.hash).toContain(`${LIVE_ACTIVITY_HASH_PREFIX}${credentials.code}.`)

    await user.click(screen.getByRole('button', { name: 'Delete Trip activity' }))
    await confirmDialogAction(user, 'Delete')
    expect(await screen.findByRole('heading', { name: 'Start your first activity' })).toBeVisible()
    expect(window.location.hash).toBe('')
    expect(JSON.parse(localStorage.getItem(LIVE_ACTIVITY_BOOKMARKS_KEY)!)).toEqual({})
  })

  it('surfaces missing configuration, stale revisions, load failures, and copy failures', async () => {
    const user = userEvent.setup()
    const credentials = { code: 'A1B2C3D4E5', editToken: 'a'.repeat(64) }
    window.history.replaceState(null, '', `/${LIVE_ACTIVITY_HASH_PREFIX}${credentials.code}.${credentials.editToken}`)
    const { unmount } = render(<App liveActivityClient={null} />)
    expect(screen.getByRole('status')).toHaveTextContent('Live sharing is not configured')
    expect(screen.queryByRole('button', { name: 'Refresh latest' })).not.toBeInTheDocument()
    unmount()

    window.history.replaceState(null, '', '/')
    localStorage.setItem(STORAGE_KEY, JSON.stringify(storedState()))
    const unavailable = render(<App liveActivityClient={null} />)
    await chooseShareAction(user, 'Start live activity')
    expect(screen.getByRole('status')).toHaveTextContent('Live sharing is not configured')
    unavailable.unmount()
    window.history.replaceState(null, '', `/${LIVE_ACTIVITY_HASH_PREFIX}${credentials.code}.${credentials.editToken}`)

    const snapshot = createSharedActivity(group, [CURRENT_USER, maya, jordan], [expense()])
    const latestSnapshot = createSharedActivity(
      { ...group, name: 'Latest trip' },
      [CURRENT_USER, maya, jordan],
      [expense()],
    )
    const client = {
      create: vi.fn(),
      load: vi.fn()
        .mockRejectedValueOnce(new LiveActivityApiError('not-found', 'missing'))
        .mockResolvedValue({ code: credentials.code, revision: 2, snapshot, updatedAt: '2026-07-14T01:00:00.000Z' }),
      poll: vi.fn(),
      update: vi.fn()
        .mockRejectedValueOnce(new LiveActivityApiError('conflict', 'stale', {
          latestRecord: {
            code: credentials.code,
            revision: 3,
            snapshot: latestSnapshot,
            updatedAt: '2026-07-14T01:01:00.000Z',
          },
        }))
        .mockRejectedValue(new LiveActivityApiError('conflict', 'stale')),
    } satisfies LiveActivityClient
    render(<App liveActivityClient={client} />)
    expect(await screen.findByRole('status')).toHaveTextContent('invalid or no longer available')
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Live · revision 2')).toBeVisible()
    await user.click(screen.getAllByRole('button', { name: 'Add friend' })[0])
    await user.type(screen.getByLabelText(/Friend names/), 'Sam')
    await user.click(screen.getByRole('button', { name: 'Add friends' }))
    expect(await screen.findByRole('heading', { name: 'Latest trip' })).toBeVisible()
    expect(screen.getByText('Live · revision 3')).toBeVisible()
    expect(screen.getAllByRole('status').some(status => status.textContent?.includes('latest changes are loaded'))).toBe(true)
    expect(screen.getByRole('dialog', { name: 'Who’s joining?' })).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await user.click(screen.getByRole('button', { name: 'Add expense' }))
    await user.type(screen.getByLabelText('Description'), 'Failed parking')
    await user.type(screen.getByLabelText('Amount'), '10')
    await user.click(screen.getByRole('button', { name: 'Save expense' }))
    expect(screen.getByRole('dialog', { name: 'Add a shared expense' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await user.click(screen.getByRole('button', { name: 'Edit Dinner' }))
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(screen.getByRole('dialog', { name: 'Edit expense' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await chooseShareAction(user, 'Show live QR')
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error('blocked')) } })
    await user.click(screen.getByRole('button', { name: 'Copy link' }))
    expect(screen.getAllByRole('status').some(status => status.textContent?.includes('Could not copy'))).toBe(true)

    client.load.mockRejectedValueOnce(new Error('unexpected'))
    await user.click(screen.getByRole('button', { name: 'Refresh latest' }))
    expect(screen.getByRole('status')).toHaveTextContent('could not be updated')

    client.load.mockRejectedValueOnce(new LiveActivityApiError('network', 'offline'))
    await user.click(screen.getByRole('button', { name: 'Refresh latest' }))
    expect(screen.getByRole('status')).toHaveTextContent('Could not reach the live activity service')

    client.load.mockRejectedValueOnce(new LiveActivityApiError('not-found', 'expired'))
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Live sharing has ended')).toBeVisible()
  })

  it('ends a remembered Live session when a save confirms that it expired', async () => {
    const user = userEvent.setup()
    const credentials = { code: 'A1B2C3D4E5', editToken: 'a'.repeat(64) }
    const snapshot = createSharedActivity(group, [CURRENT_USER, maya, jordan], [expense()])
    const client = {
      create: vi.fn(),
      load: vi.fn().mockResolvedValue({
        code: credentials.code,
        revision: 1,
        snapshot,
        updatedAt: '2026-07-14T01:00:00.000Z',
      }),
      poll: vi.fn(),
      update: vi.fn().mockRejectedValue(new LiveActivityApiError('not-found', 'expired')),
    } satisfies LiveActivityClient

    window.history.replaceState(null, '', `/${LIVE_ACTIVITY_HASH_PREFIX}${credentials.code}.${credentials.editToken}`)
    const analyticsClient = { track: vi.fn() } satisfies AnalyticsClient
    render(<App analyticsClient={analyticsClient} liveActivityClient={client} />)
    expect(await screen.findByText('Live · revision 1')).toBeVisible()

    await user.click(screen.getAllByRole('button', { name: 'Add friend' })[0])
    await user.type(screen.getByLabelText(/Friend names/), 'Sam')
    await user.click(screen.getByRole('button', { name: 'Add friends' }))

    expect(await screen.findByText('Live sharing has ended')).toBeVisible()
    expect(screen.getByText('Dinner', { exact: true })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Add expense' })).not.toBeInTheDocument()
    expect(analyticsClient.track).not.toHaveBeenCalledWith('friend_added', 'live', 'en')
  })

  it('serializes saves from one live browser tab', async () => {
    const user = userEvent.setup()
    const credentials = { code: 'A1B2C3D4E5', editToken: 'a'.repeat(64) }
    const snapshot = createSharedActivity(group, [CURRENT_USER, maya, jordan], [expense()])
    let resolveUpdate!: (record: LiveActivityRecord) => void
    let pendingSnapshot!: SharedActivity
    const client = {
      create: vi.fn(),
      load: vi.fn().mockResolvedValue({
        code: credentials.code,
        revision: 1,
        snapshot,
        updatedAt: '2026-07-14T01:00:00.000Z',
      }),
      poll: vi.fn(),
      update: vi.fn((_credentials, nextSnapshot) => {
        pendingSnapshot = nextSnapshot
        return new Promise<LiveActivityRecord>(resolve => { resolveUpdate = resolve })
      }),
    } satisfies LiveActivityClient

    window.history.replaceState(null, '', `/${LIVE_ACTIVITY_HASH_PREFIX}${credentials.code}.${credentials.editToken}`)
    render(<App liveActivityClient={client} />)
    expect(await screen.findByText('Live · revision 1')).toBeVisible()

    await user.click(screen.getAllByRole('button', { name: 'Add friend' })[0])
    await user.type(screen.getByLabelText(/Friend names/), 'Sam')
    const saveButton = screen.getByRole('button', { name: 'Add friends' })
    const form = saveButton.closest('form')!
    fireEvent.submit(form)
    fireEvent.submit(form)
    await waitFor(() => expect(client.update).toHaveBeenCalledTimes(1))

    resolveUpdate({
      code: credentials.code,
      revision: 2,
      snapshot: pendingSnapshot,
      updatedAt: '2026-07-14T01:01:00.000Z',
    })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Who’s joining?' })).not.toBeInTheDocument())
    expect(screen.getByText('Sam', { selector: '.member-row b' })).toBeVisible()
    expect(screen.getByText('Live · revision 2')).toBeVisible()
  })

  it('does not resend an identical snapshot after the backend rejects it', async () => {
    const user = userEvent.setup()
    const credentials = { code: 'A1B2C3D4E5', editToken: 'a'.repeat(64) }
    const snapshot = createSharedActivity(group, [CURRENT_USER, maya, jordan], [expense()])
    const client = {
      create: vi.fn(),
      load: vi.fn().mockResolvedValue({
        code: credentials.code,
        revision: 1,
        snapshot,
        updatedAt: '2026-07-14T01:00:00.000Z',
      }),
      poll: vi.fn(),
      update: vi.fn().mockRejectedValue(new LiveActivityApiError('invalid-input', 'invalid snapshot')),
    } satisfies LiveActivityClient

    window.history.replaceState(null, '', `/${LIVE_ACTIVITY_HASH_PREFIX}${credentials.code}.${credentials.editToken}`)
    render(<App liveActivityClient={client} />)
    expect(await screen.findByText('Live · revision 1')).toBeVisible()

    await user.click(screen.getAllByRole('button', { name: 'Add friend' })[0])
    await user.type(screen.getByLabelText(/Friend names/), 'Sam')
    const saveButton = screen.getByRole('button', { name: 'Add friends' })
    await user.click(saveButton)
    await user.click(saveButton)

    expect(client.update).toHaveBeenCalledOnce()
    expect(screen.getByRole('dialog', { name: 'Who’s joining?' })).toBeVisible()
    expect(screen.getByRole('status')).toHaveTextContent('supported limit')
  })

  it('ignores an obsolete live response after the URL changes', async () => {
    const credentials = { code: 'A1B2C3D4E5', editToken: 'a'.repeat(64) }
    const snapshot = createSharedActivity(group, [CURRENT_USER, maya, jordan], [expense()])
    let resolveLoad!: (record: { code: string; revision: number; snapshot: SharedActivity; updatedAt: string }) => void
    const client = {
      create: vi.fn(),
      load: vi.fn(() => new Promise<LiveActivityRecord>(resolve => { resolveLoad = resolve })),
      poll: vi.fn(),
      update: vi.fn(),
    } satisfies LiveActivityClient
    window.history.replaceState(null, '', '/')
    render(<App liveActivityClient={client} />)

    window.history.replaceState(null, '', `/${LIVE_ACTIVITY_HASH_PREFIX}${credentials.code}.${credentials.editToken}`)
    fireEvent(window, new HashChangeEvent('hashchange'))
    expect(screen.getByLabelText('Live activity')).toBeVisible()
    window.history.replaceState(null, '', '/')
    fireEvent(window, new HashChangeEvent('hashchange'))
    resolveLoad({ code: credentials.code, revision: 1, snapshot, updatedAt: '2026-07-14T01:00:00.000Z' })
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Start your first activity' })).toBeVisible())

    let rejectLoad!: (error: Error) => void
    const rejectingClient = {
      create: vi.fn(),
      load: vi.fn(() => new Promise<LiveActivityRecord>((_resolve, reject) => { rejectLoad = reject })),
      poll: vi.fn(),
      update: vi.fn(),
    } satisfies LiveActivityClient
    const second = render(<App liveActivityClient={rejectingClient} />)
    window.history.replaceState(null, '', `/${LIVE_ACTIVITY_HASH_PREFIX}${credentials.code}.${credentials.editToken}`)
    fireEvent(window, new HashChangeEvent('hashchange'))
    second.unmount()
    rejectLoad(new LiveActivityApiError('network', 'offline'))
    await Promise.resolve()
  })
})

describe('in-app feedback integration', () => {
  it('submits feedback without navigating away or changing local activity data', async () => {
    const user = userEvent.setup()
    const submit = vi.fn().mockResolvedValue(undefined)
    const analyticsClient = { track: vi.fn() } satisfies AnalyticsClient
    render(<App analyticsClient={analyticsClient} feedbackClient={{ submit }} />)

    await user.click(screen.getByRole('button', { name: 'Send feedback' }))
    let dialog = await screen.findByRole('dialog', { name: 'What should Tally do better?' })
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog', { name: 'What should Tally do better?' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Send feedback' }))
    dialog = await screen.findByRole('dialog', { name: 'What should Tally do better?' })
    await user.type(within(dialog).getByLabelText('Add a note (optional)'), 'The empty state could explain balances better.')

    vi.useFakeTimers()
    try {
      await act(async () => {
        fireEvent.click(within(dialog).getByRole('button', { name: 'Send feedback' }))
        await Promise.resolve()
      })

      expect(submit).toHaveBeenCalledOnce()
      expect(submit).toHaveBeenCalledWith(expect.objectContaining({
        category: 'general',
        locale: 'en',
        rating: null,
        surface: 'local',
      }))
      expect(analyticsClient.track.mock.calls.filter(([event]) => event === 'feedback_submitted')).toEqual([
        ['feedback_submitted', 'local', 'en'],
      ])
      expect(screen.queryByRole('dialog', { name: 'What should Tally do better?' })).not.toBeInTheDocument()
      expect(screen.getByRole('heading', { name: 'Start your first activity' })).toBeVisible()
      expect(screen.getByRole('status')).toHaveTextContent('Thanks—your feedback was sent.')
      expect(loadState()).toEqual(EMPTY_STATE)

      act(() => vi.advanceTimersByTime(4_000))
      expect(screen.queryByText('Thanks—your feedback was sent.')).not.toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('offers a two-step rating only after a successful share and only once per release', async () => {
    const user = userEvent.setup()
    const submit = vi.fn().mockResolvedValue(undefined)
    const analyticsClient = { track: vi.fn() } satisfies AnalyticsClient
    mockSummaryDownload()
    localStorage.setItem(STORAGE_KEY, JSON.stringify(storedState({ expenses: [expense()] })))
    render(<App analyticsClient={analyticsClient} feedbackClient={{ submit }} />)

    await chooseShareAction(user, 'Export full summary')
    expect(await screen.findByLabelText('How was Tally?')).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Trip' })).toBeVisible()
    await user.click(screen.getByRole('radio', { name: 'Rate 5 out of 5' }))

    expect(submit).not.toHaveBeenCalled()
    expect(screen.getByText('Want to tell us more?')).toBeVisible()
    expect(screen.getByLabelText('How was Tally?')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Send rating only' }))

    await waitFor(() => expect(submit).toHaveBeenCalledWith({
      category: 'general',
      message: '',
      locale: 'en',
      rating: 5,
      release: LATEST_CHANGELOG_ID,
      surface: 'local',
    }))
    expect(analyticsClient.track.mock.calls.filter(([event]) => event === 'feedback_submitted')).toEqual([
      ['feedback_submitted', 'local', 'en'],
    ])
    expect(screen.queryByLabelText('How was Tally?')).not.toBeInTheDocument()
    expect(localStorage.getItem(RATING_PROMPT_STORAGE_KEY)).toBe(LATEST_CHANGELOG_ID)

    await chooseShareAction(user, 'Export full summary')
    expect(screen.queryByLabelText('How was Tally?')).not.toBeInTheDocument()
  })

  it('lets a post-share rating prompt open the full form or be dismissed', async () => {
    const user = userEvent.setup()
    mockSummaryDownload()
    localStorage.setItem(STORAGE_KEY, JSON.stringify(storedState()))
    const first = render(<App feedbackClient={{ submit: vi.fn() }} />)

    await chooseShareAction(user, 'Export full summary')
    await user.click(await screen.findByRole('radio', { name: 'Rate 4 out of 5' }))
    await user.click(await screen.findByRole('button', { name: 'Add a note' }))
    expect(await screen.findByRole('dialog', { name: 'What should Tally do better?' })).toBeVisible()
    expect(screen.getByRole('radio', { name: 'Rate 4 out of 5' })).toBeChecked()
    expect(localStorage.getItem(RATING_PROMPT_STORAGE_KEY)).toBe(LATEST_CHANGELOG_ID)

    first.unmount()
    localStorage.removeItem(RATING_PROMPT_STORAGE_KEY)
    render(<App feedbackClient={{ submit: vi.fn() }} />)
    await chooseShareAction(user, 'Export full summary')
    await user.click(await screen.findByRole('button', { name: 'Close' }))
    expect(screen.queryByLabelText('How was Tally?')).not.toBeInTheDocument()
    expect(localStorage.getItem(RATING_PROMPT_STORAGE_KEY)).toBe(LATEST_CHANGELOG_ID)
  })

  it('prompts after a native share but not after a cancelled share', async () => {
    const user = userEvent.setup()
    localStorage.setItem(STORAGE_KEY, JSON.stringify(storedState()))
    mockCanvas()
    const nativeShare = vi.fn().mockResolvedValueOnce(undefined)
    Object.defineProperty(navigator, 'share', { configurable: true, value: nativeShare })
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: vi.fn().mockReturnValue(true) })
    const first = render(<App feedbackClient={{ submit: vi.fn() }} />)

    await chooseShareAction(user, 'Export full summary')
    expect(await screen.findByLabelText('How was Tally?')).toBeVisible()
    first.unmount()

    localStorage.removeItem(RATING_PROMPT_STORAGE_KEY)
    nativeShare.mockRejectedValueOnce(new DOMException('cancelled', 'AbortError'))
    render(<App feedbackClient={{ submit: vi.fn() }} />)
    await chooseShareAction(user, 'Export full summary')
    await waitFor(() => expect(nativeShare).toHaveBeenCalledTimes(2))
    expect(screen.queryByLabelText('How was Tally?')).not.toBeInTheDocument()
  })
})
