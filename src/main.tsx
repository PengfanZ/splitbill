import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { createConfiguredAnalyticsClient, initializeAnalytics } from './analytics'
import { reloadOnServiceWorkerUpdate } from './pwa/serviceWorkerUpdates'
import './styles.css'

const analyticsClient = createConfiguredAnalyticsClient()
const rootElement = document.getElementById('root')

if (!rootElement) throw new Error('Tally requires a root element')

createRoot(rootElement).render(
  <StrictMode>
    <App analyticsClient={analyticsClient} />
  </StrictMode>,
)

initializeAnalytics(undefined, Boolean(analyticsClient))

if (navigator.serviceWorker) {
  reloadOnServiceWorkerUpdate(navigator.serviceWorker, window.location.reload.bind(window.location))
}
