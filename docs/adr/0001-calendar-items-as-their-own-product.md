# 0001 — Calendar events and reminders as their own product, EDS first, writes granted per calendar

- **Status:** accepted
- **Date:** 2026-10-10

## Context

An AI agent working next to a person keeps meeting things that belong in a calendar: an appointment
in a letter, a deadline in an invoice, a parents' evening in a school mail. Today it can only
describe them. The person then types them into a calendar app by hand, or forgets.

The data already lives somewhere: on a GNOME desktop in **Evolution Data Server** (EDS), which
syncs Google, Nextcloud/CalDAV and local calendars through GNOME Online Accounts; elsewhere on a
**CalDAV** server. Calendar apps, the GNOME Shell clock and phone sync all read from there. A new
store would be one more place nobody looks.

A read-only calendar listing existed as a subcommand of **curlew**, a mail/contacts/calendar
assistant. Mail and calendars share accounts, but not much else:

- a mail client's job ends when a message is read, filed or answered; a calendar's job starts there;
- the writes are different in kind — sending a mail is irreversible, adding an event is not — so
  they deserve separate grants, separate defaults and separate review;
- reminders (VTODO) have no place in a mail client at all.

## Decision

### 1. Scope, and the boundary to curlew

**reminder** owns calendar events (VEVENT) and reminders (VTODO): listing calendars and task lists,
reading items, and creating items. It is a separate product with its own repository, core, CLI and
MCP server.

curlew keeps mail and contacts. Its calendar *read* code is ported here; curlew itself is not
changed by this decision. The integration point is data, not code: an agent that finds a date in a
mail through curlew creates the item through reminder, passing the mail's Message-ID as the source
id (see §5). Neither project imports the other.

### 2. Events AND reminders, one model

Both kinds go through one pipeline (`ItemKind = 'event' | 'reminder'`). They differ where the
standard differs — DTSTART/DTEND vs. DUE/STATUS, `Calendar` vs. `Task List` sources in EDS — and
nowhere else. A second project for tasks would duplicate the backend, the grants and the dedupe.

### 3. One backend seam, EDS first, CalDAV next

`@reminder/core` defines the `CalendarBackend` port: `listCalendars`, `listItems`, `getItem`,
`createItem`. **It moves raw iCalendar text and nothing else.** Parsing, dedupe, grants and routing
live in the core, so every backend gets the same answers for the same data.

- **EDS first** (`@reminder/eds`): what a GNOME desktop already has, every account included,
  through GObject Introspection on GJS (and on Node via `@gjsify/node-gi`). The typelibs load on
  first use, so a host without EDS reports `BackendUnavailableError` instead of failing at start.
- **CalDAV next**, via `@gjsify/system-accounts` (gjsify ADR 0095), once its calendar service exists
  in the gjsify core. CalDAV speaks iCalendar on the wire, so the backend is a transport: a new
  package implementing the port, plus one `backend` value in the config. No caller changes.

Text, not objects, is the seam because it is the one representation both backends already share.

### 4. Writes are granted per capability and target

Two capabilities: `calendar.create` (events) and `reminder.create` (task lists). A grant names one
capability and one **exact** calendar uid. No wildcard, no prefix, no case folding; an empty target,
a wildcard or an unknown capability is a configuration error at load. **A missing grant is a
refusal.** This is curlew's model (its ADR 0004): a process permission ("may write") turns every
calendar into a target the moment one is wanted.

The check sits inside the only functions that write (`createEvent`, `createReminder`), after the
target is resolved — so a route can never widen what may be written.

**The MCP server exposes no write tool yet.** `@gjsify/mcp` is gaining `applyGrantGate` /
`requiresCapability` (gjsify PR #2145), which gates a tool on a grant at registration and call time.
Until it is released the server stays read-only behind `applyReadOnlyGate`, and the create path is
reachable only from code and tests.

### 5. Dedupe by source key

A created item carries `X-REMINDER-SOURCE: <source>:<id>` — where it came from and that origin's
own id (for example `mail:<message-id>`). The same key always yields the same UID
(`reminder-` + 128 bits of FNV-1a), so a second create finds the first with one `getItem` instead of
a scan; no backend can query an X- property. An existing UID with a different key is an error, not
a merge. Two concurrent creates are caught by the backend's UID collision, not by this check.

### 6. Routing

A gitignored user config (`$XDG_CONFIG_HOME/reminder/config.json`) maps "what the item concerns" to
a target: explicit calendar → first matching route → `defaults[kind]` → error. Routes are
configuration, not permission; the grant check follows.

### 7. CLI and MCP first, a UI later

`reminder calendars | events | todos | config | mcp` on GJS via gjsify. A GNOME UI can come later
on the same core; nothing in the core assumes a terminal.

## Consequences

- curlew's `calendar` subcommand becomes redundant once agents use reminder; removing it is
  curlew's decision, in curlew.
- Recurring items are returned as their series definition; occurrence expansion is not in scope.
- A floating time (no zone, or a TZID this runtime cannot resolve) stays floating. Create input
  must carry an offset or be a bare date, so the same input never means two instants.
- Adding CalDAV is a new package and one config value. If it ever needs a change to a caller, the
  port was cut wrong and this ADR is superseded.
