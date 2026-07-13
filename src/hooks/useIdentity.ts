import { useEffect, useState } from 'react'
import { loadIdentity, saveIdentity } from '../data/identity'
import type { Member } from '../domain/models'

export function useIdentity() {
  const [identity, setIdentity] = useState<Member | null>(() => loadIdentity())

  useEffect(() => {
    if (identity) saveIdentity(identity)
  }, [identity])

  return [identity, setIdentity] as const
}
