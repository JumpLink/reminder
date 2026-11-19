import { describe, expect, it } from '@gjsify/unit';
import {
  type Card,
  DEFAULT_MINE,
  filterMine,
  isAssignedToMe,
  isMineFilter,
  isUnassigned,
  isWatchedByMe,
  matchesMine,
  type SourceUser,
} from '@reminder/core';

const ME: SourceUser = { id: 'u-me', displayName: 'Me', isMe: true };
const OTHER: SourceUser = { id: 'u-other', displayName: 'Someone Else', isMe: false };

function card(id: string, assignees: SourceUser[], watchedByMe: boolean | null): Card {
  return {
    ref: { source: 's', board: 'b', id },
    title: id,
    sourceColumn: 'To do',
    closed: false,
    due: null,
    assignees,
    watchedByMe,
    labels: [],
    url: null,
    version: null,
    updated: null,
  };
}

const mine = card('mine', [ME], false);
const theirs = card('theirs', [OTHER], false);
const watched = card('watched', [OTHER], true);
const nobody = card('nobody', [], null);
const mineNoWatchers = card('mine-no-watchers', [ME], null);

const ALL: Card[] = [mine, theirs, watched, nobody, mineNoWatchers];

const ids = (cards: Card[]) => cards.map((entry) => entry.ref.id).join(',');

export default async () => {
  await describe('mine filter values', async () => {
    await it('defaults to assigned', async () => {
      expect(DEFAULT_MINE).toBe('assigned');
    });

    await it('knows which strings are a filter', async () => {
      expect(isMineFilter('assigned')).toBe(true);
      expect(isMineFilter('watching')).toBe(true);
      expect(isMineFilter('all')).toBe(true);
      expect(isMineFilter('mine')).toBe(false);
      expect(isMineFilter(undefined)).toBe(false);
    });
  });

  await describe('assigned and unassigned', async () => {
    await it('reads the source own isMe, never a name', async () => {
      expect(isAssignedToMe(mine)).toBe(true);
      expect(isAssignedToMe(theirs)).toBe(false);
    });

    await it('keeps unassigned as its own answer, not as "not mine"', async () => {
      expect(isUnassigned(nobody)).toBe(true);
      expect(isUnassigned(theirs)).toBe(false);
      expect(isAssignedToMe(nobody)).toBe(false);
    });
  });

  await describe('watching', async () => {
    await it('includes what the source says I watch', async () => {
      expect(isWatchedByMe(watched)).toBe(true);
      expect(isWatchedByMe(theirs)).toBe(false);
    });

    await it('never reads a null watchedByMe as yes', async () => {
      expect(isWatchedByMe(nobody)).toBe(false);
    });

    await it('still includes a card assigned to me where the source has no watchers', async () => {
      expect(isWatchedByMe(mineNoWatchers)).toBe(true);
    });
  });

  await describe('filtering a page', async () => {
    await it('assigned is the default and the narrowest answer', async () => {
      expect(ids(filterMine(ALL))).toBe('mine,mine-no-watchers');
      expect(ids(filterMine(ALL, 'assigned'))).toBe(ids(filterMine(ALL)));
    });

    await it('watching widens assigned, it never narrows it', async () => {
      expect(ids(filterMine(ALL, 'watching'))).toBe('mine,watched,mine-no-watchers');
      for (const entry of filterMine(ALL, 'assigned')) expect(matchesMine(entry, 'watching')).toBe(true);
    });

    await it('all is every card, unassigned ones included', async () => {
      expect(filterMine(ALL, 'all').length).toBe(ALL.length);
      expect(matchesMine(nobody, 'all')).toBe(true);
    });
  });
};
