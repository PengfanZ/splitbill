import { describe, expect, it } from 'vitest'
import { fromPaymentTimeInput, toPaymentTimeInput } from './paymentTimeInput'

describe('payment time input', () => {
  it('round-trips a stored time through the local date-and-time field', () => {
    const value = toPaymentTimeInput('2026-11-13T19:30:00.000Z')

    expect(value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
    expect(fromPaymentTimeInput(value)).toBe('2026-11-13T19:30:00.000Z')
  })

  it('shows the local wall-clock time', () => {
    const local = new Date(2026, 0, 5, 7, 4)

    expect(toPaymentTimeInput(local.toISOString())).toBe('2026-01-05T07:04')
    expect(fromPaymentTimeInput('2026-01-05T07:04')).toBe(local.toISOString())
  })

  it('treats unreadable values as empty', () => {
    expect(toPaymentTimeInput('Just now')).toBe('')
    expect(fromPaymentTimeInput('')).toBeNull()
    expect(fromPaymentTimeInput('nope')).toBeNull()
  })

  it('rejects a half-typed or far-off year', () => {
    expect(fromPaymentTimeInput('0002-11-13T19:30')).toBeNull()
    expect(fromPaymentTimeInput('1969-06-01T00:00')).toBeNull()
    expect(fromPaymentTimeInput('2101-01-01T00:00')).toBeNull()
    expect(fromPaymentTimeInput('1970-01-02T00:00')).not.toBeNull()
    expect(fromPaymentTimeInput('2100-12-30T00:00')).not.toBeNull()
  })
})
