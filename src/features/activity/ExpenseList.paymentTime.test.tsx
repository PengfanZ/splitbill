import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { Expense } from '../../domain/models'
import { CURRENT_USER } from '../../domain/members'
import { ExpenseList } from './ActivityDashboard'

// Local wall-clock times, so the expectations hold in whatever zone the tests run.
const local = (day: number, hour: number, minute = 0) => new Date(2026, 10, day, hour, minute).toISOString()
const expense = (overrides: Partial<Expense>): Expense => ({
  id: 'expense',
  groupId: 'trip',
  title: 'Dinner',
  amount: 10,
  payerId: 'me',
  splitMethod: 'equal',
  shares: { me: 10 },
  createdAt: local(15, 20),
  ...overrides,
})
const list = (expenses: Expense[]) => render(<ExpenseList expenses={expenses} members={[CURRENT_USER]} query="" />)
const titles = () => [...document.querySelectorAll('.expense-entry .row-copy > b')].map(title => title.textContent)
const headings = () => screen.getAllByRole('heading', { level: 3 }).map(heading => heading.textContent)
const row = (title: string) => screen.getByText(title).closest('.expense-entry') as HTMLElement

describe('expense list payment time', () => {
  it('files a backdated expense under the day it was paid and notes when it was added', () => {
    list([expense({ paidAt: local(13, 19, 30) })])

    expect(headings()).toEqual([expect.stringContaining('Nov 13')])
    expect(row('Dinner').querySelector('time')).toHaveAttribute('datetime', local(13, 19, 30))
    expect(row('Dinner').querySelector('time')).toHaveTextContent(/7:30/)
    expect(row('Dinner').querySelector('.expense-time-note')).toHaveTextContent(/^added .*Nov 15/)
    expect(row('Dinner').title).toMatch(/^Paid .*Nov 13.* · Created .*Nov 15/)
  })

  it('groups a late-night payment under its local day', () => {
    list([expense({ createdAt: local(13, 23, 30) })])

    expect(headings()).toEqual([expect.stringContaining('Nov 13')])
  })

  it('orders a day by latest payment and keeps the saved order for ties', () => {
    list([
      expense({ id: 'a', title: 'Coffee', paidAt: local(13, 9) }),
      expense({ id: 'b', title: 'Tie one', paidAt: local(13, 12) }),
      expense({ id: 'c', title: 'Tie two', paidAt: local(13, 12) }),
      expense({ id: 'd', title: 'Izakaya', createdAt: local(13, 19, 30) }),
    ])

    expect(headings()).toHaveLength(1)
    expect(titles()).toEqual(['Izakaya', 'Tie one', 'Tie two', 'Coffee'])
  })

  it('shows when an expense was edited in place of the Edited badge', () => {
    list([expense({ createdAt: local(13, 14, 10), updatedAt: local(14, 9) })])

    expect(row('Dinner').querySelector('.expense-time-note')).toHaveTextContent(/^edited .*Nov 14/)
    expect(document.querySelector('.expense-edited')).toBeNull()
    expect(within(row('Dinner')).queryByText('Edited')).toBeNull()
    expect(row('Dinner').title).toMatch(/^Paid .*Nov 13.* · Edited .*Nov 14/)
  })

  it('shows only the payment time for an expense entered the day it was paid', () => {
    list([expense({})])

    expect(row('Dinner').querySelector('time')).toHaveTextContent(/8:00/)
    expect(row('Dinner').querySelector('.expense-time-note')).toBeNull()
  })

  it('skips the note when an edit time is unreadable', () => {
    list([expense({ updatedAt: 'Just now' })])

    expect(row('Dinner').querySelector('time')).not.toBeNull()
    expect(row('Dinner').querySelector('.expense-time-note')).toBeNull()
  })

  it('shows a time on recorded payments too', () => {
    list([expense({ kind: 'settlement', splitMethod: 'exact', payerId: 'maya', shares: { me: 10 }, paidAt: local(13, 19, 30) })])

    expect(document.querySelector('.settlement-payment-row time')).toHaveTextContent(/7:30/)
  })

  it('shows no time for an expense whose time was never recorded', () => {
    list([expense({ createdAt: 'Just now' })])

    expect(headings()).toEqual(['Date not recorded'])
    expect(row('Dinner').querySelector('time')).toBeNull()
    expect(row('Dinner').title).toBe('Time not recorded')
  })
})
