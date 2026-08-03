import { describe, expect, it } from 'vitest'
import type { TextAiExpenseRequest } from './aiExpenseContract'
import {
  getAiExpensePreflightQuestion,
  getAiExpenseRecoveryQuestion,
} from './aiExpensePreflight'

const request: TextAiExpenseRequest = {
  inputMode: 'text',
  text: 'Maya paid $30 for dinner, split with me',
  locale: 'en',
  currency: 'USD',
  members: [{ id: 'me', name: 'Alex' }, { id: 'maya', name: 'Maya' }],
}

describe('AI expense preflight', () => {
  it.each([
    'Maya paid $30 for dinner, split with me',
    'Maya pagó 30 € por la cena y lo dividimos entre Alex y Maya',
    'Maya a payé 30 € pour le dîner, partagé avec Alex',
    '夕食は三千円、私が払い、全員で分ける',
    '제가 삼만원을 내고 모두 나눠요',
    'دفعت ٣٠ دولارًا للعشاء ونقسمه بين الجميع',
    'Maya ने खाने के लिए ₹३० दिए और सभी में बाँटा',
    'J’ai payé vingt euros pour le dîner, à partager entre nous tous',
    'Maya paid 三十 dollars，大家 split equally',
  ])('lets substantive natural language reach the model: %s', text => {
    expect(getAiExpensePreflightQuestion({ ...request, text })).toBeNull()
  })

  it.each(['dinner', 'cena', '晚餐', '夕食', 'العشاء'])('quickly clarifies a tiny category-only input: %s', text => {
    expect(getAiExpensePreflightQuestion({ ...request, text })).toBe(
      'Please add the total amount, who paid, and who should be included in the split.',
    )
  })

  it('uses the interface locale for an input too short to identify its language safely', () => {
    expect(getAiExpensePreflightQuestion({ ...request, text: '晚餐', locale: 'zh-CN' })).toBe(
      '请补充总金额、付款人、参与分摊的人。',
    )
  })

  it('does not use language-specific payer or split wording as a gate', () => {
    expect(getAiExpensePreflightQuestion({ ...request, text: 'Maya pagó la cena para todos' })).toBeNull()
    expect(getAiExpensePreflightQuestion({ ...request, text: 'Dinner was $30, split with Maya' })).toBeNull()
    expect(getAiExpensePreflightQuestion({ ...request, text: 'Family dinner tonight' })).toBeNull()
  })

  it('keeps the one-person quick clarification relevant', () => {
    expect(getAiExpensePreflightQuestion({
      ...request,
      text: 'coffee',
      members: [{ id: 'me', name: 'Alex' }],
    })).toBe('Please add the total amount and who paid.')
    expect(getAiExpensePreflightQuestion({
      ...request,
      text: '咖啡',
      locale: 'zh-CN',
      members: [{ id: 'me', name: 'Alex' }],
    })).toBe('请补充总金额和付款人。')
  })

  it('lets a structured clarification reach the model even when the original text is tiny', () => {
    expect(getAiExpensePreflightQuestion({
      ...request,
      text: 'dinner',
      clarifications: [{
        question: 'Please add the missing details.',
        answer: 'Maya paid $30 and split it with Alex.',
      }],
    })).toBeNull()
    expect(getAiExpensePreflightQuestion({
      ...request,
      text: 'dinner',
      clarification: { question: 'Legacy question', answer: 'Legacy answer' },
    })).toBeNull()
  })

  it('handles blank and Unicode-normalized member names defensively', () => {
    expect(getAiExpensePreflightQuestion({
      ...request,
      text: 'Ａｌｅｘ pagó la cena',
      members: [{ id: 'blank', name: ' ' }, { id: 'me', name: 'Alex' }],
    })).toBeNull()
  })

  it('provides localized recovery questions without claiming the provider is unavailable', () => {
    expect(getAiExpenseRecoveryQuestion(request)).toBe(
      'I could not determine this expense safely. Please add the total amount, who paid, and who should be included in the split.',
    )
    expect(getAiExpenseRecoveryQuestion({
      ...request,
      locale: 'zh-CN',
    })).toBe('我还不能确定这笔支出的细节。请补充总金额、付款人，以及哪些人参与分摊。')
    expect(getAiExpenseRecoveryQuestion({
      ...request,
      clarification: { question: 'Who paid?', answer: 'Maya' },
    })).toContain('rewrite the complete expense')
    expect(getAiExpenseRecoveryQuestion({
      ...request,
      locale: 'zh-CN',
      clarifications: [{ question: '谁付款？', answer: '小明' }],
    })).toContain('用一句话重新说明')
    expect(getAiExpenseRecoveryQuestion({ ...request, responseMode: 'batch' })).toContain('these expenses')
    expect(getAiExpenseRecoveryQuestion({
      ...request,
      responseMode: 'batch',
      clarifications: [{ question: 'Who paid?', answer: 'Maya' }],
    })).toContain('restate each expense')
    expect(getAiExpenseRecoveryQuestion({ ...request, locale: 'zh-CN', responseMode: 'batch' }))
      .toContain('这些支出')
    expect(getAiExpenseRecoveryQuestion({
      ...request,
      locale: 'zh-CN',
      responseMode: 'batch',
      clarifications: [{ question: '谁付款？', answer: '小明' }],
    })).toContain('重新说明每笔支出')
  })
})
