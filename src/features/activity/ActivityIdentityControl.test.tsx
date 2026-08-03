import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Member } from '../../domain/models'
import { LocalizationProvider } from '../../i18n/LocalizationContext'
import { ActivityIdentityControl } from './ActivityIdentityControl'

const members: Member[] = [
  { id: 'me', name: 'Alex', initials: 'A', color: '#abc' },
  { id: 'maya', name: 'Maya', initials: 'M', color: '#def' },
]

describe('ActivityIdentityControl', () => {
  it('requires an explicit choice and reports the selected participant', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const { rerender } = render(
      <LocalizationProvider>
        <ActivityIdentityControl className="identity-test" memberId={null} members={members} onChange={onChange} />
      </LocalizationProvider>,
    )

    const trigger = screen.getByRole('button', { name: 'Choose who you are' })
    expect(trigger).toHaveClass('identity-test')
    await user.click(trigger)
    expect(screen.getByText('Choose the activity member that represents you on this browser.')).toBeVisible()
    expect(screen.getByText('Tally uses this to understand “I” in AI entry.')).toBeVisible()
    await user.click(screen.getByRole('option', { name: 'Choose who you are' }))
    expect(onChange).not.toHaveBeenCalled()
    await user.click(trigger)
    await user.click(screen.getByRole('option', { name: /Maya/ }))
    expect(onChange).toHaveBeenCalledWith('maya')

    rerender(
      <LocalizationProvider>
        <ActivityIdentityControl memberId="maya" members={members} onChange={onChange} />
      </LocalizationProvider>,
    )
    expect(screen.getByRole('button', { name: 'Selected identity: Maya' })).toHaveValue('maya')
  })
})
