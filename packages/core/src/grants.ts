/**
 * Writes are granted per capability and target, never per process.
 *
 * A grant names ONE capability and ONE exact target. A wildcard, an empty target or an unknown
 * capability is a configuration error at load — never a grant that quietly matches more than the
 * person wrote. A missing grant is a refusal. Same model as curlew's ADR 0004.
 */

import { ConfigError, GrantDeniedError } from './errors.ts';
import { _, fmt } from './i18n.ts';

export const CAPABILITIES = [
  'calendar.create',
  'reminder.create',
  'reminder.update',
  'board.move',
  'board.update',
  'board.create',
] as const;
export type Capability = (typeof CAPABILITIES)[number];

/** The capabilities whose target is one board, spelled `<source>:<board>` (ADR 0013 §1). */
export const BOARD_CAPABILITIES = ['board.move', 'board.update', 'board.create'] as const;
export type BoardCapability = (typeof BOARD_CAPABILITIES)[number];

export function isBoardCapability(value: Capability): value is BoardCapability {
  return (BOARD_CAPABILITIES as readonly string[]).includes(value);
}

/** The grant target of one board — the same string the `boards.columns` keys use. */
export function boardTarget(source: string, board: string): string {
  return `${source}:${board}`;
}

/** A board target names a source AND a board; a source alone would cover every board on it. */
export function isBoardTarget(target: string): boolean {
  const at = target.indexOf(':');
  return at > 0 && at < target.length - 1;
}

export interface Grant {
  capability: Capability;
  /** A calendar / task list uid, exactly as `reminder calendars` prints it. */
  target: string;
}

export function isCapability(value: unknown): value is Capability {
  return typeof value === 'string' && (CAPABILITIES as readonly string[]).includes(value);
}

export function parseGrants(value: unknown): Grant[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new ConfigError(_('grants must be a list'));
  return value.map((entry: unknown, index) => {
    if (!entry || typeof entry !== 'object') throw new ConfigError(fmt(_('grants[{index}] must be an object'), { index }));
    const { capability, target } = entry as Record<string, unknown>;
    if (!isCapability(capability)) {
      throw new ConfigError(
        fmt(_('grants[{index}]: unknown capability {capability}'), { index, capability: JSON.stringify(capability) }),
      );
    }
    if (typeof target !== 'string' || target.trim() === '') {
      throw new ConfigError(fmt(_('grants[{index}]: target must be a non-empty string'), { index }));
    }
    if (target.includes('*'))
      throw new ConfigError(fmt(_('grants[{index}]: wildcards are not allowed in a target'), { index }));
    if (isBoardCapability(capability) && !isBoardTarget(target)) {
      throw new ConfigError(
        fmt(_('grants[{index}]: {capability} needs a target of the form "<source>:<board>"'), { index, capability }),
      );
    }
    return { capability, target };
  });
}

/** Exact match on both fields. No prefix, no case folding, no wildcard. */
export function isGranted(grants: readonly Grant[], capability: Capability, target: string): boolean {
  return grants.some((g) => g.capability === capability && g.target === target);
}

export function requireGrant(grants: readonly Grant[], capability: Capability, target: string): void {
  if (!isGranted(grants, capability, target)) throw new GrantDeniedError(capability, target);
}

/** The capability that creating an item of this kind needs. */
export function createCapability(kind: 'event' | 'reminder'): Capability {
  return kind === 'event' ? 'calendar.create' : 'reminder.create';
}
