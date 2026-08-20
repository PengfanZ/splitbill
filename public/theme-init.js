(() => {
  const storageKey = 'tally:theme:v1'
  let preference = 'system'
  try {
    const stored = localStorage.getItem(storageKey)
    if (stored === 'light' || stored === 'dark' || stored === 'system') preference = stored
  } catch {
    // Use the system preference when browser storage is unavailable.
  }
  const systemPrefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
  const theme = preference === 'system' ? (systemPrefersDark ? 'dark' : 'light') : preference
  document.documentElement.dataset.theme = theme
  document.documentElement.style.colorScheme = theme
  const themeColor = document.querySelector('meta[name="theme-color"]')
  if (themeColor) themeColor.content = theme === 'dark' ? '#151513' : '#f7f4ee'
})()
