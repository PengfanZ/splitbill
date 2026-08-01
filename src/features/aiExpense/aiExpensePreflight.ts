import type { AiExpenseRequest } from './aiExpenseContract'

type MissingDetail = 'amount' | 'payer' | 'participants'

// Keep the instant path deliberately conservative. Natural-language interpretation
// belongs to the model; this check only catches tiny category-only inputs such as
// "dinner", "cena", "晚餐", or "夕食".
const MAX_OBVIOUSLY_VAGUE_CODE_POINTS = 8
const AMOUNT_SIGNAL_PATTERN = /[\p{Number}\p{Sc}]|\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million)\b|[零〇一二两三四五六七八九十百千万亿]/iu

function includesMemberName(text: string, members: AiExpenseRequest['members']) {
  const normalizedText = text.normalize('NFKC').toLocaleLowerCase()
  return members.some(member => {
    const normalizedName = member.name.trim().normalize('NFKC').toLocaleLowerCase()
    return normalizedName.length > 0 && normalizedText.includes(normalizedName)
  })
}

function isObviouslyVague(request: AiExpenseRequest) {
  if (request.clarification) return false
  const text = request.text.trim().normalize('NFKC')
  if (AMOUNT_SIGNAL_PATTERN.test(text) || includesMemberName(text, request.members)) return false
  return Array.from(text).length <= MAX_OBVIOUSLY_VAGUE_CODE_POINTS
}

function englishQuestion(missing: MissingDetail[]) {
  if (missing.length === 2) return 'Please add the total amount and who paid.'
  return 'Please add the total amount, who paid, and who should be included in the split.'
}

function chineseQuestion(missing: MissingDetail[]) {
  if (missing.length === 2) return '请补充总金额和付款人。'
  return '请补充总金额、付款人、参与分摊的人。'
}

export function getAiExpensePreflightQuestion(request: AiExpenseRequest): string | null {
  if (!isObviouslyVague(request)) return null
  const missing: MissingDetail[] = request.members.length > 1
    ? ['amount', 'payer', 'participants']
    : ['amount', 'payer']
  return request.locale === 'zh-CN' ? chineseQuestion(missing) : englishQuestion(missing)
}
