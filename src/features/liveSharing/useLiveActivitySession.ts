import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import type { PersistedState } from '../../domain/models'
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

type LiveSession = { credentials: LiveActivityCredentials; record: LiveActivityRecord }
type CreateLiveActivityResult = { ok: true; code: string; url: string } | { ok: false; message: string }

type UseLiveActivitySessionOptions = {
  initialSelectedGroupId: string | null
  liveActivityClient?: LiveActivityClient | null
  onSharedActivityChange: (activity: SharedActivity | null) => void
  setPersistedState: Dispatch<SetStateAction<PersistedState>>
}

export function liveActivityErrorMessage(error: unknown) {
  if (error instanceof LiveActivityApiError) {
    if (error.kind === 'conflict') return 'Someone saved a newer version. Refresh the activity, then try your change again.'
    if (error.kind === 'not-found') return 'This live activity link is invalid or no longer available.'
    if (error.kind === 'rate-limit') return 'Too many live activity requests from this network. Wait a few minutes, then try again.'
    if (error.kind === 'network') return 'Could not reach the live activity service. Check your connection and try again.'
  }
  return 'The live activity could not be updated. Please try again.'
}

export function useLiveActivitySession({
  initialSelectedGroupId,
  liveActivityClient,
  onSharedActivityChange,
  setPersistedState,
}: UseLiveActivitySessionOptions) {
  const [bookmarks, setBookmarks] = useLiveActivityBookmarks()
  const [client] = useState(() => liveActivityClient === undefined ? createConfiguredLiveActivityClient() : liveActivityClient)
  const bookmarkedCredentialsAtLoad = !window.location.hash && initialSelectedGroupId ? bookmarks[initialSelectedGroupId] ?? null : null
  const [credentials, setCredentials] = useState(() => parseLiveActivityHash(window.location.hash) ?? bookmarkedCredentialsAtLoad)
  const [session, setSession] = useState<LiveSession | null>(null)
  const [loading, setLoading] = useState(() => Boolean((parseLiveActivityHash(window.location.hash) ?? bookmarkedCredentialsAtLoad) && client))
  const [saving, setSaving] = useState(false)
  const saveInFlight = useRef(false)
  const [notice, setNotice] = useState<string | null>(null)

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
      if (active) setNotice(liveActivityErrorMessage(error))
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => { active = false }
  }, [bookmarks, client, credentials, session, setBookmarks, setPersistedState])

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
      setNotice('Latest changes loaded.')
    } catch (error) {
      setNotice(liveActivityErrorMessage(error))
    } finally {
      setLoading(false)
    }
  }

  const save = async (snapshot: SharedActivity, successMessage: string) => {
    if (saveInFlight.current) return false
    const activeClient = client!
    const activeSession = session!
    saveInFlight.current = true
    setSaving(true)
    try {
      const record = await activeClient.update(activeSession.credentials, snapshot, activeSession.record.revision)
      setSession({ credentials: activeSession.credentials, record })
      setNotice(successMessage)
      return true
    } catch (error) {
      if (error instanceof LiveActivityApiError && error.kind === 'conflict' && error.latestRecord) {
        setSession({ credentials: activeSession.credentials, record: error.latestRecord })
        setNotice('Someone saved a newer version. The latest changes are loaded—review and save again.')
      } else {
        setNotice(liveActivityErrorMessage(error))
      }
      return false
    } finally {
      saveInFlight.current = false
      setSaving(false)
    }
  }

  const create = async (activity: SharedActivity, groupId: string): Promise<CreateLiveActivityResult> => {
    if (!client) return { ok: false, message: 'Live sharing is not configured in this build.' }
    try {
      const created = await client.create(activity)
      const nextCredentials = { code: created.code, editToken: created.editToken }
      const url = buildLiveActivityUrl(nextCredentials)
      window.history.replaceState(null, '', url)
      setCredentials(nextCredentials)
      setSession({ credentials: nextCredentials, record: created })
      setBookmarks(current => ({ ...current, [groupId]: nextCredentials }))
      setLoading(false)
      setNotice(`Live activity ${created.code} is ready. Changes in this tab now sync to the shared activity.`)
      return { ok: true, code: created.code, url }
    } catch (error) {
      return { ok: false, message: liveActivityErrorMessage(error) }
    }
  }

  const activity = session?.record.snapshot ?? null
  const members = activity ? [getSharedActivitySender(activity), ...activity.friends] : []
  const displayedNotice = notice ?? (!client && credentials ? 'Live sharing is not configured in this build.' : null)
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
