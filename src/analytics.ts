import type { AppLocale } from './i18n/localization'
import type { CurrencyCode } from './domain/currency'

const CLOUDFLARE_BEACON_URL =
  'https://static.cloudflareinsights.com/beacon.min.js'
const CLOUDFLARE_ANALYTICS_TOKEN = 'e7952cd24d1b46ef8f41cb98923762e8'

export const ANALYTICS_SESSION_KEY = 'tally:analytics-session:v1'

export const ANALYTICS_EVENTS = [
  'app_opened',
  'activity_created',
  'expense_added',
  'live_activity_created',
  'live_activity_opened',
  'settlement_recorded',
  'currency_selected',
] as const

export type AnalyticsEvent = typeof ANALYTICS_EVENTS[number]
export type AnalyticsSurface = 'local' | 'live' | 'snapshot'

export type AnalyticsClient = {
  track: (
    event: AnalyticsEvent,
    surface: AnalyticsSurface,
    locale: AppLocale,
    currency?: CurrencyCode,
  ) => void
}

type AnalyticsEnvironment = {
  VITE_SUPABASE_URL?: string
  VITE_SUPABASE_PUBLISHABLE_KEY?: string
}

type AnalyticsDependencies = {
  enabled?: boolean
  fetcher?: typeof fetch
  storage?: Storage | null
  crypto?: Crypto
}

const SESSION_TOKEN_PATTERN = /^[a-f0-9]{32}$/

function randomSessionToken(cryptoProvider: Crypto) {
  const bytes = cryptoProvider.getRandomValues(new Uint8Array(16))
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
}

export function getOrCreateAnalyticsSessionToken(
  storage: Storage | null,
  cryptoProvider: Crypto,
) {
  try {
    const saved = storage?.getItem(ANALYTICS_SESSION_KEY)
    if (saved && SESSION_TOKEN_PATTERN.test(saved)) return saved
  } catch {
    // A blocked session store must never affect the app.
  }

  const token = randomSessionToken(cryptoProvider)
  try {
    storage?.setItem(ANALYTICS_SESSION_KEY, token)
  } catch {
    // The in-memory token is still usable for this page load.
  }
  return token
}

function validAnalyticsUrl(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:'
      || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
  } catch {
    return false
  }
}

export function createConfiguredAnalyticsClient(
  environment: AnalyticsEnvironment = import.meta.env as AnalyticsEnvironment,
  dependencies: AnalyticsDependencies = {},
): AnalyticsClient | null {
  const enabled = dependencies.enabled ?? import.meta.env.PROD
  if (!enabled) return null

  const supabaseUrl = environment.VITE_SUPABASE_URL?.trim().replace(/\/+$/, '') ?? ''
  const publishableKey = environment.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ?? ''
  if (!supabaseUrl || !publishableKey || !validAnalyticsUrl(supabaseUrl)) return null

  try {
    const fetcher = dependencies.fetcher ?? window.fetch.bind(window)
    const storage = dependencies.storage === undefined ? window.sessionStorage : dependencies.storage
    const cryptoProvider = dependencies.crypto ?? window.crypto
    const sessionToken = getOrCreateAnalyticsSessionToken(storage, cryptoProvider)

    return {
      track(event, surface, locale, currency) {
        try {
          const request = fetcher(`${supabaseUrl}/rest/v1/rpc/record_analytics_event`, {
            method: 'POST',
            headers: {
              apikey: publishableKey,
              authorization: `Bearer ${publishableKey}`,
              'content-type': 'application/json',
            },
            cache: 'no-store',
            credentials: 'omit',
            keepalive: true,
            referrerPolicy: 'no-referrer',
            body: JSON.stringify({
              p_event_name: event,
              p_surface: surface,
              p_session_token: sessionToken,
              p_locale: locale,
              p_currency: currency ?? null,
            }),
          })
          void request.catch(() => undefined)
        } catch {
          // Analytics is best-effort and must never interrupt a user action.
        }
      },
    }
  } catch {
    return null
  }
}

export function initializeAnalytics(
  enabled = import.meta.env.PROD,
  firstPartyAnalyticsEnabled = Boolean(
    import.meta.env.VITE_SUPABASE_URL?.trim()
    && import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim(),
  ),
) {
  if (
    !enabled
    || firstPartyAnalyticsEnabled
    || window.location.hash.startsWith('#share=')
    || window.location.hash.startsWith('#live=')
    || document.querySelector(`script[src="${CLOUDFLARE_BEACON_URL}"]`)
  ) {
    return
  }

  const script = document.createElement('script')
  script.defer = true
  script.src = CLOUDFLARE_BEACON_URL
  script.dataset.cfBeacon = JSON.stringify({
    token: CLOUDFLARE_ANALYTICS_TOKEN,
  })
  document.body.append(script)
}
