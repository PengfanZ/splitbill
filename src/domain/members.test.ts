import { afterEach, describe, expect, it, vi } from 'vitest'
import { ACTIVITY_EMOJIS, addedFriendsMessage, CURRENT_USER, FRIEND_COLORS, initialsFor, makeId, mergeMemberNames, parseMemberNames } from './members'

describe('member domain', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('defines the anonymous current user and reusable presentation choices', () => {
    expect(CURRENT_USER).toEqual({ id: 'me', name: 'You', initials: 'ME', color: '#ead1b9' })
    expect(FRIEND_COLORS).toHaveLength(6)
    expect(new Set(FRIEND_COLORS).size).toBe(FRIEND_COLORS.length)
    expect(ACTIVITY_EMOJIS).toEqual(['✦', '⌂', '☀', '✈'])
  })

  it('generates prefixed ids from the current time and randomness', () => {
    vi.spyOn(Date, 'now').mockReturnValue(123)
    vi.spyOn(Math, 'random').mockReturnValue(0.5)

    expect(makeId('friend')).toBe('friend-123-i')
  })

  it('creates one- or two-letter initials and handles blank names', () => {
    expect(initialsFor('maya')).toBe('M')
    expect(initialsFor('  maya chen parker ')).toBe('MC')
    expect(initialsFor('')).toBe('?')
  })

  it('parses pasted member names across common English and Chinese separators', () => {
    expect(parseMemberNames(' Sam，Taylor、 小明；小红\nJordan; Maya ')).toEqual([
      'Sam', 'Taylor', '小明', '小红', 'Jordan', 'Maya',
    ])
  })

  it('normalizes whitespace and removes duplicate member names without changing order', () => {
    expect(parseMemberNames(' Maya Chen, maya   chen, Jordan ')).toEqual(['Maya Chen', 'Jordan'])
    expect(mergeMemberNames(['Maya'], 'maya，小红')).toEqual(['Maya', '小红'])
  })

  it('describes singular and plural additions with no earlier expenses', () => {
    expect(addedFriendsMessage(['Jordan'], 0)).toBe('Jordan was added to the activity.')
    expect(addedFriendsMessage(['Jordan', 'Sam'], 0)).toBe('Jordan and Sam were added to the activity.')
  })

  it('describes additions without changing singular or plural earlier expenses', () => {
    expect(addedFriendsMessage(['Jordan'], 1)).toBe('Jordan was added for future expenses. 1 earlier expense was left unchanged.')
    expect(addedFriendsMessage(['Jordan', 'Sam', 'Taylor'], 2)).toBe('Jordan, Sam and Taylor were added for future expenses. 2 earlier expenses were left unchanged.')
  })
})
