import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import App from './App'
import { IDENTITY_KEY } from './data/identity'
import { STORAGE_KEY } from './data/storage'
import { CHANGELOG_SEEN_STORAGE_KEY, LATEST_CHANGELOG_ID } from './features/changelog/changelog'
import { ExpenseModal } from './features/activity/ActivityModals'
import { CURRENT_USER } from './domain/members'
import type { Expense } from './domain/models'
import { createSharedActivity } from './features/sharing/sharedActivity'
import { buildLiveActivityUrl } from './features/liveSharing/liveActivityLink'
import type { LiveActivityClient } from './features/liveSharing/liveActivityConfig'

const group = { id: 'trip', name: 'Kyoto weekend', emoji: '✦', memberIds: ['me'] }
const expense: Expense = { id: 'dinner', groupId: 'trip', title: 'Dinner', amount: 10, payerId: 'me', splitMethod: 'equal', shares: { me: 10 }, createdAt: '2026-09-22T12:00:00.000Z' }
beforeEach(() => {
  window.history.replaceState(null, '', '/')
  localStorage.setItem(IDENTITY_KEY, JSON.stringify(CURRENT_USER))
  localStorage.setItem(CHANGELOG_SEEN_STORAGE_KEY, LATEST_CHANGELOG_ID)
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ groups: [group], friends: [], expenses: [expense], selectedGroupId: group.id }))
})
afterEach(() => window.history.replaceState(null, '', '/'))

it('saves category changes through the live revisioned API without changing expenses', async () => {
  const user = userEvent.setup()
  const credentials = { code: 'A1B2C3D4E5', editToken: 'a'.repeat(64) }
  const snapshot = createSharedActivity(group, [CURRENT_USER], [expense])
  const client = {
    create: vi.fn(),
    load: vi.fn().mockResolvedValue({ code: credentials.code, revision: 1, snapshot, updatedAt: '2026-09-22T12:00:00.000Z' }),
    poll: vi.fn(),
    update: vi.fn<LiveActivityClient['update']>().mockImplementation(async (_credentials, next, revision) => ({ code: credentials.code, revision: revision + 1, snapshot: next, updatedAt: '2026-09-22T12:01:00.000Z' })),
  } satisfies LiveActivityClient
  const track = vi.fn()
  render(<App liveActivityClient={client} analyticsClient={{ track }} />)
  await user.click(screen.getByRole('button', { name: 'Join activity' }))
  await user.type(screen.getByLabelText('Shared activity link'), buildLiveActivityUrl(credentials, 'https://example.com/'))
  await user.click(screen.getByRole('button', { name: 'Open activity' }))
  expect(await screen.findByText('Live · revision 1')).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Activity options' }))
  await user.click(screen.getByRole('button', { name: 'Manage categories' }))
  await user.click(screen.getByRole('button', { name: 'Create category' }))
  await user.type(screen.getByLabelText('Category name'), 'Shared meals')
  await user.click(screen.getByRole('button', { name: 'Save category' }))
  await waitFor(() => expect(client.update).toHaveBeenCalledOnce())
  expect(client.update.mock.calls[0][1].expenses).toEqual(snapshot.expenses)
  expect(client.update.mock.calls[0][1].group.categories).toContainEqual(expect.objectContaining({ name: 'Shared meals' }))
  expect(await screen.findByText('Live · revision 2')).toBeVisible()
  expect(track).toHaveBeenCalledWith('category_created', 'live', 'en')
  await user.click(screen.getByRole('button', { name: 'Close' }))
  await user.click(screen.getByRole('tab', { name: 'By category' }))
  expect(track).toHaveBeenCalledWith('category_summary_opened', 'live', 'en')
  await user.click(screen.getByRole('button', { name: 'Manage categories' }))
  await user.click(screen.getByRole('button', { name: 'Edit category Shared meals' }))
  client.update.mockRejectedValue(new Error('offline'))
  await user.click(screen.getByRole('button', { name: 'Save category' }))
  await waitFor(() => expect(screen.getByRole('alert')).toBeVisible())
  expect(track.mock.calls.filter(([event]) => event === 'category_updated')).toHaveLength(0)
})

it('persists categories and assignment, then deletes the category without changing the bill', async () => {
  const user = userEvent.setup()
  const track = vi.fn()
  render(<App analyticsClient={{ track }} />)
  await user.click(screen.getByRole('button', { name: 'Activity options' }))
  await user.click(screen.getByRole('button', { name: 'Manage categories' }))
  await user.click(screen.getByRole('button', { name: 'Create category' }))
  await user.type(screen.getByLabelText('Category name'), 'Coffee')
  await user.click(screen.getByRole('button', { name: 'Save category' }))
  await waitFor(() => expect(screen.getByRole('heading', { name: 'Manage categories' })).toBeVisible())
  await user.click(screen.getByRole('button', { name: 'Edit category Coffee' }))
  await user.click(screen.getByRole('button', { name: 'Save category' }))
  await user.click(screen.getByRole('button', { name: 'Close' }))
  await user.click(screen.getByRole('button', { name: 'Edit Dinner' }))
  await user.click(screen.getByRole('button', { name: 'Category (optional)' }))
  await user.click(screen.getByRole('option', { name: 'General' }))
  await user.click(screen.getByRole('button', { name: 'Category (optional)' }))
  await user.click(screen.getByRole('option', { name: 'Coffee' }))
  await user.click(screen.getByRole('button', { name: 'Save changes' }))
  await user.click(screen.getByRole('tab', { name: 'By category' }))
  await user.click(screen.getByRole('tab', { name: 'By category' }))
  await user.click(screen.getByRole('button', { name: /Coffee.*1 expense/ }))
  await user.click(screen.getByRole('button', { name: 'Manage categories' }))
  await user.click(screen.getByRole('button', { name: 'Delete category Coffee' }))
  await user.click(screen.getByRole('button', { name: 'Delete category' }))
  await waitFor(() => expect(screen.getByRole('heading', { name: 'Manage categories' })).toBeVisible())
  await user.click(screen.getByRole('button', { name: 'Close' }))
  const state = JSON.parse(localStorage.getItem(STORAGE_KEY)!)
  expect(state.expenses[0]).toMatchObject({ ...expense, categoryId: null })
  expect(state.groups[0].categories.some((category: { name: string }) => category.name === 'Coffee')).toBe(false)
  expect(screen.getByText('Dinner')).toBeVisible()
  await user.click(screen.getByRole('tab', { name: 'Expenses' }))
  expect(screen.getByRole('heading', { name: 'Who owes whom' })).toBeVisible()
  expect(track.mock.calls.filter(([event]) => event.startsWith('category_'))).toEqual([
    ['category_created', 'local', 'en'], ['category_updated', 'local', 'en'],
    ['category_selected', 'local', 'en'], ['category_summary_opened', 'local', 'en'],
    ['category_deleted', 'local', 'en'],
  ])
})

it('requires review if a category disappears while editing and preserves the unsaved form through management', async () => {
  const user = userEvent.setup()
  const onSave = vi.fn()
  const props = { members: [CURRENT_USER], expense: { ...expense, categoryId: 'food' }, onClose: vi.fn(), onSave, onCategoriesChange: vi.fn().mockResolvedValue(true) }
  const { rerender } = render(<ExpenseModal {...props} group={group} />)
  await user.clear(screen.getByLabelText('Description'))
  await user.type(screen.getByLabelText('Description'), 'Changed dinner')
  await user.click(screen.getByRole('button', { name: 'Category (optional)' }))
  await user.click(screen.getByRole('button', { name: 'Manage categories' }))
  await user.click(screen.getByRole('button', { name: 'Close' }))
  expect(screen.getByLabelText('Description')).toHaveValue('Changed dinner')
  rerender(<ExpenseModal {...props} group={{ ...group, categories: [] }} />)
  expect(screen.getByRole('alert')).toHaveTextContent('This category was removed')
  expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled()
  await user.click(screen.getByRole('button', { name: 'Use General' }))
  await user.click(screen.getByRole('button', { name: 'Save changes' }))
  expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ title: 'Changed dinner', amount: 10, shares: { me: 10 }, categoryId: null }))
})

it('suggests a category from a new expense description without counting it as a person’s choice', async () => {
  const user = userEvent.setup()
  const onSave = vi.fn()
  const onCategorySelect = vi.fn()
  const props = { group, members: [CURRENT_USER], onClose: vi.fn(), onSave, onCategorySelect }
  const { unmount } = render(<ExpenseModal {...props} />)
  expect(screen.queryByText(/Suggested from the description/)).toBeNull()
  await user.type(screen.getByLabelText('Description'), 'Taxi to the airport')
  expect(screen.getByRole('button', { name: 'Category (optional)' })).toHaveTextContent('Transport')
  expect(screen.getByText('Suggested from the description. Change it any time.')).toBeVisible()
  await user.type(screen.getByLabelText('Amount'), '24')
  await user.click(screen.getByRole('button', { name: 'Save expense' }))
  expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Taxi to the airport', categoryId: 'transport' }), 'kept')
  expect(onCategorySelect).not.toHaveBeenCalled()
  unmount()

  render(<ExpenseModal {...props} />)
  await user.type(screen.getByLabelText('Description'), 'Dinner')
  expect(screen.getByRole('button', { name: 'Category (optional)' })).toHaveTextContent('Food & drinks')
  await user.click(screen.getByRole('button', { name: 'Category (optional)' }))
  await user.click(screen.getByRole('option', { name: 'Stay' }))
  expect(onCategorySelect).toHaveBeenCalledOnce()
  expect(screen.queryByText(/Suggested from the description/)).toBeNull()
  // A later edit to the description no longer overrides the person's choice.
  await user.type(screen.getByLabelText('Description'), ' and taxi')
  expect(screen.getByRole('button', { name: 'Category (optional)' })).toHaveTextContent('Stay')
  await user.type(screen.getByLabelText('Amount'), '40')
  await user.click(screen.getByRole('button', { name: 'Save expense' }))
  expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ categoryId: 'stay' }), 'changed')
  await user.click(screen.getByRole('button', { name: 'Category (optional)' }))
  await user.click(screen.getByRole('option', { name: 'Food & drinks' }))
  await user.click(screen.getByRole('button', { name: 'Save expense' }))
  expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ categoryId: 'food' }), 'kept')
})

it('leaves expenses without a keyword, and chosen categories without a suggestion, unreported', async () => {
  const user = userEvent.setup()
  const onSave = vi.fn()
  const props = { group, members: [CURRENT_USER], onClose: vi.fn(), onSave }
  const { unmount } = render(<ExpenseModal {...props} />)
  await user.type(screen.getByLabelText('Description'), 'Pastéis de nata')
  expect(screen.getByRole('button', { name: 'Category (optional)' })).toHaveTextContent('General')
  await user.type(screen.getByLabelText('Amount'), '9')
  await user.click(screen.getByRole('button', { name: 'Save expense' }))
  expect(onSave.mock.lastCall).toHaveLength(1)
  expect(onSave.mock.lastCall![0]).not.toHaveProperty('categoryId')
  await user.click(screen.getByRole('button', { name: 'Category (optional)' }))
  await user.click(screen.getByRole('option', { name: 'Activities' }))
  await user.click(screen.getByRole('button', { name: 'Save expense' }))
  expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ categoryId: 'activities' }))
  unmount()

  render(<ExpenseModal {...props} expense={expense} />)
  expect(screen.getByRole('button', { name: 'Category (optional)' })).toHaveTextContent('General')
  await user.click(screen.getByRole('button', { name: 'Save changes' }))
  expect(onSave).toHaveBeenLastCalledWith(expect.not.objectContaining({ categoryId: expect.anything() }))
})

it('records the suggestion outcome only after a new expense saves', async () => {
  const user = userEvent.setup()
  const track = vi.fn()
  render(<App analyticsClient={{ track }} />)
  await user.click(screen.getByRole('button', { name: 'Add expense' }))
  await user.type(screen.getByLabelText('Description'), 'Hotel')
  await user.type(screen.getByLabelText('Amount'), '120')
  await user.click(screen.getByRole('button', { name: 'Save expense' }))
  await waitFor(() => expect(track).toHaveBeenCalledWith('category_suggestion_kept', 'local', 'en'))
  expect(track.mock.calls.map(([event]) => event)).not.toContain('category_selected')
  expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).expenses[0]).toMatchObject({ title: 'Hotel', categoryId: 'stay' })
})

it('records a live suggestion outcome after the revision is accepted, and none when the save fails', async () => {
  const user = userEvent.setup()
  const credentials = { code: 'A1B2C3D4E5', editToken: 'a'.repeat(64) }
  const snapshot = createSharedActivity(group, [CURRENT_USER], [expense])
  const client = {
    create: vi.fn(),
    load: vi.fn().mockResolvedValue({ code: credentials.code, revision: 1, snapshot, updatedAt: '2026-09-22T12:00:00.000Z' }),
    poll: vi.fn(),
    update: vi.fn<LiveActivityClient['update']>().mockImplementation(async (_credentials, next, revision) => ({ code: credentials.code, revision: revision + 1, snapshot: next, updatedAt: '2026-09-22T12:01:00.000Z' })),
  } satisfies LiveActivityClient
  const track = vi.fn()
  render(<App liveActivityClient={client} analyticsClient={{ track }} />)
  await user.click(screen.getByRole('button', { name: 'Join activity' }))
  await user.type(screen.getByLabelText('Shared activity link'), buildLiveActivityUrl(credentials, 'https://example.com/'))
  await user.click(screen.getByRole('button', { name: 'Open activity' }))
  expect(await screen.findByText('Live · revision 1')).toBeVisible()
  const addTaxi = async () => {
    await user.click(screen.getByRole('button', { name: 'Add expense' }))
    await user.type(screen.getByLabelText('Description'), 'Taxi')
    await user.type(screen.getByLabelText('Amount'), '18')
    await user.click(screen.getByRole('button', { name: 'Save expense' }))
  }
  client.update.mockRejectedValueOnce(new Error('offline'))
  await addTaxi()
  await waitFor(() => expect(client.update).toHaveBeenCalledOnce())
  expect(track.mock.calls.map(([event]) => event)).not.toContain('category_suggestion_kept')
  await user.click(screen.getByRole('button', { name: 'Save expense' }))
  await waitFor(() => expect(track).toHaveBeenCalledWith('category_suggestion_kept', 'live', 'en'))
  expect(client.update.mock.lastCall![1].expenses[0]).toMatchObject({ title: 'Taxi', categoryId: 'transport' })
})
