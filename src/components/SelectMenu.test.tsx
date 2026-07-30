import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SelectMenu, type SelectMenuOption } from './SelectMenu'

type Choice = 'alpha' | 'beta' | 'gamma'

const options: ReadonlyArray<SelectMenuOption<Choice>> = [
  { value: 'alpha', label: 'Alpha', detail: 'First', leading: 'A' },
  { value: 'beta', label: 'Beta', detail: 'Second', leading: 'B', searchText: 'Bravo' },
  { value: 'gamma', label: 'Gamma' },
]

afterEach(() => {
  vi.useRealTimers()
})

describe('SelectMenu', () => {
  it('renders its value, heading, portal options, and selects with restored focus', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <SelectMenu
        value="alpha"
        options={options}
        onChange={onChange}
        ariaLabel="Choose item"
        menuLabel="Items"
        title="Available items"
        description="Pick one."
        className="custom-select"
      />,
    )

    const trigger = screen.getByRole('button', { name: 'Choose item' })
    expect(trigger).toHaveClass('custom-select')
    expect(trigger).toHaveValue('alpha')
    expect(trigger).toHaveTextContent('Alpha')
    expect(trigger).toHaveTextContent('First')
    await user.click(trigger)
    expect(screen.getByRole('listbox', { name: 'Items' })).toBeVisible()
    expect(screen.getByText('Available items')).toBeVisible()
    expect(screen.getByText('Pick one.')).toBeVisible()
    expect(screen.getByRole('option', { name: 'Alpha' })).toHaveAttribute('aria-selected', 'true')

    await user.click(screen.getByRole('option', { name: 'Beta' }))
    expect(onChange).toHaveBeenCalledWith('beta')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('supports arrow, boundary, Escape, Tab, and typeahead keyboard behavior', () => {
    vi.useFakeTimers()
    render(
      <SelectMenu
        value="beta"
        options={options}
        onChange={vi.fn()}
        ariaLabel="Keyboard item"
        menuLabel="Keyboard items"
      />,
    )
    const trigger = screen.getByRole('button', { name: 'Keyboard item' })

    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    expect(screen.getByRole('option', { name: 'Beta' })).toHaveFocus()
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'ArrowDown' })
    expect(screen.getByRole('option', { name: 'Gamma' })).toHaveFocus()
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'ArrowDown' })
    expect(screen.getByRole('option', { name: 'Alpha' })).toHaveFocus()
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'ArrowUp' })
    expect(screen.getByRole('option', { name: 'Gamma' })).toHaveFocus()
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Home' })
    expect(screen.getByRole('option', { name: 'Alpha' })).toHaveFocus()
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'End' })
    expect(screen.getByRole('option', { name: 'Gamma' })).toHaveFocus()

    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'b' })
    expect(screen.getByRole('option', { name: 'Beta' })).toHaveFocus()
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'z' })
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'x', ctrlKey: true })
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'x', metaKey: true })
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'x', altKey: true })
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Enter' })
    act(() => vi.advanceTimersByTime(500))
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'a' })
    expect(screen.getByRole('option', { name: 'Alpha' })).toHaveFocus()
    act(() => vi.advanceTimersByTime(500))
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Tab' })
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()

    fireEvent.keyDown(trigger, { key: 'ArrowUp' })
    expect(screen.getByRole('listbox')).toBeVisible()
    fireEvent.keyDown(trigger, { key: 'Escape' })
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
    fireEvent.keyDown(trigger, { key: 'Escape' })
  })

  it('closes outside, stays open inside, and repositions with viewport changes', async () => {
    const user = userEvent.setup()
    const getBoundingClientRect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      bottom: 140,
      height: 44,
      left: 900,
      right: 1000,
      top: 96,
      width: 100,
      x: 900,
      y: 96,
      toJSON: () => ({}),
    })
    render(
      <SelectMenu
        value="alpha"
        options={options}
        onChange={vi.fn()}
        ariaLabel="Compact item"
        menuLabel="Compact items"
        variant="compact"
        align="end"
      />,
    )
    const trigger = screen.getByRole('button', { name: 'Compact item' })
    await user.click(trigger)
    const listbox = screen.getByRole('listbox')
    expect(listbox).toHaveClass('select-menu-popover--compact')
    expect(listbox).toHaveStyle({ top: '147px', width: '320px' })

    fireEvent.mouseDown(screen.getByRole('option', { name: 'Alpha' }))
    expect(listbox).toBeVisible()
    fireEvent.resize(window)
    fireEvent.scroll(window)
    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()

    await user.click(trigger)
    await user.click(trigger)
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    getBoundingClientRect.mockRestore()
  })

  it('supports a custom trigger and renders nothing for an empty option list', () => {
    const { rerender } = render(
      <SelectMenu
        value="alpha"
        options={options}
        onChange={vi.fn()}
        ariaLabel="Custom item"
        menuLabel="Custom items"
        renderValue={option => <strong>Selected: {option.label}</strong>}
      />,
    )
    expect(screen.getByRole('button', { name: 'Custom item' })).toHaveTextContent('Selected: Alpha')

    rerender(
      <SelectMenu
        value="alpha"
        options={[]}
        onChange={vi.fn()}
        ariaLabel="Empty item"
        menuLabel="Empty items"
      />,
    )
    expect(screen.queryByRole('button', { name: 'Empty item' })).not.toBeInTheDocument()
  })

  it('renders heading fields independently', async () => {
    const user = userEvent.setup()
    const { rerender } = render(
      <SelectMenu
        value="alpha"
        options={options}
        onChange={vi.fn()}
        ariaLabel="Title item"
        menuLabel="Title items"
        title="Title only"
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Title item' }))
    expect(screen.getByText('Title only')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Title item' }))

    rerender(
      <SelectMenu
        value="alpha"
        options={options}
        onChange={vi.fn()}
        ariaLabel="Description item"
        menuLabel="Description items"
        description="Description only"
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Description item' }))
    expect(screen.getByText('Description only')).toBeVisible()
  })
})
