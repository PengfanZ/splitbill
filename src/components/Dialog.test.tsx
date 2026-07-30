import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { ModalShell } from './Dialog'

function DialogHarness() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button onClick={() => setOpen(true)}>Open dialog</button>
      {open ? (
        <ModalShell
          eyebrow="Details"
          title="Accessible dialog"
          description="A shared dialog description."
          onClose={() => setOpen(false)}
          mobilePlacement="center"
          size="wide"
          bodyClassName="custom-body"
        >
          <input aria-label="First field" autoFocus />
          <button>Last action</button>
        </ModalShell>
      ) : null}
    </>
  )
}

describe('ModalShell', () => {
  it('manages initial focus, traps focus, closes on Escape, and restores the opener', async () => {
    const user = userEvent.setup()
    render(<DialogHarness />)
    const opener = screen.getByRole('button', { name: 'Open dialog' })

    await user.click(opener)
    const dialog = screen.getByRole('dialog', { name: 'Accessible dialog' })
    const first = screen.getByRole('textbox', { name: 'First field' })
    const last = screen.getByRole('button', { name: 'Last action' })
    const close = screen.getByRole('button', { name: 'Close' })
    expect(dialog).toHaveClass('modal--wide')
    expect(dialog).toHaveAttribute('aria-describedby')
    expect(dialog.querySelector('.custom-body')).toBeInTheDocument()
    expect(first).toHaveFocus()

    last.focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(close).toHaveFocus()
    close.focus()
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(last).toHaveFocus()
    first.focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(first).toHaveFocus()
    fireEvent.keyDown(document, { key: 'Enter' })
    expect(dialog).toBeVisible()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(opener).toHaveFocus()
  })

  it('keeps clicks inside, dismisses from the backdrop and close control', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const { container } = render(
      <ModalShell title="Dismissible" onClose={onClose}>
        <button>Inside</button>
      </ModalShell>,
    )

    fireEvent.mouseDown(screen.getByRole('dialog'))
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.mouseDown(container.querySelector('.modal-backdrop')!)
    expect(onClose).toHaveBeenCalledOnce()
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('focuses the dialog itself when it has no controls and remains non-dismissible', () => {
    const { container } = render(
      <ModalShell title="Required">
        <span>Read this first</span>
      </ModalShell>,
    )
    const dialog = screen.getByRole('dialog', { name: 'Required' })
    expect(dialog).toHaveFocus()
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(dialog).toHaveFocus()
    fireEvent.mouseDown(container.querySelector('.modal-backdrop')!)
    expect(dialog).toBeVisible()
  })
})
