import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { LocalizationProvider } from '../../i18n/LocalizationContext'
import { FriendNameInput } from './FriendNameInput'

function TestField({ locale = 'en' }: { locale?: 'en' | 'zh-CN' }) {
  const [draft, setDraft] = useState('')
  const [names, setNames] = useState<string[]>([])
  return (
    <LocalizationProvider initialLocale={locale}>
      <FriendNameInput draft={draft} names={names} onDraftChange={setDraft} onNamesChange={setNames} />
    </LocalizationProvider>
  )
}

describe('FriendNameInput', () => {
  it('adds one name with Enter and lets the user remove it', async () => {
    const user = userEvent.setup()
    render(<TestField />)

    const input = screen.getByLabelText(/Friend names/)
    await user.type(input, 'Maya{Enter}')
    expect(screen.getByText('Maya')).toBeVisible()
    expect(screen.getByText('1 friend ready')).toBeVisible()
    expect(input).toHaveValue('')

    await user.type(input, 'maya{Enter}')
    expect(screen.getAllByText(/Maya/i)).toHaveLength(1)
    expect(input).toHaveValue('maya')
    await user.clear(input)

    await user.click(screen.getByRole('button', { name: 'Remove Maya' }))
    expect(screen.queryByText('Maya')).not.toBeInTheDocument()
    expect(screen.getByText('No friends added yet.')).toBeVisible()
  })

  it('accepts pasted Chinese punctuation, removes duplicates, and localizes the UI', async () => {
    const user = userEvent.setup()
    render(<TestField locale="zh-CN" />)

    await user.type(screen.getByLabelText(/朋友姓名/), '小明，小红、小明')
    await user.click(screen.getByRole('button', { name: '添加' }))
    expect(screen.getByText('小明')).toBeVisible()
    expect(screen.getByText('小红')).toBeVisible()
    expect(screen.getByText('已准备添加 2 位朋友')).toBeVisible()
  })

  it('does not submit Enter while an input method editor is composing', async () => {
    const user = userEvent.setup()
    render(<TestField />)
    const input = screen.getByLabelText(/Friend names/)

    await user.type(input, '小明')
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
    expect(screen.queryByRole('list', { name: 'Friends ready to add' })).not.toBeInTheDocument()
    expect(input).toHaveValue('小明')
  })
})
