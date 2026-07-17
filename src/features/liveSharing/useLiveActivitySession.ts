import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import type { PersistedState } from '../../domain/models'
import { translate, type Translate } from '../../i18n/localization'
import { decodeSharedActivityHash, getSharedActivitySender, type SharedActivity } from '../sharing/shareActivityUrl'
import { LiveActivityApiError, type LiveActivityRecord } from './liveActivityApi'
import { createConfiguredLiveActivityClient, type LiveActivityClient } from './liveActivityConfig'
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
import { useLiveActivityPolling } from './useLiveActivityPolling'

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
  const [bookmarks, setBookmarks] = useLiveActivityBookmarks()
  const [client] = useState(() => liveActivityClient === undefined ? createConfiguredLiveActivityClient() : liveActivityClient)
  const bookmarkedCredentialsAtLoad = !window.location.hash && initialSelectedGroupId ? bookmarks[initialSelectedGroupId] ?? null : null
  const [credentials, setCredentials] = useState(() => parseLiveActivityHash(window.location.hash) ?? bookmarkedCredentialsAtLoad)
  const [session, setSession] = useState<LiveSession | null>(null)
  const [loading, setLoading] = useState(() => Boolean((parseLiveActivityHash(window.location.hash) ?? bookmarkedCredentialsAtLoad) && client))
  const [saving, setSaving] = useState(false)
  const saveInFlight = useRef(false)
  const rejectedSaveFingerprint = useRef<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useLiveActivityPolling({
    enabled: Boolean(client && credentials && session && !saving),
    poll: async () => {
      const latest = await client!.poll(credentials!)
      return latest.revision > session!.record.revision
        ? client!.load(credentials!)
        : null
    },
    onResult: record => {
      if (!record) return
      const activeSession = session!
      if (record.revision <= activeSession.record.revision) return
      setSession({ credentials: activeSession.credentials, record })
      setNotice(t('live.newChanges'))
    },
  })

  useEffect(() => {
    if (credentials && !parseLiveActivityHash(window.location.hash)) window.history.replaceState(null, '', buildLiveActivityUrl(credentials))
  }, [credentials])

  useEffect(() => {
    const syncSharedActivity = () => {
      const nextCredentials = parseLiveActivityHash(window.location.hash)
      setCredentials(nextCredentials)
      setSession(null)
      setNotice(null)
      setLoading(Boolean(nextCredentials && client))
      onSharedActivityChange(nextCredentials ? null : decodeSharedActivityHash(window.location.hash))
    }
    window.addEventListener('hashchange', syncSharedActivity)
    return () => window.removeEventListener('hashchange', syncSharedActivity)
  }, [client, onSharedActivityChange])

  useEffect(() => {
    if (!credentials || !client || (session && session.credentials.code === credentials.code && session.credentials.editToken === credentials.editToken)) return
    let active = true
    client.load(credentials).then(record => {
      if (!active) return
      const shortcutGroupId = findLiveActivityBookmarkGroupId(bookmarks, credentials) ?? liveActivityShortcutId(record.code)
      setSession({ credentials, record })
      setNotice(null)
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
    }).catch(error => {
      if (active) setNotice(liveActivityErrorMessage(error, t))
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => { active = false }
  }, [bookmarks, client, credentials, session, setBookmarks, setPersistedState, t])

  const close = () => {
    clearLiveActivityHash()
    setCredentials(null)
    setSession(null)
    setNotice(null)
  }

  const openBookmarked = (groupId: string) => {
    const bookmarkedCredentials = bookmarks[groupId]
    if (!bookmarkedCredentials) return false
    window.history.replaceState(null, '', buildLiveActivityUrl(bookmarkedCredentials))
    setPersistedState(current => ({ ...current, selectedGroupId: groupId }))
    setCredentials(bookmarkedCredentials)
    setSession(null)
    setNotice(null)
    setLoading(Boolean(client))
    return true
  }

  const refresh = async () => {
    const activeClient = client!
    const activeCredentials = credentials!
    setLoading(true)
    try {
      const record = await activeClient.load(activeCredentials)
      setSession({ credentials: activeCredentials, record })
      setNotice(t('live.latestLoaded'))
    } catch (error) {
      setNotice(liveActivityErrorMessage(error, t))
    } finally {
      setLoading(false)
    }
  }

  const save = async (snapshot: SharedActivity, successMessage: string, mutationKey: string) => {
    if (saveInFlight.current) return false
    const activeClient = client!
    const activeSession = session!
    const fingerprint = `${activeSession.credentials.code}:${activeSession.record.revision}:${mutationKey}`
    if (rejectedSaveFingerprint.current === fingerprint) return false
    saveInFlight.current = true
    setSaving(true)
    try {
      const record = await activeClient.update(activeSession.credentials, snapshot, activeSession.record.revision)
      rejectedSaveFingerprint.current = null
      setSession({ credentials: activeSession.credentials, record })
      setNotice(successMessage)
      return true
    } catch (error) {
      if (error instanceof LiveActivityApiError && error.kind === 'conflict' && error.latestRecord) {
        rejectedSaveFingerprint.current = null
        setSession({ credentials: activeSession.credentials, record: error.latestRecord })
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
      setSaving(false)
    }
  }

  const create = async (activity: SharedActivity, groupId: string): Promise<CreateLiveActivityResult> => {
    if (!client) return { ok: false, message: t('live.notConfigured') }
    try {
      const created = await client.create(activity)
      const nextCredentials = { code: created.code, editToken: created.editToken }
      const url = buildLiveActivityUrl(nextCredentials)
      window.history.replaceState(null, '', url)
      setCredentials(nextCredentials)
      setSession({ credentials: nextCredentials, record: created })
      setBookmarks(current => ({ ...current, [groupId]: nextCredentials }))
      setLoading(false)
      setNotice(t('live.ready', { code: created.code }))
      return { ok: true, code: created.code, url }
    } catch (error) {
      return { ok: false, message: liveActivityErrorMessage(error, t) }
    }
  }

  const activity = session?.record.snapshot ?? null
  const members = activity ? [getSharedActivitySender(activity), ...activity.friends] : []
  const displayedNotice = notice ?? (!client && credentials ? t('live.notConfigured') : null)
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
    loading,
    members,
    notice,
    notify: setNotice,
    openBookmarked,
    refresh,
    removeBookmark: (groupId: string) => setBookmarks(current => Object.fromEntries(Object.entries(current).filter(([savedGroupId]) => savedGroupId !== groupId))),
    save,
    saving,
    session,
  }
}
