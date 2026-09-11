import { ANALYTICS_EVENTS, type AnalyticsClient } from './analytics'
import { isCurrencyCode } from './domain/currency'

export const GOOGLE_ANALYTICS_LAYER = 'tallyGoogleAnalytics'
const MAX_PENDING_COMMANDS = 100

type GoogleAnalyticsWindow = Window & { tallyGoogleAnalytics?: IArguments[] }
type GoogleAnalyticsEnvironment = { VITE_GA_MEASUREMENT_ID?: string; BASE_URL?: string }

export function googleMeasurementId(value?: string) {
  const id = value?.trim() ?? ''
  return /^G-[A-Z0-9]{5,20}$/.test(id) ? id : null
}

function referrerOrigin(value: string) {
  try {
    const url = new URL(value)
    return ['https:', 'http:'].includes(url.protocol) ? `${url.origin}/` : ''
  } catch {
    return ''
  }
}

/** Optional GA adapter. No activity state or raw URL is accepted by its API. */
export function createConfiguredGoogleAnalyticsClient(
  environment: GoogleAnalyticsEnvironment = import.meta.env,
  dependencies: { enabled?: boolean; browser?: GoogleAnalyticsWindow } = {},
): AnalyticsClient | null {
  const id = googleMeasurementId(environment.VITE_GA_MEASUREMENT_ID)
  if (!(dependencies.enabled ?? import.meta.env.PROD) || !id) return null

  try {
    const browser: GoogleAnalyticsWindow = dependencies.browser ?? window
    const document = browser.document
    // Use the build's base path, never a live capability or arbitrary current URL.
    const location = new URL(environment.BASE_URL ?? '/', browser.location.origin)
    const page = {
      page_location: `${location.origin}${location.pathname}`,
      page_referrer: referrerOrigin(document.referrer),
      page_title: 'Tally — Group Expense Splitter',
    }
    const queue: IArguments[] = []
    browser.tallyGoogleAnalytics = queue
    let loaded = false
    let failed = false
    let pageViewed = false

    function send(..._command: unknown[]) {
      if (!failed && (loaded || queue.length < MAX_PENDING_COMMANDS)) {
        // gtag consumes argument objects, not a custom event payload format.
        // eslint-disable-next-line prefer-rest-params -- required by Google's gtag queue protocol
        queue.push(arguments)
      }
    }

    send('js', new Date())
    send('config', id, {
      ...page,
      send_page_view: false,
      allow_google_signals: false,
      allow_ad_personalization_signals: false,
      // Do not infer campaign data from untrusted query parameters.
      campaign_id: '',
      campaign_source: '',
      campaign_medium: '',
      campaign_name: '',
      campaign_term: '',
      campaign_content: '',
      cookie_domain: browser.location.hostname,
      cookie_path: location.pathname,
    })

    const script = document.createElement('script')
    script.async = true
    script.referrerPolicy = 'no-referrer'
    script.src = `https://www.googletagmanager.com/gtag/js?id=${id}&l=${GOOGLE_ANALYTICS_LAYER}`
    script.onload = () => { loaded = true }
    script.onerror = () => { failed = true; queue.length = 0 }
    document.head.appendChild(script)

    return {
      track(event, surface, locale, currency) {
        try {
          if (!ANALYTICS_EVENTS.includes(event)
            || !['local', 'live'].includes(surface)
            || !['en', 'zh-CN'].includes(locale)) return
          const parameters = {
            ...page,
            send_to: id,
            surface,
            app_locale: locale,
            ...(event === 'currency_selected' && isCurrencyCode(currency) ? { selected_currency: currency } : {}),
          }
          if (event === 'app_opened' && !pageViewed) {
            pageViewed = true
            send('event', 'page_view', parameters)
          }
          send('event', event, parameters)
        } catch {
          // A blocked or broken Google tag must not affect any app action.
        }
      },
    }
  } catch {
    return null
  }
}
