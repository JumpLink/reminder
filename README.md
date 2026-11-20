# reminder

Calendar events and reminders (tasks) from the calendars you already have — as a CLI and an
[MCP](https://modelcontextprotocol.io) server, so an AI agent can see your schedule and, later, put
things into it. Runs on [GJS](https://gjs.guide) via [gjsify](https://github.com/gjsify/gjsify).

- **Reads** every enabled calendar and task list from Evolution Data Server — Google,
  Nextcloud/CalDAV and local ones, whatever GNOME Online Accounts has set up.
- **Creates** events and reminders in the core library, only where a grant names the exact calendar,
  and never twice for the same source (a mail, a letter). Over MCP as `events_create` and
  `reminders_create`, served only when that grant exists.
- **Changes** a reminder that already exists — title, description, due date, priority, done or open
  again — by rewriting only the lines it touches, so alarms, recurrence and everything else in the
  task survive untouched. Over MCP as `reminders_update`.
- **Backends:** EDS today; CalDAV via `@gjsify/system-accounts` next, behind the same interface.

Status: early. Reads work everywhere; writes need a grant. Design:
[ADR 0001](docs/adr/0001-calendar-items-as-their-own-product.md), updates in
[ADR 0003](docs/adr/0003-managing-reminders-in-place.md).

## Requirements

- Linux with GJS ≥ 1.80 and Evolution Data Server (Fedora: `gjs evolution-data-server`)
- Node 24 to bootstrap the gjsify CLI

## Install and build

```sh
npm install -g @gjsify/cli@0.64.12
gjsify install
gjsify workspace reminder-cli build
```

The bundle is `app/dist/reminder.gjs.mjs`; run it with `gjsify run app/dist/reminder.gjs.mjs <command>`.

## Usage

```sh
reminder calendars                        # calendars and task lists, with their uids
reminder events --from 2026-10-12 --to 2026-10-18
reminder events --from 2026-10-12 --to 2026-10-18 --expand   # every instance of recurring events
reminder todos                            # open reminders, by due date
reminder todos --all --calendar <uid>
reminder update <uid> --summary 'Call back' --due 2026-11-03 --priority 2
reminder complete <uid>                   # done: STATUS, PERCENT-COMPLETE and COMPLETED
reminder reopen <uid>                     # open again
reminder board list                       # boards of every enabled source (read-only)
reminder board cards <board> [--all] [--include-done] [--json]
reminder priorities                       # ranked priorities with open steps (needs priorities.list)
reminder config                           # where the config file is, and whether it parses
reminder mcp                              # MCP server over stdio
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

Tools: `calendars_list`, `events_list` (`expand: true` lists every instance of recurring events in a window clamped to 92 days, capped by `limit`, with `omitted`, `clamped`, `cuts` and `unresolvedZones` reported), `reminders_list`, `priorities_list`, `boards_list`, `cards_list`
are read-only and always served (the board tools cap their answers and report `omitted`; hidden-in-the-window
sources are served, disabled ones are not). `events_create`, `reminders_create` and `reminders_update` appear only when the config grants
`calendar.create`, `reminder.create` respectively `reminder.update` for a calendar; each call must
target a granted uid exactly. The gate drops any tool that neither declares itself read-only nor
declares a granted capability, so a forgotten annotation is a missing tool, not an open one.

`reminders_update` changes only the fields a call names — `null` clears `description` and `due`,
`priority: 0` clears the priority, `status: "completed"` marks the task done. Everything else in the
stored task stays as it is. There is no delete tool: `status: "cancelled"` is how a reminder goes
away.

## Desktop app

`reminder gui` opens the GTK4/libadwaita window. Three views on the same data: **Calendar**
(month, week or day), **Tasks** and **Board**. The window adapts from a phone to a desktop —
below desktop width the week shows the days that still fit, and the whole week stays one step
away in the month.

The calendar is read-only: activating an item opens its details, with a link to the original
where the event carries one. An event whose time zone could not be resolved keeps the clock it
was written with and says so (`⏱`) — nothing is silently converted.

| | |
|---|---|
| Previous / next period | `Alt`+`←` / `Alt`+`→`, or `Ctrl`+`Page Up` / `Ctrl`+`Page Down` |
| Today | `Ctrl`+`T` |
| Month / week / day | `Ctrl`+`Shift`+`M` / `W` / `D` |
| Calendar / Tasks / Board | `Ctrl`+`1` / `2` / `3` |

## Configuration

`$XDG_CONFIG_HOME/reminder/config.json` (or `REMINDER_CONFIG`). Reading needs none. Writing needs a
grant per capability (`calendar.create`, `reminder.create`, `reminder.update`) and calendar uid,
exactly as `reminder calendars` prints it; routes pick a calendar from what an item concerns. See [config.example.json](config.example.json).

Several accounts — a local one and a CalDAV server, two servers — live in one file under `accounts`,
each with an id you choose. `reminder accounts` lists them. Reads then cover every account at once
and every uid carries its account: a target reads `<account-id>:<uid>`, exactly as `reminder
calendars` prints it. See [config.accounts.example.json](config.accounts.example.json). A file
without `accounts` is one account and stays as it is — nothing to migrate, no prefix to write.

### Local lists (vdir)

An account with `"backend": "vdir"` keeps lists as plain files: one folder per list, one `.ics` per
item, optional `displayname` and `color` files (the vdirsyncer/khal layout). The directory is
`$XDG_DATA_HOME/reminder/vdir` unless the account sets `"vdir": {"path": "…"}`. **This directory is
your data, not a cache: back it up.** Preferences → Accounts → "Create local list" makes one.

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
