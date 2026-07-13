import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App, {
  ActivitySummary,
  AddFriendModal,
  Avatar,
  buildShareSummary,
  CreateGroupModal,
  CURRENT_USER,
  EMPTY_STATE,
  ExpenseList,
  ExpenseModal,
  FreshStart,
  GroupDashboard,
  initialsFor,
  loadState,
  makeId,
  Member,
  MembersRail,
  ModalShell,
  money,
  parseState,
  PersistedState,
  saveState,
  SHARE_MESSAGES,
  shareActivitySummary,
  SettlementDirections,
  Sidebar,
  STORAGE_KEY,
  Topbar,
  type ActivityGroup,
  type Expense,
} from './App'

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
  Object.defineProperty(navigator, 'share', { configurable: true, value: undefined })
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined })
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})

describe('state and formatting helpers', () => {
  it('formats money, initials, and generated ids', () => {
    expect(money(-12.5)).toBe('$12.50')
    expect(initialsFor('  maya chen parker ')).toBe('MC')
    expect(initialsFor('')).toBe('?')
    vi.spyOn(Date, 'now').mockReturnValue(123)
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    expect(makeId('friend')).toBe('friend-123-i')
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

  it('shares natively and reports user cancellation', async () => {
    const nativeShare = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'share', { configurable: true, value: nativeShare })
    expect(await shareActivitySummary('Trip — Tally', 'Summary')).toBe('shared')
    expect(nativeShare).toHaveBeenCalledWith({ title: 'Trip — Tally', text: 'Summary' })

    nativeShare.mockRejectedValueOnce(new DOMException('cancelled', 'AbortError'))
    expect(await shareActivitySummary('Trip — Tally', 'Summary')).toBe('cancelled')
  })

  it('falls back from native sharing to the clipboard', async () => {
    Object.defineProperty(navigator, 'share', { configurable: true, value: vi.fn().mockRejectedValue(new Error('unavailable')) })
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    expect(await shareActivitySummary('Trip — Tally', 'Summary')).toBe('copied')
    expect(writeText).toHaveBeenCalledWith('Summary')
  })

  it('downloads a text file when sharing and copying are unavailable', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('blocked'))
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const anchor = document.createElement('a')
    const click = vi.spyOn(anchor, 'click').mockImplementation(() => {})
    vi.spyOn(document, 'createElement').mockReturnValue(anchor)
    const createObjectURL = vi.fn().mockReturnValue('blob:summary')
    const revokeObjectURL = vi.fn()
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL })

    expect(await shareActivitySummary('Trip — Tally', 'Summary')).toBe('downloaded')
    expect(anchor.download).toBe('trip-tally.txt')
    expect(click).toHaveBeenCalledOnce()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:summary')

    expect(await shareActivitySummary('!!!', 'Summary')).toBe('downloaded')
    expect(anchor.download).toBe('tally-summary.txt')
  })

  it('reports a failed export when every browser fallback is unavailable', async () => {
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => { throw new Error('blocked') }) })
    expect(await shareActivitySummary('Trip', 'Summary')).toBe('failed')
    expect(SHARE_MESSAGES.failed).toContain('Could not export')
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
    const unknownPayer = expense({ id: 'e2', title: 'Taxi', payerId: 'missing', splitMethod: 'exact' })
    const { rerender } = render(<ExpenseList expenses={[expense(), unknownPayer]} members={[CURRENT_USER, maya]} query="" onDeleteExpense={onDelete} />)
    expect(screen.getByText('2 entries')).toBeVisible()
    expect(screen.getByText((_, node) => node?.textContent === 'You paidSplit equally')).toBeVisible()
    expect(screen.getByText((_, node) => node?.textContent === 'You paidSplit by exact amounts')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Delete Dinner' }))
    expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({ title: 'Dinner' }))
    rerender(<ExpenseList expenses={[expense()]} members={[CURRENT_USER]} query="zzz" onDeleteExpense={onDelete} />)
    expect(screen.getByText('No expenses match your search.')).toBeVisible()
    rerender(<ExpenseList expenses={[]} members={[CURRENT_USER]} query="" onDeleteExpense={onDelete} />)
    expect(screen.getByText('No expenses yet. Add the first one when you’re ready.')).toBeVisible()
  })

  it('renders members and forwards rail and dashboard actions', async () => {
    const user = userEvent.setup()
    const addFriend = vi.fn()
    const addExpense = vi.fn()
    const share = vi.fn()
    const deleteExpense = vi.fn()
    const { rerender } = render(<MembersRail members={[CURRENT_USER, maya]} expenses={[expense()]} onAddFriend={addFriend} />)
    expect(screen.getByText('Friend')).toBeVisible()
    expect(screen.getByText('$30.00')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Add friend' }))
    expect(addFriend).toHaveBeenCalledOnce()

    rerender(<GroupDashboard group={group} members={[CURRENT_USER, maya, jordan]} expenses={[expense()]} query="" shareFeedback="Summary copied." onShare={share} onAddFriend={addFriend} onAddExpense={addExpense} onDeleteExpense={deleteExpense} />)
    expect(screen.getByRole('status')).toHaveTextContent('Summary copied.')
    await user.click(screen.getByRole('button', { name: 'Share summary' }))
    await user.click(screen.getAllByRole('button', { name: 'Add friend' })[0])
    await user.click(screen.getByRole('button', { name: 'Add expense' }))
    expect(addFriend).toHaveBeenCalledTimes(2)
    expect(addExpense).toHaveBeenCalledOnce()
    expect(share).toHaveBeenCalledOnce()
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
    const { container } = render(<AddFriendModal onClose={onClose} onSave={onSave} />)
    fireEvent.submit(container.querySelector('form')!)
    expect(onSave).not.toHaveBeenCalled()
    await user.type(screen.getByLabelText(/Friend names/), ' Sam, , Taylor ')
    await user.click(screen.getByRole('button', { name: 'Add friends' }))
    expect(onSave).toHaveBeenCalledWith(['Sam', 'Taylor'])
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalledOnce()
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
})

describe('complete app workflows', () => {
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
})
