# 0011 — Credentials through a `SecretStore` port: the config holds a reference

- **Status:** accepted
- **Date:** 2026-11-18

## Context

CalDAV needs a password and the board sources need tokens. Today the only way in is `passwordEnv`:
the config names an environment variable and the person exports it. That is right for a CLI and for
CI and wrong for a window opened from the launcher, where nobody exports anything and typing the
password on every start is not an option.

The config file must stay free of secrets: it is read by tools, backed up, and shown in bug
reports ([ADR 0005](0005-several-accounts-in-one-configuration.md) already refuses a `password`
key). Where a secret does live is a property of the host — the desktop has the Secret Service, a
CI job has its environment, Android has its keystore — so the code that needs a secret must not
know which.

## Decision

### 1. The config holds only a reference

A reference names a secret by `account` and `purpose` (for example account `work`, purpose
`password`). It is written in the file as `<account>:<purpose>`. It carries no value and no store
name, so the same file works on every host. `passwordEnv` keeps working unchanged for existing
files; a new `passwordSecret` reference is the alternative spelling, and naming both is a
`ConfigError`.

### 2. `SecretStore` is a core port with three operations

`lookup`, `store` and `clear`, each by reference. None of them throws for "this host has no secret
service": they return an **unavailable** outcome with a reason, which the caller turns into an
instruction ("export the variable", "unlock the keyring") and not a stack trace. `lookup` also
distinguishes **missing** (the service works, nothing stored) from **unavailable** (it cannot be
asked).

A secret value never appears in an error message, a log line, an MCP answer or a fixture.

### 3. Drivers

| Driver | Where | Behaviour |
|---|---|---|
| Environment | `@reminder/core` (pure, takes an env record) | read-only; the reference maps to `REMINDER_SECRET_<ACCOUNT>_<PURPOSE>`; `store` and `clear` answer unavailable |
| Secret Service | `@reminder/secrets-libsecret` (`*.gjs.ts`) | libsecret with a fixed schema (`IDENTITY.secretSchemaName`, attributes `account` and `purpose`); `gi://Secret` loads lazily, a host without the typelib or without a running service answers unavailable |
| Android keystore | later | a driver in the app shell |

A host tries stores in order through a chain, so the environment can override the keyring in CI.
The first store that finds a value wins; if none finds one, the result is unavailable when any
store was unavailable and missing otherwise.

### 4. System accounts are not stored by us

Where the system already owns the account (GNOME Online Accounts), the credentials are asked from
`@gjsify/system-accounts` at the moment of use and nothing is stored. That is a separate source of
credentials and a later decision; it does not go through `SecretStore`.

## Consequences

- No driver other than the environment one is exercised in unit tests; the libsecret driver is
  tested on its degrade path (no session bus, so unavailable).
- Flatpak builds need access to `org.freedesktop.secrets`; that is a manifest concern, not a code one.
- `gi://Secret` is the second place in the repo with a `gi://` import besides EDS, and follows the
  same `*.gjs.ts` and lazy-namespace convention.
