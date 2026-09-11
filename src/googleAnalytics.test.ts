import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ANALYTICS_EVENTS, type AnalyticsEvent, type AnalyticsSurface } from './analytics'
import { createConfiguredGoogleAnalyticsClient, googleMeasurementId } from './googleAnalytics'
import type { AppLocale } from './i18n/localization'
import type { CurrencyCode } from './domain/currency'

const environment = { VITE_GA_MEASUREMENT_ID: 'G-TEST12345', BASE_URL: '/splitbill/' }
const browser = window as Window & { tallyGoogleAnalytics?: IArguments[] }
const commands = () => browser.tallyGoogleAnalytics!.map(command => Array.from(command))
const script = () => document.head.querySelector<HTMLScriptElement>('script[src*="googletagmanager"]')!
const create = () => createConfiguredGoogleAnalyticsClient(environment, { enabled: true })!

beforeEach(() => {
  vi.stubEnv('PROD', false)
  document.head.innerHTML = ''
  window.history.replaceState(null, '', '/splitbill/?private=secret#live=ACTIVITY.secret-token')
  document.title = 'Private activity name'
  vi.spyOn(document, 'referrer', 'get').mockReturnValue('https://example.com/private-name?token=secret#private')
  delete browser.tallyGoogleAnalytics
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs() })

describe('Google Analytics configuration', () => {
  it.each([undefined, '', 'G-', 'G-abc12345', 'G-TEST12345&evil=1', 'G-' + 'A'.repeat(21)])('rejects invalid measurement IDs: %s', value => {
    expect(googleMeasurementId(value)).toBeNull()
    expect(createConfiguredGoogleAnalyticsClient({ VITE_GA_MEASUREMENT_ID: value }, { enabled: true })).toBeNull()
    expect(document.querySelector('script')).toBeNull()
  })

  it('is opt-in by build configuration and disabled in development', () => {
    expect(googleMeasurementId(' G-TEST12345 ')).toBe('G-TEST12345')
    expect(createConfiguredGoogleAnalyticsClient(environment)).toBeNull()
    expect(createConfiguredGoogleAnalyticsClient(environment, { enabled: false })).toBeNull()
    expect(createConfiguredGoogleAnalyticsClient()).toBeNull()
    expect(document.querySelector('script')).toBeNull()
  })

  it('loads one asynchronous tag with sanitized context and no automatic pageviews or advertising', () => {
    const client = create()
    expect(script().async).toBe(true)
    expect(script().referrerPolicy).toBe('no-referrer')
    expect(script().src).toBe('https://www.googletagmanager.com/gtag/js?id=G-TEST12345&l=tallyGoogleAnalytics')
    expect(commands()[1]).toEqual(['config', 'G-TEST12345', expect.objectContaining({
      send_page_view: false, allow_google_signals: false, allow_ad_personalization_signals: false,
      page_location: `${location.origin}/splitbill/`, page_referrer: 'https://example.com/',
      page_title: 'Tally — Group Expense Splitter', cookie_domain: location.hostname, cookie_path: '/splitbill/',
      campaign_id: '', campaign_source: '', campaign_medium: '', campaign_name: '', campaign_term: '', campaign_content: '',
    })])
    client.track('app_opened', 'live', 'zh-CN')
    client.track('app_opened', 'live', 'zh-CN')
    client.track('live_activity_opened', 'live', 'zh-CN')
    expect(commands().filter(command => command[1] === 'page_view')).toHaveLength(1)
    expect(document.querySelectorAll('script')).toHaveLength(1)
    expect(JSON.stringify(commands())).not.toMatch(/Private|private|secret|ACTIVITY|#live|token/)
  })

  it.each(['', 'not a url', 'file:///private/file', 'javascript:alert(1)'])('does not send unsafe referrers: %s', referrer => {
    vi.spyOn(document, 'referrer', 'get').mockReturnValue(referrer)
    vi.stubEnv('PROD', true)
    const client = createConfiguredGoogleAnalyticsClient({ VITE_GA_MEASUREMENT_ID: 'G-TEST12345' }, { browser })!
    client.track('expense_added', 'local', 'en')
    expect(commands()[2]).toEqual(['event', 'expense_added', {
      page_location: `${location.origin}/`, page_referrer: '', page_title: 'Tally — Group Expense Splitter',
      send_to: 'G-TEST12345', surface: 'local', app_locale: 'en',
    }])
  })

  it('mirrors every allowlisted interaction and only forwards currency for currency selection', () => {
    const client = create()
    script().dispatchEvent(new Event('load'))
    for (const event of ANALYTICS_EVENTS) client.track(event, 'local', 'en', 'CNY')
    expect(commands().filter(command => command[0] === 'event').map(command => command[1])).toEqual(['page_view', ...ANALYTICS_EVENTS])
    for (const command of commands().slice(2)) {
      expect(command[2]).toEqual(expect.objectContaining({ surface: 'local', app_locale: 'en' }))
      if (command[1] === 'currency_selected') expect(command[2]).toHaveProperty('selected_currency', 'CNY')
      else expect(command[2]).not.toHaveProperty('selected_currency')
    }
  })

  it('drops untrusted runtime input and invalid currencies', () => {
    const client = create()
    client.track('private-name' as AnalyticsEvent, 'local', 'en')
    client.track('app_opened', 'private-name' as AnalyticsSurface, 'en')
    client.track('app_opened', 'local', 'private-name' as AppLocale)
    expect(commands()).toHaveLength(2)
    client.track('currency_selected', 'local', 'en', 'private-name' as CurrencyCode)
    expect(commands()[2][2]).not.toHaveProperty('selected_currency')
  })

  it('bounds the queue while loading, handles a blocked tag, and never retries on user actions', () => {
    const client = create()
    for (let i = 0; i < 120; i++) client.track('expense_added', 'local', 'en')
    expect(commands()).toHaveLength(100)
    script().dispatchEvent(new Event('error'))
    expect(commands()).toHaveLength(0)
    client.track('expense_added', 'local', 'en')
    expect(commands()).toHaveLength(0)
    expect(document.querySelectorAll('script')).toHaveLength(1)
  })

  it('keeps user actions working if the tag breaks the queue', () => {
    const client = create()
    vi.spyOn(browser.tallyGoogleAnalytics!, 'push').mockImplementation(() => { throw new Error('blocked') })
    expect(() => client.track('expense_added', 'local', 'en')).not.toThrow()
  })

  it('fails closed if script insertion is unavailable', () => {
    vi.spyOn(document.head, 'appendChild').mockImplementation(() => { throw new Error('blocked') })
    expect(create()).toBeNull()
  })
})
