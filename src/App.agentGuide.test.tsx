import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import App from './App'
import { IDENTITY_KEY } from './data/identity'
import { CHANGELOG_SEEN_STORAGE_KEY, LATEST_CHANGELOG_ID } from './features/changelog/changelog'

const GENERAL_TITLE = 'Let your coding agent keep the tab.'

beforeEach(() => {
  localStorage.setItem(CHANGELOG_SEEN_STORAGE_KEY, LATEST_CHANGELOG_ID)
  window.history.replaceState(null, '', '/')
})

function rememberMia() {
  localStorage.setItem(IDENTITY_KEY, JSON.stringify({ id: 'me', name: 'Mia', initials: 'M', color: '#ead1b9' }))
}

describe('the experimental agent guide', () => {
  it('opens from the sidebar and hands off to feedback', async () => {
    rememberMia()
    render(<App liveActivityClient={null} />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /Use with AI agents/ }))
    expect(await screen.findByRole('heading', { name: GENERAL_TITLE })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Tell us how it goes' }))
    expect(screen.queryByRole('heading', { name: GENERAL_TITLE })).not.toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'What should Tally do better?' })).toBeInTheDocument()
  })
})
