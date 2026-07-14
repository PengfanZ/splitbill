import { calculateSettlements, getSettlementRecipientId, isSettlementPayment, money, spendingExpenses } from '../../domain/expenses'
import type { ActivityGroup, Expense, Member } from '../../domain/models'

export type ShareResult = 'shared' | 'copied' | 'downloaded' | 'cancelled' | 'failed'

export const SHARE_MESSAGES: Record<ShareResult, string> = {
  shared: 'PNG summary shared.',
  copied: 'Summary copied. Paste it into any chat.',
  downloaded: 'PNG summary downloaded.',
  cancelled: 'Sharing cancelled.',
  failed: 'Could not export the summary. Please try again.',
}

function memberName(memberMap: Map<string, Member>, memberId: string | null) {
  if (!memberId) return 'Unknown'
  return memberMap.get(memberId)?.name ?? 'Unknown'
}

export function buildShareSummary(group: ActivityGroup, members: Member[], expenses: Expense[]) {
  const memberMap = new Map(members.map(member => [member.id, member]))
  const spending = spendingExpenses(expenses)
  const payments = expenses.filter(isSettlementPayment)
  const total = spending.reduce((sum, item) => sum + item.amount, 0)
  const expenseLines = spending.length
    ? spending.map(item => `• ${item.title} — ${money(item.amount)}, paid by ${memberMap.get(item.payerId)?.name ?? 'Unknown'} (${item.splitMethod === 'equal' ? 'split equally' : 'exact split'})`)
    : ['• No expenses yet.']
  const paymentLines = payments.length
    ? payments.map(item => {
      const recipientId = getSettlementRecipientId(item)
      return `• ${memberName(memberMap, item.payerId)} paid ${memberName(memberMap, recipientId)} ${money(item.amount)}`
    })
    : ['• No settlement payments recorded.']
  const settlements = calculateSettlements(members, expenses)
  const settlementLines = settlements.length
    ? settlements.map(item => `• ${item.from.name} pays ${item.to.name} ${money(item.amount)}`)
    : ['• Everyone is settled.']

  return [
    `Tally summary — ${group.name}`,
    `Total spent: ${money(total)}`,
    '',
    'Expenses',
    ...expenseLines,
    '',
    'Recorded settlements',
    ...paymentLines,
    '',
    'Suggested payments',
    ...settlementLines,
    '',
    'Shared from Tally',
  ].join('\n')
}

export async function createSummaryCard(group: ActivityGroup, members: Member[], expenses: Expense[]) {
  const canvas = document.createElement('canvas')
  canvas.width = 1080
  canvas.height = 1350
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas is unavailable')

  const total = spendingExpenses(expenses).reduce((sum, item) => sum + item.amount, 0)
  const settlements = calculateSettlements(members, expenses)
  const memberMap = new Map(members.map(member => [member.id, member]))
  const visibleEntries = expenses.slice(0, 5)

  context.fillStyle = '#f7f4ee'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.fillStyle = '#e8584f'
  context.font = '700 40px Arial, sans-serif'
  context.fillText('Tally.', 72, 82)
  context.fillStyle = '#26231f'
  context.font = '400 70px Georgia, serif'
  context.fillText(group.name, 72, 178, 936)
  context.fillStyle = '#746e67'
  context.font = '500 24px Arial, sans-serif'
  context.fillText(`${members.length} ${members.length === 1 ? 'person' : 'people'} sharing expenses`, 74, 225)

  context.fillStyle = '#ffffff'
  context.fillRect(72, 278, 936, 190)
  context.fillStyle = '#746e67'
  context.font = '600 22px Arial, sans-serif'
  context.fillText('TOTAL SPENT', 112, 330)
  context.fillStyle = '#26231f'
  context.font = '400 74px Georgia, serif'
  context.fillText(money(total), 112, 420)

  context.fillStyle = '#26231f'
  context.font = '700 30px Arial, sans-serif'
  context.fillText('Suggested payments', 72, 540)
  context.fillStyle = '#d8d1c8'
  context.fillRect(72, 560, 936, 2)
  context.font = '600 27px Arial, sans-serif'
  if (settlements.length) {
    settlements.slice(0, 4).forEach((item, index) => {
      const y = 620 + index * 58
      context.fillStyle = '#26231f'
      context.fillText(`${item.from.name} pays ${item.to.name}`, 82, y, 710)
      context.fillStyle = '#e8584f'
      context.textAlign = 'right'
      context.fillText(money(item.amount), 998, y)
      context.textAlign = 'left'
    })
  } else {
    context.fillStyle = '#16724c'
    context.fillText('Everyone is settled', 82, 620)
  }

  const expenseHeadingY = 620 + Math.max(1, Math.min(4, settlements.length)) * 58 + 72
  context.fillStyle = '#26231f'
  context.font = '700 30px Arial, sans-serif'
  context.fillText('Activity', 72, expenseHeadingY)
  context.fillStyle = '#d8d1c8'
  context.fillRect(72, expenseHeadingY + 20, 936, 2)
  context.font = '500 24px Arial, sans-serif'
  if (visibleEntries.length) {
    visibleEntries.forEach((item, index) => {
      const y = expenseHeadingY + 78 + index * 58
      const settlementPayment = isSettlementPayment(item)
      const payer = memberName(memberMap, item.payerId)
      const recipientId = getSettlementRecipientId(item)
      const recipient = memberName(memberMap, recipientId)
      context.fillStyle = '#26231f'
      context.fillText(settlementPayment ? `${payer} paid ${recipient}` : item.title, 82, y, 460)
      context.fillStyle = '#746e67'
      context.fillText(settlementPayment ? 'Settlement payment' : `${payer} paid · ${item.splitMethod === 'equal' ? 'Equal split' : 'Exact split'}`, 390, y, 410)
      context.fillStyle = '#26231f'
      context.textAlign = 'right'
      context.fillText(money(item.amount), 998, y)
      context.textAlign = 'left'
    })
    if (expenses.length > visibleEntries.length) {
      context.fillStyle = '#746e67'
      context.fillText(`+ ${expenses.length - visibleEntries.length} more entries`, 82, expenseHeadingY + 78 + visibleEntries.length * 58)
    }
  } else {
    context.fillStyle = '#746e67'
    context.fillText('No activity yet.', 82, expenseHeadingY + 78)
  }

  context.fillStyle = '#746e67'
  context.font = '500 21px Arial, sans-serif'
  context.fillText('Shared from Tally · Settle up simply', 72, 1290)

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('PNG generation failed')), 'image/png')
  })
}

export async function shareActivitySummary(title: string, text: string, image: Blob | null): Promise<ShareResult> {
  const filename = `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'tally-summary'}.png`
  if (image) {
    const file = new File([image], filename, { type: 'image/png' })
    const shareData = { title, text, files: [file] }
    if (typeof navigator.share === 'function' && typeof navigator.canShare === 'function' && navigator.canShare(shareData)) {
      try {
        await navigator.share(shareData)
        return 'shared'
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled'
      }
    }

    try {
      const url = URL.createObjectURL(image)
      const link = document.createElement('a')
      link.href = url
      link.download = filename
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
      return 'downloaded'
    } catch {
      // Continue to the text fallback.
    }
  }

  if (!image && typeof navigator.share === 'function') {
    try {
      await navigator.share({ title, text })
      return 'shared'
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled'
    }
  }

  if (typeof navigator.clipboard?.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(text)
      return 'copied'
    } catch {
      return 'failed'
    }
  }

  return 'failed'
}

export async function exportActivitySummary(group: ActivityGroup, members: Member[], expenses: Expense[]) {
  const title = `${group.name} — Tally`
  const text = buildShareSummary(group, members, expenses)
  try {
    const image = await createSummaryCard(group, members, expenses)
    return shareActivitySummary(title, text, image)
  } catch {
    return shareActivitySummary(title, text, null)
  }
}
