import { describe, expect, it } from 'vitest'
import { isEmbeddedWindow, renderFrameProtection } from './frameProtection'

describe('frame protection', () => {
  it('distinguishes the top-level app from an embedded copy', () => {
    const topLevel = {} as Window

    expect(isEmbeddedWindow({ self: topLevel, top: topLevel })).toBe(false)
    expect(isEmbeddedWindow({ self: {} as Window, top: topLevel })).toBe(true)
    expect(isEmbeddedWindow()).toBe(false)
  })

  it('replaces embedded app controls with a safe top-level link', () => {
    const root = document.createElement('div')
    root.textContent = 'Sensitive app controls'

    renderFrameProtection(root, document, 'https://example.com/splitbill/#live=capability')

    expect(root).toHaveTextContent('Tally cannot run inside another website')
    expect(root).not.toHaveTextContent('Sensitive app controls')
    expect(root.querySelector('main')).toHaveClass('frame-protection')
    expect(root.querySelector('a')).toMatchObject({
      href: 'https://example.com/splitbill/#live=capability',
      target: '_top',
      rel: 'noopener noreferrer',
      textContent: 'Open Tally',
    })
  })
})
