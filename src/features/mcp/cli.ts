import { spawn as spawnProcess } from 'node:child_process'
import { createInterface } from 'node:readline/promises'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { isInactiveMember } from '../../domain/memberRemoval'
import { createLiveActivityClient } from '../liveSharing/liveActivityApi'
import type { LiveActivityClient } from '../liveSharing/liveActivityConfig'
import { parseLiveActivityHash } from '../liveSharing/liveActivityLink'
import { startAgentLinkSession } from './agentLinkServer'
import { createCredentialStore, type CredentialStore } from './credentialStore'
import { linkApprovedActivities } from './linkActivities'
import { activityMembers } from './mcpActivity'
import { createTallyMcpServer } from './mcpServer'

export const DEFAULT_APP_URL = 'https://pengfanz.github.io/splitbill/'

export const USAGE = `Usage: tally-mcp [command]

  (no command)      Run the MCP server for Claude Code or Codex.
  link              Open Tally in your browser and allow activities for your agent.
  link '<url>'      Link one Live activity from its invite link (for machines without a browser).
  list              Show linked activities.
  unlink <code>     Forget a linked activity on this computer.

Install:  claude mcp add tally -- npx -y tally-mcp
          codex mcp add tally -- npx -y tally-mcp`

export type CliConfig = { supabaseUrl: string; publishableKey: string }

export type CliDependencies = {
  store: CredentialStore
  createClient: () => Pick<LiveActivityClient, 'create' | 'load' | 'update'>
  appUrl: string
  openUrl: (url: string) => Promise<boolean>
  prompt: (question: string) => Promise<string>
  print: (text: string) => void
  serve: (dependencies: CliDependencies) => Promise<void>
  startLinkSession: typeof startAgentLinkSession
  now: () => Date
}

/** Build-time defaults come from the same VITE_ variables as the web app; TALLY_ variables override them. */
type BuiltInEnvironment = { VITE_SUPABASE_URL?: string; VITE_SUPABASE_PUBLISHABLE_KEY?: string }

export function resolveCliConfig(
  environment: Record<string, string | undefined>,
  builtIn: BuiltInEnvironment = import.meta.env as BuiltInEnvironment,
): CliConfig {
  const supabaseUrl = environment.TALLY_SUPABASE_URL || builtIn.VITE_SUPABASE_URL || ''
  const publishableKey = environment.TALLY_SUPABASE_PUBLISHABLE_KEY || builtIn.VITE_SUPABASE_PUBLISHABLE_KEY || ''
  if (!supabaseUrl || !publishableKey) {
    throw new Error('This tally-mcp build has no Tally backend. Set TALLY_SUPABASE_URL and TALLY_SUPABASE_PUBLISHABLE_KEY.')
  }
  return { supabaseUrl, publishableKey }
}

type Spawn = (command: string, args: string[], options: { stdio: 'ignore'; detached: boolean }) => {
  once(event: 'spawn' | 'error', listener: () => void): unknown
  unref(): void
}

export function openInBrowser(
  url: string,
  { platform = process.platform, environment = process.env, spawn = spawnProcess as unknown as Spawn } = {},
): Promise<boolean> {
  if (environment.TALLY_MCP_OPEN_BROWSER === '0') return Promise.resolve(false)
  const [command, args] = platform === 'darwin'
    ? ['open', [url]]
    : platform === 'win32'
      ? ['cmd', ['/c', 'start', '""', url]]
      : ['xdg-open', [url]]
  return new Promise(resolve => {
    const child = spawn(command, args, { stdio: 'ignore', detached: true })
    child.once('error', () => resolve(false))
    child.once('spawn', () => {
      child.unref()
      resolve(true)
    })
  })
}

async function linkFromInviteUrl(url: string, dependencies: CliDependencies) {
  let credentials = null
  try {
    credentials = parseLiveActivityHash(new URL(url).hash)
  } catch {
    // Reported below.
  }
  if (!credentials) throw new Error('That is not a Tally Live invite link. Copy it from Share → Copy live invite link.')
  const record = await dependencies.createClient().load(credentials)
  const members = activityMembers(record.snapshot).filter(member => !isInactiveMember(record.snapshot.group, member.id))
  dependencies.print(`Found "${record.snapshot.group.name}". Which member are you?`)
  members.forEach((member, index) => dependencies.print(`  ${index + 1}. ${member.name}`))
  const answer = Number((await dependencies.prompt('Number: ')).trim())
  const member = members[answer - 1]
  if (!Number.isInteger(answer) || !member) throw new Error('Pick one of the listed numbers.')
  await dependencies.store.save({
    ...credentials,
    memberId: member.id,
    name: record.snapshot.group.name,
    linkedAt: dependencies.now().toISOString(),
  })
  dependencies.print(`Linked ${record.snapshot.group.name} as ${member.name}. Your agent can use it now.`)
}

async function linkInBrowser(dependencies: CliDependencies) {
  const session = await dependencies.startLinkSession({ appUrl: dependencies.appUrl, client: 'other' })
  const opened = await dependencies.openUrl(session.approvalUrl)
  dependencies.print(opened
    ? 'Opened Tally in your browser. Choose activities there and click Allow.'
    : `Open this page on this computer, choose activities and click Allow:\n${session.approvalUrl}`)
  const outcome = await linkApprovedActivities(await session.approval, dependencies.createClient(), dependencies.store, dependencies.now())
  for (const activity of outcome.linked) dependencies.print(`Linked ${activity.name} as ${activity.you}.`)
  for (const activity of outcome.failed) dependencies.print(`Could not link ${activity.code}: ${activity.reason}`)
}

/** Returns the process exit code. */
export async function runCli(argv: string[], dependencies: CliDependencies): Promise<number> {
  const [command, ...rest] = argv
  if (command === undefined || command === 'serve') {
    await dependencies.serve(dependencies)
    return 0
  }
  if (command === 'link' && rest.length <= 1) {
    if (rest[0]) await linkFromInviteUrl(rest[0], dependencies)
    else await linkInBrowser(dependencies)
    return 0
  }
  if (command === 'list' && !rest.length) {
    const linked = await dependencies.store.list()
    if (!linked.length) dependencies.print('Nothing is linked yet. Run `tally-mcp link` or ask your agent to create an activity.')
    for (const activity of linked) dependencies.print(`${activity.code}  ${activity.name}`)
    return 0
  }
  if (command === 'unlink' && rest.length === 1) {
    const removed = await dependencies.store.remove(rest[0].toUpperCase())
    dependencies.print(removed ? `Unlinked ${rest[0].toUpperCase()}.` : `${rest[0]} is not linked.`)
    return removed ? 0 : 1
  }
  dependencies.print(USAGE)
  return command === 'help' || command === '--help' ? 0 : 1
}

export async function serveStdio(dependencies: CliDependencies) {
  const server = createTallyMcpServer({
    store: dependencies.store,
    client: dependencies.createClient(),
    appUrl: dependencies.appUrl,
    openUrl: dependencies.openUrl,
    startLinkSession: dependencies.startLinkSession,
    now: dependencies.now,
  })
  await server.connect(new StdioServerTransport())
}

export function createNodeDependencies(
  environment: Record<string, string | undefined> = process.env,
  builtIn?: BuiltInEnvironment,
  { input = process.stdin, output = process.stdout }: { input?: NodeJS.ReadableStream; output?: NodeJS.WritableStream } = {},
): CliDependencies {
  let config: CliConfig | null = null
  const getConfig = () => config ??= resolveCliConfig(environment, builtIn)
  return {
    store: createCredentialStore(),
    createClient: () => createLiveActivityClient(getConfig()),
    appUrl: environment.TALLY_APP_URL || DEFAULT_APP_URL,
    openUrl: url => openInBrowser(url, { environment }),
    prompt: async question => {
      const readline = createInterface({ input, output })
      try {
        return await readline.question(question)
      } finally {
        readline.close()
      }
    },
    // Only the link, list and unlink commands print; while serving, stdout carries the MCP protocol.
    print: text => { output.write(`${text}\n`) },
    serve: serveStdio,
    startLinkSession: startAgentLinkSession,
    now: () => new Date(),
  }
}

export async function main(argv: string[]) {
  try {
    process.exitCode = await runCli(argv, createNodeDependencies())
  } catch (error) {
    process.stderr.write(`tally-mcp: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
