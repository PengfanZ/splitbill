# Tally MCP server (proposal)

Status: **design proposal, not implemented.** Nothing in this document is live.

An MCP server lets people use coding agents to work with Tally from the terminal. Examples: "add the shared rows from `~/Downloads/statement.csv` to the Tokyo trip", "create a ski weekend activity and email the link to Leo and Sam", "who still owes me?"

## Principles

- **Clients: Codex and Claude Code only.** ChatGPT, Claude.ai and other hosted chat clients are out of scope, so there is no OAuth and no remote MCP endpoint.
- **Live activities only.** The server reads and writes the canonical Supabase record behind a `#live=` capability. Browser-local activities never leave `localStorage`, and agents cannot see them.
- **Preview, then confirm.** No tool saves on its own. Every write returns a preview, and a separate `confirm` call saves it after the user approves it in the conversation.
- **No backend or data-model changes.** The server is another Live client on the existing RPCs and the existing snapshot format.
- **No model calls.** The user's agent does the language work and sends structured expenses. Tally makes no OpenRouter requests and adds no AI budget.
- **Tally never sends messages.** Sharing returns a link and invite text. The agent delivers them with its own tools.

## Architecture: a local stdio server on the existing Live RPCs

Codex and Claude Code both launch local stdio MCP servers, so Tally ships a small Node package instead of a backend service:

```bash
claude mcp add tally -- npx -y tally-mcp
codex mcp add tally -- npx -y tally-mcp
```

The server calls the same public RPCs as the browser, with the publishable key: `create_shared_activity`, `load_shared_activity`, `update_shared_activity_v2`. Existing request throttling, the snapshot byte budget, snapshot validation and revision checks apply to it unchanged.

Code layout:
- `src/features/mcp/` holds the tool handlers, input schemas, name resolution, the preview store and the credential store. It is covered by Vitest at 100%, like the rest of `src/`.
- A thin `bin` entry wires the stdio transport (`@modelcontextprotocol/sdk`) and Node `fetch`. It is bundled into the published package.

It reuses existing modules directly:
- **`createLiveActivityClient` (`liveActivityApi.ts`)** already takes an injected `fetch` and has no browser dependencies.
- **`sharedActivitySchema`** validates every snapshot before it is previewed or saved.
- **`src/domain/`** does money math: equal-split cent allocation, balances and settlements. An agent-created split then rounds exactly like one made in the app.

The Supabase URL and publishable key are baked in at build time, and the server never prints them. `TALLY_SUPABASE_URL` and `TALLY_SUPABASE_PUBLISHABLE_KEY` override them for local or preview backends.

## Credentials and identity

The server keeps a small store at `~/.config/tally/live-activities.json`, created with mode `0600`. For each activity it records:
- code and edit token;
- display name;
- the caller's member ID (who "I" am).

Links are added from the terminal, not by pasting them into the chat, so edit tokens stay out of the agent's context:

```bash
npx tally-mcp link '<live url>'    # validates by loading, asks "Which member are you?"
npx tally-mcp list
npx tally-mcp unlink <code>
```

Activities created through the server are linked automatically, with the caller as `me`.

**Token handling:**
- **Tools never return tokens or URLs**, except `get_share_link`.
- **Nothing is logged:** no tokens or URLs.

Local coding agents can read files on the user's machine, so the store protects tokens from accidental exposure, not from the agent itself. That matches today's model: a Live link is a trusted-group bearer capability. Revoking the CLI's access means **End live sharing**, which also ends everyone else's access.

## Tools

Members can be given by ID or by name. Names are matched case-insensitively among active members. Ambiguous or unknown names return a structured error listing candidates, so the agent asks the user instead of guessing.

### Read

| Tool | Behavior |
| --- | --- |
| `list_activities` | Linked activities: code, name, emoji, currency, member names, the caller's member, expense count. No tokens or URLs. Activities that the backend reports `not-found` are flagged as ended. |
| `get_activity` | Members (active/removed), categories, expenses (paginated, filterable by date and category), balances and suggested settlements. |
| `get_share_link` | Returns the `#live=` URL and invite text in the requested language (`en`/`zh-CN`). This is the only tool that returns a capability. Its description tells the agent to call it only when the user asks to share. |

### Write (preview only)

Each tool validates its input against the latest revision and returns a preview without saving anything:
- a human-readable summary;
- the computed result: shares, per-person balance changes, and for `create_activity` the new activity;
- warnings, such as possible duplicates;
- a short-lived `previewId`.

| Tool | Proposes |
| --- | --- |
| `add_expenses` | A batch of expenses. Each has `title`, `amount`, `payer`, `split: { equal: [members] } \| { exact: { member: amount } }`, optional `category` and `date`. |
| `record_settlement` | A payment `from` → `to` for `amount`, as the existing `kind: "settlement"` shape. |
| `add_members` | Friends by name. Proposes restoring a removed friend instead of duplicating the name. |
| `create_activity` | A new Live activity: name, emoji, currency, member names, optional categories. |
| `update_expense` | A change to one expense. |
| `delete_expense` | Removal of one expense. There is no bulk delete. |

### Confirm

| Tool | Behavior |
| --- | --- |
| `confirm` | Saves one preview by `previewId` as a single revision. Its description says to call it only after the user explicitly approves that preview in the conversation. |

**How previews are held:**
- Previews live in the server process's memory and expire after 10 minutes.
- A preview can be confirmed at most once.
- Each records the revision it was computed against.

**Stale previews:**
- On `confirm`, the server reloads the activity.
- If the revision has moved, it saves nothing and returns a fresh preview against the latest state, so the user always approves what is actually saved.
- `create_activity` has no prior revision, so it is never stale.

**Approvals:**
- **Claude Code and Codex prompts.** Both already ask before tool calls, so the write tools and `confirm` keep those prompts.
- **Read tools are marked `readOnlyHint`,** so users can allow them permanently, and so can the preview tools, which save nothing.
- **`confirm` is the only tool that changes data.** For `delete_expense` previews, it is the step the user should look at closely.

**Duplicates:** `add_expenses` flags an expense as a possible duplicate when the activity already has one with the same amount and date and a similar title. The agent asks the user before confirming. No reference IDs are stored, so the snapshot format stays as it is.

### Prompts

The server publishes MCP prompts, which surface as slash commands in Claude Code:

- `import-transactions` — read a statement file, ask which rows were shared and with whom, preview, show duplicates, confirm on approval.
- `plan-a-trip` — preview the activity with members and categories, confirm, then offer to share the link.
- `settle-up` — read balances, propose the minimal settlements, confirm the payments the user approves.

## Example flows

**"Add the shared rows from statement.csv to the Tokyo trip"**

1. The agent reads the CSV from disk.
2. It calls `list_activities`, then `get_activity` for members and categories.
3. It asks something like: "These 9 look like trip costs — split equally with Leo and Sam?"
4. It calls `add_expenses`. The preview shows 9 expenses, ¥84,300 total, you're owed ¥56,200, and flags 2 as possible duplicates.
5. The agent shows the preview. The user says "skip the duplicates". The agent previews the 7 remaining expenses, and the user approves.
6. The agent calls `confirm`. The 7 expenses are saved as one revision.
7. Friends' open tabs pick up the new revision through the existing 15-second polling.

**"Create a ski weekend activity and send it to Leo, Sam and Ana"**

1. The agent calls `create_activity` with name "Ski weekend", emoji 🎿, currency CAD, members Leo, Sam and Ana, and shows the preview.
2. The user approves. The agent calls `confirm`, which creates the Live activity and links it locally.
3. The agent calls `get_share_link` and sends the link with its own tools, or prints it for the user to paste.
4. The user opens the link in their browser to get the activity in the app too. It is bookmarked there as usual.

## In-app changes

None are required. One optional convenience: a **Use with Codex or Claude Code** action in the QR/share dialog that copies `npx tally-mcp link '<live url>'` for the current Live activity.

Agent-saved expenses look exactly like ones added in the app. To undo one, edit or delete it in the app.

## Safety and privacy

- **Prompt injection.** Expense titles, member names and category names written by other participants reach the agent as data, and tool descriptions say so. Every change needs a preview and an explicit `confirm`, and deletes are single-item only.
- **No telemetry.** The CLI sends nothing beyond the Live RPCs.
- **No secrets in output.** The package writes only MCP frames to stdout. It logs no expense text, names, amounts, tokens or URLs to stderr.

## Phases

1. **Spike.**
   - `link`/`list`/`unlink` commands.
   - `list_activities`, `get_activity`, `add_expenses`, `confirm`.
   - Run from the repo with `node`, before publishing to npm.
2. **v1.**
   - The remaining tools and the prompts.
   - The npm package.
   - The optional copy-command action in the app.

## Open questions

- **npm package.** Is `tally-mcp` free, or should it be a scoped package?
- **Per-device or project-local store.** Should the credential store be per-device only, or also allow a project-local file so a repo can pin its activity? A project-local file risks committing tokens, so it would need a `.gitignore` check.
