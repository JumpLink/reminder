# 0005 — Several accounts in one configuration: `accounts[]`, and a target that names its account

- **Status:** accepted
- **Date:** 2026-11-18

## Context

[ADR 0001](0001-calendar-items-as-their-own-product.md) §3 cut one seam for the data — the
`CalendarBackend` port — and the configuration grew exactly one slot for it: a top-level
`backend` value, plus a `caldav` section when that value is `caldav`. One installation, one
place calendars come from.

That is not how a desktop looks. The calendars a person works with sit in at least two places at
once: what the desktop already syncs through Evolution Data Server, and a CalDAV server reached
with its own credentials — a second household, a client's server, a self-hosted instance that GOA
does not know. Today the choice between them is the whole config file: switching means rewriting
`backend`, and every grant, route and default written against the other one is now pointing at
calendars that are not there.

The uid makes it worse rather than better. A grant names a calendar uid **exactly** (ADR 0001 §4),
and a uid is backend-specific: EDS hands out an opaque source uid, CalDAV hands out a collection
URL. Two accounts can serve the same uid — two CalDAV accounts on the same software, a calendar
synced both through GOA and directly — and a grant that matches "the uid" then matches a calendar
on a server the person never meant to write to. A permission model whose target is ambiguous is
not a permission model.

## Decision

### 1. `accounts[]` is the configuration; a single `backend` is the one-account spelling of it

The config file gains a top-level list:

```json
{
  "accounts": [
    { "id": "desktop", "backend": "eds" },
    {
      "id": "work",
      "backend": "caldav",
      "caldav": { "url": "https://dav.example.org/", "username": "<user>", "passwordEnv": "WORK_DAV_PASSWORD" }
    }
  ]
}
```

An account is an id plus everything the backend factory needs for it — the same `caldav` object as
before, now per account, so two CalDAV servers carry two URLs and **two** password variables. The
password is still never in the file (`passwordEnv`), unchanged from the single-account model.

A file **without** `accounts` is read as one account with the id `default`, taking the top-level
`backend` and `caldav` exactly as they are written. This is not a migration step that runs once and
rewrites something: it is how the parser reads that file, every time, for as long as it exists. A
v1 config stays valid, is written back in the spelling it was read in, and the person is never
asked to do anything.

`accounts` and a top-level `backend` in the same file are a `ConfigError`. Either spelling is fine;
both at once means the file says two things about which backend serves account one, and guessing
which one wins is how a write lands on the wrong server.

### 2. A target names its account only when there is more than one

A grant, a route, a default and `priorities.list` all name a target. From here on a target is

```
<account-id>:<calendar-uid>
```

**with exactly one exception: when the configuration has exactly one account, the prefix is omitted
and a bare uid names that account's calendar.** With several accounts a bare target is a
`ConfigError` at load, naming the configured ids.

The prefix exists to disambiguate, so it appears exactly where there is something to disambiguate.
The consequence is the property that matters: a one-account configuration — which is every
configuration written before this record — has no prefix anywhere, in the file or in what
`reminder calendars` prints, and therefore does not change at all.

Adding a second account is the moment every target becomes ambiguous, and it is reported as such:
the load fails with the list of accounts and the targets that need qualifying, rather than quietly
resolving them against whichever account happens to be first. Breaking loudly at the one moment the
meaning changes is the point.

### 3. The split is at the first colon, and account ids are restricted so that stays unambiguous

A CalDAV calendar uid **is a URL** and contains colons. So the target is split at the **first**
colon, never the last, and the remainder — URL and all — is the uid verbatim.

For that to be decidable, an account id is `[a-z0-9][a-z0-9_-]*`, at most 32 characters: lowercase,
no colon, no slash, no dot. `http` and `https` are refused on top of that, because those are the
one pair of ids that would make a bare CalDAV URL indistinguishable from a qualified target. Ids
are unique within the file, and `default` is a legal id like any other — it is only what an
unnamed, single-account config is called.

With one account the string is **not** split at all: a bare CalDAV URL stays whole without needing
any rule about what its scheme looks like.

### 4. The port does not change; several accounts are a multiplexer above it

`CalendarBackend` keeps its five methods and its one job. The app composes one backend per account
and puts a multiplexer in front — `createMultiBackend`, which lives in the core because it is pure
logic over the port and belongs where the other rules about targets are:

| Call | What the multiplexer does |
|---|---|
| `listCalendars` | asks every account, concatenates, rewrites each `uid` to `<account>:<uid>` |
| `listItems` with a calendar | splits the target, asks that one account |
| `listItems` without one | asks every account and merges; every `RawItem.calendarUid` comes back qualified |
| `getItem` / `createItem` / `updateItem` | splits the target, calls that one account with the bare uid |

So **reads merge across accounts and a write goes to exactly one** — the one the target names.
Nothing below the multiplexer learns that accounts exist, and nothing above it (routing, grants,
dedupe, the rewrite) learns that backends exist. With a single account there is no multiplexer at
all: `createBackend` hands back the account's backend directly, so the v1 path is the same objects
and the same calls it was before.

The qualified uid is produced in exactly one place — the multiplexer — and consumed everywhere a
uid is compared (`create`'s "is this calendar enabled" check, `priorities`' check that the list
exists, the MCP grant gate). Those comparisons are untouched: they still compare a target from the
config with a uid from `listCalendars`, and both sides are now qualified or both are bare.

### 5. A broken account is an error, not a shorter list

An account whose backend cannot be built — a `passwordEnv` that is not exported, a host without
EDS — fails the whole call. It does not drop out of `listCalendars` with the others returned. Every
message this code writes itself names the account; `UnsupportedAuthError` cannot, because it is
built from the scheme alone.

A missing calendar and an empty calendar look identical to a caller, and "there is no such
reminder" is the answer that makes an agent create a second one. Silence here costs more than the
inconvenience of a loud failure, so the one place that may report instead of raise is the
diagnostic command built for it (§6).

### 6. `reminder accounts`

A new command, beside `reminder config`, listing every configured account with its id, its backend
and **counts**: how many calendars and how many task lists it serves. Like `reminder config` it
prints no calendar names, no uids and no credentials — its output ends up in bug reports — and it is the one
place where an account that cannot be reached is reported per account instead of ending the
command, because a diagnostic that dies on the first problem cannot show the second one.

There is no MCP tool for it: an agent sees accounts in the qualified uids `calendars_list` already
returns, and a list of the person's accounts is not something a model needs to act.

## Consequences

- Grants get the precision ADR 0001 §4 claimed. `work:<uid>` and `desktop:<uid>` are different
  targets even when the uid is the same string, so granting a write on one server cannot reach the
  other.
- A second account is a breaking change to that file, by design: every unqualified target must be
  rewritten, and the load says which. The first account is not privileged — there is no implicit
  "main" account whose targets keep working.
- Renaming an account id invalidates every target that names it, the same way renaming a calendar
  in the backend would. Ids are therefore the person's own short labels, not derived from a URL.
- `reminder calendars` is the only source of a target that is correct by construction; the README
  and the examples say so. A uid copied from a calendar app's URL bar was already wrong, and is now
  wrong in a second way.
- Two accounts serving the same calendar (one through GOA, one directly) appear twice, with two
  uids and no dedupe. They are two routes to the same data and reminder cannot tell; collapsing
  them would need identity comparison the port deliberately does not have.
- The one-account read of a file without `accounts` is permanent, not a deprecation window. There
  is no config version number, no migration command and no rewrite on save: the shape of the file
  is what it means.
