import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { createConfiguredAnalyticsClient, initializeAnalytics } from './analytics'
import './styles.css'

const analyticsClient = createConfiguredAnalyticsClient()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App analyticsClient={analyticsClient} />
  </StrictMode>,
)

initializeAnalytics(undefined, Boolean(analyticsClient))
