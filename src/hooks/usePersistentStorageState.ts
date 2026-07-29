import { useEffect, useState } from 'react'

type PersistentStorageStateOptions<T> = {
  key: string
  load: () => T
  parse: (stored: string | null) => T
  save: (value: T) => void
}

export function usePersistentStorageState<T>({
  key,
  load,
  parse,
  save,
}: PersistentStorageStateOptions<T>) {
  const [value, setValue] = useState<T>(load)

  useEffect(() => save(value), [save, value])
  useEffect(() => {
    const syncAcrossTabs = (event: StorageEvent) => {
      if (event.key === key) setValue(parse(event.newValue))
    }
    window.addEventListener('storage', syncAcrossTabs)
    return () => window.removeEventListener('storage', syncAcrossTabs)
  }, [key, parse])

  return [value, setValue] as const
}
