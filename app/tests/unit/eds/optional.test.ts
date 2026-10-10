import { describe, expect, it } from '@gjsify/unit';
import { BackendError, BackendUnavailableError } from '@reminder/core';
import { createEdsBackend, edsError, optionalNamespace, unwrapList, unwrapResult } from '@reminder/eds';

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  return null;
}

export default async () => {
  await describe('optional GI namespaces', async () => {
    await it('does not load until first use, and loads once', async () => {
      let calls = 0;
      const ns = optionalNamespace('Fake', async () => {
        calls++;
        return { ok: true };
      });
      expect(calls).toBe(0);
      expect((await ns.get()).ok).toBe(true);
      await ns.get();
      expect(calls).toBe(1);
    });

    await it('reports a failing loader as BackendUnavailableError naming the namespace', async () => {
      const ns = optionalNamespace('ECal', async () => {
        throw new Error("Typelib file for namespace 'ECal' not found");
      });
      const err = await rejection(ns.get());
      expect(err instanceof BackendUnavailableError).toBe(true);
      expect((err as Error).message).toContain('ECal typelib not available');
    });

    await it('caches the failure', async () => {
      let calls = 0;
      const ns = optionalNamespace('EDataServer', async () => {
        calls++;
        throw new Error('missing');
      });
      await rejection(ns.get());
      await rejection(ns.get());
      expect(calls).toBe(1);
    });
  });

  await describe('EDS result shapes', async () => {
    await it('unwraps [success, value] and a bare value alike', async () => {
      expect(unwrapResult<string>([true, 'uid-1'])).toBe('uid-1');
      expect(unwrapResult<string>('uid-2')).toBe('uid-2');
      expect(unwrapList<number>([true, [1, 2]])).toEqualArray([1, 2]);
      expect(unwrapList<number>(null)).toEqualArray([]);
    });

    await it('keeps a GError domain only when it is a name', async () => {
      const named = edsError('call', { message: 'boom', domain: 'e-client-error-quark', code: 3 });
      expect(named.domain).toBe('e-client-error-quark');
      expect(named.code).toBe(3);
      expect(named.message).toBe('call: boom');
      expect(edsError('call', { message: 'x', domain: 1234 }).domain).toBeUndefined();
    });
  });

  // No session bus here (the test script points DBUS_SESSION_BUS_ADDRESS at nothing): with the
  // typelibs present the registry cannot connect, without them they cannot load. Either way the
  // backend must answer with one of reminder's own errors — a raw GLib.Error serialises to `{}`.
  await describe('EDS backend without a session', async () => {
    await it('fails with a classified error, never a raw one', async () => {
      const err = await rejection(createEdsBackend().listCalendars());
      expect(err instanceof BackendError || err instanceof BackendUnavailableError).toBe(true);
    });
  });
};
