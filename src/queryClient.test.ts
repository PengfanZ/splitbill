import { describe, expect, it } from 'vitest'
import { createAppQueryClient } from './queryClient'

describe('app query client', () => {
  it('does not repeat failed live requests automatically', () => {
    const client = createAppQueryClient()

    expect(client.getDefaultOptions()).toMatchObject({
      queries: { retry: false },
      mutations: { retry: false },
    })
  })
})
