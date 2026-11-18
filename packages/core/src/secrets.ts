/**
 * The SecretStore port — passwords and tokens the config only REFERS to (docs/adr/0011).
 *
 * "This host has no secret service" is an answer, not an exception: every operation returns an
 * outcome the caller turns into an instruction. A secret value never goes into an error message.
 */

import { ConfigError } from './errors.ts';
import { _, fmt } from './i18n.ts';

/** What a secret is for: the account it belongs to and the purpose (`password`, `token`). */
export interface SecretRef {
  account: string;
  purpose: string;
}

export type SecretLookup =
  | { status: 'found'; value: string }
  /** The service works and holds nothing under this reference. */
  | { status: 'missing' }
  /** The service cannot be asked (no keyring, locked, no bus, read-only store). */
  | { status: 'unavailable'; reason: string };

export type SecretWrite = { status: 'ok' } | { status: 'unavailable'; reason: string };

export interface SecretStore {
  /** Short id for messages (`env`, `libsecret`). */
  readonly id: string;
  lookup(ref: SecretRef): Promise<SecretLookup>;
  store(ref: SecretRef, value: string): Promise<SecretWrite>;
  /** Remove the secret; clearing one that is not there is `ok`. */
  clear(ref: SecretRef): Promise<SecretWrite>;
}

const REF_PART = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;

/** `<account>:<purpose>`, the spelling used in the configuration file. */
export function parseSecretRef(text: string): SecretRef {
  const parts = text.split(':');
  if (parts.length !== 2 || !REF_PART.test(parts[0]) || !REF_PART.test(parts[1])) {
    throw new ConfigError(fmt(_('"{ref}" is not a secret reference — write <account>:<purpose>'), { ref: text }));
  }
  return { account: parts[0], purpose: parts[1] };
}

export function formatSecretRef(ref: SecretRef): string {
  return `${ref.account}:${ref.purpose}`;
}

/** `REMINDER_SECRET_<ACCOUNT>_<PURPOSE>`, anything outside A-Z0-9 becoming `_`. */
export function secretEnvName(ref: SecretRef): string {
  const part = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '_');
  return `REMINDER_SECRET_${part(ref.account)}_${part(ref.purpose)}`;
}

/** Read-only store over an environment: the CLI and CI way. */
export function createEnvSecretStore(env: Record<string, string | undefined>): SecretStore {
  const readOnly = (): SecretWrite => ({
    status: 'unavailable',
    reason: _('the environment is read-only — export the variable instead'),
  });
  return {
    id: 'env',
    async lookup(ref) {
      const value = env[secretEnvName(ref)];
      return value ? { status: 'found', value } : { status: 'missing' };
    },
    async store() {
      return readOnly();
    },
    async clear() {
      return readOnly();
    },
  };
}

/**
 * Try the stores in order. Lookup: the first value wins; with none found the result is
 * `unavailable` if any store could not be asked, else `missing`. Writes go to the first store that
 * accepts them.
 */
export function chainSecretStores(stores: SecretStore[]): SecretStore {
  const write = async (run: (s: SecretStore) => Promise<SecretWrite>): Promise<SecretWrite> => {
    let last: SecretWrite = { status: 'unavailable', reason: _('no secret store configured') };
    for (const store of stores) {
      last = await run(store);
      if (last.status === 'ok') return last;
    }
    return last;
  };
  return {
    id: stores.map((s) => s.id).join('+'),
    async lookup(ref) {
      let unavailable: SecretLookup | null = null;
      for (const store of stores) {
        const result = await store.lookup(ref);
        if (result.status === 'found') return result;
        if (result.status === 'unavailable') unavailable ??= result;
      }
      return unavailable ?? { status: 'missing' };
    },
    store: (ref, value) => write((s) => s.store(ref, value)),
    clear: (ref) => write((s) => s.clear(ref)),
  };
}
