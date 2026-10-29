# Translation status

The CLI is translatable with gettext. Source strings are English msgids; German lives in
[`app/po/de.po`](../app/po/de.po). Core and backend packages call `_()` / `_n()` from
`@reminder/core`; the app binds the catalogue at startup (`app/src/core/i18n.ts`).

## How the language is chosen

The usual gettext order applies: `LANGUAGE`, then `LC_ALL`, `LC_MESSAGES`, `LANG`. A `de_*`
locale loads the German catalogue, anything else shows the English msgids. The catalogue is
read from `GJSIFY_LOCALE_DIR`, else `<bundle>/../locale` for a build in `dist/`, else
`/usr/share/locale`. yargs help follows the same language.

## What stays English

- **Machine-readable output.** `--json` and every other JSON payload.
- **MCP.** Tool titles, descriptions and parameter descriptions are the contract with agents.
- **Technical labels.** Error `name` fields and the backend labels passed to `edsError` /
  `boundary` (`listCalendars`, `getItem`, …).

## Adding a string

1. Wrap it: `_('Text')`, `_n('one', 'many', n)`, or `fmt(_('Hello {name}'), { name })` — named
   placeholders, no template literals inside `_()`.
2. `gjsify workspace reminder-cli run i18n:extract` updates `app/po/reminder.pot` and merges `de.po`.
3. Translate the new entries in `de.po`.
4. `gjsify run check` runs `check:i18n`: it fails on a stale `.pot`, an untranslated or fuzzy
   entry, or placeholders that differ between msgid and msgstr.

`.mo` files are compiled by `build` and `test`; CI needs the `gettext` package.
