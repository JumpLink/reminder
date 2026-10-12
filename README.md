# reminder

Calendar events and reminders (tasks) from the calendars you already have — as a CLI and an
[MCP](https://modelcontextprotocol.io) server, so an AI agent can see your schedule and, later, put
things into it. Runs on [GJS](https://gjs.guide) via [gjsify](https://github.com/gjsify/gjsify).

- **Reads** every enabled calendar and task list from Evolution Data Server — Google,
  Nextcloud/CalDAV and local ones, whatever GNOME Online Accounts has set up.
- **Creates** events and reminders in the core library, only where a grant names the exact calendar,
  and never twice for the same source (a mail, a letter). Not exposed over MCP yet.
- **Backends:** EDS today; CalDAV via `@gjsify/system-accounts` next, behind the same interface.

Status: early. Read-only in the CLI and over MCP. Design: [ADR 0001](docs/adr/0001-calendar-items-as-their-own-product.md).

## Requirements

- Linux with GJS ≥ 1.80 and Evolution Data Server (Fedora: `gjs evolution-data-server`)
- Node 24 to bootstrap the gjsify CLI

## Install and build

```sh
npm install -g @gjsify/cli@0.59.0
gjsify install
gjsify workspace reminder-cli build
```

The bundle is `app/dist/reminder.gjs.mjs`; run it with `gjsify run app/dist/reminder.gjs.mjs <command>`.

## Usage

```sh
reminder calendars                        # calendars and task lists, with their uids
reminder events --from 2026-10-12 --to 2026-10-18
reminder todos                            # open reminders, by due date
reminder todos --all --calendar <uid>
reminder priorities                       # ranked priorities with open steps (needs priorities.list)
reminder config                           # where the config file is, and whether it parses
reminder mcp                              # MCP server over stdio (read-only)
```

Every command takes `--json`. Times print in their own shape: `2026-10-12` is all-day, a trailing
`Z` is UTC, no zone is floating local time — never silently converted.

### MCP

```json
{
  "mcpServers": {
    "reminder": { "command": "gjsify", "args": ["run", "/path/to/reminder/app/dist/reminder.gjs.mjs", "mcp"] }
  }
}
```

Tools: `calendars_list`, `events_list`, `reminders_list`, `priorities_list` — all read-only. The server drops any tool
that does not declare itself read-only.

## Configuration

`$XDG_CONFIG_HOME/reminder/config.json` (or `REMINDER_CONFIG`). Reading needs none. Writing needs a
grant per capability and calendar uid, exactly as `reminder calendars` prints it; routes pick a
calendar from what an item concerns. See [config.example.json](config.example.json).

## Development

```sh
gjsify foreach -A check     # type check
gjsify foreach -A lint
gjsify workspace reminder-cli format:check
gjsify workspace reminder-cli test           # GJS and Node
node app/tests/integration/mcp-gjs-smoke.mjs # after a build
```

Agent guide: [AGENTS.md](AGENTS.md). Docs index: [docs/README.md](docs/README.md).

## License

AGPL-3.0-or-later — see [LICENSE](LICENSE).
