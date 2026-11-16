const pad = (value: number) => String(value).padStart(2, '0')

/** A stored time as the local `YYYY-MM-DDTHH:mm` value a date-and-time field expects, or '' when unreadable. */
export function toPaymentTimeInput(iso: string) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

const EARLIEST = Date.UTC(1970, 0, 1)
const LATEST = Date.UTC(2101, 0, 1)

/** The stored time for a date-and-time field's local value, or null when it is empty, unreadable, or a year no one means (a half-typed "0002"). */
export function fromPaymentTimeInput(value: string) {
  const time = new Date(value).getTime()
  return value && time >= EARLIEST && time < LATEST ? new Date(time).toISOString() : null
}
