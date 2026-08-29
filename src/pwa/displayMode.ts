type NavigatorWithStandalone = Navigator & { standalone?: boolean }

export function isStandalonePwa() {
  return window.matchMedia?.('(display-mode: standalone)').matches === true
    || (navigator as NavigatorWithStandalone).standalone === true
}
