import { QueryClient } from '@tanstack/react-query'

export function createAppQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
}
