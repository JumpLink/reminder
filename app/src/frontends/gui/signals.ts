import type GObject from '@girs/gobject-2.0';

/** Custom signals are missing from the generated signatures; this names that gap once, typed. */
export function onSignal<A extends unknown[]>(
  object: GObject.Object,
  name: string,
  callback: (...args: A) => void,
): number {
  return (object as unknown as { connect(name: string, cb: (...args: never[]) => void): number }).connect(
    name,
    callback as unknown as (...args: never[]) => void,
  );
}
