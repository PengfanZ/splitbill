type FrameWindow = {
  self: unknown
  top: unknown
}

export function isEmbeddedWindow(frameWindow: FrameWindow = window) {
  return frameWindow.self !== frameWindow.top
}

export function renderFrameProtection(
  rootElement: HTMLElement,
  documentRef: Document = document,
  destination = window.location.href,
) {
  const notice = documentRef.createElement('main')
  notice.className = 'frame-protection'

  const title = documentRef.createElement('h1')
  title.textContent = 'Open Tally directly'

  const message = documentRef.createElement('p')
  message.textContent = 'For your security, Tally cannot run inside another website.'

  const link = documentRef.createElement('a')
  link.className = 'frame-protection-link'
  link.href = destination
  link.target = '_top'
  link.rel = 'noopener noreferrer'
  link.textContent = 'Open Tally'

  notice.append(title, message, link)
  rootElement.replaceChildren(notice)
}
