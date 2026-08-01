import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ACTIVITY_IDENTITY_KEY } from '../data/activityIdentity'
import { useActivityIdentitySelections } from './useActivityIdentitySelections'

describe('useActivityIdentitySelections', () => {
  it('persists changes and synchronizes storage events', () => {
    const { result } = renderHook(() => useActivityIdentitySelections())
    act(() => result.current[1]({ 'local:trip': 'maya' }))
    expect(localStorage.getItem(ACTIVITY_IDENTITY_KEY)).toBe(JSON.stringify({ 'local:trip': 'maya' }))

    act(() => window.dispatchEvent(new StorageEvent('storage', {
      key: ACTIVITY_IDENTITY_KEY,
      newValue: JSON.stringify({ 'live:ABC': 'jordan' }),
    })))
    expect(result.current[0]).toEqual({ 'live:ABC': 'jordan' })
  })
})
