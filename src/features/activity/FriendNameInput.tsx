import { useId, type KeyboardEvent } from 'react'
import { Plus, X } from 'lucide-react'
import { useLocalization } from '../../i18n/LocalizationContext'
import { mergeMemberNames } from '../../domain/members'

export function FriendNameInput({
  draft,
  fieldContext = 'friend',
  names,
  onDraftChange,
  onNamesChange,
}: {
  draft: string
  fieldContext?: 'friend' | 'group'
  names: string[]
  onDraftChange: (value: string) => void
  onNamesChange: (names: string[]) => void
}) {
  const { t } = useLocalization()
  const inputId = useId()
  const label = fieldContext === 'group' ? t('group.addFriends') : t('friend.names')
  const help = fieldContext === 'group' ? t('group.addFriendsHelp') : t('friend.namesHelp')
  const placeholder = fieldContext === 'group' ? t('group.addFriendsPlaceholder') : t('friend.namesPlaceholder')
  const hasAddableName = mergeMemberNames(names, draft).length > names.length

  const addDraft = () => {
    const next = mergeMemberNames(names, draft)
    if (next.length === names.length) return
    onNamesChange(next)
    onDraftChange('')
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
    event.preventDefault()
    addDraft()
  }

  const removeName = (index: number) => {
    onNamesChange(names.filter((_, nameIndex) => nameIndex !== index))
  }

  const pendingCount = mergeMemberNames(names, draft).length

  return (
    <div className="friend-name-field">
      <label htmlFor={inputId}>
        {label}
        <small>{help}</small>
      </label>
      <div className="friend-name-entry">
        <input
          id={inputId}
          autoFocus
          value={draft}
          onChange={event => onDraftChange(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
        />
        <button type="button" onClick={addDraft} disabled={!hasAddableName}>
          <Plus size={15} />
          {t('friend.inputAdd')}
        </button>
      </div>
      {names.length > 0 ? (
        <ul className="friend-name-list" aria-label={t('friend.readyList')}>
          {names.map((name, index) => (
            <li key={`${name}-${index}`}>
              <span>{name}</span>
              <button type="button" onClick={() => removeName(index)} aria-label={t('friend.removeName', { name })}>
                <X size={13} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <small className="friend-name-status" aria-live="polite">
        {pendingCount > 0 ? t(pendingCount === 1 ? 'friend.readyOne' : 'friend.readyMany', { count: pendingCount }) : t('friend.readyEmpty')}
      </small>
    </div>
  )
}
