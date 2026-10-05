# tally-splitbill-mcp

Let Claude Code and Codex work with your shared expenses in [Tally](https://pengfanz.github.io/splitbill/), the free, no-account app for splitting bills with friends.

Ask your agent things like:

- "Add the shared rows from `~/Downloads/statement.csv` to Tokyo trip, split with everyone."
- "Who still owes me in Tokyo trip?"
- "Leo paid me back ¥5,000 for Tokyo trip."
- "Create a ski weekend activity with Leo and Sam in CAD, then write me an invite message."

Not to be confused with Tally Forms (tally.so). This package is for the Tally bill-splitting app.

## Requirements

- [Node.js](https://nodejs.org/) 22 or later, which provides `npx`.
- Claude Code or Codex on the computer where you use Tally in a browser. For a computer without a browser, see [No browser on that computer](#no-browser-on-that-computer).

## Install

Claude Code:

```bash
claude mcp add tally -- npx -y tally-splitbill-mcp
```

Codex:

```bash
codex mcp add tally -- npx -y tally-splitbill-mcp
```

## Use it

Tally keeps activities in your browser, and agents can use only **Live** activities: ones shared with **Share → Start live activity**.

**Start something new.** Ask your agent to create an activity. It is created as a Live activity, linked to your agent automatically and opened in your browser.

**Use an activity you already have.** Name it in your request. The first time, your agent opens Tally in your default browser, which asks **Let Claude Code use your activities?** Pick the activity, choose who you are, and click **Allow**. Your agent gets the activity's name, never its invite link.

Then review the result in Tally. Your agent saves changes right away and tells you what it saved and skipped. Edit or delete anything that is wrong in the app. Friends with the activity open usually see changes within 15 seconds.

## What your agent can do

| Tool | What it does |
| --- | --- |
| `list_activities` | Lists the activities linked on this computer and who you are in each. |
| `get_activity` | Reads members, categories, expenses, balances and suggested payments. |
| `add_expenses` | Saves expenses, split equally or by exact amounts. Skips likely duplicates, so importing the same statement twice is safe. |
| `record_settlement` | Records that one person paid another back. It can't record more than is owed. |
| `add_members` | Adds friends by name, or brings back a friend who was removed. |
| `update_expense` | Changes one expense. Nothing is saved if someone else changed it first. |
| `delete_expense` | Deletes one expense or payment. |
| `create_activity` | Creates a Live activity and opens it in your browser. |
| `get_share_link` | Returns the invite link and a message, only when you ask to share. |
| `link_activities` | Opens Tally so you can allow activities you already have. |

Three prompts guide common jobs. In Claude Code they appear as slash commands such as `/mcp__tally__import-transactions`:

- `import-transactions`: add the shared rows from a statement file.
- `plan-a-trip`: create an activity for a trip and offer an invite.
- `settle-up`: show who owes whom and record the payments that were made.

## Privacy and access

- **Links stay out of the chat.** Approval goes from Tally in your browser straight to this program on your computer, through `127.0.0.1`. Only `get_share_link` returns an invite link.
- **Stored on your computer.** Linked activities are saved in `~/.config/tally/live-activities.json`, readable only by your user on macOS and Linux.
- **Nothing extra is sent.** The server talks only to Tally's backend, sends no analytics and makes no AI requests. Your agent does the language work.
- **Removing access.** `npx tally-splitbill-mcp unlink <code>` forgets an activity on this computer. Anyone with a Live invite link can edit the activity, so to cut off all access, use **Share → End live sharing** in Tally. That also ends your friends' access.

## Commands

Run these in your own terminal:

| Command | What it does |
| --- | --- |
| `npx tally-splitbill-mcp link` | Opens Tally in your browser to allow activities. |
| `npx tally-splitbill-mcp link '<live invite link>'` | Links one activity from its invite link. |
| `npx tally-splitbill-mcp list` | Shows linked activities. |
| `npx tally-splitbill-mcp unlink <code>` | Forgets a linked activity on this computer. |
| `npx tally-splitbill-mcp --version` | Shows the version. |

### No browser on that computer

On a remote machine, copy the activity's link with **Share → Copy live invite link** in Tally, then run `npx tally-splitbill-mcp link '<live invite link>'` in your own terminal on that machine. Don't paste the link into the agent chat: anyone with it can edit the activity.

## Troubleshooting

- **"There are no Live activities in this browser yet."** Tally opened in a browser that doesn't have the activity. Open the activity there, from its invite link or from Tally, and the approval screen updates. The approval page opens in your default browser.
- **Codex refuses to save in `codex exec`.** Without prompts, Codex refuses write tools. To allow them, add `default_tools_approval_mode = "approve"` under `[mcp_servers.tally]` in `~/.codex/config.toml`.

## Settings

| Variable | Effect |
| --- | --- |
| `TALLY_MCP_CONFIG_DIR` | Where linked activities are stored. Default: `~/.config/tally`. |
| `TALLY_MCP_OPEN_BROWSER=0` | Never open a browser; `link_activities` returns the approval page for you to open. |

## Source and issues

Source: [PengfanZ/splitbill](https://github.com/PengfanZ/splitbill/tree/main/src/features/mcp). Report problems at [GitHub issues](https://github.com/PengfanZ/splitbill/issues). MIT licensed.
