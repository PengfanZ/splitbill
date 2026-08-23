import { describe, expect, it, vi } from 'vitest'
import { selectInputContents } from './inputInteractions'

describe('selectInputContents', () => {
  it('selects an existing value so typing can replace it immediately', () => {
    const input = document.createElement('input')
    input.value = '38.23'
    const select = vi.spyOn(input, 'select')

    selectInputContents({ currentTarget: input } as never)

    expect(select).toHaveBeenCalledOnce()
  })

  it('leaves an empty input ready for normal typing', () => {
    const input = document.createElement('input')
    const select = vi.spyOn(input, 'select')

    selectInputContents({ currentTarget: input } as never)

    expect(select).not.toHaveBeenCalled()
  })
})
