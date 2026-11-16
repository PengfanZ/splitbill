const pad = (value: number) => String(value).padStart(2, '0')

/** A stored time as the local `YYYY-MM-DDTHH:mm` value a date-and-time field expects, or '' when unreadable. */
export function toPaymentTimeInput(iso: string) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** The stored time for a date-and-time field's local value, or null when it is empty or unreadable. */
export function fromPaymentTimeInput(value: string) {
  const date = new Date(value)
  return value && !Number.isNaN(date.getTime()) ? date.toISOString() : null
}
