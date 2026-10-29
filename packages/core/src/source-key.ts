/**
 * The dedupe key: `<source>:<id>` — where an item came from and that origin's own id, for example
 * a mail backend and a Message-ID. Handling the same origin twice must not create two items.
 *
 * The key is stored in `X-REMINDER-SOURCE` AND decides the UID. The property is what a reader
 * sees; the UID is what makes the lookup one `getItem` instead of a scan of the whole calendar,
 * because no backend can query an X- property (EDS's sexp has no field for one).
 */

import { InputError } from './errors.ts';
import { _, fmt } from './i18n.ts';

const SOURCE = /^[a-z0-9][a-z0-9._-]*$/i;

export function sourceKey(source: string, id: string): string {
  if (!SOURCE.test(source)) throw new InputError(fmt(_('invalid source "{source}": letters, digits, . _ - only'), { source }));
  if (id.length === 0) throw new InputError(_('source id must not be empty'));
  if (/[\r\n]/.test(id)) throw new InputError(_('source id must not contain a line break'));
  return `${source}:${id}`;
}

/** FNV-1a over UTF-16 code units, 32 bit, with a seed as the offset basis. */
function fnv1a(text: string, seed: number): number {
  let hash = seed >>> 0;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

const SEEDS = [0x811c9dc5, 0x050c5d1f, 0x1b873593, 0xcc9e2d51];

/**
 * The UID an item with this key gets. Deterministic, so a second create finds the first.
 * 128 bits of a non-cryptographic hash: a collision is not a silent merge — `createEvent`
 * compares the stored key and refuses when it differs.
 */
export function uidForSourceKey(key: string): string {
  return `reminder-${SEEDS.map((seed) => fnv1a(key, seed).toString(16).padStart(8, '0')).join('')}`;
}
