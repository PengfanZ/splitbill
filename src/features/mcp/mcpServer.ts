import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { version } from '../../../packages/tally-splitbill-mcp/package.json'
import { SUPPORTED_CURRENCIES } from '../../domain/currency'
import { DEFAULT_CATEGORIES, GENERAL_CATEGORY } from '../../domain/categories'
import { makeId as makeRandomId } from '../../domain/members'
import { LiveActivityApiError, type LiveActivityRecord } from '../liveSharing/liveActivityApi'
import type { LiveActivityClient } from '../liveSharing/liveActivityConfig'
import { buildLiveActivityUrl, type LiveActivityCredentials } from '../liveSharing/liveActivityLink'
import type { SharedActivity } from '../sharing/sharedActivity'
import { MCP_SERVER_INSTRUCTIONS } from './agentGuide'
import { agentClientFromName } from './agentLinkProtocol'
import { startAgentLinkSession, type AgentLinkSession } from './agentLinkServer'
import type { CredentialStore, LinkedActivity } from './credentialStore'
import { linkApprovedActivities } from './linkActivities'
import {
  activityMembers,
  balanceChanges,
  createActivitySnapshot,
  describeActivity,
  describeExpense,
  McpToolError,
  planExpenseAdditions,
  planExpenseDeletion,
  planExpenseUpdate,
  planMemberAdditions,
  planSettlement,
  type ExpenseInput,
} from './mcpActivity'
import { MCP_PROMPTS } from './mcpPrompts'

export const MCP_SERVER_VERSION = version
const SAVE_ATTEMPTS = 3
const LINK_WAIT_MS = 45_000

export type TallyMcpDependencies = {
  store: CredentialStore
  client: Pick<LiveActivityClient, 'create' | 'load' | 'update'>
  appUrl: string
  openUrl: (url: string) => Promise<boolean>
  startLinkSession?: typeof startAgentLinkSession
  now?: () => Date
  makeId?: (prefix: string) => string
  linkWaitMs?: number
}

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('A date as YYYY-MM-DD.')
const activitySchema = z.string().min(1).describe('The activity\'s name or 10-character code, from list_activities.')
const expenseIdSchema = z.string().min(1).describe('The expense id from get_activity.')
const versionSchema = z.string().min(1).describe('The expense version from get_activity, so changes made since are never overwritten.')
const titleSchema = z.string().describe('What it was for, in the user\'s words.')
const amountSchema = z.number().describe('The total, in the activity\'s currency, with at most two decimals.')
const payerSchema = z.string().describe('Who paid: a member name or id from get_activity.')
const categorySchema = z.string().describe('A category name from get_activity. Omit for General.')
const expenseDateSchema = z.string().describe('When it happened, as YYYY-MM-DD. Omit for now.')
const expenseSchema = z.object({
  title: titleSchema,
  amount: amountSchema,
  payer: payerSchema,
  split: z.discriminatedUnion('method', [
    z.object({
      method: z.literal('equal'),
      participants: z.array(z.string()).optional().describe('Member names or ids sharing the cost. Omit to split with every active member.'),
    }),
    z.object({
      method: z.literal('exact'),
      shares: z.record(z.string(), z.number()).describe('Member name or id to the amount they owe. Must add up to the total.'),
    }),
  ]),
  category: categorySchema.optional(),
  date: expenseDateSchema.optional(),
})

type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean }

const reply = (data: unknown): ToolResult => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] })

function failure(error: unknown, activityName?: string): ToolResult {
  const target = activityName ?? 'that activity'
  let message = 'Something went wrong talking to Tally. Try again in a moment.'
  if (error instanceof McpToolError) message = error.message
  else if (error instanceof LiveActivityApiError) {
    if (error.kind === 'not-found') message = `Tally can't find ${target} anymore. Live sharing may have ended; ask the user to check the app.`
    else if (error.kind === 'rate-limit') message = 'Tally is receiving too many requests right now. Wait a minute, then try again.'
    else if (error.kind === 'network') message = 'Could not reach Tally. Check the internet connection, then try again.'
    else if (error.kind === 'conflict' || error.kind === 'membership-changed') message = `Someone else kept changing ${target}. Read it again with get_activity, then retry.`
  }
  return { content: [{ type: 'text', text: message }], isError: true }
}

const credentialsOf = (activity: LinkedActivity) => ({ code: activity.code, editToken: activity.editToken })

/** The category id to filter by, `''` for General, or undefined for no filter. */
function categoryFilter(snapshot: LiveActivityRecord['snapshot'], category: string | undefined) {
  if (category === undefined) return undefined
  const key = category.trim().toLocaleLowerCase()
  if (key === GENERAL_CATEGORY.name.toLocaleLowerCase()) return GENERAL_CATEGORY.id
  const match = (snapshot.group.categories ?? DEFAULT_CATEGORIES).find(item => item.name.toLocaleLowerCase() === key)
  if (!match) throw new McpToolError(`${snapshot.group.name} has no "${category}" category.`)
  return match.id
}

export function createTallyMcpServer({
  store,
  client,
  appUrl,
  openUrl,
  startLinkSession = startAgentLinkSession,
  now = () => new Date(),
  makeId = makeRandomId,
  linkWaitMs = LINK_WAIT_MS,
}: TallyMcpDependencies) {
  const server = new McpServer({ name: 'tally', version: MCP_SERVER_VERSION }, { instructions: MCP_SERVER_INSTRUCTIONS })

  const findLinked = async (reference: string) => {
    const linked = await store.list()
    const key = reference.trim().toLocaleLowerCase()
    const byCode = linked.find(activity => activity.code.toLocaleLowerCase() === key)
    if (byCode) return byCode
    const byName = linked.filter(activity => activity.name.toLocaleLowerCase() === key)
    if (byName.length === 1) return byName[0]
    if (byName.length > 1) throw new McpToolError(`More than one linked activity is called "${reference}". Use its code: ${byName.map(activity => activity.code).join(', ')}.`)
    throw new McpToolError(`"${reference}" isn't linked on this computer. Call link_activities so the user can allow it in Tally.`)
  }

  const viewerFor = (activity: LinkedActivity, record: LiveActivityRecord) => (
    activityMembers(record.snapshot).some(member => member.id === activity.memberId) ? activity.memberId : 'me'
  )

  const viewerName = (activity: LinkedActivity, record: LiveActivityRecord) => {
    const viewerId = viewerFor(activity, record)
    return activityMembers(record.snapshot).find(member => member.id === viewerId)?.name
  }

  /** Plans a change on the latest version and saves it. A plan of `null` saves nothing. */
  const saveChange = async <T extends { activity: SharedActivity | null }>(
    credentials: LiveActivityCredentials,
    plan: (snapshot: SharedActivity) => T,
  ) => {
    let record = await client.load(credentials)
    for (let attempt = 1; ; attempt += 1) {
      const before = record.snapshot
      const planned = plan(before)
      if (planned.activity) {
        try {
          record = await client.update(credentials, planned.activity, record.revision)
        } catch (error) {
          // Plans touch only what the agent asked for and re-check it, so rebuilding one on the newer version
          // never overwrites anyone's work: additions are re-applied, and edits stop if their expense changed.
          if (error instanceof LiveActivityApiError && error.latestRecord && attempt < SAVE_ATTEMPTS
            && (error.kind === 'conflict' || error.kind === 'membership-changed')) {
            record = error.latestRecord
            continue
          }
          throw error
        }
      }
      return { record, before, planned }
    }
  }

  server.registerTool('list_activities', {
    title: 'List linked Tally activities',
    description: 'Lists the Live Tally activities linked on this computer, with their members and who the user is in each.',
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async () => {
    try {
      const linked = await store.list()
      const activities = await Promise.all(linked.map(async activity => {
        try {
          const record = await client.load(credentialsOf(activity))
          const summary = describeActivity(record.snapshot, viewerFor(activity, record))
          return {
            code: activity.code,
            name: summary.name,
            currency: summary.currency,
            you: summary.you,
            members: summary.members.filter(member => member.active).map(member => member.name),
            expenseCount: record.snapshot.expenses.length,
          }
        } catch (error) {
          const ended = error instanceof LiveActivityApiError && error.kind === 'not-found'
          return { code: activity.code, name: activity.name, status: ended ? 'ended' : 'unavailable' }
        }
      }))
      return reply({
        activities,
        ...(activities.length ? {} : { hint: 'Nothing is linked yet. Call link_activities, or create_activity for something new.' }),
      })
    } catch (error) {
      return failure(error)
    }
  })

  server.registerTool('get_activity', {
    title: 'Read a Tally activity',
    description: 'Reads one linked activity: members, categories, balances, suggested settlements and its expenses, newest first. Filter by date or category and page through long lists.',
    inputSchema: {
      activity: activitySchema,
      from: dateSchema.optional(),
      to: dateSchema.optional(),
      category: z.string().optional(),
      limit: z.number().int().min(1).max(200).optional().describe('Expenses per page, 50 by default.'),
      offset: z.number().int().min(0).optional(),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async ({ activity: reference, from, to, category, limit = 50, offset = 0 }) => {
    let name: string | undefined
    try {
      const activity = await findLinked(reference)
      name = activity.name
      const record = await client.load(credentialsOf(activity))
      const snapshot = record.snapshot
      const categoryId = categoryFilter(snapshot, category)
      const matching = snapshot.expenses.filter(expense => {
        const day = expense.createdAt.slice(0, 10)
        return (!from || day >= from) && (!to || day <= to)
          && (categoryId === undefined || (expense.kind !== 'settlement' && (expense.categoryId ?? '') === categoryId))
      })
      return reply({
        code: activity.code,
        ...describeActivity(snapshot, viewerFor(activity, record)),
        expenses: {
          total: matching.length,
          offset,
          items: matching.slice(offset, offset + limit).map(expense => describeExpense(snapshot, expense)),
        },
      })
    } catch (error) {
      return failure(error, name)
    }
  })

  server.registerTool('add_expenses', {
    title: 'Add expenses to a Tally activity',
    description: 'Saves one or more expenses to a linked activity right away, as one change everyone sees. Likely duplicates (same payer, amount and day, similar title) are skipped unless allowDuplicates is true. Afterwards, recap what was saved and skipped so the user can review it in Tally.',
    inputSchema: {
      activity: activitySchema,
      expenses: z.array(expenseSchema).min(1).max(100),
      allowDuplicates: z.boolean().optional().describe('Save expenses even if they look like ones already in the activity.'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, async ({ activity: reference, expenses, allowDuplicates = false }) => {
    let name: string | undefined
    try {
      const activity = await findLinked(reference)
      name = activity.name
      const { record, before, planned } = await saveChange(credentialsOf(activity), snapshot => {
        const plan = planExpenseAdditions(snapshot, expenses as ExpenseInput[], {
          allowDuplicates,
          now: now(),
          makeId: () => makeId('expense'),
        })
        return { ...plan, preview: plan.activity, activity: plan.saved.length ? plan.activity : null }
      })
      return reply({
        activity: record.snapshot.group.name,
        currency: describeActivity(record.snapshot, viewerFor(activity, record)).currency,
        saved: planned.saved.map(expense => describeExpense(record.snapshot, expense)),
        skipped: planned.skipped.map(({ expense, duplicateOf }) => ({
          ...describeExpense(planned.preview, expense),
          reason: `Looks like "${duplicateOf.title}" from ${duplicateOf.createdAt.slice(0, 10)}, already in Tally.`,
        })),
        balanceChanges: balanceChanges(before, record.snapshot),
        you: viewerName(activity, record),
        next: 'Recap the saved and skipped expenses for the user so they can review them in Tally.',
      })
    } catch (error) {
      return failure(error, name)
    }
  })

  server.registerTool('record_settlement', {
    title: 'Record a payment between people',
    description: 'Records that one person paid another back, such as Leo paying Mia, as a settlement payment. The amount can\'t exceed what the payer owes or what the recipient is owed; get_activity shows balances and suggested payments. Record only payments the user says were made.',
    inputSchema: {
      activity: activitySchema,
      from: z.string().describe('Who paid: a member name or id.'),
      to: z.string().describe('Who received the money: a member name or id.'),
      amount: z.number().describe('How much, in the activity\'s currency, with at most two decimals.'),
      date: expenseDateSchema.optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, async ({ activity: reference, from, to, amount, date }) => {
    let name: string | undefined
    try {
      const activity = await findLinked(reference)
      name = activity.name
      const { record, before, planned } = await saveChange(credentialsOf(activity), snapshot => (
        planSettlement(snapshot, { from, to, amount, date }, makeId('payment'), now())
      ))
      return reply({
        activity: record.snapshot.group.name,
        saved: describeExpense(record.snapshot, planned.saved),
        balanceChanges: balanceChanges(before, record.snapshot),
        you: viewerName(activity, record),
        next: 'Tell the user which payment was recorded and how the balances moved.',
      })
    } catch (error) {
      return failure(error, name)
    }
  })

  server.registerTool('add_members', {
    title: 'Add people to a Tally activity',
    description: 'Adds friends to a linked activity by name. Someone who was removed comes back instead of being added twice, and names already in the activity are left alone.',
    inputSchema: {
      activity: activitySchema,
      names: z.array(z.string()).min(1).max(100).describe('Friends\' names.'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, async ({ activity: reference, names }) => {
    let name: string | undefined
    try {
      const activity = await findLinked(reference)
      name = activity.name
      const { record, planned } = await saveChange(credentialsOf(activity), snapshot => {
        const plan = planMemberAdditions(snapshot, names, makeId)
        return { ...plan, activity: plan.added.length || plan.restored.length ? plan.activity : null }
      })
      return reply({
        activity: record.snapshot.group.name,
        added: planned.added,
        restored: planned.restored,
        alreadyIn: planned.alreadyIn,
        members: describeActivity(record.snapshot, viewerFor(activity, record)).members.filter(member => member.active).map(member => member.name),
      })
    } catch (error) {
      return failure(error, name)
    }
  })

  server.registerTool('update_expense', {
    title: 'Change an expense',
    description: 'Changes one expense, only in the ways the user asked. Pass its id and version from get_activity; if someone changed it since, nothing is saved and you get the current version to show the user. A new amount is split again between the same people, except for exact splits, which need the new split too.',
    inputSchema: {
      activity: activitySchema,
      expenseId: expenseIdSchema,
      version: versionSchema,
      title: titleSchema.optional(),
      amount: amountSchema.optional(),
      payer: payerSchema.optional(),
      split: expenseSchema.shape.split.optional(),
      category: categorySchema.optional(),
      date: expenseDateSchema.optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, async ({ activity: reference, expenseId, version, ...changes }) => {
    let name: string | undefined
    try {
      const activity = await findLinked(reference)
      name = activity.name
      const { record, before, planned } = await saveChange(credentialsOf(activity), snapshot => (
        planExpenseUpdate(snapshot, expenseId, version, changes, now())
      ))
      return reply({
        activity: record.snapshot.group.name,
        before: describeExpense(before, planned.before),
        after: describeExpense(record.snapshot, planned.after),
        balanceChanges: balanceChanges(before, record.snapshot),
        next: 'Tell the user what changed so they can check it in Tally.',
      })
    } catch (error) {
      return failure(error, name)
    }
  })

  server.registerTool('delete_expense', {
    title: 'Delete an expense',
    description: 'Deletes one expense or payment. Only call it when the user asked to delete that specific item; there is no bulk delete. Pass its id and version from get_activity; if someone changed it since, nothing is deleted.',
    inputSchema: {
      activity: activitySchema,
      expenseId: expenseIdSchema,
      version: versionSchema,
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  }, async ({ activity: reference, expenseId, version }) => {
    let name: string | undefined
    try {
      const activity = await findLinked(reference)
      name = activity.name
      const { record, before, planned } = await saveChange(credentialsOf(activity), snapshot => planExpenseDeletion(snapshot, expenseId, version))
      return reply({
        activity: record.snapshot.group.name,
        deleted: describeExpense(before, planned.deleted),
        balanceChanges: balanceChanges(before, record.snapshot),
        next: 'Tell the user what was deleted. It can be added again if this was a mistake.',
      })
    } catch (error) {
      return failure(error, name)
    }
  })

  server.registerTool('create_activity', {
    title: 'Create a Live Tally activity',
    description: 'Creates a new Live activity with the user and their friends, links it on this computer and opens it in the user\'s browser. Ask for the user\'s own name if you don\'t know it.',
    inputSchema: {
      name: z.string().describe('The activity name, such as "Ski weekend".'),
      yourName: z.string().describe('The user\'s own name, as friends know them.'),
      members: z.array(z.string()).max(100).describe('Friends\' names, without the user.'),
      currency: z.enum(SUPPORTED_CURRENCIES).describe('ISO currency code, such as USD, EUR or JPY.'),
      emoji: z.string().optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, async ({ name, yourName, members, currency, emoji }) => {
    try {
      const snapshot = createActivitySnapshot({ name, creatorName: yourName, memberNames: members, currency, emoji }, makeId)
      const created = await client.create(snapshot)
      await store.save({
        code: created.code,
        editToken: created.editToken,
        memberId: 'me',
        name: snapshot.group.name,
        linkedAt: now().toISOString(),
      })
      const opened = await openUrl(buildLiveActivityUrl(created, appUrl))
      return reply({
        code: created.code,
        name: snapshot.group.name,
        currency,
        members: activityMembers(snapshot).map(member => member.name),
        openedInBrowser: opened,
        next: opened
          ? 'It is open in the user\'s browser. Call get_share_link if they want to invite friends.'
          : 'Linked here, but the browser did not open. Call get_share_link if the user wants the link.',
      })
    } catch (error) {
      return failure(error, name)
    }
  })

  server.registerTool('get_share_link', {
    title: 'Get a Tally invite link',
    description: 'Returns the Live invite link and a ready-to-send message. Anyone with the link can edit the activity, so call this only when the user asks to share or invite people.',
    inputSchema: {
      activity: activitySchema,
      language: z.enum(['en', 'zh-CN']).optional().describe('Language of the invite message. English by default.'),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ activity: reference, language = 'en' }) => {
    try {
      const activity = await findLinked(reference)
      const url = buildLiveActivityUrl(credentialsOf(activity), appUrl)
      const message = language === 'zh-CN'
        ? `一起在 Tally 记录「${activity.name}」的花销吧：${url}`
        : `Let's track ${activity.name} together in Tally: ${url}`
      return reply({ name: activity.name, url, message })
    } catch (error) {
      return failure(error)
    }
  })

  let pendingLink: { session: AgentLinkSession; result: Promise<unknown> } | null = null

  server.registerTool('link_activities', {
    title: 'Link Tally activities',
    description: 'Opens Tally in the user\'s browser so they can allow this agent to use activities they already have. Call it when the user names an activity that list_activities doesn\'t show. You get names, never links.',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async () => {
    try {
      let opened = true
      if (!pendingLink) {
        const session = await startLinkSession({ appUrl, client: agentClientFromName(server.server.getClientVersion()?.name) })
        const result = session.approval
          .then(
            async payload => ({ status: 'linked', ...await linkApprovedActivities(payload, client, store, now()) }),
            (error: Error) => { throw new McpToolError(`${error.message} Call link_activities to try again.`) },
          )
          .finally(() => { pendingLink = null })
        result.catch(() => undefined)
        pendingLink = { session, result }
        opened = await openUrl(session.approvalUrl)
      }
      const { session, result } = pendingLink
      let timer: ReturnType<typeof setTimeout> | undefined
      // Without a browser nobody can approve yet, so hand the agent the page right away.
      const waiting = new Promise(resolve => { timer = setTimeout(() => resolve(null), opened ? linkWaitMs : 0) })
      const outcome = await Promise.race([result, waiting]).finally(() => clearTimeout(timer))
      if (outcome) return reply(outcome)
      return reply({
        status: 'waiting',
        approvalUrl: session.approvalUrl,
        next: opened
          ? 'Tally is open in the user\'s browser. Ask them to click Allow, then call list_activities.'
          : 'The browser did not open. Ask the user to open approvalUrl on this computer and click Allow, then call list_activities.',
      })
    } catch (error) {
      return failure(error)
    }
  })

  const promptReply = (text: string) => ({ messages: [{ role: 'user' as const, content: { type: 'text' as const, text } }] })
  const { 'import-transactions': importTransactions, 'plan-a-trip': planATrip, 'settle-up': settleUp } = MCP_PROMPTS
  server.registerPrompt('import-transactions', importTransactions, args => promptReply(importTransactions.text(args)))
  server.registerPrompt('plan-a-trip', planATrip, args => promptReply(planATrip.text(args)))
  server.registerPrompt('settle-up', settleUp, args => promptReply(settleUp.text(args)))

  return server
}
