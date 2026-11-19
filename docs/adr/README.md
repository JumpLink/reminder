# Architecture decision records

One file per decision, numbered, never renumbered. A decision that changes is superseded by a new
record that links back; the old one stays.

| # | Decision | Status |
|---|---|---|
| [0001](0001-calendar-items-as-their-own-product.md) | Calendar events and reminders as their own product, EDS first, writes granted per calendar | accepted |
| [0002](0002-priorities-as-linked-reminders.md) | Priorities as linked reminders (VTODO + child next step), read by agents over MCP | accepted |
| [0003](0003-managing-reminders-in-place.md) | Managing reminders in place: `reminder.update` rewrites only the touched lines, no delete | accepted |
| [0004](0004-the-ui-is-next-three-views-on-the-same-core.md) | The UI is next: three views on the same core (supersedes 0001 §7) | accepted |
| [0005](0005-several-accounts-in-one-configuration.md) | Several accounts in one configuration: `accounts[]`, and a target that names its account | accepted |
| [0006](0006-visibility-in-two-levels.md) | Visibility in two levels: disabled (config, all frontends) and hidden (GUI only) | accepted |
| [0010](0010-cache-and-synchronisation.md) | Cache and synchronisation: raw responses with a version marker, derived and deletable | accepted |
| [0011](0011-credentials-through-a-secret-store-port.md) | Credentials through a `SecretStore` port: the config holds a reference | accepted |
| [0012](0012-one-interaction-concept-three-size-classes.md) | One interaction concept, three size classes | accepted |
| [0016](0016-gjsify-pim-incubates-here.md) | `@gjsify/pim`: the backend port and its drivers incubate here, MIT, moving to gjsify when complete | accepted |
| [0017](0017-sync-schedule-and-states.md) | Sync schedule and states: one core service, states as values, cache first | accepted |
| [0018](0018-caldav-delta-sync.md) | CalDAV delta sync: opaque ctag/sync-token marker, fallback chain, raw texts as cache body | accepted |
| [0019](0019-http-client-is-its-own-package.md) | `@gjsify/http-client`: one REST client for the board adapters, incubated here, MIT | accepted |
