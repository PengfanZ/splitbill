import type { FocusEvent } from 'react'

export function selectInputContents(event: FocusEvent<HTMLInputElement>) {
  if (event.currentTarget.value) event.currentTarget.select()
}
