/**
 * Who this app is, in one place. Everything that names the app to the outside — the binary, the
 * gettext domain, the directories, the MCP server — reads it from here, so a later rename is this
 * file plus a script instead of a grep.
 *
 * Deliberately NOT here: `X-REMINDER-SOURCE`, the `reminder-` UID prefix (stored data and dedupe
 * hang on them) and the MCP tool names `reminders_*` (the domain term for VTODO).
 */

export const IDENTITY = {
  /** Shown to people (window title, about dialog, `--version` chrome). */
  displayName: 'reminder',
  appId: 'eu.jumplink.Reminder',
  binaryName: 'reminder',
  gettextDomain: 'reminder',
  /** Directory under `$XDG_CONFIG_HOME`. */
  configDirName: 'reminder',
  /** Directory under `$XDG_CACHE_HOME`. */
  cacheDirName: 'reminder',
  secretSchemaName: 'eu.jumplink.Reminder.Secret',
  mcpServerName: 'reminder',
} as const;
