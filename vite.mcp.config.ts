import { defineConfig } from 'vite'

// Bundles the tally-mcp command (Claude Code and Codex MCP server) into one Node file.
// VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY are built in, like the web app.
export default defineConfig({
  publicDir: false,
  build: {
    ssr: 'src/features/mcp/bin.ts',
    outDir: 'dist-mcp',
    emptyOutDir: true,
    target: 'node22',
    rollupOptions: {
      output: {
        entryFileNames: 'tally-mcp.mjs',
        banner: '#!/usr/bin/env node',
      },
    },
  },
  ssr: {
    noExternal: true,
  },
})
