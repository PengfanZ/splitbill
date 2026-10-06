import { readFileSync } from 'node:fs'
import path from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { describe, expect, it, vi } from 'vitest'
import { MCP_AGENT_RULES, MCP_INSTALL_COMMANDS, MCP_JSON_CONFIG, MCP_NPM_URL } from './agentGuide'
import { createTallyMcpServer } from './mcpServer'

// Vitest runs from the repository root; the file ships from public/ to /splitbill/llms.txt.
const llmsTxt = readFileSync(path.join(process.cwd(), 'public/llms.txt'), 'utf8')

async function offered() {
  const server = createTallyMcpServer({
    store: { filePath: '', list: async () => [], save: async () => undefined, remove: async () => false },
    client: { create: vi.fn(), load: vi.fn(), update: vi.fn() },
    appUrl: 'https://tally.test/',
    openUrl: async () => false,
  })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  const client = new Client({ name: 'llms-txt-test', version: '0' })
  await client.connect(clientTransport)
  const tools = (await client.listTools()).tools.map(tool => tool.name)
  const prompts = (await client.listPrompts()).prompts.map(prompt => prompt.name)
  await client.close()
  return { tools, prompts }
}

describe('llms.txt', () => {
  it('tells agents the same rules and install commands as the server', () => {
    for (const rule of MCP_AGENT_RULES) expect(llmsTxt).toContain(rule)
    expect(llmsTxt).toContain(MCP_INSTALL_COMMANDS['claude-code'])
    expect(llmsTxt).toContain(MCP_INSTALL_COMMANDS.codex)
    expect(llmsTxt).toContain(MCP_NPM_URL)
  })

  it('gives agents without an install command the JSON config, with Cursor\'s file', () => {
    expect(JSON.parse(MCP_JSON_CONFIG)).toEqual({ mcpServers: { tally: { command: 'npx', args: ['-y', 'tally-splitbill-mcp'] } } })
    expect(llmsTxt).toContain(MCP_JSON_CONFIG.split('\n').map(line => `   ${line}`).join('\n'))
    expect(llmsTxt).toContain('~/.cursor/mcp.json')
  })

  it('lists exactly the tools and prompts the server offers', async () => {
    const { tools, prompts } = await offered()
    const mentioned = new Set(llmsTxt.match(/`[a-z]+(?:_[a-z]+)+`/g)?.map(name => name.slice(1, -1)))
    expect([...mentioned].sort()).toEqual([...tools].sort())
    for (const prompt of prompts) expect(llmsTxt).toContain(`\`${prompt}\``)
  })
})
