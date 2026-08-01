import { UserRoundCheck } from 'lucide-react'
import { Avatar } from '../../components/AppShell'
import { SelectMenu, type SelectMenuOption } from '../../components/SelectMenu'
import type { Member } from '../../domain/models'
import { useLocalization } from '../../i18n/LocalizationContext'

export function ActivityIdentityControl({
  className = '',
  memberId,
  members,
  onChange,
  variant = 'compact',
}: {
  className?: string
  memberId: string | null
  members: Member[]
  onChange: (memberId: string) => void
  variant?: 'field' | 'compact'
}) {
  const { t } = useLocalization()
  const selectedMember = members.find(member => member.id === memberId) ?? null
  const memberOptions: ReadonlyArray<SelectMenuOption<string>> = members.map(member => ({
    value: member.id,
    label: member.name,
    detail: t('activityIdentity.localOnly'),
    leading: <Avatar member={member} size="sm" />,
  }))
  const options: ReadonlyArray<SelectMenuOption<string>> = selectedMember
    ? memberOptions
    : [{
        value: '',
        label: t('activityIdentity.choose'),
        detail: t('activityIdentity.aiReason'),
        leading: <UserRoundCheck size={17} />,
      }, ...memberOptions]

  return (
    <SelectMenu
      className={`activity-identity-control${className ? ` ${className}` : ''}`}
      value={selectedMember?.id ?? ''}
      options={options}
      onChange={nextMemberId => {
        if (nextMemberId) onChange(nextMemberId)
      }}
      ariaLabel={selectedMember
        ? t('activityIdentity.current', { name: selectedMember.name })
        : t('activityIdentity.choose')}
      menuLabel={t('activityIdentity.menu')}
      title={t('activityIdentity.title')}
      description={t('activityIdentity.description')}
      variant="field"
      renderValue={variant === 'compact' ? () => (
        <>
          <span className="select-menu-leading"><UserRoundCheck size={17} /></span>
          <span className="select-menu-value">
            <b>{selectedMember
              ? t('activityIdentity.compact', { name: selectedMember.name })
              : t('activityIdentity.choose')}</b>
          </span>
        </>
      ) : undefined}
    />
  )
}
