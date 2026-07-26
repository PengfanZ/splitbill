import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CURRENT_USER } from '../../domain/members'
import { createSharedActivity } from '../sharing/shareActivityUrl'
import {
  LIVE_ACTIVITY_MIRRORS_KEY,
  LIVE_ACTIVITY_TTL_MS,
  createLiveActivityMirror,
  findLiveActivityMirrorGroupId,
  loadLiveActivityMirrors,
  parseLiveActivityMirrors,
  saveLiveActivityMirrors,
  useLiveActivityMirrors,
} from './useLiveActivityMirrors'

const record = {
  code: 'A1B2C3D4E5',
  revision: 3,
  snapshot: createSharedActivity(
    { id: 'trip', name: 'Trip', emoji: '✦', memberIds: ['me'] },
    [CURRENT_USER],
    [],
  ),
  updatedAt: '2026-07-14T01:00:00.000Z',
}
const mirror = createLiveActivityMirror(record)

function MirrorHarness() {
  const [mirrors, setMirrors] = useLiveActivityMirrors()
  return (
    <>
      <output aria-label="Mirrors">{JSON.stringify(mirrors)}</output>
      <button onClick={() => setMirrors({ trip: mirror })}>Save mirror</button>
    </>
  )
}

beforeEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
})

describe('live activity mirrors', () => {
  it('builds a rolling 90-day expiry and finds a mirror by activity code', () => {
    expect(Date.parse(mirror.expiresAt) - Date.parse(record.updatedAt)).toBe(LIVE_ACTIVITY_TTL_MS)
    expect(findLiveActivityMirrorGroupId({ trip: mirror }, record.code)).toBe('trip')
    expect(findLiveActivityMirrorGroupId({ trip: mirror }, 'B1B2C3D4E5')).toBeNull()
  })

  it('parses only complete, valid snapshots with an untampered expiry', () => {
    expect(parseLiveActivityMirrors(null)).toEqual({})
    expect(parseLiveActivityMirrors('{')).toEqual({})
    expect(parseLiveActivityMirrors('[]')).toEqual({})
    expect(parseLiveActivityMirrors(JSON.stringify({
      trip: mirror,
      nullMirror: null,
      arrayMirror: [],
      missingCode: { ...mirror, code: undefined },
      invalidCode: { ...mirror, code: 'bad' },
      decimalRevision: { ...mirror, revision: 1.5 },
      missingRevision: { ...mirror, revision: undefined },
      invalidRevision: { ...mirror, revision: 0 },
      missingUpdatedAt: { ...mirror, updatedAt: undefined },
      invalidUpdatedAt: { ...mirror, updatedAt: 'not-a-date' },
      missingExpiresAt: { ...mirror, expiresAt: undefined },
      invalidExpiryDate: { ...mirror, expiresAt: 'not-a-date' },
      invalidExpiry: { ...mirror, expiresAt: record.updatedAt },
      invalidSnapshot: { ...mirror, snapshot: {} },
      '': mirror,
    }))).toEqual({ trip: mirror })
  })

  it('loads and saves mirrors defensively', () => {
    localStorage.setItem(LIVE_ACTIVITY_MIRRORS_KEY, JSON.stringify({ trip: mirror }))
    expect(loadLiveActivityMirrors()).toEqual({ trip: mirror })

    const setItem = vi.spyOn(localStorage, 'setItem')
    saveLiveActivityMirrors({ trip: mirror })
    expect(setItem).not.toHaveBeenCalled()
    saveLiveActivityMirrors({ cabin: mirror })
    expect(setItem).toHaveBeenCalledOnce()

    setItem.mockImplementation(() => { throw new Error('blocked') })
    expect(() => saveLiveActivityMirrors({})).not.toThrow()
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    expect(loadLiveActivityMirrors()).toEqual({})
  })

  it('persists hook updates and synchronizes matching storage events', async () => {
    const user = userEvent.setup()
    render(<MirrorHarness />)
    expect(screen.getByLabelText('Mirrors')).toHaveTextContent('{}')

    await user.click(screen.getByRole('button', { name: 'Save mirror' }))
    await waitFor(() => expect(JSON.parse(localStorage.getItem(LIVE_ACTIVITY_MIRRORS_KEY)!)).toEqual({ trip: mirror }))

    fireEvent(window, new StorageEvent('storage', { key: 'other', newValue: null }))
    expect(screen.getByLabelText('Mirrors')).toHaveTextContent('trip')
    fireEvent(window, new StorageEvent('storage', {
      key: LIVE_ACTIVITY_MIRRORS_KEY,
      newValue: JSON.stringify({ cabin: mirror }),
    }))
    expect(JSON.parse(screen.getByLabelText('Mirrors').textContent ?? '{}')).toEqual({ cabin: mirror })
  })
})
