import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { createConfiguredAnalyticsClient } from './analytics'
import { createConfiguredAiExpenseClient } from './features/aiExpense/aiExpenseApi'
import { reloadOnServiceWorkerUpdate } from './pwa/serviceWorkerUpdates'
import { isEmbeddedWindow, renderFrameProtection } from './security/frameProtection'
import './styles.css'

const rootElement = document.getElementById('root')

if (!rootElement) throw new Error('Tally requires a root element')

if (isEmbeddedWindow()) {
  renderFrameProtection(rootElement)
} else {
  const analyticsClient = createConfiguredAnalyticsClient()
  const aiExpenseClient = createConfiguredAiExpenseClient()
  createRoot(rootElement).render(
    <StrictMode>
      <App aiExpenseClient={aiExpenseClient} analyticsClient={analyticsClient} />
    </StrictMode>,
  )

  if (navigator.serviceWorker) {
    reloadOnServiceWorkerUpdate(navigator.serviceWorker, window.location.reload.bind(window.location))
  }
}
