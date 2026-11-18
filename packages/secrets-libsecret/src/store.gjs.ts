/**
 * The SecretStore driver over the Secret Service (libsecret), with a fixed schema: attributes
 * `account` and `purpose`. Every failure to reach the service — no typelib, no session bus, a
 * locked or absent keyring — is an `unavailable` outcome with a reason; nothing throws, and a
 * secret value never reaches a message.
 */

import type Secret from 'gi://Secret?version=1';

import { _, errorMessage, fmt, formatSecretRef, type SecretLookup, type SecretRef, type SecretStore, type SecretWrite } from '@reminder/core';

import { secret } from './libs.gjs.ts';
import type { OptionalNamespace } from './optional.ts';

export interface LibsecretOptions {
  /** The schema name, `IDENTITY.secretSchemaName`. */
  schemaName: string;
  /** Shown to the person next to the stored secret in their keyring UI. */
  label?: string;
  /** Override the namespace loader; tests pass one that always fails. */
  namespace?: OptionalNamespace<typeof Secret>;
}

export function createLibsecretStore(options: LibsecretOptions): SecretStore {
  const namespace = options.namespace ?? secret;

  const unavailable = (err: unknown) => ({
    status: 'unavailable' as const,
    reason: fmt(_('secret service not available: {message}'), { message: errorMessage(err) }),
  });

  const schemaOf = (S: typeof Secret) =>
    S.Schema.new(options.schemaName, S.SchemaFlags.NONE, {
      account: S.SchemaAttributeType.STRING,
      purpose: S.SchemaAttributeType.STRING,
    });
  const attributes = (ref: SecretRef) => ({ account: ref.account, purpose: ref.purpose });

  return {
    id: 'libsecret',
    async lookup(ref): Promise<SecretLookup> {
      try {
        const S = await namespace.get();
        const value = S.password_lookup_sync(schemaOf(S), attributes(ref), null);
        return value ? { status: 'found', value } : { status: 'missing' };
      } catch (err) {
        return unavailable(err);
      }
    },
    async store(ref, value): Promise<SecretWrite> {
      try {
        const S = await namespace.get();
        const label = options.label ?? formatSecretRef(ref);
        S.password_store_sync(schemaOf(S), attributes(ref), S.COLLECTION_DEFAULT, label, value, null);
        return { status: 'ok' };
      } catch (err) {
        return unavailable(err);
      }
    },
    async clear(ref): Promise<SecretWrite> {
      try {
        const S = await namespace.get();
        S.password_clear_sync(schemaOf(S), attributes(ref), null);
        return { status: 'ok' };
      } catch (err) {
        return unavailable(err);
      }
    },
  };
}
