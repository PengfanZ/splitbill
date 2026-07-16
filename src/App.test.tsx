import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import type { AnalyticsClient } from './analytics'
import { Avatar, FreshStart, ModalShell, Sidebar, Topbar } from './components/AppShell'
import { IDENTITY_KEY } from './data/identity'
import { EMPTY_STATE, loadState, parseState, saveState, STORAGE_KEY } from './data/storage'
import { CURRENT_USER } from './domain/members'
import type { ActivityGroup, Expense, Member, PersistedState } from './domain/models'
import { ActivitySummary, ExpenseList, GroupDashboard, MembersRail, SettlementDirections } from './features/activity/ActivityDashboard'
import { AddFriendModal, CreateGroupModal, ExpenseModal, SettleUpModal } from './features/activity/ActivityModals'
import { LiveActivityApiError, type LiveActivityRecord } from './features/liveSharing/liveActivityApi'
import type { LiveActivityClient } from './features/liveSharing/liveActivityConfig'
import { buildLiveActivityUrl, LIVE_ACTIVITY_HASH_PREFIX } from './features/liveSharing/liveActivityLink'
import { liveActivityErrorMessage } from './features/liveSharing/useLiveActivitySession'
import { LIVE_ACTIVITY_BOOKMARKS_KEY } from './features/liveSharing/useLiveActivityBookmarks'
import { LIVE_ACTIVITY_POLL_INTERVAL_MS } from './features/liveSharing/useLiveActivityPolling'
import { buildShareSummary, createSummaryCard, exportActivitySummary, SHARE_MESSAGES, shareActivitySummary } from './features/sharing/shareActivity'
import { SharedActivityIdentityModal } from './features/sharing/SharedActivityIdentityModal'
import { createSharedActivity, encodeSharedActivity, LINK_SENDER, SHARE_HASH_PREFIX, type SharedActivity } from './features/sharing/shareActivityUrl'

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
  createdAt: 'Just now',
  ...overrides,
})

const storedState = (overrides: Partial<PersistedState> = {}): PersistedState => ({
  groups: [group],
  friends: [maya, jordan],
  expenses: [],
  selectedGroupId: group.id,
  ...overrides,
})

function incompressibleText(length: number) {
  let value = ''
  let seed = 987_654_321
  for (let index = 0; index < length; index += 1) {
    seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0
    value += String.fromCharCode(32 + (seed % 95))
  }
  return value
}

beforeEach(() => {
  vi.restoreAllMocks()
  window.history.replaceState(null, '', '/')
  localStorage.setItem(IDENTITY_KEY, JSON.stringify(CURRENT_USER))
  Object.defineProperty(navigator, 'share', { configurable: true, value: undefined })
  Object.defineProperty(navigator, 'canShare', { configurable: true, value: undefined })
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})

function mockCanvas(blob: Blob | null = new Blob(['png'], { type: 'image/png' })) {
  const context = {
    fillStyle: '',
    font: '',
    textAlign: 'left',
    fillRect: vi.fn(),
    fillText: vi.fn(),
  }
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D)
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(callback => callback(blob))
  return context
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
    expect(drawnText).toContain('+ 3 more entries')

    await createSummaryCard(group, [CURRENT_USER], [
      expense({ id: 'missing-payer', kind: 'settlement', title: 'Settlement payment', amount: 5, payerId: 'missing', splitMethod: 'exact', shares: {} }),
      expense({ id: 'missing-recipient', kind: 'settlement', title: 'Settlement payment', amount: 5, payerId: 'missing', splitMethod: 'exact', shares: { missing: 5 } }),
    ])
    drawnText = populatedContext.fillText.mock.calls.map(call => call[0])
    expect(drawnText.filter(text => text === 'Unknown paid Unknown')).toHaveLength(2)
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
    Object.defineProperty(navigator, 'share', { configurable: true, value: nativeShare })
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: canShare })
    expect(await shareActivitySummary('Trip — Tally', 'Summary', image)).toBe('shared')
    expect(canShare).toHaveBeenCalled()
    expect(nativeShare.mock.calls[0][0].files[0]).toMatchObject({ name: 'trip-tally.png', type: 'image/png' })

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

    const failingShare = vi.fn().mockRejectedValue(new Error('unavailable'))
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: vi.fn().mockReturnValue(true) })
    Object.defineProperty(navigator, 'share', { configurable: true, value: failingShare })
    expect(await shareActivitySummary('Trip', 'Summary', image)).toBe('downloaded')
    expect(click).toHaveBeenCalledTimes(4)
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
  })

  it('falls back to text after a PNG download failure and can report total failure', async () => {
    const image = new Blob(['png'], { type: 'image/png' })
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => { throw new Error('blocked') }) })
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    expect(await shareActivitySummary('Trip', 'Summary', image)).toBe('copied')
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined })
    expect(await shareActivitySummary('Trip', 'Summary', image)).toBe('failed')
    expect(SHARE_MESSAGES.failed).toContain('Could not export')
  })

  it('exports a generated PNG and falls back when card rendering fails', async () => {
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
    expect(await exportActivitySummary(group, [CURRENT_USER], [])).toBe('copied')
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
    const onDelete = vi.fn()
    const onReset = vi.fn()
    const { rerender } = render(<Sidebar groups={[]} selectedId={null} onSelect={onSelect} onCreate={onCreate} onJoin={onJoin} onDelete={onDelete} onReset={onReset} />)
    expect(screen.getByText('No activities yet.')).toBeVisible()
    expect(screen.getByRole('link', { name: 'Source & feedback' })).toHaveAttribute('href', 'https://github.com/PengfanZ/splitbill')
    expect(screen.getByRole('link', { name: 'Source & feedback' })).toHaveAttribute('target', '_blank')
    expect(screen.getByRole('link', { name: 'Source & feedback' })).toHaveAttribute('rel', 'noreferrer')
    expect(screen.queryByRole('button', { name: 'Overview' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Open navigation' }))
    await user.click(screen.getAllByRole('button', { name: 'Close navigation' })[0])
    await user.click(screen.getByRole('button', { name: 'New activity' }))
    expect(onCreate).toHaveBeenCalledOnce()
    await user.click(screen.getByRole('button', { name: 'Join activity' }))
    expect(onJoin).toHaveBeenCalledOnce()

    const home: ActivityGroup = { id: 'home', name: 'Home', emoji: '⌂', memberIds: ['me'] }
    rerender(<Sidebar groups={[home, group]} selectedId="home" onSelect={onSelect} onCreate={onCreate} onJoin={onJoin} onDelete={onDelete} onReset={onReset} />)
    expect(screen.getByText('1 person')).toBeVisible()
    expect(screen.getByText('3 people')).toBeVisible()
    rerender(<Sidebar groups={[home, group]} selectedId={null} liveActivityCodes={{ trip: 'A1B2C3D4E5' }} onSelect={onSelect} onCreate={onCreate} onJoin={onJoin} onDelete={onDelete} onReset={onReset} />)
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
    const { rerender } = render(<Topbar query="" setQuery={setQuery} />)
    expect(screen.queryByRole('button', { name: 'Notifications' })).not.toBeInTheDocument()
    await user.type(screen.getByRole('textbox', { name: 'Search expenses' }), 'din')
    expect(setQuery).toHaveBeenCalled()
    rerender(<Topbar query="din" setQuery={setQuery} />)
    await user.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(setQuery).toHaveBeenLastCalledWith('')
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
    const { rerender } = render(<MembersRail members={[CURRENT_USER, maya]} expenses={[expense()]} onAddFriend={addFriend} />)
    expect(screen.getByText('Friend')).toBeVisible()
    expect(screen.getByText('$30.00')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Add friend' }))
    expect(addFriend).toHaveBeenCalledOnce()

    rerender(<GroupDashboard group={group} members={[CURRENT_USER, maya, jordan]} expenses={[expense()]} query="" activityFeedback="Summary copied." statusLabel="Live · revision 2" shareQrLabel="Show QR" currentUserRole="Activity creator" onShare={share} onShareQr={shareQr} onShareLive={shareLive} onAddFriend={addFriend} onAddExpense={addExpense} onSettleUp={settleUp} onEditExpense={editExpense} onDeleteExpense={deleteExpense} />)
    expect(screen.getByRole('status')).toHaveTextContent('Summary copied.')
    expect(screen.getByText('Live · revision 2')).toBeVisible()
    expect(screen.getByText('Activity creator')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Show QR' }))
    await user.click(screen.getByRole('button', { name: 'Share live' }))
    await user.click(screen.getByRole('button', { name: 'Share summary' }))
    await user.click(screen.getAllByRole('button', { name: 'Add friend' })[0])
    await user.click(screen.getByRole('button', { name: 'Add expense' }))
    await user.click(screen.getAllByRole('button', { name: 'Settle up' })[0])
    await user.click(screen.getByRole('button', { name: 'Edit Dinner' }))
    expect(addFriend).toHaveBeenCalledTimes(2)
    expect(addExpense).toHaveBeenCalledOnce()
    expect(share).toHaveBeenCalledOnce()
    expect(shareQr).toHaveBeenCalledOnce()
    expect(shareLive).toHaveBeenCalledOnce()
    expect(editExpense).toHaveBeenCalledWith(expect.objectContaining({ title: 'Dinner' }))
    expect(settleUp).toHaveBeenCalledWith(expect.objectContaining({ amount: 10 }))

    rerender(<GroupDashboard group={group} members={[CURRENT_USER, maya]} expenses={[]} query="" activityFeedback={null} />)
    expect(screen.queryByRole('button', { name: 'Share QR' })).not.toBeInTheDocument()
    expect(screen.queryByText('Live · revision 2')).not.toBeInTheDocument()

    rerender(<GroupDashboard group={group} members={[CURRENT_USER, maya]} expenses={[expense()]} query="" activityFeedback={null} readOnly />)
    expect(screen.getByText('Read-only snapshot')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Share QR' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add friend' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit Dinner' })).not.toBeInTheDocument()
  })
})

describe('modals', () => {
  it('closes from its button and backdrop but not its panel', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const { container } = render(<ModalShell eyebrow="Test" title="Dialog" onClose={onClose}><button>Inside</button></ModalShell>)
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
    fireEvent.submit(container.querySelector('form')!)
    expect(onSave).not.toHaveBeenCalled()
    await user.type(screen.getByLabelText('Activity name'), '  Beach trip  ')
    await user.type(screen.getByLabelText(/Add friends/), ' Maya, , Jordan ')
    await user.click(screen.getByRole('button', { name: 'Create activity' }))
    expect(onSave).toHaveBeenCalledWith('Beach trip', ['Maya', 'Jordan'])
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('validates and submits friend names', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const onSave = vi.fn()
    const { container, rerender } = render(<AddFriendModal existingExpenseCount={0} onClose={onClose} onSave={onSave} />)
    expect(screen.queryByText('Future expenses only')).not.toBeInTheDocument()
    fireEvent.submit(container.querySelector('form')!)
    expect(onSave).not.toHaveBeenCalled()
    await user.type(screen.getByLabelText(/Friend names/), ' Sam, , Taylor ')
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
    fireEvent.submit(container.querySelector('form')!)
    expect(onSave).not.toHaveBeenCalled()
    await user.type(screen.getByLabelText('Description'), 'Lunch')
    await user.type(screen.getByLabelText('Amount'), '10')
    await user.selectOptions(screen.getByLabelText('Paid by'), 'maya')
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
    await user.selectOptions(screen.getByLabelText('Split method'), 'exact')
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
    expect(screen.getByLabelText('Paid by')).toHaveValue('maya')
    expect(screen.getByLabelText('Split method')).toHaveValue('exact')
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

  it('lets a shared-link recipient choose their participant identity', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const onSave = vi.fn()
    const { unmount } = render(<SharedActivityIdentityModal members={[LINK_SENDER, maya]} onClose={onClose} onSave={onSave} />)

    expect(screen.getByLabelText('Your participant')).toHaveValue('me')
    await user.selectOptions(screen.getByLabelText('Your participant'), maya.id)
    await user.click(screen.getByRole('button', { name: 'Save my copy' }))
    expect(onSave).toHaveBeenCalledWith(maya.id)
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalledOnce()

    unmount()
    const { container } = render(<SharedActivityIdentityModal members={[]} onClose={onClose} onSave={onSave} />)
    expect(screen.getByRole('button', { name: 'Save my copy' })).toBeDisabled()
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
    await user.selectOptions(screen.getByLabelText('Language'), 'zh-CN')

    expect(document.documentElement.lang).toBe('zh-CN')
    expect(document.title).toBe('Tally — 轻松分账')
    expect(screen.getByRole('heading', { name: '设置' })).toBeVisible()
    expect(screen.getByRole('button', { name: '保存' })).toBeVisible()
    expect(screen.getByText(/^创建于 /)).toBeVisible()
    expect(localStorage.getItem('tally:locale:v1')).toBe('zh-CN')

    await user.click(screen.getByRole('button', { name: '保存' }))
    unmount()
    render(<App />)
    expect(screen.getByRole('button', { name: '设置' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: '设置' }))
    await user.selectOptions(screen.getByLabelText('语言'), 'en')
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeVisible()
  })

  it('tracks successful local activity, expense, and settlement outcomes without payload data', async () => {
    const user = userEvent.setup()
    const analyticsClient = { track: vi.fn() } satisfies AnalyticsClient
    render(<StrictMode><App analyticsClient={analyticsClient} /></StrictMode>)

    await waitFor(() => expect(analyticsClient.track).toHaveBeenCalledWith('app_opened', 'local'))
    await user.click(screen.getByRole('button', { name: 'Create an activity' }))
    await user.type(screen.getByLabelText('Activity name'), 'Analytics trip')
    await user.type(screen.getByLabelText(/Add friends/), 'Maya')
    await user.click(screen.getByRole('button', { name: 'Create activity' }))
    await user.click(screen.getByRole('button', { name: 'Add expense' }))
    await user.type(screen.getByLabelText('Description'), 'Dinner')
    await user.type(screen.getByLabelText('Amount'), '20')
    await user.click(screen.getByRole('button', { name: 'Save expense' }))

    const direction = screen.getByText('Maya owes You').closest('.balance-row') as HTMLElement
    await user.click(within(direction).getByRole('button', { name: 'Settle up' }))
    await user.click(screen.getByRole('button', { name: 'Record payment' }))

    expect(analyticsClient.track.mock.calls).toEqual([
      ['app_opened', 'local'],
      ['activity_created', 'local'],
      ['expense_added', 'local'],
      ['settlement_recorded', 'local'],
    ])
  })

  it('creates and updates a persistent local identity', async () => {
    const user = userEvent.setup()
    localStorage.removeItem(IDENTITY_KEY)
    render(<App />)

    const onboarding = screen.getByRole('dialog', { name: 'What should we call you?' })
    expect(onboarding).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument()
    fireEvent.submit(onboarding.querySelector('form')!)
    expect(onboarding).toBeVisible()
    await user.type(screen.getByLabelText('Display name'), '  Pengfan Zhang  ')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await waitFor(() => expect(JSON.parse(localStorage.getItem(IDENTITY_KEY)!)).toMatchObject({ name: 'Pengfan Zhang', initials: 'PZ' }))

    await user.click(screen.getByRole('button', { name: 'Settings' }))
    expect(screen.getByLabelText('Display name')).toHaveValue('Pengfan Zhang')
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Settings' }))
    await user.clear(screen.getByLabelText('Display name'))
    await user.type(screen.getByLabelText('Display name'), 'Pengfan')
    await user.click(screen.getByRole('button', { name: 'Save name' }))
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

    await user.click(screen.getByRole('button', { name: 'Share QR' }))
    expect(await screen.findByRole('dialog', { name: 'Scan to open Trip' })).toBeVisible()
    await user.click(screen.getAllByRole('button', { name: 'Close' })[0])
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Join activity' }))
    expect(screen.getByRole('dialog', { name: 'Join a shared activity' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Close' }))
  })

  it('creates an activity, adds people and expenses, searches, deletes, and resets', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    render(<App />)
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

    await user.click(screen.getByRole('button', { name: 'Share summary' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Summary copied')
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('Maya pays You $15.00'))

    await user.click(screen.getByRole('button', { name: 'Share QR' }))
    expect(await screen.findByRole('dialog', { name: 'Scan to open Road trip' })).toBeVisible()
    expect(screen.getByLabelText('Road trip shared activity QR code').querySelector('svg')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Copy link' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Activity link copied')
    expect(writeText).toHaveBeenLastCalledWith(expect.stringContaining('#share='))

    const nativeShare = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'share', { configurable: true, value: nativeShare })
    await user.click(screen.getByRole('button', { name: 'Share QR' }))
    await user.click(await screen.findByRole('button', { name: 'Share link' }))
    expect(nativeShare).toHaveBeenCalledWith(expect.objectContaining({ title: 'Road trip — Tally', text: 'View Road trip in Tally.', url: expect.stringContaining('#share=') }))
    expect(await screen.findByRole('status')).toHaveTextContent('Activity link shared')

    await user.type(screen.getByRole('textbox', { name: 'Search expenses' }), 'zzz')
    expect(screen.getByText('No expenses match your search.')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Clear search' }))

    vi.mocked(window.confirm).mockReturnValueOnce(false).mockReturnValueOnce(true)
    await user.click(screen.getByRole('button', { name: 'Delete Gas' }))
    expect(screen.getByText('Gas')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Delete Gas' }))
    expect(screen.queryByText('Gas')).not.toBeInTheDocument()

    vi.mocked(window.confirm).mockReturnValueOnce(false).mockReturnValueOnce(true)
    await user.click(screen.getByRole('button', { name: 'Reset local data' }))
    expect(screen.getByRole('heading', { name: 'Road trip' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Reset local data' }))
    expect(screen.getByRole('heading', { name: 'Start your first activity' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Join from a link' }))
    expect(screen.getByRole('dialog', { name: 'Join a shared activity' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Close' }))
  })

  it('guides oversized activities to the summary fallback instead of rendering an unreliable QR code', async () => {
    const user = userEvent.setup()
    const oversizedGroup = { ...group, name: incompressibleText(4_000) }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(storedState({ groups: [oversizedGroup] })))
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'Share QR' }))
    expect(await screen.findByRole('status')).toHaveTextContent('too large for a reliable QR code')
    expect(screen.queryByText(/Scan to open/)).not.toBeInTheDocument()
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

  it('selects another activity and synchronizes matching storage events', async () => {
    const user = userEvent.setup()
    const second: ActivityGroup = { id: 'home', name: 'Home', emoji: '⌂', memberIds: ['me'] }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(storedState({ groups: [group, second] })))
    render(<App />)
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    await user.click(screen.getByRole('button', { name: 'Share summary' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Summary copied')
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

    vi.mocked(window.confirm).mockReturnValueOnce(false).mockReturnValue(true)
    await user.click(screen.getByRole('button', { name: 'Delete Cabin activity' }))
    expect(screen.getByRole('button', { name: 'Delete Cabin activity' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Delete Cabin activity' }))
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

  it('opens URL state as read-only and saves an isolated local copy explicitly', async () => {
    const user = userEvent.setup()
    const analyticsClient = { track: vi.fn() } satisfies AnalyticsClient
    const sender = { ...CURRENT_USER, name: 'Alex', initials: 'A' }
    const shared = createSharedActivity(group, [sender, maya, jordan], [expense()])
    window.history.replaceState(null, '', `/${SHARE_HASH_PREFIX}${encodeSharedActivity(shared)}`)
    const { unmount } = render(<App analyticsClient={analyticsClient} />)

    expect(screen.getByLabelText('Shared activity preview')).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Trip' })).toBeVisible()
    expect(screen.getByText('Read-only snapshot')).toBeVisible()
    expect(screen.getByText('Alex paid')).toBeVisible()
    expect(screen.getByText('Alex balance')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Add expense' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit Dinner' })).not.toBeInTheDocument()
    expect(parseState(localStorage.getItem(STORAGE_KEY)).groups).toHaveLength(0)

    await user.click(screen.getByRole('button', { name: 'Save a local copy' }))
    expect(screen.getByRole('dialog', { name: 'Who are you in this activity?' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Shared activity preview')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Save a local copy' }))
    await user.selectOptions(screen.getByLabelText('Your participant'), maya.id)
    await user.click(screen.getByRole('button', { name: 'Save my copy' }))
    expect(screen.queryByLabelText('Shared activity preview')).not.toBeInTheDocument()
    expect(window.location.hash).toBe('')
    expect(screen.getByRole('button', { name: 'Add expense' })).toBeVisible()
    expect(screen.getByText((_, node) => node?.textContent === 'Alex paidSplit equally · 3 people')).toBeVisible()
    expect(screen.getByText('You owe Alex')).toBeVisible()
    await waitFor(() => expect(parseState(localStorage.getItem(STORAGE_KEY)).groups).toHaveLength(1))
    expect(analyticsClient.track).toHaveBeenCalledWith('app_opened', 'snapshot')
    expect(analyticsClient.track).toHaveBeenCalledWith('activity_created', 'snapshot')

    unmount()
    localStorage.clear()
    window.history.replaceState(null, '', `/${SHARE_HASH_PREFIX}${encodeSharedActivity(shared)}`)
    render(<App />)
    await user.click(screen.getByRole('button', { name: 'Back to my activities' }))
    expect(screen.getByRole('heading', { name: 'Start your first activity' })).toBeVisible()
    expect(window.location.hash).toBe('')
  })

  it('updates shared previews when an open tab receives a new URL fragment', () => {
    const shared = createSharedActivity(group, [CURRENT_USER, maya, jordan], [expense()])
    render(<App />)
    expect(screen.getByRole('heading', { name: 'Start your first activity' })).toBeVisible()

    window.history.replaceState(null, '', `/${SHARE_HASH_PREFIX}${encodeSharedActivity(shared)}`)
    fireEvent(window, new HashChangeEvent('hashchange'))
    expect(screen.getByLabelText('Shared activity preview')).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Trip' })).toBeVisible()

    window.history.replaceState(null, '', '/')
    fireEvent(window, new HashChangeEvent('hashchange'))
    expect(screen.getByRole('heading', { name: 'Start your first activity' })).toBeVisible()
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

    await user.click(screen.getByRole('button', { name: 'Share live' }))
    expect(await screen.findByRole('dialog', { name: 'Scan to join Trip' })).toBeVisible()
    expect(within(screen.getByRole('dialog', { name: 'Scan to join Trip' })).getByText('Live activity · A1B2C3D4E5')).toBeVisible()
    expect(screen.getByText('Live · revision 1')).toBeVisible()
    expect(window.location.hash).toContain(`${LIVE_ACTIVITY_HASH_PREFIX}A1B2C3D4E5.`)
    expect(client.create).toHaveBeenCalledWith(expect.objectContaining({ group: expect.objectContaining({ name: 'Trip' }) }))
    expect(client.load).not.toHaveBeenCalled()
    await waitFor(() => expect(analyticsClient.track).toHaveBeenCalledWith('live_activity_opened', 'live'))
    expect(analyticsClient.track).toHaveBeenCalledWith('app_opened', 'local')
    expect(analyticsClient.track).toHaveBeenCalledWith('live_activity_created', 'local')

    const nativeShare = vi.fn().mockRejectedValueOnce(new DOMException('cancelled', 'AbortError')).mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'share', { configurable: true, value: nativeShare })
    await user.click(screen.getByRole('button', { name: 'Share link' }))
    expect(screen.getByRole('dialog', { name: 'Scan to join Trip' })).toBeVisible()
    expect(screen.getByRole('status')).toHaveTextContent('Sharing cancelled')
    await user.click(screen.getByRole('button', { name: 'Share link' }))
    expect(nativeShare).toHaveBeenLastCalledWith(expect.objectContaining({ text: 'Join Trip and edit expenses together in Tally.' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Live activity link shared')

    Object.defineProperty(navigator, 'share', { configurable: true, value: undefined })
    await user.click(screen.getByRole('button', { name: 'Show QR' }))
    await user.click(screen.getByRole('button', { name: 'Copy link' }))
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining(`${LIVE_ACTIVITY_HASH_PREFIX}A1B2C3D4E5.`))
    expect(await screen.findByRole('status')).toHaveTextContent('Live activity link copied')

    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error('blocked')) } })
    await user.click(screen.getByRole('button', { name: 'Show QR' }))
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
    expect(analyticsClient.track).toHaveBeenCalledWith('expense_added', 'live')
    await waitFor(() => expect(JSON.parse(localStorage.getItem(LIVE_ACTIVITY_BOOKMARKS_KEY)!)).toEqual({ trip: { code: 'A1B2C3D4E5', editToken: 'a'.repeat(64) } }))

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
    expect(replacementAnalyticsClient.track).not.toHaveBeenCalledWith('live_activity_opened', 'live')
    expect(replacementAnalyticsClient.track).toHaveBeenCalledWith('settlement_recorded', 'live')
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
      await act(async () => { await Promise.resolve() })
      expect(screen.getByText('Live · revision 1')).toBeVisible()
      expect(screen.queryByText('Remote taxi')).not.toBeInTheDocument()

      await act(async () => {
        await vi.advanceTimersByTimeAsync(LIVE_ACTIVITY_POLL_INTERVAL_MS)
      })
      expect(screen.getByText('Live · revision 2')).toBeVisible()
      expect(screen.getByText('Remote taxi')).toBeVisible()
      expect(screen.getByRole('status')).toHaveTextContent('New shared changes loaded automatically')

      await act(async () => {
        await vi.advanceTimersByTimeAsync(LIVE_ACTIVITY_POLL_INTERVAL_MS)
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
    expect(screen.getByText('Live · revision 1')).toBeVisible()
  })

  it('reports backend failures while creating a live activity', async () => {
    const user = userEvent.setup()
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
    render(<App liveActivityClient={client} />)

    await user.click(screen.getByRole('button', { name: 'Share live' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Could not reach the live activity service')
    await user.click(screen.getByRole('button', { name: 'Share live' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Too many live activity requests')
    await user.click(screen.getByRole('button', { name: 'Share live' }))
    expect(await screen.findByRole('status')).toHaveTextContent('could not be updated')
    await user.click(screen.getByRole('button', { name: 'Share live' }))
    expect(await screen.findByRole('status')).toHaveTextContent('could not be updated')
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
    const { unmount } = render(<App liveActivityClient={client} />)

    expect(await screen.findByLabelText('Live activity')).toBeVisible()
    expect(await screen.findByText('Live · revision 1')).toBeVisible()
    expect(screen.getByText('Activity creator')).toBeVisible()
    expect(screen.getByText('Alex balance')).toBeVisible()
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
    await waitFor(() => expect(screen.queryByText('Parking')).not.toBeInTheDocument())
    expect(screen.getByText('Live · revision 5')).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Show QR' }))
    expect(await screen.findByRole('dialog', { name: 'Scan to join Trip' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Copy link' }))
    expect(screen.getAllByRole('status').some(status => status.textContent?.includes('Anyone with it can edit'))).toBe(true)

    await user.click(screen.getByRole('button', { name: 'Share summary' }))

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
    render(<App liveActivityClient={client} />)
    expect(await screen.findByText('Live · revision 5')).toBeVisible()
    expect(window.location.hash).toContain(`${LIVE_ACTIVITY_HASH_PREFIX}${credentials.code}.`)

    await user.click(screen.getByRole('button', { name: 'Delete Trip activity' }))
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
    await user.click(screen.getByRole('button', { name: 'Share live' }))
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
    await user.click(screen.getByRole('button', { name: 'Refresh latest' }))
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
    await user.click(screen.getByRole('button', { name: 'Show QR' }))
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error('blocked')) } })
    await user.click(screen.getByRole('button', { name: 'Copy link' }))
    expect(screen.getAllByRole('status').some(status => status.textContent?.includes('Could not copy'))).toBe(true)

    client.load.mockRejectedValueOnce(new LiveActivityApiError('network', 'offline'))
    await user.click(screen.getByRole('button', { name: 'Refresh latest' }))
    expect(screen.getByRole('status')).toHaveTextContent('Could not reach the live activity service')
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
    await user.click(saveButton)
    await user.click(saveButton)
    expect(client.update).toHaveBeenCalledTimes(1)

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
