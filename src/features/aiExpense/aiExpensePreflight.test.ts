import { describe, expect, it } from 'vitest'
import type { AiExpenseRequest } from './aiExpenseContract'
import { getAiExpensePreflightQuestion } from './aiExpensePreflight'

const request: AiExpenseRequest = {
  text: 'Maya paid $30 for dinner, split with me',
  locale: 'en',
  currency: 'USD',
  members: [{ id: 'me', name: 'Alex' }, { id: 'maya', name: 'Maya' }],
}

describe('AI expense preflight', () => {
  it('lets complete English and Chinese descriptions reach the model', () => {
    expect(getAiExpensePreflightQuestion(request)).toBeNull()
    expect(getAiExpensePreflightQuestion({
      ...request,
      text: '小明付了三百元晚餐费，小明、小红和我平分',
      locale: 'zh-CN',
      members: [{ id: 'me', name: '小红' }, { id: 'ming', name: '小明' }],
    })).toBeNull()
    expect(getAiExpensePreflightQuestion({
      ...request,
      text: 'I paid twenty dollars for lunch, split with Maya',
    })).toBeNull()
  })

  it('asks for every missing detail in one localized question', () => {
    expect(getAiExpensePreflightQuestion({ ...request, text: 'dinner' })).toBe(
      'Please add the total amount, who paid, and who should be included in the split.',
    )
    expect(getAiExpensePreflightQuestion({ ...request, text: '晚餐', locale: 'zh-CN' })).toBe(
      '请补充总金额、付款人、参与分摊的人。',
    )
    expect(getAiExpensePreflightQuestion({ ...request, text: 'Maya paid for dinner' })).toBe(
      'Please add the total amount and who should be included in the split.',
    )
  })

  it.each([
    ['Maya paid for dinner, split with me', 'What was the total amount?'],
    ['Dinner was $30, split with Maya', 'Who paid?'],
    ['Dinner was paid by Maya for $30', 'Who should be included in the split?'],
  ])('asks only for the missing detail in %s', (text, question) => {
    expect(getAiExpensePreflightQuestion({ ...request, text })).toBe(question)
  })

  it('does not require split wording for a one-person activity', () => {
    expect(getAiExpensePreflightQuestion({
      ...request,
      text: 'I paid $8 for coffee',
      members: [{ id: 'me', name: 'Alex' }],
    })).toBeNull()
  })

  it('recognizes Chinese single-detail questions and payment phrasing', () => {
    expect(getAiExpensePreflightQuestion({
      ...request,
      text: '小明付了晚餐费，大家平分',
      locale: 'zh-CN',
      members: [{ id: 'ming', name: '小明' }, { id: 'hong', name: '小红' }],
    })).toBe('这笔支出的总金额是多少？')
    expect(getAiExpensePreflightQuestion({
      ...request,
      text: '晚餐 300 元，大家平分',
      locale: 'zh-CN',
      members: [{ id: 'ming', name: '小明' }, { id: 'hong', name: '小红' }],
    })).toBe('是谁付款的？')
    expect(getAiExpensePreflightQuestion({
      ...request,
      text: '小明支付了 300 元晚餐费',
      locale: 'zh-CN',
      members: [{ id: 'ming', name: '小明' }, { id: 'hong', name: '小红' }],
    })).toBe('哪些人需要参与分摊？')
  })

  it('handles a blank member name defensively', () => {
    expect(getAiExpensePreflightQuestion({
      ...request,
      text: 'Dinner was $30, split equally',
      members: [{ id: 'blank', name: ' ' }],
    })).toBe('Who paid?')
  })
})
