import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import type { PersistedState } from '../../domain/models'
import { translate, type Translate } from '../../i18n/localization'
import { decodeSharedActivityHash, getSharedActivitySender, type SharedActivity } from '../sharing/shareActivityUrl'
import { LiveActivityApiError, type LiveActivityRecord } from './liveActivityApi'
import { createConfiguredLiveActivityClient, type LiveActivityClient } from './liveActivityConfig'
import {
  LIVE_ACTIVITY_POLL_INTERVAL_MS,
  liveActivityPollInterval,
  liveActivityQueryKey,
} from './liveActivityQuery'
import {
  buildLiveActivityUrl,
  clearLiveActivityHash,
  parseLiveActivityHash,
  type LiveActivityCredentials,
} from './liveActivityLink'
import {
  findLiveActivityBookmarkGroupId,
  liveActivityShortcutId,
  useLiveActivityBookmarks,
} from './useLiveActivityBookmarks'

type LiveSession = { credentials: LiveActivityCredentials; record: LiveActivityRecord }
type CreateLiveActivityResult = { ok: true; code: string; url: string } | { ok: false; message: string }

type UseLiveActivitySessionOptions = {
  initialSelectedGroupId: string | null
  liveActivityClient?: LiveActivityClient | null
  onSharedActivityChange: (activity: SharedActivity | null) => void
  setPersistedState: Dispatch<SetStateAction<PersistedState>>
  t?: Translate
}

const englishT: Translate = (key, variables) => translate('en', key, variables)

export function liveActivityErrorMessage(error: unknown, t: Translate = englishT) {
  if (error instanceof LiveActivityApiError) {
    if (error.kind === 'conflict') return t('live.conflict')
    if (error.kind === 'not-found') return t('live.notFound')
    if (error.kind === 'rate-limit') return t('live.rateLimit')
    if (error.kind === 'network') return t('live.network')
    if (error.kind === 'invalid-input') return t('live.invalidInput')
  }
  return t('live.genericError')
}

export function useLiveActivitySession({
  initialSelectedGroupId,
  liveActivityClient,
  onSharedActivityChange,
  setPersistedState,
  t = englishT,
}: UseLiveActivitySessionOptions) {
  const queryClient = useQueryClient()
  const [bookmarks, setBookmarks] = useLiveActivityBookmarks()
  const [client] = useState(() => liveActivityClient === undefined ? createConfiguredLiveActivityClient() : liveActivityClient)
  const bookmarkedCredentialsAtLoad = !window.location.hash && initialSelectedGroupId ? bookmarks[initialSelectedGroupId] ?? null : null
  const [credentials, setCredentials] = useState(() => parseLiveActivityHash(window.location.hash) ?? bookmarkedCredentialsAtLoad)
  const saveInFlight = useRef(false)
  const rejectedSaveFingerprint = useRef<string | null>(null)
  const polledRevision = useRef<number | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const updateMutation = useMutation({
    mutationFn: ({ activeCredentials, expectedRevision, snapshot }: {
      activeCredentials: LiveActivityCredentials
      expectedRevision: number
      snapshot: SharedActivity
    }) => client!.update(activeCredentials, snapshot, expectedRevision),
  })

  const createMutation = useMutation({
    mutationFn: (activity: SharedActivity) => client!.create(activity),
  })

  const refreshMutation = useMutation({
    mutationFn: ({ activeClient, activeCredentials }: {
      activeClient: LiveActivityClient
      activeCredentials: LiveActivityCredentials
    }) => activeClient.load(activeCredentials),
  })

  const queryKey = credentials ? liveActivityQueryKey(credentials) : ['live-activity', 'inactive'] as const
  const liveQuery = useQuery({
    queryKey,
    enabled: Boolean(client && credentials && !updateMutation.isPending),
    queryFn: async () => {
      const activeCredentials = credentials!
      const cached = queryClient.getQueryData<LiveActivityRecord>(liveActivityQueryKey(activeCredentials))
      if (!cached) return client!.load(activeCredentials)
      const latest = await client!.poll(activeCredentials)
      if (latest.revision <= cached.revision) return cached
      const record = await client!.load(activeCredentials)
      if (record.revision > cached.revision) polledRevision.current = record.revision
      return record.revision > cached.revision ? record : cached
    },
    refetchInterval: liveActivityPollInterval,
    refetchIntervalInBackground: false,
    refetchOnReconnect: 'always',
    refetchOnWindowFocus: 'always',
    staleTime: LIVE_ACTIVITY_POLL_INTERVAL_MS,
  })
  const session: LiveSession | null = credentials && liveQuery.data
    ? { credentials, record: liveQuery.data }
    : null

  useEffect(() => {
    if (credentials && !parseLiveActivityHash(window.location.hash)) window.history.replaceState(null, '', buildLiveActivityUrl(credentials))
  }, [credentials])

  useEffect(() => {
    const syncSharedActivity = () => {
      const nextCredentials = parseLiveActivityHash(window.location.hash)
      if (nextCredentials) queryClient.removeQueries({ queryKey: liveActivityQueryKey(nextCredentials) })
      setCredentials(nextCredentials)
      setNotice(null)
      onSharedActivityChange(nextCredentials ? null : decodeSharedActivityHash(window.location.hash))
    }
    window.addEventListener('hashchange', syncSharedActivity)
    return () => window.removeEventListener('hashchange', syncSharedActivity)
  }, [onSharedActivityChange, queryClient])

  useEffect(() => {
    if (!credentials || !liveQuery.data) return
    const record = liveQuery.data
    const shortcutGroupId = findLiveActivityBookmarkGroupId(bookmarks, credentials) ?? liveActivityShortcutId(record.code)
    setBookmarks(current => findLiveActivityBookmarkGroupId(current, credentials)
      ? current
      : { ...current, [shortcutGroupId]: credentials })
    setPersistedState(current => {
      const shortcutGroup = { ...record.snapshot.group, id: shortcutGroupId }
      const hasShortcut = current.groups.some(group => group.id === shortcutGroupId)
      return {
        ...current,
        groups: hasShortcut ? current.groups.map(group => group.id === shortcutGroupId ? shortcutGroup : group) : [...current.groups, shortcutGroup],
        selectedGroupId: shortcutGroupId,
      }
    })
  }, [bookmarks, credentials, liveQuery.data, setBookmarks, setPersistedState])

  useEffect(() => {
    if (!liveQuery.data || polledRevision.current !== liveQuery.data.revision) return
    polledRevision.current = null
    setNotice(t('live.newChanges'))
  }, [liveQuery.data, t])

  const close = () => {
    queryClient.removeQueries({ queryKey })
    clearLiveActivityHash()
    setCredentials(null)
    setNotice(null)
  }

  const openBookmarked = (groupId: string) => {
    const bookmarkedCredentials = bookmarks[groupId]
    if (!bookmarkedCredentials) return false
    queryClient.removeQueries({ queryKey: liveActivityQueryKey(bookmarkedCredentials) })
    window.history.replaceState(null, '', buildLiveActivityUrl(bookmarkedCredentials))
    setPersistedState(current => ({ ...current, selectedGroupId: groupId }))
    setCredentials(bookmarkedCredentials)
    setNotice(null)
    return true
  }

  const refresh = async () => {
    const activeClient = client!
    const activeCredentials = credentials!
    try {
      const record = await refreshMutation.mutateAsync({ activeClient, activeCredentials })
      queryClient.setQueryData(liveActivityQueryKey(activeCredentials), record)
      setNotice(t('live.latestLoaded'))
    } catch (error) {
      setNotice(liveActivityErrorMessage(error, t))
    }
  }

  const save = async (snapshot: SharedActivity, successMessage: string, mutationKey: string) => {
    if (saveInFlight.current) return false
    const activeSession = session!
    const fingerprint = `${activeSession.credentials.code}:${activeSession.record.revision}:${mutationKey}`
    if (rejectedSaveFingerprint.current === fingerprint) return false
    saveInFlight.current = true
    try {
      await queryClient.cancelQueries({ queryKey: liveActivityQueryKey(activeSession.credentials) })
      polledRevision.current = null
      const record = await updateMutation.mutateAsync({
        activeCredentials: activeSession.credentials,
        expectedRevision: activeSession.record.revision,
        snapshot,
      })
      rejectedSaveFingerprint.current = null
      queryClient.setQueryData(liveActivityQueryKey(activeSession.credentials), record)
      setNotice(successMessage)
      return true
    } catch (error) {
      if (error instanceof LiveActivityApiError && error.kind === 'conflict' && error.latestRecord) {
        rejectedSaveFingerprint.current = null
        queryClient.setQueryData(liveActivityQueryKey(activeSession.credentials), error.latestRecord)
        setNotice(t('live.conflictLoaded'))
      } else {
        if (error instanceof LiveActivityApiError && error.kind === 'invalid-input') {
          rejectedSaveFingerprint.current = fingerprint
        }
        setNotice(liveActivityErrorMessage(error, t))
      }
      return false
    } finally {
      saveInFlight.current = false
    }
  }

  const create = async (activity: SharedActivity, groupId: string): Promise<CreateLiveActivityResult> => {
    if (!client) return { ok: false, message: t('live.notConfigured') }
    try {
      const created = await createMutation.mutateAsync(activity)
      const nextCredentials = { code: created.code, editToken: created.editToken }
      const url = buildLiveActivityUrl(nextCredentials)
      window.history.replaceState(null, '', url)
      queryClient.setQueryData(liveActivityQueryKey(nextCredentials), created)
      setCredentials(nextCredentials)
      setBookmarks(current => ({ ...current, [groupId]: nextCredentials }))
      setNotice(t('live.ready', { code: created.code }))
      return { ok: true, code: created.code, url }
    } catch (error) {
      return { ok: false, message: liveActivityErrorMessage(error, t) }
    }
  }

  const activity = session?.record.snapshot ?? null
  const members = activity ? [getSharedActivitySender(activity), ...activity.friends] : []
  const displayedNotice = notice
    ?? (!liveQuery.data && liveQuery.error ? liveActivityErrorMessage(liveQuery.error, t) : null)
    ?? (!client && credentials ? t('live.notConfigured') : null)
  const activityCodes = Object.fromEntries(Object.entries(bookmarks).map(([groupId, savedCredentials]) => [groupId, savedCredentials.code]))
  const bookmarkedGroupId = credentials ? findLiveActivityBookmarkGroupId(bookmarks, credentials) : null

  return {
    activity,
    activityCodes,
    bookmarkedGroupId,
    clearBookmarks: () => setBookmarks({}),
    client,
    close,
    create,
    credentials,
    displayedNotice,
    loading: Boolean(client && credentials && !session && liveQuery.isPending) || refreshMutation.isPending,
    members,
    notice,
    notify: setNotice,
    openBookmarked,
    refresh,
    removeBookmark: (groupId: string) => setBookmarks(current => Object.fromEntries(Object.entries(current).filter(([savedGroupId]) => savedGroupId !== groupId))),
    save,
    saving: updateMutation.isPending,
    session,
  }
}
