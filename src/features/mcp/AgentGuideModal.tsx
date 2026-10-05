import { useState, type ReactNode } from 'react'
import { ArrowRight, Bot, Check, CircleCheck, Copy, FlaskConical, SquareTerminal, User, Users } from 'lucide-react'
import { Button } from '../../components/Button'
import { ModalShell } from '../../components/Dialog'
import { useLocalization } from '../../i18n/LocalizationContext'
import type { TranslationKey } from '../../i18n/localization'
import { copyLink } from '../sharing/shareLink'
import { MCP_INSTALL_COMMANDS, MCP_NPM_URL } from './agentGuide'
import { loadGuideClient, saveGuideClient, type GuideClient } from './agentGuideState'

export type AgentGuideTarget = { kind: 'general' } | { kind: 'activity'; name: string; code: string }

/** Analytics names for successful copies; they carry no command or prompt text. */
export type AgentGuideCopyEvent = 'agent_install_copied_claude_code' | 'agent_install_copied_codex' | 'agent_prompt_copied'

type CopyResult = 'copied' | 'failed'

const CLIENT_NAMES: Record<GuideClient, string> = { 'claude-code': 'Claude Code', codex: 'Codex' }
const PROMPT_KEYS: TranslationKey[] = ['agentGuide.promptImport', 'agentGuide.promptOwes', 'agentGuide.promptSettle']
const FLOW: Array<{ key: TranslationKey; icon: ReactNode }> = [
  { key: 'agentGuide.flowYou', icon: <User size={16} /> },
  { key: 'agentGuide.flowAgent', icon: <Bot size={16} /> },
  { key: 'agentGuide.flowServer', icon: <SquareTerminal size={16} /> },
  { key: 'agentGuide.flowFriends', icon: <Users size={16} /> },
]

function GuideStep({ marker, title, hint, children }: { marker: string; title: string; hint: string; children?: ReactNode }) {
  return (
    <li className="agent-guide-step">
      <span className="agent-guide-step-marker" aria-hidden="true">{marker}</span>
      <div>
        <b>{title}</b>
        <small>{hint}</small>
        {children}
      </div>
    </li>
  )
}

/** Shows how to use Tally from Claude Code or Codex; labeled experimental while the integration may change. */
export function AgentGuideModal({ target, onClose, onSendFeedback, onCopied, copy = copyLink }: {
  target: AgentGuideTarget
  onClose: () => void
  onSendFeedback: () => void
  onCopied?: (event: AgentGuideCopyEvent) => void
  copy?: (text: string) => Promise<CopyResult>
}) {
  const { t } = useLocalization()
  const [client, setClient] = useState<GuideClient>(loadGuideClient)
  const [copied, setCopied] = useState<{ text: string; result: CopyResult } | null>(null)
  const installCommand = MCP_INSTALL_COMMANDS[client]
  const resultFor = (text: string) => copied?.text === text ? copied.result : null

  const chooseClient = (next: GuideClient) => {
    setClient(next)
    saveGuideClient(next)
    setCopied(null)
  }
  const copyText = async (text: string, event: AgentGuideCopyEvent) => {
    const result = await copy(text)
    setCopied({ text, result })
    if (result === 'copied') onCopied?.(event)
  }

  const installResult = resultFor(installCommand)
  const installStep = (
    <GuideStep marker="1" title={t('agentGuide.installTitle')} hint={t('agentGuide.installHint')}>
      <div className="agent-guide-command">
        <code>{installCommand}</code>
        <button type="button" onClick={() => void copyText(installCommand, client === 'codex' ? 'agent_install_copied_codex' : 'agent_install_copied_claude_code')}>
          {installResult === 'copied' ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
          {t(installResult === 'copied' ? 'agentGuide.copied' : installResult === 'failed' ? 'agentGuide.copyFailed' : 'agentGuide.copy')}
        </button>
      </div>
    </GuideStep>
  )

  return (
    <ModalShell
      eyebrow={target.kind === 'activity' ? t('agentGuide.activityEyebrow', { code: target.code }) : t('agentGuide.eyebrow')}
      title={target.kind === 'activity' ? t('agentGuide.activityTitle', { name: target.name }) : t('agentGuide.generalTitle')}
      description={t('agentGuide.description')}
      onClose={onClose}
      bodyClassName="agent-guide"
    >
      <p className="agent-guide-phone-note">{t('agentGuide.phoneNote')}</p>
      {target.kind === 'general' ? (
        <ol className="agent-guide-flow" aria-label={t('agentGuide.flowLabel')}>
          {FLOW.map((step, index) => (
            <li key={step.key}>
              <span aria-hidden="true">{step.icon}</span>
              <small>{t(step.key)}</small>
              {index < FLOW.length - 1 ? <ArrowRight className="agent-guide-flow-arrow" size={14} aria-hidden="true" /> : null}
            </li>
          ))}
        </ol>
      ) : null}
      <div className="agent-guide-tabs" role="tablist" aria-label={t('agentGuide.agentTabs')}>
        {(Object.keys(CLIENT_NAMES) as GuideClient[]).map(option => (
          <button key={option} type="button" role="tab" aria-selected={client === option} onClick={() => chooseClient(option)}>
            {CLIENT_NAMES[option]}
          </button>
        ))}
      </div>
      {target.kind === 'general' ? (
        <ol className="agent-guide-steps">
          {installStep}
          <GuideStep marker="2" title={t('agentGuide.newTitle')} hint={t('agentGuide.newHint')}>
            <p className="agent-guide-example">{t('agentGuide.newExample')}</p>
          </GuideStep>
          <GuideStep marker="·" title={t('agentGuide.existingTitle')} hint={t('agentGuide.existingHint')} />
        </ol>
      ) : (
        <>
          <ol className="agent-guide-steps">
            {installStep}
            <GuideStep marker="2" title={t('agentGuide.allowTitle', { name: target.name })} hint={t('agentGuide.allowHint')}>
              <p className="agent-guide-linked"><CircleCheck size={16} aria-hidden="true" />{t('agentGuide.autoLinked')}</p>
            </GuideStep>
            <GuideStep marker="3" title={t('agentGuide.promptsTitle')} hint={t('agentGuide.promptsHint', { agent: CLIENT_NAMES[client] })}>
              {PROMPT_KEYS.map(key => {
                const prompt = t(key, { name: target.name })
                const result = resultFor(prompt)
                return (
                  <button key={key} type="button" className="agent-guide-prompt" onClick={() => void copyText(prompt, 'agent_prompt_copied')}>
                    <span>{prompt}</span>
                    {result ? <em>{t(result === 'copied' ? 'agentGuide.copied' : 'agentGuide.copyFailed')}</em> : <Copy size={14} aria-hidden="true" />}
                  </button>
                )
              })}
            </GuideStep>
          </ol>
          <section className="agent-guide-how" aria-label={t('agentGuide.howTitle')}>
            <h3>{t('agentGuide.howTitle')}</h3>
            <div>
              <p><b>{t('agentGuide.howSaves')}</b><small>{t('agentGuide.howSavesText')}</small></p>
              <p><b>{t('agentGuide.howSync')}</b><small>{t('agentGuide.howSyncText')}</small></p>
              <p><b>{t('agentGuide.howOff')}</b><small>{t('agentGuide.howOffText')}</small></p>
            </div>
          </section>
        </>
      )}
      <p className="agent-guide-experimental">
        <FlaskConical size={16} aria-hidden="true" />
        <span>{t('agentGuide.experimentalNote')} <button type="button" onClick={onSendFeedback}>{t('agentGuide.feedback')}</button></span>
      </p>
      <div className="modal-actions agent-guide-footer">
        <a href={MCP_NPM_URL} target="_blank" rel="noreferrer">{t('agentGuide.npmGuide')}</a>
        <Button variant="primary" onClick={onClose}>{t('agentGuide.done')}</Button>
      </div>
    </ModalShell>
  )
}
