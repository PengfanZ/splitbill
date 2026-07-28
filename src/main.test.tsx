import { beforeEach, expect, it, vi } from 'vitest'

const render = vi.fn()
const createRoot = vi.fn(() => ({ render }))
const reloadOnServiceWorkerUpdate = vi.fn()
const isEmbeddedWindow = vi.fn(() => false)
const renderFrameProtection = vi.fn()

vi.mock('react-dom/client', () => ({ createRoot }))
vi.mock('./pwa/serviceWorkerUpdates', () => ({ reloadOnServiceWorkerUpdate }))
vi.mock('./security/frameProtection', () => ({ isEmbeddedWindow, renderFrameProtection }))

beforeEach(() => {
  vi.resetModules()
  render.mockClear()
  createRoot.mockClear()
  reloadOnServiceWorkerUpdate.mockClear()
  isEmbeddedWindow.mockReset()
  isEmbeddedWindow.mockReturnValue(false)
  renderFrameProtection.mockClear()
  document.body.innerHTML = '<div id="root"></div>'
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: undefined })
})

it('mounts the application at the root element', async () => {
  await import('./main')
  expect(createRoot).toHaveBeenCalledWith(document.getElementById('root'))
  expect(render).toHaveBeenCalledOnce()
  expect(renderFrameProtection).not.toHaveBeenCalled()
  expect(reloadOnServiceWorkerUpdate).not.toHaveBeenCalled()
})

it('reloads the mounted app when an active service worker is replaced', async () => {
  const serviceWorker = {}
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: serviceWorker })

  await import('./main')

  expect(reloadOnServiceWorkerUpdate).toHaveBeenCalledWith(serviceWorker, expect.any(Function))
})

it('blocks rendering and background services when another site embeds the app', async () => {
  isEmbeddedWindow.mockReturnValue(true)

  await import('./main')

  expect(renderFrameProtection).toHaveBeenCalledWith(document.getElementById('root'))
  expect(createRoot).not.toHaveBeenCalled()
  expect(reloadOnServiceWorkerUpdate).not.toHaveBeenCalled()
})

it('fails clearly when the root element is missing', async () => {
  document.body.innerHTML = ''

  await expect(import('./main')).rejects.toThrow('Tally requires a root element')
  expect(createRoot).not.toHaveBeenCalled()
})
