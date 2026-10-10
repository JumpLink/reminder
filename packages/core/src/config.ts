/**
 * The configuration file's model — parsing and validation only; the app owns the path and I/O.
 *
 * Unknown top-level keys are carried through and written back. A build that does not know a key
 * must not erase it on save: curlew learned that an older build dropping `grants` fails closed on
 * read and destructively on write.
 */

import { ConfigError } from './errors.ts';
import { parseGrants, type Grant } from './grants.ts';
import { parseDefaults, parseRoutes, type RoutingConfig } from './routing.ts';

export const BACKENDS = ['eds'] as const;
export type BackendId = (typeof BACKENDS)[number];

export interface ReminderConfig extends RoutingConfig {
  backend: BackendId;
  grants: Grant[];
  /** Keys this build does not know, kept verbatim. */
  extra: Record<string, unknown>;
}

const KNOWN = new Set(['backend', 'grants', 'routes', 'defaults']);

export function emptyConfig(): ReminderConfig {
  return { backend: 'eds', grants: [], routes: [], defaults: {}, extra: {} };
}

export function parseConfig(raw: unknown): ReminderConfig {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new ConfigError('config must be a JSON object');
  const record = raw as Record<string, unknown>;
  const backend = record.backend ?? 'eds';
  if (!(BACKENDS as readonly unknown[]).includes(backend)) {
    throw new ConfigError(
      `backend ${JSON.stringify(backend)} is not supported (known: ${BACKENDS.join(', ')})`,
    );
  }
  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) if (!KNOWN.has(key)) extra[key] = value;
  return {
    backend: backend as BackendId,
    grants: parseGrants(record.grants),
    routes: parseRoutes(record.routes),
    defaults: parseDefaults(record.defaults),
    extra,
  };
}

export function serializeConfig(config: ReminderConfig): string {
  const { extra, ...known } = config;
  return `${JSON.stringify({ ...extra, ...known }, null, 2)}\n`;
}
