/**
 * `@reminder/eds` — the Evolution Data Server backend. One implementation for every runtime:
 * GJS resolves `gi://` natively, Node through `@gjsify/node-gi`. The typelibs load on first use.
 */

export { createEdsBackend } from './driver.gjs.ts';
export { optionalNamespace, type OptionalNamespace } from './optional.ts';
export { edsError, unwrapList, unwrapResult } from './errors.ts';
