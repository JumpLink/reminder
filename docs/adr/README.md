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
| [0012](0012-one-interaction-concept-three-size-classes.md) | One interaction concept, three size classes | accepted |
