import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ActivityCurrencyControl } from './ActivityCurrencyControl'

describe('ActivityCurrencyControl', () => {
  it('opens a polished menu, marks the current currency, and selects another one', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<ActivityCurrencyControl currency="USD" locale="en" readOnly={false} onChange={onChange} />)

    const trigger = screen.getByRole('button', { name: 'Activity currency, USD' })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await user.click(trigger)

    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('listbox', { name: 'Choose activity currency' })).toBeVisible()
    expect(screen.getAllByRole('option')).toHaveLength(15)
    expect(screen.getByRole('option', { name: 'USD' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('option', { name: 'EUR' })).toHaveAttribute('aria-selected', 'false')

    await user.click(screen.getByRole('option', { name: 'EUR' }))
    expect(onChange).toHaveBeenCalledWith('EUR')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('toggles, closes outside, and supports Escape without reacting to other keys', async () => {
    const user = userEvent.setup()
    render(<ActivityCurrencyControl currency="USD" locale="en" readOnly={false} onChange={vi.fn()} />)
    const trigger = screen.getByRole('button', { name: 'Activity currency, USD' })

    await user.click(trigger)
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    expect(screen.getByRole('listbox')).toBeVisible()
    fireEvent.keyDown(trigger, { key: 'Escape' })
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()

    await user.click(trigger)
    await user.click(trigger)
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()

    await user.click(trigger)
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('renders a non-interactive value without a change handler or in read-only mode', () => {
    const { rerender } = render(<ActivityCurrencyControl currency="CNY" locale="zh-CN" readOnly={false} />)
    expect(screen.getByText('CNY · ¥')).toBeVisible()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()

    rerender(<ActivityCurrencyControl currency="USD" locale="en" readOnly onChange={vi.fn()} />)
    expect(screen.getByText('USD · $')).toBeVisible()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
