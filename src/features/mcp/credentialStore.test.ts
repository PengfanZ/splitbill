import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createCredentialStore, defaultCredentialStorePath, type LinkedActivity } from './credentialStore'

const tokyo: LinkedActivity = {
  code: 'A1B2C3D4E5',
  editToken: 'a'.repeat(64),
  memberId: 'me',
  name: 'Tokyo trip',
  linkedAt: '2026-10-04T12:00:00.000Z',
}
const ski: LinkedActivity = { ...tokyo, code: 'B1B2C3D4E5', editToken: 'b'.repeat(64), name: 'Ski weekend' }

describe('defaultCredentialStorePath', () => {
  it('uses the explicit config directory first', () => {
    expect(defaultCredentialStorePath({ TALLY_MCP_CONFIG_DIR: '/tmp/tally', XDG_CONFIG_HOME: '/xdg' }, '/home/mia'))
      .toBe(path.join('/tmp/tally', 'live-activities.json'))
  })

  it('falls back to XDG and then the home directory', () => {
    expect(defaultCredentialStorePath({ XDG_CONFIG_HOME: '/xdg' }, '/home/mia')).toBe(path.join('/xdg', 'tally', 'live-activities.json'))
    expect(defaultCredentialStorePath({}, '/home/mia')).toBe(path.join('/home/mia', '.config', 'tally', 'live-activities.json'))
  })

  it('reads the real environment by default', () => {
    vi.stubEnv('TALLY_MCP_CONFIG_DIR', '/env/tally')
    expect(defaultCredentialStorePath()).toBe(path.join('/env/tally', 'live-activities.json'))
    vi.unstubAllEnvs()
  })
})

describe('createCredentialStore', () => {
  let directory: string
  let filePath: string

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'tally-splitbill-mcp-'))
    filePath = path.join(directory, 'nested', 'live-activities.json')
  })

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  it('starts empty when nothing has been linked', async () => {
    await expect(createCredentialStore(filePath).list()).resolves.toEqual([])
  })

  it('saves links privately and lists them by name', async () => {
    const store = createCredentialStore(filePath)
    await store.save(tokyo)
    await store.save(ski)

    await expect(store.list()).resolves.toEqual([ski, tokyo])
    expect((await stat(filePath)).mode & 0o777).toBe(0o600)
    expect((await stat(path.dirname(filePath))).mode & 0o777).toBe(0o700)
  })

  it('replaces a relinked activity and removes links', async () => {
    const store = createCredentialStore(filePath)
    await store.save(tokyo)
    await store.save({ ...tokyo, memberId: 'friend-1' })

    await expect(store.list()).resolves.toEqual([{ ...tokyo, memberId: 'friend-1' }])
    await expect(store.remove('FFFFFFFFFF')).resolves.toBe(false)
    await expect(store.remove(tokyo.code)).resolves.toBe(true)
    await expect(store.list()).resolves.toEqual([])
  })

  it('rejects invalid credentials before writing them', async () => {
    const store = createCredentialStore(filePath)
    await expect(store.save({ ...tokyo, editToken: 'short' })).rejects.toThrow()
    await expect(store.list()).resolves.toEqual([])
  })

  it('keeps valid links when one stored entry is corrupted', async () => {
    const store = createCredentialStore(filePath)
    await store.save(tokyo)
    const file = JSON.parse(await readFile(filePath, 'utf8'))
    file.activities.broken = { code: 'nope' }
    await writeFile(filePath, JSON.stringify(file))

    await expect(store.list()).resolves.toEqual([tokyo])
  })

  it('explains unreadable files instead of silently discarding links', async () => {
    const store = createCredentialStore(filePath)
    await store.save(tokyo)
    await writeFile(filePath, '{')
    await expect(store.list()).rejects.toThrow('not valid JSON')
    await writeFile(filePath, JSON.stringify({ version: 2, activities: {} }))
    await expect(store.list()).rejects.toThrow('unknown format')
  })

  it('reports file-system errors other than a missing file', async () => {
    const failure = Object.assign(new Error('denied'), { code: 'EACCES' })
    const store = createCredentialStore(filePath, {
      readFile: vi.fn().mockRejectedValue(failure),
      writeFile: vi.fn(),
      rename: vi.fn(),
      mkdir: vi.fn(),
    })
    await expect(store.list()).rejects.toBe(failure)
    const plainFailure = createCredentialStore(filePath, {
      readFile: vi.fn().mockRejectedValue('boom'),
      writeFile: vi.fn(),
      rename: vi.fn(),
      mkdir: vi.fn(),
    })
    await expect(plainFailure.list()).rejects.toBe('boom')
  })
})
