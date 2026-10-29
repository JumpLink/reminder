/**
 * Translation for strings the core hands to a person — without the core importing gettext.
 *
 * The core runs where GJS's `gettext` module does not exist (Node, the tests), so it cannot bind a
 * catalogue itself. A frontend that has one registers its translator once at startup
 * (`app/src/core/i18n.ts`); until then `_` returns the msgid, which is the English source text —
 * exactly what gettext returns for a missing catalogue.
 *
 * `_` and `_n` are keywords `app/dev/i18n.sh extract` collects. Call them when the string is BUILT,
 * not at module level: a module-level call runs before any frontend could register.
 */

export interface CoreTranslator {
  gettext: (msgid: string) => string;
  /** Both English forms go in — the CATALOGUE decides which one a count needs. */
  ngettext: (singular: string, plural: string, n: number) => string;
}

const SOURCE: CoreTranslator = {
  gettext: (msgid) => msgid,
  ngettext: (singular, plural, n) => (n === 1 ? singular : plural),
};

let current: CoreTranslator = SOURCE;

/** Register the frontend's translator (null restores the English source strings). */
export function setCoreTranslator(translator: CoreTranslator | null): void {
  current = translator ?? SOURCE;
}

export function _(msgid: string): string {
  return current.gettext(msgid);
}

/** A counted string; never replace with an `n === 1` check — the plural rule is the catalogue's. */
export function _n(singular: string, plural: string, n: number): string {
  return current.ngettext(singular, plural, n);
}

/** Fill `{name}` placeholders in an already translated string (named, so a translation may reorder). */
export function fmt(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => (name in values ? String(values[name]) : whole));
}
