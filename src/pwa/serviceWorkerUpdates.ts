type ServiceWorkerUpdateSource = {
  controller: unknown | null
  addEventListener: (type: 'controllerchange', listener: () => void) => void
}

export function reloadOnServiceWorkerUpdate(source: ServiceWorkerUpdateSource, reload: () => void) {
  const replacingExistingWorker = source.controller !== null
  let reloading = false

  source.addEventListener('controllerchange', () => {
    if (!replacingExistingWorker || reloading) return
    reloading = true
    reload()
  })
}
