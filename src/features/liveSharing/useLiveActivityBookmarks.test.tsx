import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  LIVE_ACTIVITY_BOOKMARKS_KEY,
  loadLiveActivityBookmarks,
  parseLiveActivityBookmarks,
  saveLiveActivityBookmarks,
  useLiveActivityBookmarks,
} from './useLiveActivityBookmarks'

const credentials = { code: 'A1B2C3D4E5', editToken: 'a'.repeat(64) }

function BookmarkHarness() {
  const [bookmarks, setBookmarks] = useLiveActivityBookmarks()
  return <><output aria-label="Bookmarks">{JSON.stringify(bookmarks)}</output><button onClick={() => setBookmarks({ trip: credentials })}>Remember trip</button></>
}

beforeEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
})

describe('live activity bookmarks', () => {
  it('parses only valid group capability records', () => {
    expect(parseLiveActivityBookmarks(null)).toEqual({})
    expect(parseLiveActivityBookmarks('{')).toEqual({})
    expect(parseLiveActivityBookmarks('null')).toEqual({})
    expect(parseLiveActivityBookmarks('[]')).toEqual({})
    expect(parseLiveActivityBookmarks('"text"')).toEqual({})
    expect(parseLiveActivityBookmarks(JSON.stringify({
      trip: credentials,
      '': credentials,
      invalid: { ...credentials, code: 'bad' },
    }))).toEqual({ trip: credentials })
  })

  it('loads and saves bookmarks defensively', () => {
    localStorage.setItem(LIVE_ACTIVITY_BOOKMARKS_KEY, JSON.stringify({ trip: credentials }))
    expect(loadLiveActivityBookmarks()).toEqual({ trip: credentials })

    const setItem = vi.spyOn(localStorage, 'setItem')
    saveLiveActivityBookmarks({ trip: credentials })
    expect(setItem).not.toHaveBeenCalled()
    saveLiveActivityBookmarks({ cabin: credentials })
    expect(setItem).toHaveBeenCalledOnce()

    setItem.mockImplementation(() => { throw new Error('blocked') })
    expect(() => saveLiveActivityBookmarks({})).not.toThrow()
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    expect(loadLiveActivityBookmarks()).toEqual({})
  })

  it('persists hook updates and synchronizes matching storage events', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<BookmarkHarness />)
    expect(screen.getByLabelText('Bookmarks')).toHaveTextContent('{}')
    await user.click(screen.getByRole('button', { name: 'Remember trip' }))
    await waitFor(() => expect(JSON.parse(localStorage.getItem(LIVE_ACTIVITY_BOOKMARKS_KEY)!)).toEqual({ trip: credentials }))

    fireEvent(window, new StorageEvent('storage', { key: 'other', newValue: null }))
    expect(screen.getByLabelText('Bookmarks')).toHaveTextContent('trip')
    fireEvent(window, new StorageEvent('storage', { key: LIVE_ACTIVITY_BOOKMARKS_KEY, newValue: JSON.stringify({ cabin: credentials }) }))
    expect(screen.getByLabelText('Bookmarks')).toHaveTextContent('cabin')
    expect(screen.getByLabelText('Bookmarks')).not.toHaveTextContent('trip')
    unmount()
  })
})
