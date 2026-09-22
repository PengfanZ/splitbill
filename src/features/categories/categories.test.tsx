import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { ActivityGroup, Expense } from '../../domain/models'
import { DEFAULT_CATEGORIES } from '../../domain/categories'
import { LocalizationProvider } from '../../i18n/LocalizationContext'
import { CategoryControl } from './CategoryControl'
import { CategoryManager } from './CategoryManager'
import { CategorySummary } from './CategorySummary'

const group: ActivityGroup = { id: 'trip', name: 'Trip', emoji: '✦', memberIds: ['me'] }
const expense: Expense = { id: 'dinner', groupId: 'trip', title: 'Dinner', amount: 10, payerId: 'me', splitMethod: 'equal', shares: { me: 10 }, createdAt: '2026-09-22T12:00:00.000Z', categoryId: 'food' }

describe('category controls', () => {
  it('offers localized built-ins and permanent General', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<LocalizationProvider initialLocale="zh-CN"><CategoryControl group={group} value="food" onChange={onChange} /></LocalizationProvider>)
    await user.click(screen.getByRole('button', { name: '分类（选填）' }))
    await user.click(screen.getByRole('option', { name: '通用' }))
    expect(onChange).toHaveBeenCalledWith(null)
    await user.click(screen.getByRole('button', { name: '分类（选填）' }))
    await user.click(screen.getByRole('option', { name: '交通' }))
    expect(onChange).toHaveBeenLastCalledWith('transport')
  })
  it('renders General as default without stored metadata', () => {
    render(<CategoryControl group={group} value={null} onChange={vi.fn()} />)
    expect(screen.getByRole('button')).toHaveTextContent('General')
  })
  it('filters category totals, clears filters and opens management', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    const onManage = vi.fn()
    const { rerender } = render(<CategorySummary group={group} expenses={[expense]} selected={null} onSelect={onSelect} onManage={onManage} />)
    await user.click(screen.getByRole('button', { name: /Food & drinks/ }))
    expect(onSelect).toHaveBeenCalledWith('food')
    await user.click(screen.getByRole('button', { name: 'Manage categories' }))
    expect(onManage).toHaveBeenCalled()
    rerender(<CategorySummary group={group} expenses={[expense]} selected="food" onSelect={onSelect} />)
    await user.click(screen.getByRole('button', { name: /Food & drinks/ }))
    expect(onSelect).toHaveBeenLastCalledWith(null)
    await user.click(screen.getByRole('button', { name: 'All categories' }))
    expect(onSelect).toHaveBeenLastCalledWith(null)
    rerender(<CategorySummary group={group} expenses={[]} selected={null} onSelect={onSelect} />)
    expect(screen.getByText('Add an expense to see spending by category.')).toBeVisible()
    rerender(<CategorySummary group={group} expenses={[{ ...expense, amount: 0 }]} selected={null} onSelect={onSelect} />)
    expect(screen.getByText('$0.00')).toBeVisible()
    rerender(<CategorySummary group={group} expenses={[expense, { ...expense, id: 'second' }]} selected={null} onSelect={onSelect} />)
    expect(screen.getByText('2 expenses')).toBeVisible()
    expect(screen.getByText('$20.00')).toBeVisible()
  })
})

describe('category manager', () => {
  it('creates and validates names, selects color and keeps General protected', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn().mockResolvedValue(true)
    render(<CategoryManager group={group} expenses={[expense]} onChange={onChange} onClose={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Delete category General' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Create category' }))
    await user.click(screen.getByRole('button', { name: 'Save category' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a category name')
    await user.type(screen.getByLabelText('Category name'), 'General')
    await user.click(screen.getByRole('button', { name: 'Save category' }))
    expect(screen.getByRole('alert')).toHaveTextContent('already exists')
    await user.clear(screen.getByLabelText('Category name'))
    await user.type(screen.getByLabelText('Category name'), 'Coffee')
    await user.click(screen.getByRole('button', { name: 'Color #a78ab8' }))
    await user.click(screen.getByRole('button', { name: 'Save category' }))
    expect(onChange).toHaveBeenCalledWith({ kind: 'save', category: { id: expect.any(String), name: 'Coffee', color: '#a78ab8' } })
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Manage categories' })).toBeVisible())
  })
  it('renames, cancels, warns before deletion and reports unsuccessful saves', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn().mockResolvedValue(false)
    render(<CategoryManager group={group} expenses={[expense]} onChange={onChange} onClose={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Edit category Food & drinks' }))
    await user.clear(screen.getByLabelText('Category name'))
    await user.type(screen.getByLabelText('Category name'), 'Dining')
    await user.click(screen.getByRole('button', { name: 'Save category' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('not saved')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await user.click(screen.getByRole('button', { name: 'Delete category Food & drinks' }))
    expect(screen.getByText(/1 expenses will move to General/)).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await user.click(screen.getByRole('button', { name: 'Delete category Food & drinks' }))
    onChange.mockRejectedValueOnce(new Error('offline'))
    await user.click(screen.getByRole('button', { name: 'Delete category' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('not saved')
    onChange.mockResolvedValueOnce(true)
    await user.click(screen.getByRole('button', { name: 'Delete category' }))
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Manage categories' })).toBeVisible())
    expect(onChange).toHaveBeenLastCalledWith({ kind: 'delete', id: 'food' })
  })
  it('preserves a translated default name and prevents resurrection after remote deletion', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn().mockResolvedValue(true)
    const { rerender } = render(<LocalizationProvider initialLocale="zh-CN"><CategoryManager group={group} expenses={[]} onChange={onChange} onClose={vi.fn()} /></LocalizationProvider>)
    await user.click(screen.getByRole('button', { name: '编辑分类“餐饮”' }))
    await user.click(screen.getByRole('button', { name: '保存分类' }))
    expect(onChange).toHaveBeenCalledWith({ kind: 'save', category: DEFAULT_CATEGORIES[0] })
    await user.click(screen.getByRole('button', { name: '编辑分类“餐饮”' }))
    rerender(<LocalizationProvider initialLocale="zh-CN"><CategoryManager group={{ ...group, categories: [] }} expenses={[]} onChange={onChange} onClose={vi.fn()} /></LocalizationProvider>)
    await user.click(screen.getByRole('button', { name: '保存分类' }))
    expect(screen.getByRole('alert')).toHaveTextContent('分类未保存')
    expect(onChange).toHaveBeenCalledTimes(1)
  })
  it('limits creation and prevents closing while saving', async () => {
    const user = userEvent.setup()
    const full = { ...group, categories: Array.from({ length: 40 }, (_, index) => ({ id: `${index}`, name: `Category ${index}`, color: '#719d86' })) }
    const { rerender } = render(<CategoryManager group={full} expenses={[]} onChange={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Create category' })).toBeDisabled()
    let finish!: (value: boolean) => void
    rerender(<CategoryManager group={group} expenses={[]} onChange={() => new Promise(resolve => { finish = resolve })} onClose={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Create category' }))
    fireEvent.change(screen.getByLabelText('Category name'), { target: { value: 'Coffee' } })
    await user.click(screen.getByRole('button', { name: 'Save category' }))
    expect(screen.getByRole('button', { name: 'Save category' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull()
    finish(true)
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Manage categories' })).toBeVisible())
  })
})
