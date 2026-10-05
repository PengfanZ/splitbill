import { defineConfig, loadEnv } from 'vite'
import { assertReleaseBackend } from './src/features/mcp/releaseBuild'

// Bundles tally-splitbill-mcp (the Claude Code and Codex MCP server) into one Node file with no dependencies.
// VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY are built in, like the web app. `--mode release` builds the
// published package and refuses any backend but production.
export default defineConfig(({ mode }) => {
  if (mode === 'release') assertReleaseBackend(loadEnv(mode, process.cwd(), 'VITE_'))
  return {
    publicDir: false,
    build: {
      ssr: 'src/features/mcp/bin.ts',
      outDir: 'packages/tally-splitbill-mcp/dist',
      emptyOutDir: true,
      target: 'node22',
      rollupOptions: {
        output: {
          entryFileNames: 'tally-splitbill-mcp.mjs',
          banner: '#!/usr/bin/env node',
        },
      },
    },
    ssr: {
      noExternal: true,
    },
  }
})
