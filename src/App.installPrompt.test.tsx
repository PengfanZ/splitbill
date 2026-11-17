import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { IDENTITY_KEY } from './data/identity'
import { CHANGELOG_SEEN_STORAGE_KEY, LATEST_CHANGELOG_ID } from './features/changelog/changelog'
import { captureInstallPrompt } from './pwa/installGuide'
import { INSTALL_PROMPT_STORAGE_KEY } from './pwa/installPromptState'

const IPHONE_SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1'
const defaultUserAgent = navigator.userAgent

function setUserAgent(userAgent: string) {
  Object.defineProperty(navigator, 'userAgent', { configurable: true, value: userAgent })
}

function renderApp() {
  const analyticsClient = { track: vi.fn() }
  const view = render(<App analyticsClient={analyticsClient} liveActivityClient={null} />)
  return { analyticsClient, view }
}

async function createActivity(name: string) {
  const user = userEvent.setup()
  await user.click(screen.getAllByRole('button', { name: /Create an activity|New activity/ })[0])
  await user.type(screen.getByLabelText('Activity name'), name)
  await user.click(screen.getByRole('button', { name: 'Create activity' }))
  return user
}

const installCard = () => screen.queryByRole('region', { name: 'Install Tally' })

beforeAll(() => captureInstallPrompt())

beforeEach(() => {
  localStorage.setItem(CHANGELOG_SEEN_STORAGE_KEY, LATEST_CHANGELOG_ID)
  localStorage.setItem(IDENTITY_KEY, JSON.stringify({ id: 'me', name: 'Mia', initials: 'M', color: '#ead1b9' }))
  window.history.replaceState(null, '', '/')
})

afterEach(() => {
  setUserAgent(defaultUserAgent)
  act(() => {
    window.dispatchEvent(new Event('appinstalled'))
  })
})

describe('the install prompt', () => {
  it('appears on iPhone after the first activity is created, and stays gone once dismissed', async () => {
    setUserAgent(IPHONE_SAFARI)
    const { analyticsClient, view } = renderApp()
    expect(installCard()).not.toBeInTheDocument()

    const user = await createActivity('Ski weekend')
    expect(installCard()).toHaveTextContent('Add Tally to your Home Screen')
    expect(analyticsClient.track).toHaveBeenCalledWith('install_prompt_shown', 'local', 'en')

    await user.click(screen.getByRole('button', { name: 'Got it' }))
    expect(installCard()).not.toBeInTheDocument()
    expect(analyticsClient.track).toHaveBeenCalledWith('install_prompt_dismissed', 'local', 'en')
    expect(localStorage.getItem(INSTALL_PROMPT_STORAGE_KEY)).toBe('done')

    await createActivity('Dinner club')
    expect(installCard()).not.toBeInTheDocument()

    view.unmount()
    renderApp()
    expect(installCard()).not.toBeInTheDocument()
  })

  it('comes back on the next visit until it is dismissed', async () => {
    setUserAgent(IPHONE_SAFARI)
    const { view } = renderApp()
    await createActivity('Ski weekend')
    view.unmount()

    renderApp()
    expect(installCard()).toBeInTheDocument()
  })

  it('opens the browser install dialog where Chromium offers one', async () => {
    const prompt = vi.fn().mockResolvedValue(undefined)
    const { analyticsClient } = renderApp()
    act(() => {
      window.dispatchEvent(Object.assign(new Event('beforeinstallprompt'), { prompt, userChoice: Promise.resolve({ outcome: 'accepted' }) }))
    })

    const user = await createActivity('Ski weekend')
    await user.click(screen.getByRole('button', { name: 'Install' }))

    expect(prompt).toHaveBeenCalledOnce()
    await waitFor(() => expect(installCard()).not.toBeInTheDocument())
    expect(analyticsClient.track).toHaveBeenCalledWith('install_prompt_accepted', 'local', 'en')
  })

  it('stays out of the way in browsers that cannot install', async () => {
    const { analyticsClient } = renderApp()
    await createActivity('Ski weekend')
    expect(installCard()).not.toBeInTheDocument()
    expect(analyticsClient.track).not.toHaveBeenCalledWith('install_prompt_shown', 'local', 'en')
  })
})
