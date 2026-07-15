import { describe, expect, it, vi } from 'vitest'
import { reloadOnServiceWorkerUpdate } from './serviceWorkerUpdates'

function updateSource(controller: unknown | null) {
  let listener = () => {}
  return {
    source: {
      controller,
      addEventListener: vi.fn((_type: 'controllerchange', nextListener: () => void) => {
        listener = nextListener
      }),
    },
    dispatchControllerChange: () => listener(),
  }
}

describe('service-worker updates', () => {
  it('reloads once when a new worker replaces the active app version', () => {
    const worker = updateSource({})
    const reload = vi.fn()
    reloadOnServiceWorkerUpdate(worker.source, reload)

    worker.dispatchControllerChange()
    worker.dispatchControllerChange()

    expect(worker.source.addEventListener).toHaveBeenCalledWith('controllerchange', expect.any(Function))
    expect(reload).toHaveBeenCalledOnce()
  })

  it('does not reload when the app is controlled for the first time', () => {
    const worker = updateSource(null)
    const reload = vi.fn()
    reloadOnServiceWorkerUpdate(worker.source, reload)

    worker.dispatchControllerChange()

    expect(reload).not.toHaveBeenCalled()
  })
})
