import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { z } from 'zod'
import { LIVE_ACTIVITY_CODE_PATTERN, LIVE_ACTIVITY_TOKEN_PATTERN } from '../liveSharing/liveActivityLink'

const linkedActivitySchema = z.object({
  code: z.string().regex(LIVE_ACTIVITY_CODE_PATTERN),
  editToken: z.string().regex(LIVE_ACTIVITY_TOKEN_PATTERN),
  memberId: z.string().min(1).max(120),
  name: z.string().min(1).max(120),
  linkedAt: z.iso.datetime({ offset: true }),
})

const storeFileSchema = z.object({
  version: z.literal(1),
  activities: z.record(z.string(), z.unknown()),
})

export type LinkedActivity = z.infer<typeof linkedActivitySchema>

export type CredentialStore = {
  readonly filePath: string
  list(): Promise<LinkedActivity[]>
  save(activity: LinkedActivity): Promise<void>
  remove(code: string): Promise<boolean>
}

type StoreFileSystem = {
  readFile(filePath: string, encoding: 'utf8'): Promise<string>
  writeFile(filePath: string, data: string, options: { mode: number }): Promise<void>
  rename(from: string, to: string): Promise<void>
  mkdir(directory: string, options: { recursive: true; mode: number }): Promise<unknown>
}

const nodeFileSystem: StoreFileSystem = { readFile, writeFile, rename, mkdir }

export function defaultCredentialStorePath(environment: Record<string, string | undefined> = process.env, home = homedir()) {
  const directory = environment.TALLY_MCP_CONFIG_DIR
    || path.join(environment.XDG_CONFIG_HOME || path.join(home, '.config'), 'tally')
  return path.join(directory, 'live-activities.json')
}

function isMissingFile(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}

export function createCredentialStore(filePath = defaultCredentialStorePath(), fileSystem: StoreFileSystem = nodeFileSystem): CredentialStore {
  const read = async (): Promise<Record<string, LinkedActivity>> => {
    let text: string
    try {
      text = await fileSystem.readFile(filePath, 'utf8')
    } catch (error) {
      if (isMissingFile(error)) return {}
      throw error
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      throw new Error(`Tally's linked-activity file is not valid JSON: ${filePath}`)
    }
    const file = storeFileSchema.safeParse(parsed)
    if (!file.success) throw new Error(`Tally's linked-activity file has an unknown format: ${filePath}`)
    // Skip individually corrupted entries instead of losing every link.
    return Object.fromEntries(Object.values(file.data.activities).flatMap(value => {
      const activity = linkedActivitySchema.safeParse(value)
      return activity.success ? [[activity.data.code, activity.data]] : []
    }))
  }

  const write = async (activities: Record<string, LinkedActivity>) => {
    await fileSystem.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 })
    const temporaryPath = `${filePath}.${process.pid}.tmp`
    await fileSystem.writeFile(temporaryPath, `${JSON.stringify({ version: 1, activities }, null, 2)}\n`, { mode: 0o600 })
    await fileSystem.rename(temporaryPath, filePath)
  }

  return {
    filePath,
    async list() {
      return Object.values(await read()).sort((first, second) => first.name.localeCompare(second.name))
    },
    async save(activity) {
      const entry = linkedActivitySchema.parse(activity)
      await write({ ...await read(), [entry.code]: entry })
    },
    async remove(code) {
      const activities = await read()
      if (!(code in activities)) return false
      delete activities[code]
      await write(activities)
      return true
    },
  }
}
