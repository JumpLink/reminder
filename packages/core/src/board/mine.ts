/**
 * Whose cards these are (docs/adr/0008 §5).
 *
 * `mine` travels in `CardQuery` to the source, so OpenProject's `assignee = me` filter runs on the
 * server and only the relevant page crosses the wire. A source that cannot filter server-side
 * calls `filterMine` here — the same function, so the answer does not depend on which source the
 * card came from, and the contract test can hold every adapter to it.
 */

import type { Card, MineFilter, SourceUser } from './types.ts';

export const DEFAULT_MINE: MineFilter = 'assigned';

export function isMineFilter(value: unknown): value is MineFilter {
  return value === 'assigned' || value === 'watching' || value === 'all';
}

/** Nobody is assigned — a fact of its own, and never the same as "not mine". */
export function isUnassigned(card: Pick<Card, 'assignees'>): boolean {
  return card.assignees.length === 0;
}

export function isAssignedToMe(card: Pick<Card, 'assignees'>): boolean {
  return card.assignees.some((user: SourceUser) => user.isMe);
}

/**
 * `watchedByMe: null` means the source has no watching concept (ADR 0007 §3). Such a card counts
 * as watched only when it is assigned: `null` never reads as "yes", and `watching` never answers
 * less than `assigned` would.
 */
export function isWatchedByMe(card: Pick<Card, 'assignees' | 'watchedByMe'>): boolean {
  return card.watchedByMe === true || isAssignedToMe(card);
}

export function matchesMine(card: Pick<Card, 'assignees' | 'watchedByMe'>, mine: MineFilter = DEFAULT_MINE): boolean {
  switch (mine) {
    case 'all':
      return true;
    case 'watching':
      return isWatchedByMe(card);
    case 'assigned':
      return isAssignedToMe(card);
  }
}

export function filterMine<T extends Pick<Card, 'assignees' | 'watchedByMe'>>(
  cards: readonly T[],
  mine: MineFilter = DEFAULT_MINE,
): T[] {
  return cards.filter((card) => matchesMine(card, mine));
}
