import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TOKYO_CODE, TOKYO_TOKEN, tokyoActivity } from '../../test/mcpFixtures'
import type { AgentLinkSession } from './agentLinkServer'
import type { CredentialStore, LinkedActivity } from './credentialStore'

const transports = vi.hoisted(() => [] as unknown[])
vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: class {
    start = vi.fn(async () => undefined)
    send = vi.fn(async () => undefined)
    close = vi.fn(async () => undefined)
    constructor() { transports.push(this) }
  },
}))
const {
  createNodeDependencies,
  DEFAULT_APP_URL,
  main,
  openInBrowser,
  resolveCliConfig,
  runCli,
  serveStdio,
  USAGE,
} = await import('./cli')
type CliDependencies = import('./cli').CliDependencies

const inviteUrl = `https://pengfanz.github.io/splitbill/#live=${TOKYO_CODE}.${TOKYO_TOKEN}`

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

function setup(overrides: Partial<CliDependencies> = {}) {
  const output: string[] = []
  const load = vi.fn(async () => ({ code: TOKYO_CODE, revision: 1, snapshot: tokyoActivity(), updatedAt: '' }))
  const dependencies: CliDependencies = {
    store: memoryStore(),
    createClient: () => ({ load, create: vi.fn(), update: vi.fn() }),
    appUrl: 'https://tally.test/',
    openUrl: vi.fn(async () => true),
    prompt: vi.fn(async () => '2'),
    print: text => { output.push(text) },
    serve: vi.fn(async () => undefined),
    startLinkSession: vi.fn(),
    now: () => new Date('2026-10-04T09:30:00.000Z'),
    ...overrides,
  }
  return { dependencies, output, load, store: dependencies.store as ReturnType<typeof memoryStore> }
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  process.exitCode = undefined
})

describe('resolveCliConfig', () => {
  it('prefers TALLY_ variables, then the values built into the package', () => {
    const builtIn = { VITE_SUPABASE_URL: 'https://built.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'built-key' }
    expect(resolveCliConfig({}, builtIn)).toEqual({ supabaseUrl: 'https://built.supabase.co', publishableKey: 'built-key' })
    expect(resolveCliConfig({ TALLY_SUPABASE_URL: 'http://127.0.0.1:54321', TALLY_SUPABASE_PUBLISHABLE_KEY: 'local' }, builtIn))
      .toEqual({ supabaseUrl: 'http://127.0.0.1:54321', publishableKey: 'local' })
  })

  it('reads the build environment by default and explains a missing backend', () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://env.supabase.co')
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'env-key')
    expect(resolveCliConfig({})).toEqual({ supabaseUrl: 'https://env.supabase.co', publishableKey: 'env-key' })
    expect(() => resolveCliConfig({}, {})).toThrow('TALLY_SUPABASE_URL')
  })
})

describe('openInBrowser', () => {
  function fakeSpawn(event: 'spawn' | 'error') {
    const calls: [string, string[]][] = []
    const unref = vi.fn()
    const spawn = (command: string, args: string[]) => {
      calls.push([command, args])
      const child = Object.assign(new EventEmitter(), { unref })
      queueMicrotask(() => child.emit(event))
      return child
    }
    return { spawn, calls, unref }
  }

  it('uses each platform\'s opener and detaches from it', async () => {
    for (const [platform, command, args] of [
      ['darwin', 'open', ['https://x.test']],
      ['win32', 'cmd', ['/c', 'start', '""', 'https://x.test']],
      ['linux', 'xdg-open', ['https://x.test']],
    ] as const) {
      const fake = fakeSpawn('spawn')
      await expect(openInBrowser('https://x.test', { platform, environment: {}, spawn: fake.spawn })).resolves.toBe(true)
      expect(fake.calls).toEqual([[command, args]])
      expect(fake.unref).toHaveBeenCalled()
    }
  })

  it('reports when no browser could open, or when opening is turned off', async () => {
    await expect(openInBrowser('https://x.test', { platform: 'linux', environment: {}, spawn: fakeSpawn('error').spawn })).resolves.toBe(false)
    await expect(openInBrowser('https://x.test', { environment: { TALLY_MCP_OPEN_BROWSER: '0' } })).resolves.toBe(false)
  })
})

describe('runCli', () => {
  it('serves MCP by default and with serve', async () => {
    const { dependencies } = setup()
    await expect(runCli([], dependencies)).resolves.toBe(0)
    await expect(runCli(['serve'], dependencies)).resolves.toBe(0)
    expect(dependencies.serve).toHaveBeenCalledTimes(2)
  })

  it('links one activity from an invite link after asking who the user is', async () => {
    const { dependencies, output, store } = setup()
    await expect(runCli(['link', inviteUrl], dependencies)).resolves.toBe(0)
    expect(output).toEqual([
      'Found "Tokyo trip". Which member are you?',
      '  1. Mia',
      '  2. Leo',
      '  3. Sam',
      'Linked Tokyo trip as Leo. Your agent can use it now.',
    ])
    expect(store.saved.get(TOKYO_CODE)).toEqual({ code: TOKYO_CODE, editToken: TOKYO_TOKEN, memberId: 'friend-leo', name: 'Tokyo trip', linkedAt: '2026-10-04T09:30:00.000Z' })
  })

  it('refuses links that are not Live invites and answers that are not listed', async () => {
    const { dependencies } = setup({ prompt: async () => '9' })
    await expect(runCli(['link', 'not a url'], dependencies)).rejects.toThrow('not a Tally Live invite link')
    await expect(runCli(['link', 'https://pengfanz.github.io/splitbill/#share=x'], dependencies)).rejects.toThrow('not a Tally Live invite link')
    await expect(runCli(['link', inviteUrl], dependencies)).rejects.toThrow('Pick one of the listed numbers')
    await expect(runCli(['link', inviteUrl], { ...dependencies, prompt: async () => 'two' })).rejects.toThrow('Pick one')
  })

  it('links in the browser, printing the page when it cannot open one', async () => {
    const approvalUrl = 'https://tally.test/#agent-link=51234.0123456789abcdef0123456789abcdef.other'
    const session: AgentLinkSession = {
      approvalUrl,
      close: vi.fn(),
      approval: Promise.resolve({
        state: '0123456789abcdef0123456789abcdef',
        activities: [
          { code: TOKYO_CODE, editToken: TOKYO_TOKEN, memberId: 'friend-sam' },
          { code: TOKYO_CODE, editToken: TOKYO_TOKEN, memberId: 'friend-ana' },
        ],
      }),
    }
    const startLinkSession = vi.fn(async () => session)
    const opened = setup({ startLinkSession })
    await expect(runCli(['link'], opened.dependencies)).resolves.toBe(0)
    expect(startLinkSession).toHaveBeenCalledWith({ appUrl: 'https://tally.test/', client: 'other' })
    expect(opened.output).toEqual([
      'Opened Tally in your browser. Choose activities there and click Allow.',
      'Linked Tokyo trip as Sam.',
      `Could not link ${TOKYO_CODE}: The chosen member is no longer in this activity.`,
    ])

    const closed = setup({ startLinkSession, openUrl: async () => false })
    await runCli(['link'], closed.dependencies)
    expect(closed.output[0]).toBe(`Open this page on this computer, choose activities and click Allow:\n${approvalUrl}`)
  })

  it('links through the real localhost hand-off once the browser approves', async () => {
    const { startAgentLinkSession } = await import('./agentLinkServer')
    const { agentLinkCallbackUrl, parseAgentLinkHash } = await import('./agentLinkProtocol')
    const { request } = await import('node:http')
    // Stand-in for the browser: Tally's approval page navigates to the callback, whose page posts the fragment back.
    const approveInBrowser = async (approvalUrl: string) => {
      const linkRequest = parseAgentLinkHash(new URL(approvalUrl).hash)!
      const callback = new URL(agentLinkCallbackUrl(linkRequest, {
        state: linkRequest.state,
        activities: [{ code: TOKYO_CODE, editToken: TOKYO_TOKEN, memberId: 'me' }],
      }))
      await new Promise<void>((resolve, reject) => {
        const post = request({ host: '127.0.0.1', port: linkRequest.port, method: 'POST', path: '/done', headers: { origin: callback.origin, 'content-type': 'application/json' } }, response => {
          response.resume()
          response.on('end', () => resolve())
        })
        post.on('error', reject)
        post.end(JSON.stringify({ payload: callback.hash.slice(1) }))
      })
      return true
    }
    const { dependencies, output, store } = setup({ startLinkSession: startAgentLinkSession, openUrl: approveInBrowser })
    await expect(runCli(['link'], dependencies)).resolves.toBe(0)
    expect(output.at(-1)).toBe('Linked Tokyo trip as Mia.')
    expect(store.saved.get(TOKYO_CODE)?.memberId).toBe('me')
  })

  it('lists and unlinks activities without showing tokens', async () => {
    const { dependencies, output } = setup({
      store: memoryStore([{ code: TOKYO_CODE, editToken: TOKYO_TOKEN, memberId: 'me', name: 'Tokyo trip', linkedAt: '2026-10-04T09:30:00.000Z' }]),
    })
    await expect(runCli(['list'], dependencies)).resolves.toBe(0)
    await expect(runCli(['unlink', TOKYO_CODE.toLowerCase()], dependencies)).resolves.toBe(0)
    await expect(runCli(['unlink', TOKYO_CODE], dependencies)).resolves.toBe(1)
    await expect(runCli(['list'], dependencies)).resolves.toBe(0)
    expect(output).toEqual([
      `${TOKYO_CODE}  Tokyo trip`,
      `Unlinked ${TOKYO_CODE}.`,
      `${TOKYO_CODE} is not linked.`,
      'Nothing is linked yet. Run `tally-mcp link` or ask your agent to create an activity.',
    ])
    expect(output.join('\n')).not.toContain(TOKYO_TOKEN)
  })

  it('shows usage for help and unknown commands', async () => {
    const { dependencies, output } = setup()
    await expect(runCli(['--help'], dependencies)).resolves.toBe(0)
    await expect(runCli(['help'], dependencies)).resolves.toBe(0)
    await expect(runCli(['link', 'a', 'b'], dependencies)).resolves.toBe(1)
    await expect(runCli(['list', 'x'], dependencies)).resolves.toBe(1)
    await expect(runCli(['unlink'], dependencies)).resolves.toBe(1)
    expect(output).toEqual([USAGE, USAGE, USAGE, USAGE, USAGE])
  })
})

describe('Node wiring', () => {
  it('serves the MCP server over stdio', async () => {
    const { dependencies } = setup()
    await serveStdio(dependencies)
    expect(transports).toHaveLength(1)
  })

  it('connects real dependencies lazily to the configured backend', async () => {
    const input = new PassThrough()
    const output = new PassThrough()
    let printed = ''
    output.on('data', chunk => { printed += chunk })
    const dependencies = createNodeDependencies({ TALLY_APP_URL: 'http://localhost:5173/', TALLY_MCP_OPEN_BROWSER: '0' }, {
      VITE_SUPABASE_URL: 'https://built.supabase.co',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'built-key',
    }, { input, output })
    expect(dependencies.appUrl).toBe('http://localhost:5173/')
    expect(Object.keys(dependencies.createClient())).toEqual(expect.arrayContaining(['load', 'update', 'create']))
    await expect(dependencies.openUrl('https://x.test')).resolves.toBe(false)
    const answer = dependencies.prompt('Number: ')
    input.write('3\n')
    await expect(answer).resolves.toBe('3')
    dependencies.print('hello')
    expect(printed).toBe('Number: hello\n')
    expect(dependencies.serve).toBe(serveStdio)
    expect(dependencies.now()).toBeInstanceOf(Date)

    expect(createNodeDependencies({}, {}).appUrl).toBe(DEFAULT_APP_URL)
    expect(() => createNodeDependencies({}, {}).createClient()).toThrow('no Tally backend')
    expect(createNodeDependencies().store.filePath).toContain('live-activities.json')
  })

  it('sets the exit code and reports errors on stderr', async () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    await main(['help'])
    expect(process.exitCode).toBe(0)
    expect(stdout).toHaveBeenCalledWith(`${USAGE}\n`)
    await main(['link', 'not a url'])
    expect(process.exitCode).toBe(1)
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('tally-mcp: That is not a Tally Live invite link'))
  })

  it('reports non-Error failures too', async () => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => { throw 'odd' })
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    await main(['help'])
    expect(stderr).toHaveBeenCalledWith('tally-mcp: odd\n')
    expect(process.exitCode).toBe(1)
  })
})

describe('bin', () => {
  it('runs the CLI with the process arguments', async () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const argv = process.argv
    process.argv = ['node', 'tally-mcp', 'help']
    await import('./bin')
    await vi.waitFor(() => expect(stdout).toHaveBeenCalledWith(`${USAGE}\n`))
    process.argv = argv
  })
})
