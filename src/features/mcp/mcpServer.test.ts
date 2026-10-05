import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LiveActivityApiError, type LiveActivityRecord } from '../liveSharing/liveActivityApi'
import type { LiveActivityCredentials } from '../liveSharing/liveActivityLink'
import type { SharedActivity } from '../sharing/sharedActivity'
import { TOKYO_CODE, TOKYO_TOKEN, tokyoActivity, tokyoExpense } from '../../test/mcpFixtures'
import { MCP_SERVER_INSTRUCTIONS } from './agentGuide'
import type { AgentLinkPayload } from './agentLinkProtocol'
import type { AgentLinkSession } from './agentLinkServer'
import type { CredentialStore, LinkedActivity } from './credentialStore'
import { createTallyMcpServer, type TallyMcpDependencies } from './mcpServer'

type Row = { editToken: string; snapshot: SharedActivity; revision: number }

function fakeLive() {
  const rows = new Map<string, Row>()
  const record = (code: string, row: Row): LiveActivityRecord => ({ code, revision: row.revision, snapshot: row.snapshot, updatedAt: '2026-10-04T09:00:00.000Z' })
  const find = ({ code, editToken }: LiveActivityCredentials) => {
    const row = rows.get(code)
    if (!row || row.editToken !== editToken) throw new LiveActivityApiError('not-found', 'Not found')
    return row
  }
  return {
    rows,
    create: vi.fn(async (snapshot: SharedActivity) => {
      const row = { editToken: 'c'.repeat(64), snapshot, revision: 1 }
      rows.set('C0FFEE1234', row)
      return { ...record('C0FFEE1234', row), editToken: row.editToken }
    }),
    load: vi.fn(async (credentials: LiveActivityCredentials) => record(credentials.code, find(credentials))),
    update: vi.fn(async (credentials: LiveActivityCredentials, snapshot: SharedActivity, expectedRevision: number) => {
      const row = find(credentials)
      if (row.revision !== expectedRevision) throw new LiveActivityApiError('conflict', 'Newer', { latestRecord: record(credentials.code, row) })
      row.snapshot = snapshot
      row.revision += 1
      return record(credentials.code, row)
    }),
  }
}

function memoryStore(initial: LinkedActivity[] = []): CredentialStore & { saved: Map<string, LinkedActivity> } {
  const saved = new Map(initial.map(activity => [activity.code, activity]))
  return {
    saved,
    filePath: '/tmp/test.json',
    list: async () => [...saved.values()],
    save: async activity => { saved.set(activity.code, activity) },
    remove: async code => saved.delete(code),
  }
}

const tokyoLink: LinkedActivity = { code: TOKYO_CODE, editToken: TOKYO_TOKEN, memberId: 'friend-leo', name: 'Tokyo trip', linkedAt: '2026-10-01T00:00:00.000Z' }

function deferredSession(url = 'https://tally.test/#agent-link=51234.0123456789abcdef0123456789abcdef.claude-code') {
  let resolve!: (payload: AgentLinkPayload) => void
  let reject!: (error: Error) => void
  const approval = new Promise<AgentLinkPayload>((ok, fail) => { resolve = ok; reject = fail })
  const session: AgentLinkSession = { approvalUrl: url, approval, close: vi.fn() }
  return { session, resolve, reject }
}

let connected: Client | undefined

async function connect(overrides: Partial<TallyMcpDependencies> = {}) {
  const live = fakeLive()
  live.rows.set(TOKYO_CODE, { editToken: TOKYO_TOKEN, snapshot: tokyoActivity(), revision: 4 })
  const store = memoryStore([tokyoLink])
  let id = 0
  const dependencies: TallyMcpDependencies = {
    store,
    client: live,
    appUrl: 'https://tally.test/splitbill/',
    openUrl: vi.fn(async () => true),
    now: () => new Date('2026-10-04T09:30:00.000Z'),
    makeId: prefix => `${prefix}-${++id}`,
    ...overrides,
  }
  const server = createTallyMcpServer(dependencies)
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  connected = new Client({ name: 'claude-code', version: '2.0.0' })
  await connected.connect(clientTransport)
  const mcp = connected
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await mcp.callTool({ name, arguments: args }) as { content: { text: string }[]; isError?: boolean }
    const text = result.content[0].text
    return { isError: Boolean(result.isError), text, data: result.isError ? null : JSON.parse(text) }
  }
  return { mcp, call, live, store, dependencies }
}

afterEach(async () => {
  await connected?.close()
  connected = undefined
})

describe('Tally MCP server', () => {
  it('tells agents the rules and offers every tool with honest hints', async () => {
    const { mcp } = await connect()
    expect(mcp.getInstructions()).toBe(MCP_SERVER_INSTRUCTIONS)
    expect(mcp.getServerVersion()).toMatchObject({ name: 'tally', version: '0.1.0' })
    const { tools } = await mcp.listTools()
    expect(tools.map(tool => [tool.name, tool.annotations?.readOnlyHint, tool.annotations?.destructiveHint])).toEqual([
      ['list_activities', true, undefined],
      ['get_activity', true, undefined],
      ['add_expenses', false, false],
      ['record_settlement', false, false],
      ['add_members', false, false],
      ['update_expense', false, false],
      ['delete_expense', false, true],
      ['create_activity', false, false],
      ['get_share_link', true, undefined],
      ['link_activities', false, false],
    ])
  })

  describe('list_activities', () => {
    it('lists linked activities with who the user is, and flags ended or unreachable ones', async () => {
      const { call, live, store } = await connect()
      store.saved.set('DEADBEEF00', { ...tokyoLink, code: 'DEADBEEF00', name: 'Old trip' })
      store.saved.set('BADC0FFEE0', { ...tokyoLink, code: 'BADC0FFEE0', name: 'Offline trip' })
      const load = live.load.getMockImplementation()!
      live.load.mockImplementation(async credentials => {
        if (credentials.code === 'BADC0FFEE0') throw new LiveActivityApiError('network', 'Offline')
        return load(credentials)
      })

      const { data } = await call('list_activities')
      expect(data.activities).toEqual([
        { code: TOKYO_CODE, name: 'Tokyo trip', currency: 'JPY', you: 'Leo', members: ['Mia', 'Leo', 'Sam'], expenseCount: 1 },
        { code: 'DEADBEEF00', name: 'Old trip', status: 'ended' },
        { code: 'BADC0FFEE0', name: 'Offline trip', status: 'unavailable' },
      ])
      expect(JSON.stringify(data)).not.toContain(TOKYO_TOKEN)
    })

    it('suggests linking or creating when nothing is linked, and reports store failures', async () => {
      const { call, store } = await connect()
      store.saved.clear()
      expect((await call('list_activities')).data.hint).toContain('link_activities')
      store.list = async () => { throw new Error('disk') }
      expect(await call('list_activities')).toMatchObject({ isError: true, text: expect.stringContaining('Something went wrong') })
    })
  })

  describe('get_activity', () => {
    const expenses = [
      tokyoExpense({ id: 'dinner', title: 'Izakaya dinner', amount: 18600, createdAt: '2026-09-22T11:00:00.000Z', categoryId: 'food', shares: { me: 6200, 'friend-leo': 6200, 'friend-sam': 6200 } }),
      tokyoExpense({ id: 'snacks', title: '7-Eleven snacks', amount: 1420, createdAt: '2026-09-21T11:00:00.000Z', categoryId: null, shares: { me: 710, 'friend-leo': 710 } }),
      tokyoExpense({ id: 'payback', title: 'Settlement payment', kind: 'settlement', amount: 500, payerId: 'friend-leo', splitMethod: 'exact', shares: { me: 500 }, createdAt: '2026-09-21T12:00:00.000Z', categoryId: undefined }),
      tokyoExpense(),
    ]

    it('reads an activity by name or code with balances and newest expenses first', async () => {
      const { call, live } = await connect()
      live.rows.get(TOKYO_CODE)!.snapshot = tokyoActivity(expenses)
      const { data } = await call('get_activity', { activity: 'tokyo TRIP', limit: 2 })
      expect(data).toMatchObject({ code: TOKYO_CODE, name: 'Tokyo trip', you: 'Leo', totalSpending: 25020 })
      expect(data.expenses.total).toBe(4)
      expect(data.expenses.items.map((item: { title: string }) => item.title)).toEqual(['Izakaya dinner', '7-Eleven snacks'])
      expect((await call('get_activity', { activity: TOKYO_CODE.toLowerCase(), offset: 3 })).data.expenses.items[0].title).toBe('Suica top-up')
    })

    it('filters by date and category, leaving payments out of category views', async () => {
      const { call, live } = await connect()
      live.rows.get(TOKYO_CODE)!.snapshot = tokyoActivity(expenses)
      const titles = async (args: Record<string, unknown>) => (await call('get_activity', { activity: 'Tokyo trip', ...args })).data.expenses.items.map((item: { title: string }) => item.title)
      expect(await titles({ from: '2026-09-21', to: '2026-09-21' })).toEqual(['7-Eleven snacks', 'Settlement payment'])
      expect(await titles({ category: 'general' })).toEqual(['7-Eleven snacks'])
      expect(await titles({ category: 'Food & drinks' })).toEqual(['Izakaya dinner'])
      expect((await call('get_activity', { activity: 'Tokyo trip', category: 'Rent' })).text).toBe('Tokyo trip has no "Rent" category.')
    })

    it('explains unlinked, ambiguous and ended activities', async () => {
      const { call, store, live } = await connect()
      expect((await call('get_activity', { activity: 'Paris' })).text).toContain('Call link_activities')
      store.saved.set('DEADBEEF00', { ...tokyoLink, code: 'DEADBEEF00' })
      expect((await call('get_activity', { activity: 'Tokyo trip' })).text).toContain(`Use its code: ${TOKYO_CODE}, DEADBEEF00`)
      live.rows.delete(TOKYO_CODE)
      expect((await call('get_activity', { activity: TOKYO_CODE })).text).toContain("Tally can't find Tokyo trip anymore")
    })

    it('treats the creator as the user when their saved member disappeared', async () => {
      const { call, store } = await connect()
      store.saved.set(TOKYO_CODE, { ...tokyoLink, memberId: 'friend-gone' })
      expect((await call('get_activity', { activity: 'Tokyo trip' })).data.you).toBe('Mia')
    })
  })

  describe('add_expenses', () => {
    const ramen = { title: 'Ichiran ramen', amount: 3960, payer: 'Mia', split: { method: 'equal' }, date: '2026-09-20' }

    it('saves new expenses in one change and skips ones already in Tally', async () => {
      const { call, live } = await connect()
      const { data } = await call('add_expenses', {
        activity: 'Tokyo trip',
        expenses: [ramen, { title: 'Suica top-up', amount: 5000, payer: 'Mia', split: { method: 'equal' }, date: '2026-09-20' }],
      })

      expect(live.update).toHaveBeenCalledTimes(1)
      expect(live.update.mock.calls[0][2]).toBe(4)
      expect(live.rows.get(TOKYO_CODE)!.revision).toBe(5)
      expect(data.saved).toEqual([{
        id: 'expense-1', version: '2026-09-20T12:00:00.000Z', date: '2026-09-20', title: 'Ichiran ramen', amount: 3960, kind: 'expense', paidBy: 'Mia', category: 'General',
        split: [{ member: 'Mia', amount: 1320 }, { member: 'Leo', amount: 1320 }, { member: 'Sam', amount: 1320 }],
      }])
      expect(data.skipped).toEqual([expect.objectContaining({ title: 'Suica top-up', reason: 'Looks like "Suica top-up" from 2026-09-20, already in Tally.' })])
      expect(data.balanceChanges).toEqual([{ member: 'Mia', change: 2640 }, { member: 'Leo', change: -1320 }, { member: 'Sam', change: -1320 }])
      expect(data).toMatchObject({ activity: 'Tokyo trip', currency: 'JPY', you: 'Leo' })
      expect(data.next).toContain('Recap')
    })

    it('does not write when every expense was a duplicate, unless duplicates are allowed', async () => {
      const { call, live } = await connect()
      const suica = { title: 'Suica', amount: 5000, payer: 'Mia', split: { method: 'equal' }, date: '2026-09-20' }
      expect((await call('add_expenses', { activity: 'Tokyo trip', expenses: [suica] })).data.saved).toEqual([])
      expect(live.update).not.toHaveBeenCalled()
      expect((await call('add_expenses', { activity: 'Tokyo trip', expenses: [suica], allowDuplicates: true })).data.saved).toHaveLength(1)
    })

    it('rebuilds the additions on a newer version when someone else saved first', async () => {
      const { call, live } = await connect()
      const update = live.update.getMockImplementation()!
      live.update.mockImplementationOnce(async (credentials, snapshot, revision) => {
        const row = live.rows.get(TOKYO_CODE)!
        row.snapshot = tokyoActivity([tokyoExpense({ id: 'friend-edit', title: 'Taxi', createdAt: '2026-09-23T03:00:00.000Z' }), ...row.snapshot.expenses])
        row.revision += 1
        return update(credentials, snapshot, revision)
      })
      const { data } = await call('add_expenses', { activity: 'Tokyo trip', expenses: [ramen] })
      expect(data.saved).toHaveLength(1)
      expect(live.rows.get(TOKYO_CODE)!.snapshot.expenses.map(expense => expense.id)).toEqual(['expense-2', 'friend-edit', 'expense-suica'])
    })

    it('stops retrying after repeated conflicts and explains what to do', async () => {
      const { call, live } = await connect()
      live.update.mockImplementation(async credentials => {
        const row = live.rows.get(credentials.code)!
        throw new LiveActivityApiError('membership-changed', 'Changed', { latestRecord: { code: credentials.code, revision: row.revision, snapshot: row.snapshot, updatedAt: '' } })
      })
      expect((await call('add_expenses', { activity: 'Tokyo trip', expenses: [ramen] })).text).toContain('Someone else kept changing Tokyo trip')
      expect(live.update).toHaveBeenCalledTimes(3)
    })

    it('relays validation problems and service failures without saving', async () => {
      const { call, live } = await connect()
      expect((await call('add_expenses', { activity: 'Tokyo trip', expenses: [{ ...ramen, payer: 'Zoe' }] })).text).toContain('No one called "Zoe"')
      for (const [error, message] of [
        [new LiveActivityApiError('rate-limit', 'Slow down'), 'too many requests'],
        [new LiveActivityApiError('network', 'Offline'), 'Could not reach Tally'],
        [new LiveActivityApiError('backend', 'Boom'), 'Something went wrong'],
        [new LiveActivityApiError('conflict', 'No latest record'), 'Someone else kept changing'],
      ] as const) {
        live.update.mockRejectedValueOnce(error)
        expect((await call('add_expenses', { activity: 'Tokyo trip', expenses: [ramen] })).text).toContain(message)
      }
      expect(live.rows.get(TOKYO_CODE)!.revision).toBe(4)
    })
  })

  describe('record_settlement', () => {
    it('records a payment and reports how balances moved', async () => {
      const { call, live } = await connect()
      const { data } = await call('record_settlement', { activity: 'Tokyo trip', from: 'Leo', to: 'Mia', amount: 1000, date: '2026-09-25' })
      expect(data.saved).toMatchObject({ id: 'payment-1', kind: 'settlement', title: 'Settlement payment', amount: 1000, paidBy: 'Leo', date: '2026-09-25', split: [{ member: 'Mia', amount: 1000 }] })
      expect(data.balanceChanges).toEqual([{ member: 'Mia', change: -1000 }, { member: 'Leo', change: 1000 }])
      expect(data).toMatchObject({ activity: 'Tokyo trip', you: 'Leo' })
      expect(live.rows.get(TOKYO_CODE)!.snapshot.expenses.map(expense => expense.id)).toEqual(['payment-1', 'expense-suica'])
    })

    it('refuses a payment larger than the debt without saving', async () => {
      const { call, live } = await connect()
      expect((await call('record_settlement', { activity: 'Tokyo trip', from: 'Leo', to: 'Mia', amount: 5000 })).text).toBe('Leo owes 1666.67 in Tokyo trip, less than 5000.')
      expect(live.update).not.toHaveBeenCalled()
    })
  })

  describe('add_members', () => {
    it('adds new friends and restores removed ones in one change', async () => {
      const { call, live } = await connect()
      const { data } = await call('add_members', { activity: 'Tokyo trip', names: ['Kenji', 'ana', 'Leo'] })
      expect(data).toEqual({
        activity: 'Tokyo trip',
        added: ['Kenji'],
        restored: ['Ana'],
        alreadyIn: ['Leo'],
        members: ['Mia', 'Leo', 'Sam', 'Ana', 'Kenji'],
      })
      const snapshot = live.rows.get(TOKYO_CODE)!.snapshot
      expect(snapshot.friends.at(-1)).toMatchObject({ id: 'friend-1', name: 'Kenji' })
      expect(snapshot.group.inactiveMemberIds).toEqual([])
    })

    it('does not save when everyone named is already in the activity, or a name is unusable', async () => {
      const { call, live } = await connect()
      expect((await call('add_members', { activity: 'Tokyo trip', names: ['Mia'] })).data.alreadyIn).toEqual(['Mia'])
      expect((await call('add_members', { activity: 'Tokyo trip', names: [' '] })).text).toBe('Give at least one name.')
      expect(live.update).not.toHaveBeenCalled()
    })
  })

  describe('update_expense and delete_expense', () => {
    const version = '2026-09-20T03:00:00.000Z'

    it('changes one expense using the version the agent read', async () => {
      const { call, live } = await connect()
      const read = (await call('get_activity', { activity: 'Tokyo trip' })).data.expenses.items[0]
      expect(read).toMatchObject({ id: 'expense-suica', version })
      const { data } = await call('update_expense', { activity: 'Tokyo trip', expenseId: read.id, version: read.version, amount: 6000 })
      expect(data.before).toMatchObject({ amount: 5000, version })
      expect(data.after).toMatchObject({ amount: 6000, version: '2026-10-04T09:30:00.000Z', split: [{ member: 'Mia', amount: 2000 }, { member: 'Leo', amount: 2000 }, { member: 'Sam', amount: 2000 }] })
      expect(data.balanceChanges).toEqual([{ member: 'Mia', change: 666.67 }, { member: 'Leo', change: -333.33 }, { member: 'Sam', change: -333.34 }])
      expect(live.rows.get(TOKYO_CODE)!.revision).toBe(5)
    })

    it('reapplies an edit when someone else changed a different expense first', async () => {
      const { call, live } = await connect()
      const update = live.update.getMockImplementation()!
      live.update.mockImplementationOnce(async (credentials, snapshot, revision) => {
        const row = live.rows.get(TOKYO_CODE)!
        row.snapshot = tokyoActivity([tokyoExpense({ id: 'taxi', title: 'Taxi', createdAt: '2026-09-23T03:00:00.000Z' }), ...row.snapshot.expenses])
        row.revision += 1
        return update(credentials, snapshot, revision)
      })
      expect((await call('update_expense', { activity: 'Tokyo trip', expenseId: 'expense-suica', version, title: 'Suica card' })).isError).toBe(false)
      expect(live.rows.get(TOKYO_CODE)!.snapshot.expenses.map(expense => expense.title)).toEqual(['Taxi', 'Suica card'])
    })

    it('saves nothing when someone else changed the same expense first', async () => {
      const { call, live } = await connect()
      const update = live.update.getMockImplementation()!
      live.update.mockImplementationOnce(async (credentials, snapshot, revision) => {
        const row = live.rows.get(TOKYO_CODE)!
        row.snapshot = tokyoActivity([tokyoExpense({ title: 'Suica (fixed by Sam)', updatedAt: '2026-10-04T09:00:00.000Z' })])
        row.revision += 1
        return update(credentials, snapshot, revision)
      })
      const result = await call('update_expense', { activity: 'Tokyo trip', expenseId: 'expense-suica', version, title: 'Suica card' })
      expect(result.isError).toBe(true)
      expect(result.text).toContain('"Suica (fixed by Sam)" changed since you read it')
      expect(live.rows.get(TOKYO_CODE)!.snapshot.expenses[0].title).toBe('Suica (fixed by Sam)')
    })

    it('deletes one expense and reports how balances moved', async () => {
      const { call, live } = await connect()
      const { data } = await call('delete_expense', { activity: 'Tokyo trip', expenseId: 'expense-suica', version })
      expect(data.deleted).toMatchObject({ title: 'Suica top-up', amount: 5000 })
      expect(data.balanceChanges).toEqual([{ member: 'Mia', change: -3333.33 }, { member: 'Leo', change: 1666.67 }, { member: 'Sam', change: 1666.66 }])
      expect(live.rows.get(TOKYO_CODE)!.snapshot.expenses).toEqual([])
      expect((await call('delete_expense', { activity: 'Tokyo trip', expenseId: 'expense-suica', version })).text).toContain('No expense with id "expense-suica"')
    })
  })

  describe('prompts', () => {
    it('offers the three workflows, filled in with what the user gave', async () => {
      const { mcp } = await connect()
      const { prompts } = await mcp.listPrompts()
      expect(prompts.map(prompt => [prompt.name, prompt.arguments?.map(argument => [argument.name, argument.required])])).toEqual([
        ['import-transactions', [['file', true], ['activity', false]]],
        ['plan-a-trip', [['name', true], ['people', false], ['currency', false]]],
        ['settle-up', [['activity', true]]],
      ])
      const text = async (name: string, args: Record<string, string>) => {
        const { messages } = await mcp.getPrompt({ name, arguments: args })
        return (messages[0].content as { text: string }).text
      }
      expect(await text('import-transactions', { file: '~/Downloads/statement.csv', activity: 'Tokyo trip' })).toMatch(/~\/Downloads\/statement\.csv[\s\S]*Tokyo trip/)
      expect(await text('import-transactions', { file: 'a.csv' })).toContain('ask me which activity')
      expect(await text('plan-a-trip', { name: 'Ski weekend', people: 'Leo, Sam', currency: 'CAD' })).toMatch(/Ski weekend[\s\S]*Leo, Sam[\s\S]*CAD/)
      expect(await text('plan-a-trip', { name: 'Ski weekend' })).toContain('who is coming')
      expect(await text('settle-up', { activity: 'Tokyo trip' })).toContain('Tokyo trip')
    })

    it('only points agents at tools the server offers', async () => {
      const { mcp } = await connect()
      const toolNames = new Set((await mcp.listTools()).tools.map(tool => tool.name))
      const args = { 'import-transactions': { file: 'a.csv' }, 'plan-a-trip': { name: 'Trip' }, 'settle-up': { activity: 'Trip' } }
      for (const [name, promptArgs] of Object.entries(args)) {
        const { messages } = await mcp.getPrompt({ name, arguments: promptArgs })
        const mentioned = (messages[0].content as { text: string }).text.match(/\b[a-z]+(?:_[a-z]+)+\b/g) ?? []
        expect(mentioned.length).toBeGreaterThan(0)
        for (const tool of mentioned) expect(toolNames, `${name} mentions ${tool}`).toContain(tool)
      }
    })
  })

  describe('create_activity and get_share_link', () => {
    it('creates a Live activity, links it as the creator and opens it in the browser', async () => {
      const { call, live, store, dependencies } = await connect()
      const { data } = await call('create_activity', { name: 'Ski weekend', yourName: 'Mia', members: ['Leo', 'Sam'], currency: 'CAD' })
      expect(live.create).toHaveBeenCalledOnce()
      expect(data).toMatchObject({ code: 'C0FFEE1234', name: 'Ski weekend', currency: 'CAD', members: ['Mia', 'Leo', 'Sam'], openedInBrowser: true })
      expect(store.saved.get('C0FFEE1234')).toMatchObject({ memberId: 'me', name: 'Ski weekend', editToken: 'c'.repeat(64) })
      expect(dependencies.openUrl).toHaveBeenCalledWith(`https://tally.test/splitbill/#live=C0FFEE1234.${'c'.repeat(64)}`)
      expect(JSON.stringify(data)).not.toContain('c'.repeat(64))
    })

    it('still links the activity when no browser opens, and rejects invalid activities', async () => {
      const { call } = await connect({ openUrl: async () => false, now: undefined })
      const created = await call('create_activity', { name: 'Ski weekend', yourName: 'Mia', members: [], currency: 'CAD' })
      expect(created.data.next).toContain('did not open')
      expect((await call('create_activity', { name: ' ', yourName: 'Mia', members: [], currency: 'CAD' })).text).toContain('activity name')
    })

    it('returns an invite only for linked activities, in English or Chinese', async () => {
      const { call } = await connect()
      const english = await call('get_share_link', { activity: 'Tokyo trip' })
      expect(english.data).toEqual({
        name: 'Tokyo trip',
        url: `https://tally.test/splitbill/#live=${TOKYO_CODE}.${TOKYO_TOKEN}`,
        message: `Let's track Tokyo trip together in Tally: https://tally.test/splitbill/#live=${TOKYO_CODE}.${TOKYO_TOKEN}`,
      })
      expect((await call('get_share_link', { activity: 'Tokyo trip', language: 'zh-CN' })).data.message).toContain('一起在 Tally 记录「Tokyo trip」')
      expect((await call('get_share_link', { activity: 'Paris' })).isError).toBe(true)
    })
  })

  describe('link_activities', () => {
    const approved = (activities: AgentLinkPayload['activities']): AgentLinkPayload => ({ state: '0123456789abcdef0123456789abcdef', activities })

    it('opens Tally for approval and links what the user allowed', async () => {
      const pending = deferredSession()
      const startLinkSession = vi.fn(async () => pending.session)
      const { call, store, dependencies } = await connect({ startLinkSession })
      const result = call('link_activities')
      await vi.waitFor(() => expect(dependencies.openUrl).toHaveBeenCalledWith(pending.session.approvalUrl))
      expect(startLinkSession).toHaveBeenCalledWith({ appUrl: 'https://tally.test/splitbill/', client: 'claude-code' })

      store.saved.clear()
      pending.resolve(approved([
        { code: TOKYO_CODE, editToken: TOKYO_TOKEN, memberId: 'friend-sam' },
        { code: 'DEADBEEF00', editToken: 'd'.repeat(64), memberId: 'me' },
        { code: TOKYO_CODE, editToken: TOKYO_TOKEN, memberId: 'friend-ana' },
      ]))
      const { data } = await result
      expect(data).toEqual({
        status: 'linked',
        linked: [{ name: 'Tokyo trip', you: 'Sam' }],
        failed: [
          { code: 'DEADBEEF00', reason: 'Tally could not find it. Live sharing may have ended.' },
          { code: TOKYO_CODE, reason: 'The chosen member is no longer in this activity.' },
        ],
      })
      expect(store.saved.get(TOKYO_CODE)).toMatchObject({ memberId: 'friend-sam', name: 'Tokyo trip' })
    })

    it('keeps waiting in the background when the user has not clicked Allow yet', async () => {
      const pending = deferredSession()
      const startLinkSession = vi.fn(async () => pending.session)
      const { call, store } = await connect({ startLinkSession, linkWaitMs: 5 })
      const first = await call('link_activities')
      expect(first.data).toMatchObject({ status: 'waiting', approvalUrl: pending.session.approvalUrl })
      expect(first.data.next).toContain('click Allow')

      const second = call('link_activities')
      pending.resolve(approved([{ code: TOKYO_CODE, editToken: TOKYO_TOKEN, memberId: 'me' }]))
      expect((await second).data.status).toBe('linked')
      expect(startLinkSession).toHaveBeenCalledOnce()
      expect(store.saved.get(TOKYO_CODE)?.memberId).toBe('me')
    })

    it('asks the user to open the page when no browser opens, and reports timeouts', async () => {
      const pending = deferredSession()
      const { call } = await connect({ startLinkSession: async () => pending.session, openUrl: async () => false, linkWaitMs: 60_000 })
      expect((await call('link_activities')).data.next).toContain('open approvalUrl')
      const failed = call('link_activities')
      pending.reject(new Error('Nobody approved the Tally link in time.'))
      expect((await failed).text).toBe('Nobody approved the Tally link in time. Call link_activities to try again.')
    })
  })
})
