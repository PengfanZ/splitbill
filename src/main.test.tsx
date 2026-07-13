import { beforeEach, expect, it, vi } from 'vitest'

const render = vi.fn()
const createRoot = vi.fn(() => ({ render }))

vi.mock('react-dom/client', () => ({ createRoot }))

beforeEach(() => {
  vi.resetModules()
  render.mockClear()
  createRoot.mockClear()
  document.body.innerHTML = '<div id="root"></div>'
})

it('mounts the application at the root element', async () => {
  await import('./main')
  expect(createRoot).toHaveBeenCalledWith(document.getElementById('root'))
  expect(render).toHaveBeenCalledOnce()
})
