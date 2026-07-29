export function loadBrowserStorageValue<T>(
  key: string,
  parse: (stored: string | null) => T,
  fallback: T,
): T {
  try {
    return parse(localStorage.getItem(key))
  } catch {
    return fallback
  }
}

export function saveBrowserStorageValue(key: string, value: unknown) {
  try {
    const serialized = JSON.stringify(value)
    if (serialized !== undefined && localStorage.getItem(key) !== serialized) {
      localStorage.setItem(key, serialized)
    }
  } catch {
    // Browser storage is optional; keep local and Live workflows usable without it.
  }
}
