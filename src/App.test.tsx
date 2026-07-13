import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { Avatar, FreshStart, ModalShell, Sidebar, Topbar } from './components/AppShell'
import { IDENTITY_KEY } from './data/identity'
import { EMPTY_STATE, loadState, parseState, saveState, STORAGE_KEY } from './data/storage'
import { CURRENT_USER } from './domain/members'
import type { ActivityGroup, Expense, Member, PersistedState } from './domain/models'
import { ActivitySummary, ExpenseList, GroupDashboard, MembersRail, SettlementDirections } from './features/activity/ActivityDashboard'
import { AddFriendModal, CreateGroupModal, ExpenseModal } from './features/activity/ActivityModals'
import { buildShareSummary, createSummaryCard, exportActivitySummary, SHARE_MESSAGES, shareActivitySummary } from './features/sharing/shareActivity'
import { SharedActivityIdentityModal } from './features/sharing/SharedActivityIdentityModal'
import { createSharedActivity, encodeSharedActivity, LINK_SENDER, SHARE_HASH_PREFIX } from './features/sharing/shareActivityUrl'

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
    expect(empty).toContain('• Everyone is settled.')

    const populated = buildShareSummary(group, [CURRENT_USER, maya, jordan], [
      expense(),
      expense({ id: 'e2', title: 'Taxi', amount: 15, payerId: 'missing', splitMethod: 'exact', shares: {} }),
    ])
    expect(populated).toContain('Dinner — $30.00, paid by You (split equally)')
    expect(populated).toContain('Taxi — $15.00, paid by Unknown (exact split)')
    expect(populated).toContain('Maya Chen pays You $10.00')
    expect(populated).toContain('Jordan pays You $10.00')
  })

  it('renders populated and empty PNG cards', async () => {
    const context = mockCanvas()
    const card = await createSummaryCard(group, [CURRENT_USER], [])
    expect(card.type).toBe('image/png')
    let drawnText = context.fillText.mock.calls.map(call => call[0])
    expect(drawnText).toContain('1 person sharing expenses')
    expect(drawnText).toContain('Everyone is settled')
    expect(drawnText).toContain('No expenses yet.')
    await createSummaryCard(group, [CURRENT_USER, maya, jordan], [expense()])

    vi.restoreAllMocks()
    const populatedContext = mockCanvas()
    const manyExpenses = [
      expense(),
      expense({ id: 'e2', title: 'Taxi', payerId: 'missing', splitMethod: 'exact', shares: {} }),
      ...Array.from({ length: 5 }, (_, index) => expense({ id: `extra-${index}`, title: `Extra ${index}`, payerId: 'missing', shares: {} })),
    ]
    await createSummaryCard(group, [CURRENT_USER, maya, jordan], manyExpenses)
    drawnText = populatedContext.fillText.mock.calls.map(call => call[0])
    expect(drawnText).toContain('3 people sharing expenses')
    expect(drawnText).toContain('Maya Chen pays You')
    expect(drawnText).toContain('Unknown paid · Exact split')
    expect(drawnText).toContain('+ 2 more expenses')
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

  it('supports sidebar navigation, creation, reset, and mobile controls', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    const onCreate = vi.fn()
    const onReset = vi.fn()
    const { rerender } = render(<Sidebar groups={[]} selectedId={null} onSelect={onSelect} onCreate={onCreate} onReset={onReset} />)
    expect(screen.getByText('No activities yet.')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Open navigation' }))
    await user.click(screen.getByRole('button', { name: 'Activity' }))
    await user.click(screen.getByRole('button', { name: 'Open navigation' }))
    await user.click(screen.getAllByRole('button', { name: 'Close navigation' })[0])
    await user.click(screen.getByRole('button', { name: 'New activity' }))
    expect(onCreate).toHaveBeenCalledOnce()

    const home: ActivityGroup = { id: 'home', name: 'Home', emoji: '⌂', memberIds: ['me'] }
    rerender(<Sidebar groups={[home, group]} selectedId="home" onSelect={onSelect} onCreate={onCreate} onReset={onReset} />)
    expect(screen.getByText('1 person')).toBeVisible()
    expect(screen.getByText('3 people')).toBeVisible()
    await user.click(screen.getByRole('button', { name: /Trip/ }))
    expect(onSelect).toHaveBeenCalledWith('trip')
    await user.click(screen.getByRole('button', { name: 'Reset local data' }))
    expect(onReset).toHaveBeenCalledOnce()
    await user.click(screen.getByRole('button', { name: 'Open navigation' }))
    await user.click(screen.getAllByRole('button', { name: 'Close navigation' })[1])
  })

  it('updates and clears the topbar search', async () => {
    const user = userEvent.setup()
    const setQuery = vi.fn()
    const { rerender } = render(<Topbar query="" setQuery={setQuery} />)
    await user.type(screen.getByRole('textbox', { name: 'Search expenses' }), 'din')
    expect(setQuery).toHaveBeenCalled()
    rerender(<Topbar query="din" setQuery={setQuery} />)
    await user.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(setQuery).toHaveBeenLastCalledWith('')
  })

  it('renders the fresh start and runs its action', async () => {
    const user = userEvent.setup()
    const onCreate = vi.fn()
    render(<FreshStart onCreate={onCreate} />)
    await user.click(screen.getByRole('button', { name: 'Create an activity' }))
    expect(onCreate).toHaveBeenCalledOnce()
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
  })

  it('renders members and forwards rail and dashboard actions', async () => {
    const user = userEvent.setup()
    const addFriend = vi.fn()
    const addExpense = vi.fn()
    const share = vi.fn()
    const shareLink = vi.fn()
    const editExpense = vi.fn()
    const deleteExpense = vi.fn()
    const { rerender } = render(<MembersRail members={[CURRENT_USER, maya]} expenses={[expense()]} onAddFriend={addFriend} />)
    expect(screen.getByText('Friend')).toBeVisible()
    expect(screen.getByText('$30.00')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Add friend' }))
    expect(addFriend).toHaveBeenCalledOnce()

    rerender(<GroupDashboard group={group} members={[CURRENT_USER, maya, jordan]} expenses={[expense()]} query="" activityFeedback="Summary copied." onShare={share} onShareLink={shareLink} onAddFriend={addFriend} onAddExpense={addExpense} onEditExpense={editExpense} onDeleteExpense={deleteExpense} />)
    expect(screen.getByRole('status')).toHaveTextContent('Summary copied.')
    await user.click(screen.getByRole('button', { name: 'Share link' }))
    await user.click(screen.getByRole('button', { name: 'Share summary' }))
    await user.click(screen.getAllByRole('button', { name: 'Add friend' })[0])
    await user.click(screen.getByRole('button', { name: 'Add expense' }))
    await user.click(screen.getByRole('button', { name: 'Edit Dinner' }))
    expect(addFriend).toHaveBeenCalledTimes(2)
    expect(addExpense).toHaveBeenCalledOnce()
    expect(share).toHaveBeenCalledOnce()
    expect(shareLink).toHaveBeenCalledOnce()
    expect(editExpense).toHaveBeenCalledWith(expect.objectContaining({ title: 'Dinner' }))

    rerender(<GroupDashboard group={group} members={[CURRENT_USER, maya]} expenses={[expense()]} query="" activityFeedback={null} readOnly />)
    expect(screen.getByText('Read-only snapshot')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Share link' })).not.toBeInTheDocument()
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

  it('creates equal splits down to the cent and supports any payer', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    const onClose = vi.fn()
    const { container } = render(<ExpenseModal group={group} members={[CURRENT_USER, maya, jordan]} onClose={onClose} onSave={onSave} />)
    fireEvent.submit(container.querySelector('form')!)
    expect(onSave).not.toHaveBeenCalled()
    await user.type(screen.getByLabelText('Description'), 'Lunch')
    await user.type(screen.getByLabelText('Amount'), '10')
    await user.selectOptions(screen.getByLabelText('Paid by'), 'maya')
    expect(screen.getByText('$3.33')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Save expense' }))
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Lunch',
      amount: 10,
      payerId: 'maya',
      shares: { me: 3.34, maya: 3.33, jordan: 3.33 },
    }))
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
    })
  })

  it('handles an empty member list in the equal preview', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(<ExpenseModal group={group} members={[]} onClose={vi.fn()} onSave={onSave} />)
    expect(screen.getByText('$0.00')).toBeVisible()
    await user.type(screen.getByLabelText('Description'), 'Fee')
    await user.type(screen.getByLabelText('Amount'), '1')
    await user.click(screen.getByRole('button', { name: 'Save expense' }))
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ shares: {} }))
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

    await user.click(screen.getByRole('button', { name: 'Share summary' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Summary copied')
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('Maya pays You $10.00'))

    await user.click(screen.getByRole('button', { name: 'Share link' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Activity link copied')
    expect(writeText).toHaveBeenLastCalledWith(expect.stringContaining('#share='))

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
    await user.click(screen.getByRole('button', { name: /Home/ }))
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
    const sender = { ...CURRENT_USER, name: 'Alex', initials: 'A' }
    const shared = createSharedActivity(group, [sender, maya, jordan], [expense()])
    window.history.replaceState(null, '', `/${SHARE_HASH_PREFIX}${encodeSharedActivity(shared)}`)
    const { unmount } = render(<App />)

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
})
