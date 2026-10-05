import { useEffect, useRef, useState, type FormEvent } from 'react'
import { CircleCheck, Info, ShieldCheck } from 'lucide-react'
import { Button } from '../../components/Button'
import { ModalShell } from '../../components/Dialog'
import { SelectMenu } from '../../components/SelectMenu'
import { loadActivityIdentitySelections } from '../../data/activityIdentity'
import { useLocalization } from '../../i18n/LocalizationContext'
import { loadLiveActivityBookmarks } from '../liveSharing/useLiveActivityBookmarks'
import { loadLiveActivityMirrors } from '../liveSharing/useLiveActivityMirrors'
import {
  AGENT_LINK_HASH_PREFIX,
  AGENT_LINK_MAX_ACTIVITIES,
  agentLinkCallbackUrl,
  parseAgentLinkHash,
  type AgentClient,
  type AgentLinkPayload,
  type AgentLinkRequest,
} from './agentLinkProtocol'
import { linkableActivities, type LinkableActivity } from './linkableActivities'

export function AgentLinkApprovalModal({ activities, client, hasUnavailable, onApprove, onCancel }: {
  activities: LinkableActivity[]
  client: AgentClient
  hasUnavailable: boolean
  onApprove: (activities: AgentLinkPayload['activities']) => void
  onCancel: () => void
}) {
  const { t } = useLocalization()
  // Only the person's own choices are kept, so activities that appear later still get their defaults.
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [memberIds, setMemberIds] = useState<Record<string, string>>({})
  const isSelected = (activity: LinkableActivity) => selected[activity.code] ?? activities.length === 1
  const memberFor = (activity: LinkableActivity) => memberIds[activity.code] ?? activity.defaultMemberId ?? ''
  const chosen = activities.filter(isSelected)
  const ready = chosen.length > 0
    && chosen.length <= AGENT_LINK_MAX_ACTIVITIES
    && chosen.every(memberFor)
  const clientName = client === 'claude-code' ? 'Claude Code' : client === 'codex' ? 'Codex' : t('agentLink.otherClient')

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!ready) return
    onApprove(chosen.map(activity => ({ code: activity.code, editToken: activity.editToken, memberId: memberFor(activity) })))
  }

  return (
    <ModalShell
      eyebrow={t('agentLink.eyebrow')}
      title={t('agentLink.title', { client: clientName })}
      description={t('agentLink.description')}
      onClose={onCancel}
      mobilePlacement="center"
    >
      <form className="agent-link-form" onSubmit={submit}>
        {activities.length ? (
          <ul className="agent-link-list" aria-label={t('agentLink.activities')}>
            {activities.map(activity => (
              <li key={activity.code} className="agent-link-row">
                <label className="agent-link-choice">
                  <input
                    type="checkbox"
                    checked={isSelected(activity)}
                    onChange={event => setSelected(current => ({ ...current, [activity.code]: event.target.checked }))}
                  />
                  <span>
                    <b>{activity.name}</b>
                    <small>{t('agentLink.activityDetail', { code: activity.code, names: activity.members.map(member => member.name).join(', ') })}</small>
                  </span>
                </label>
                <div className="agent-link-member">
                  <span aria-hidden="true">{t('agentLink.youAre')}</span>
                  <SelectMenu
                    value={memberFor(activity)}
                    options={[
                      { value: '', label: t('agentLink.chooseMember') },
                      ...activity.members.map(member => ({ value: member.id, label: member.name })),
                    ]}
                    onChange={memberId => {
                      setMemberIds(current => ({ ...current, [activity.code]: memberId }))
                      if (memberId) setSelected(current => ({ ...current, [activity.code]: true }))
                    }}
                    ariaLabel={t('agentLink.youAreLabel', { name: activity.name })}
                    menuLabel={t('agentLink.youAreLabel', { name: activity.name })}
                  />
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="split-note"><Info size={18} /><span>{t('agentLink.empty')}</span></div>
        )}
        {hasUnavailable ? <p className="agent-link-unavailable">{t('agentLink.unavailable')}</p> : null}
        {activities.length ? (
          <div className="agent-link-notes">
            <div className="split-note identity-note"><CircleCheck size={18} /><span><small>{t('agentLink.saveNote')}</small></span></div>
            <div className="split-note identity-note"><ShieldCheck size={18} /><span><small>{t('agentLink.privacyNote')}</small></span></div>
            <p>{t('agentLink.revokeNote')}</p>
          </div>
        ) : null}
        <div className="modal-actions">
          <Button onClick={onCancel}>{activities.length ? t('agentLink.deny') : t('common.close')}</Button>
          {activities.length ? <Button variant="primary" type="submit" disabled={!ready}>{t('agentLink.allow')}</Button> : null}
        </div>
      </form>
    </ModalShell>
  )
}

/** Analytics names for the approval screen; they carry no activity, code or link. */
export type AgentLinkEvent = 'agent_link_requested' | 'agent_link_allowed' | 'agent_link_denied'

/** Shows the approval screen when tally-splitbill-mcp opens `#agent-link=…`, then hands the choice to it on 127.0.0.1. */
export function AgentLinkGate({ identityName, navigate = url => window.location.assign(url), onAnalytics }: {
  identityName?: string
  navigate?: (url: string) => void
  onAnalytics?: (event: AgentLinkEvent) => void
}) {
  const [request, setRequest] = useState<AgentLinkRequest | null>(() => parseAgentLinkHash(window.location.hash))
  const analyticsRef = useRef(onAnalytics)

  useEffect(() => {
    analyticsRef.current = onAnalytics
  }, [onAnalytics])

  useEffect(() => {
    // Once per request, not per render.
    if (request) analyticsRef.current?.('agent_link_requested')
  }, [request])

  useEffect(() => {
    const sync = () => {
      const next = parseAgentLinkHash(window.location.hash)
      if (next) setRequest(next)
    }
    window.addEventListener('hashchange', sync)
    return () => window.removeEventListener('hashchange', sync)
  }, [])

  useEffect(() => {
    // The request is one-shot: keep it out of the address bar so a reload or bookmark can't replay it.
    if (!request || !window.location.hash.startsWith(AGENT_LINK_HASH_PREFIX)) return
    const url = new URL(window.location.href)
    url.hash = ''
    window.history.replaceState(null, '', url)
  }, [request])

  if (!request) return null
  return (
    <AgentLinkRequestModal
      key={`${request.port}.${request.state}`}
      request={request}
      identityName={identityName}
      onClose={() => {
        analyticsRef.current?.('agent_link_denied')
        setRequest(null)
      }}
      navigate={url => {
        analyticsRef.current?.('agent_link_allowed')
        navigate(url)
      }}
    />
  )
}

const readLinkableActivities = (identityName?: string) => linkableActivities(
  loadLiveActivityBookmarks(),
  loadLiveActivityMirrors(),
  loadActivityIdentitySelections(),
  identityName,
)

/** Reads this browser's Live activities without subscribing to or rewriting their storage. */
function AgentLinkRequestModal({ identityName, navigate, onClose, request }: {
  identityName?: string
  navigate: (url: string) => void
  onClose: () => void
  request: AgentLinkRequest
}) {
  const [{ activities, unavailable }, setLinkable] = useState(() => readLinkableActivities(identityName))

  useEffect(() => {
    // Another tab may finish opening an activity after this screen appears, so read again when it saves or the person returns.
    const refresh = () => setLinkable(readLinkableActivities(identityName))
    window.addEventListener('storage', refresh)
    window.addEventListener('focus', refresh)
    return () => {
      window.removeEventListener('storage', refresh)
      window.removeEventListener('focus', refresh)
    }
  }, [identityName])
  return (
    <AgentLinkApprovalModal
      activities={activities}
      client={request.client}
      hasUnavailable={unavailable > 0}
      onCancel={onClose}
      onApprove={approved => navigate(agentLinkCallbackUrl(request, { state: request.state, activities: approved }))}
    />
  )
}
