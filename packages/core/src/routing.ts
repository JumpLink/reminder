/**
 * Routing: which calendar an item goes to, from what it concerns.
 *
 * A route is configuration, not a permission. It picks the target; the grant for that target is
 * checked afterwards like for an explicit one, so a route can never widen what may be written.
 */

import { ConfigError, RoutingError } from './errors.ts';
import type { ItemKind } from './types.ts';
import { _, fmt } from './i18n.ts';

export interface Route {
  /** Concern labels this route answers, compared case-insensitively. */
  concerns: string[];
  /** Restrict the route to events or reminders; both when absent. */
  kind?: ItemKind;
  target: string;
}

export interface RoutingConfig {
  routes: Route[];
  defaults: Partial<Record<ItemKind, string>>;
}

export interface RouteRequest {
  kind: ItemKind;
  /** An explicit calendar uid wins over everything. */
  calendar?: string;
  concern?: string;
}

const KINDS: readonly ItemKind[] = ['event', 'reminder'];

export function parseRoutes(value: unknown): Route[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new ConfigError(_('routes must be a list'));
  return value.map((entry: unknown, index) => {
    if (!entry || typeof entry !== 'object') throw new ConfigError(fmt(_('routes[{index}] must be an object'), { index }));
    const { concerns, kind, target } = entry as Record<string, unknown>;
    if (
      !Array.isArray(concerns) ||
      concerns.length === 0 ||
      !concerns.every((c) => typeof c === 'string' && c)
    ) {
      throw new ConfigError(fmt(_('routes[{index}]: concerns must be a non-empty list of strings'), { index }));
    }
    if (kind !== undefined && !KINDS.includes(kind as ItemKind)) {
      throw new ConfigError(fmt(_('routes[{index}]: kind must be "event" or "reminder"'), { index }));
    }
    if (typeof target !== 'string' || target === '')
      throw new ConfigError(fmt(_('routes[{index}]: target missing'), { index }));
    return { concerns: concerns as string[], target, ...(kind ? { kind: kind as ItemKind } : {}) };
  });
}

export function parseDefaults(value: unknown): Partial<Record<ItemKind, string>> {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new ConfigError(_('defaults must be an object'));
  const out: Partial<Record<ItemKind, string>> = {};
  for (const [key, target] of Object.entries(value)) {
    if (!KINDS.includes(key as ItemKind)) throw new ConfigError(fmt(_('defaults: unknown kind "{key}"'), { key }));
    if (typeof target !== 'string' || target === '')
      throw new ConfigError(fmt(_('defaults.{key} must be a calendar uid'), { key }));
    out[key as ItemKind] = target;
  }
  return out;
}

/** Explicit calendar → first matching route → default for the kind → RoutingError. */
export function resolveTarget(config: RoutingConfig, request: RouteRequest): string {
  if (request.calendar) return request.calendar;
  const concern = request.concern?.trim().toLowerCase();
  if (concern) {
    const route = config.routes.find(
      (r) => (!r.kind || r.kind === request.kind) && r.concerns.some((c) => c.toLowerCase() === concern),
    );
    if (route) return route.target;
  }
  const fallback = config.defaults[request.kind];
  if (fallback) return fallback;
  throw new RoutingError(
    concern
      ? fmt(_('no route for concern "{concern}" and no default {kind} calendar'), {
          concern,
          kind: request.kind,
        })
      : fmt(_('no calendar given and no default {kind} calendar configured'), { kind: request.kind }),
  );
}
