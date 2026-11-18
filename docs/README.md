# reminder docs

- [Architecture decisions](adr/README.md) — scope, the backend seam, grants and dedupe
  ([0001](adr/0001-calendar-items-as-their-own-product.md)), priorities as linked reminders
  ([0002](adr/0002-priorities-as-linked-reminders.md), accepted), changing a reminder in place
  ([0003](adr/0003-managing-reminders-in-place.md), accepted), the UI as a third frontend
  ([0004](adr/0004-the-ui-is-next-three-views-on-the-same-core.md)), several accounts
  ([0005](adr/0005-several-accounts-in-one-configuration.md), accepted), visibility
  ([0006](adr/0006-visibility-in-two-levels.md)), the cache
  ([0010](adr/0010-cache-and-synchronisation.md)), credentials through a secret store
  ([0011](adr/0011-credentials-through-a-secret-store-port.md)), size classes
  ([0012](adr/0012-one-interaction-concept-three-size-classes.md))
- [config.example.json](../config.example.json) — the configuration file, placeholders only
- [config.accounts.example.json](../config.accounts.example.json) — several accounts in one file,
  targets written `<account-id>:<uid>`
- [CalDAV backend](caldav.md) — config, password handling, what is supported
- [Translation status](i18n-status.md) — how the language is chosen, what stays English, adding a string
