/**
 * Lazy, cached access to an OPTIONAL GObject-Introspection namespace. Pure — the `gi://` import
 * lives in the caller's loader thunk. Same idea as `optionalNamespace` in `@gjsify/pim`, but the
 * failure here is a plain Error: this driver turns it into an `unavailable` outcome and never
 * lets it escape.
 */

export interface OptionalNamespace<T> {
  get(): Promise<T>;
}

/** Run the loader at most once; a failure is cached too — a missing typelib stays missing. */
export function optionalNamespace<T>(label: string, load: () => Promise<T>): OptionalNamespace<T> {
  let pending: Promise<T> | null = null;
  return {
    get() {
      pending ??= load();
      return pending.catch((err: unknown) => {
        throw new Error(`${label}: ${err instanceof Error ? err.message : String(err)}`);
      });
    },
  };
}
