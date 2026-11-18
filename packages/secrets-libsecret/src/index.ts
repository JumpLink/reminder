/** `@reminder/secrets-libsecret` — the SecretStore driver over gi://Secret. See docs/adr/0011. */

export { createLibsecretStore, type LibsecretOptions } from './store.gjs.ts';
export { optionalNamespace, type OptionalNamespace } from './optional.ts';
