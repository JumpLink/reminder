/**
 * Binds the gettext catalogue for the `reminder` binary and hands it to `@reminder/core`.
 *
 * English is the source language: every msgid is English, German arrives as `po/de.po`. A missing
 * catalogue is not an error — gettext returns the msgid, so an install without `.mo` files (or a
 * Node run, which has no GJS `gettext` module) shows correct English.
 *
 * The module is reached through `imports.gettext`, the GJS global, instead of `import 'gettext'`,
 * because the same sources are bundled for Node in the tests and a static import would not resolve
 * there. Which language: `setlocale(LC_ALL, "")` reads the usual chain (`LANGUAGE`, `LC_ALL`,
 * `LC_MESSAGES`, `LANG`).
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { _, setCoreTranslator } from '@reminder/core';

export const TEXT_DOMAIN = 'reminder';

interface GjsGettext {
  LocaleCategory: { ALL: number };
  setlocale(category: number, locale: string): string;
  bindtextdomain(domain: string, dir: string): void;
  textdomain(domain: string): void;
  dgettext(domain: string, msgid: string): string;
  dngettext(domain: string, singular: string, plural: string, n: number): string;
}

function gjsGettext(): GjsGettext | null {
  const imports = (globalThis as { imports?: { gettext?: GjsGettext } }).imports;
  return imports?.gettext ?? null;
}

/** `GJSIFY_LOCALE_DIR` (set by `gjsify ship`), else `<bundle>/../locale` in a build tree, else the system. */
function defaultLocaleDir(): string | undefined {
  const fromEnv = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env
    ?.GJSIFY_LOCALE_DIR;
  if (fromEnv) return fromEnv;
  const url = import.meta.url;
  if (url.startsWith('file:') && url.includes('/dist/')) return join(dirname(fileURLToPath(url)), 'locale');
  return undefined;
}

/**
 * Bind the catalogue and register it with the core. Call once, before the CLI modules evaluate:
 * yargs `describe` strings are translated when the command objects are built.
 */
export function initI18n(localeDir: string | undefined = defaultLocaleDir()): boolean {
  const gt = gjsGettext();
  if (!gt) return false;
  gt.setlocale(gt.LocaleCategory.ALL, '');
  gt.bindtextdomain(TEXT_DOMAIN, localeDir ?? '/usr/share/locale');
  gt.textdomain(TEXT_DOMAIN);
  setCoreTranslator({
    gettext: (msgid) => gt.dgettext(TEXT_DOMAIN, msgid),
    ngettext: (singular, plural, n) => gt.dngettext(TEXT_DOMAIN, singular, plural, n),
  });
  return true;
}

/** The language of the active catalogue (`en` without one) — picks yargs' own chrome language. */
export function uiLanguage(): string {
  // TRANSLATORS: Not shown. The language code of THIS catalogue ("de" in de.po); it selects the
  // language of the --help chrome ("Options:", "Commands:").
  return _('en');
}
