import { z } from 'zod'

/** Workflows the server publishes as MCP prompts; Claude Code shows them as slash commands. */
export const MCP_PROMPTS = {
  'import-transactions': {
    title: 'Import transactions',
    description: 'Add the shared rows from a bank or card statement to a Tally activity.',
    argsSchema: {
      file: z.string().describe('Path to the statement file, such as a CSV export.'),
      activity: z.string().optional().describe('The Tally activity to add them to.'),
    },
    text: ({ file, activity }: { file: string; activity?: string }) => [
      `Import the shared expenses from ${file} into ${activity ? `the Tally activity "${activity}"` : 'Tally'}.`,
      `1. Read the file. Call list_activities${activity ? '' : ', and ask me which activity to use if it is not obvious'}, then get_activity for its members and categories.`,
      '2. Pick the rows that look like shared costs. Show them to me with the payer and split you propose, and ask about anything unclear (personal purchases, who paid, who shared it) before saving.',
      '3. Save them in one add_expenses call, with each row\'s date and a short, readable title.',
      '4. Recap what was saved and what was skipped as a duplicate, so I can review it in Tally.',
    ].join('\n'),
  },
  'plan-a-trip': {
    title: 'Plan a trip',
    description: 'Create a Live Tally activity for a trip or event and invite people.',
    argsSchema: {
      name: z.string().describe('What the activity is for, such as "Ski weekend".'),
      people: z.string().optional().describe('Who is coming, besides you.'),
      currency: z.string().optional().describe('The currency to track it in, such as CAD.'),
    },
    text: ({ name, people, currency }: { name: string; people?: string; currency?: string }) => [
      `Set up a Tally activity for "${name}".`,
      `1. Ask me for anything you don't know yet: my own name${people ? '' : ', who is coming'}${currency ? '' : ', and the currency'}.`,
      `2. Call create_activity${people ? ` with ${people}` : ''}${currency ? ` in ${currency}` : ''}. It opens in my browser.`,
      '3. Ask whether I want an invite message. Call get_share_link only if I say yes.',
    ].join('\n'),
  },
  'settle-up': {
    title: 'Settle up',
    description: 'See who owes whom in an activity and record the payments people made.',
    argsSchema: {
      activity: z.string().describe('The Tally activity to settle.'),
    },
    text: ({ activity }: { activity: string }) => [
      `Help me settle up "${activity}" in Tally.`,
      '1. Call get_activity and show me the balances and the suggested payments: who pays whom, and how much.',
      '2. Ask me which of those payments have actually been made.',
      '3. Record only those, one record_settlement call per payment, then show me the updated balances.',
    ].join('\n'),
  },
} as const
