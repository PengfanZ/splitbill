import type { AiExpenseRequest } from './aiExpenseContract'

type MissingDetail = 'amount' | 'payer' | 'participants'

const NUMBER_WORD_PATTERN = /\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million)\b/iu
const CHINESE_NUMBER_PATTERN = /[零〇一二两三四五六七八九十百千万亿]/u
const SPLIT_PATTERN = /\b(?:split|shared?|with|between|among|equally|everyone|everybody|all of us|each|portion|owes?)\b|(?:平分|均分|分摊|分账|每人|大家|所有人|一起|各付|各自|欠)|\baa\b/iu
const ENGLISH_PAYMENT_VERBS = '(?:paid|pays|paying|covered|covers|covering|bought|spent|picked\\s+up)'
const CHINESE_PAYMENT_VERBS = '(?:付(?:了|款|的)?|支付|买单|垫付|花了)'

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function hasAmount(text: string) {
  return /\p{Number}/u.test(text)
    || NUMBER_WORD_PATTERN.test(text)
    || CHINESE_NUMBER_PATTERN.test(text)
}

function hasPayer(text: string, members: AiExpenseRequest['members']) {
  const payerReferences = [
    '\\b(?:i|we)\\b',
    ...members.map(member => escapeRegExp(member.name.trim())),
  ].filter(Boolean).join('|')

  return new RegExp(`(?:${payerReferences})\\s+(?:${ENGLISH_PAYMENT_VERBS})\\b`, 'iu').test(text)
    || new RegExp(`\\b(?:${ENGLISH_PAYMENT_VERBS})\\s+by\\s+(?:me|us|${payerReferences})\\b`, 'iu').test(text)
    || new RegExp(`(?:我|${payerReferences}).{0,12}${CHINESE_PAYMENT_VERBS}`, 'iu').test(text)
}

function missingDetails(request: AiExpenseRequest): MissingDetail[] {
  const missing: MissingDetail[] = []
  if (!hasAmount(request.text)) missing.push('amount')
  if (!hasPayer(request.text, request.members)) missing.push('payer')
  if (request.members.length > 1 && !SPLIT_PATTERN.test(request.text)) missing.push('participants')
  return missing
}

function englishQuestion(missing: MissingDetail[]) {
  if (missing.length === 1) {
    if (missing[0] === 'amount') return 'What was the total amount?'
    if (missing[0] === 'payer') return 'Who paid?'
    return 'Who should be included in the split?'
  }
  const details = missing.map(detail => ({
    amount: 'the total amount',
    payer: 'who paid',
    participants: 'who should be included in the split',
  })[detail])
  return `Please add ${details.slice(0, -1).join(', ')}${details.length > 2 ? ',' : ''} and ${details.at(-1)}.`
}

function chineseQuestion(missing: MissingDetail[]) {
  if (missing.length === 1) {
    if (missing[0] === 'amount') return '这笔支出的总金额是多少？'
    if (missing[0] === 'payer') return '是谁付款的？'
    return '哪些人需要参与分摊？'
  }
  const details = missing.map(detail => ({
    amount: '总金额',
    payer: '付款人',
    participants: '参与分摊的人',
  })[detail])
  return `请补充${details.join('、')}。`
}

export function getAiExpensePreflightQuestion(request: AiExpenseRequest): string | null {
  const missing = missingDetails(request)
  if (missing.length === 0) return null
  return request.locale === 'zh-CN' ? chineseQuestion(missing) : englishQuestion(missing)
}
