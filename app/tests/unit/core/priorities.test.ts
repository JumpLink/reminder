import { describe, expect, it } from '@gjsify/unit';
import { ConfigError, formatUtc, listPriorities, rankPriorities, readReminder } from '@reminder/core';

import { calendar, createFakeBackend, vtodo } from '../fake-backend.ts';

// Local noon, so "today" and every local day below hold in any TZ the suite runs under (CI runs
// it in Berlin and Auckland). A UTC literal would land on a different local date in one of them.
const at = (month: number, day: number) => new Date(2026, month - 1, day, 12, 0, 0);
const NOW = at(10, 12);
const created = (month: number, day: number) => `CREATED:${formatUtc(at(month, day))}`;

const parent = (uid: string) => `RELATED-TO;RELTYPE=PARENT:${uid}`;

function read(uid: string, lines: string[]) {
  const item = readReminder(vtodo(uid, lines), 'list');
  if (!item) throw new Error('fixture has no VTODO');
  return item;
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  return null;
}

export default async () => {
  await describe('reminder links (RELATED-TO, URL, CREATED)', async () => {
    await it('reads the parent, with RELTYPE=PARENT or none (the RFC default)', async () => {
      expect(read('s1', [parent('p1')]).parent).toBe('p1');
      expect(read('s2', ['RELATED-TO:p2']).parent).toBe('p2');
    });

    await it('ignores other relation types and reads no parent from a CHILD link', async () => {
      expect(read('p', ['RELATED-TO;RELTYPE=CHILD:s1']).parent).toBe(null);
      expect(read('s', ['RELATED-TO;RELTYPE=SIBLING:x', parent('p')]).parent).toBe('p');
    });

    await it('keeps the URL verbatim', async () => {
      const url = 'https://wiki.example.org/cases/studio-lease?tab=log';
      expect(read('p', [`URL:${url}`]).url).toBe(url);
      expect(read('p', []).url).toBe(null);
    });

    await it('prefers CREATED, falls back to DTSTAMP, else null — a bad value is unknown', async () => {
      expect(read('a', ['CREATED:20261002T100000Z', 'DTSTAMP:20261009T100000Z']).created).toBe(
        '2026-10-02T10:00:00Z',
      );
      expect(read('b', ['DTSTAMP:20261009T100000Z']).created).toBe('2026-10-09T10:00:00Z');
      expect(read('c', []).created).toBe(null);
      expect(read('d', ['CREATED:garbage']).created).toBe(null);
    });
  });

  await describe('rankPriorities', async () => {
    const items = [
      read('no-due', ['SUMMARY:No deadline', 'PRIORITY:2', created(9, 1)]),
      read('later', ['SUMMARY:Later', 'PRIORITY:2', 'DUE;VALUE=DATE:20261101', created(9, 1)]),
      read('sooner', ['SUMMARY:Sooner', 'PRIORITY:2', 'DUE;VALUE=DATE:20261020', created(9, 1)]),
      read('top', ['SUMMARY:Top', 'PRIORITY:1', created(9, 1)]),
      read('plain', ['SUMMARY:Plain task, not a priority', created(9, 1)]),
      read('zero', ['SUMMARY:PRIORITY 0 is unset', 'PRIORITY:0']),
      read('done', ['SUMMARY:Done', 'PRIORITY:1', 'STATUS:COMPLETED']),
      read('dropped', ['SUMMARY:Dropped', 'PRIORITY:1', 'STATUS:CANCELLED']),
    ];

    await it('orders by PRIORITY, then DUE with none last', async () => {
      const ranked = rankPriorities(items, NOW);
      expect(ranked.map((p) => p.uid)).toEqualArray(['top', 'sooner', 'later', 'no-due']);
    });

    await it('leaves out unranked, completed and cancelled items', async () => {
      const uids = rankPriorities(items, NOW).map((p) => p.uid);
      for (const gone of ['plain', 'zero', 'done', 'dropped']) expect(uids.includes(gone)).toBe(false);
    });

    await it('breaks a PRIORITY+DUE tie by CREATED, then UID', async () => {
      const tied = [
        read('b', ['PRIORITY:3', 'DUE;VALUE=DATE:20261101', created(9, 5)]),
        read('c', ['PRIORITY:3', 'DUE;VALUE=DATE:20261101', created(9, 5)]),
        read('a', ['PRIORITY:3', 'DUE;VALUE=DATE:20261101', created(9, 20)]),
        read('older', ['PRIORITY:3', 'DUE;VALUE=DATE:20261101', created(9, 1)]),
      ];
      expect(rankPriorities(tied, NOW).map((p) => p.uid)).toEqualArray(['older', 'b', 'c', 'a']);
    });

    await it('counts days to the deadline from the local date, negative when overdue', async () => {
      const ranked = rankPriorities(
        [
          read('future', ['PRIORITY:1', 'DUE;VALUE=DATE:20261101']),
          read('today', ['PRIORITY:2', 'DUE;VALUE=DATE:20261012']),
          read('overdue', ['PRIORITY:3', 'DUE;VALUE=DATE:20261010']),
          read('none', ['PRIORITY:4']),
        ],
        NOW,
      );
      expect(ranked.map((p) => p.daysToDeadline)).toEqualArray([20, 0, -2, null]);
    });

    await it('flags a tie for the top rank on exactly the tied items', async () => {
      const tied = rankPriorities(
        [read('x', ['PRIORITY:1']), read('y', ['PRIORITY:1']), read('z', ['PRIORITY:2'])],
        NOW,
      );
      expect(tied.map((p) => p.tie)).toEqualArray([true, true, false]);
      const clear = rankPriorities([read('x', ['PRIORITY:1']), read('y', ['PRIORITY:2'])], NOW);
      expect(clear.map((p) => p.tie)).toEqualArray([false, false]);
      // Sharing a lower rank is not ambiguity about the top.
      const lower = rankPriorities(
        [read('x', ['PRIORITY:1']), read('y', ['PRIORITY:2']), read('z', ['PRIORITY:2'])],
        NOW,
      );
      expect(lower.map((p) => p.tie)).toEqualArray([false, false, false]);
    });
  });

  await describe('steps and "open since"', async () => {
    const lease = read('lease', [
      'SUMMARY:Renew the studio lease',
      'PRIORITY:2',
      'DUE;VALUE=DATE:20261101',
      'URL:https://wiki.example.org/cases/studio-lease',
    ]);

    await it('collects open children oldest first and nags the oldest only', async () => {
      const [p] = rankPriorities(
        [
          lease,
          read('s-new', ['SUMMARY:Send the signed copy', parent('lease'), created(10, 9)]),
          read('s-old', ['SUMMARY:Call the landlord', parent('lease'), created(10, 2)]),
        ],
        NOW,
      );
      expect(p.steps.map((s) => s.uid)).toEqualArray(['s-old', 's-new']);
      expect(p.steps.map((s) => s.nag)).toEqualArray([true, false]);
      expect(p.steps.map((s) => s.daysOpen)).toEqualArray([10, 3]);
      expect(p.daysOpen).toBe(10);
      expect(p.link).toBe('https://wiki.example.org/cases/studio-lease');
    });

    await it('moves the clock to the next-oldest step when the oldest is completed or cancelled', async () => {
      const [p] = rankPriorities(
        [
          lease,
          read('s-done', ['PRIORITY:1', parent('lease'), 'STATUS:COMPLETED', created(9, 1)]),
          read('s-cancelled', [parent('lease'), 'STATUS:CANCELLED', created(9, 2)]),
          read('s-open', ['SUMMARY:Still open', parent('lease'), created(10, 9)]),
        ],
        NOW,
      );
      expect(p.steps.map((s) => s.uid)).toEqualArray(['s-open']);
      expect(p.daysOpen).toBe(3);
    });

    await it('reports no age for a priority without open steps', async () => {
      const [p] = rankPriorities([lease, read('s', [parent('lease'), 'STATUS:COMPLETED'])], NOW);
      expect(p.steps.length).toBe(0);
      expect(p.daysOpen).toBe(null);
    });

    await it('does not guess the age of a step without a creation time, and never lets it take the nag', async () => {
      const [p] = rankPriorities(
        [lease, read('s-undated', [parent('lease')]), read('s-dated', [parent('lease'), created(10, 7)])],
        NOW,
      );
      expect(p.steps.map((s) => s.uid)).toEqualArray(['s-dated', 's-undated']);
      expect(p.steps.map((s) => s.daysOpen)).toEqualArray([5, null]);
      expect(p.steps[0].nag).toBe(true);
      expect(p.steps[1].nag).toBe(false);
    });

    await it('falls back to DTSTAMP for a step whose client wrote no CREATED', async () => {
      const stamp = `DTSTAMP:${formatUtc(at(10, 5))}`;
      const [p] = rankPriorities([lease, read('s', [parent('lease'), stamp])], NOW);
      expect(p.steps[0].daysOpen).toBe(7);
    });

    await it('drops orphans: a step whose parent is missing, done, or not itself a priority', async () => {
      const ranked = rankPriorities(
        [
          lease,
          read('orphan', ['SUMMARY:Parent is gone', parent('ghost'), created(10, 1)]),
          read('finished', ['PRIORITY:1', 'STATUS:COMPLETED']),
          read('of-finished', [parent('finished'), created(10, 1)]),
          read('plain', ['SUMMARY:No PRIORITY, so no priority']),
          read('of-plain', [parent('plain'), created(10, 1)]),
        ],
        NOW,
      );
      expect(ranked.map((p) => p.uid)).toEqualArray(['lease']);
      expect(ranked[0].steps.length).toBe(0);
    });

    await it('never promotes a child with a PRIORITY of its own to a priority', async () => {
      const ranked = rankPriorities([lease, read('s', ['PRIORITY:1', parent('lease')])], NOW);
      expect(ranked.map((p) => p.uid)).toEqualArray(['lease']);
      expect(ranked[0].steps.length).toBe(1);
    });
  });

  await describe('listPriorities', async () => {
    const backend = createFakeBackend([calendar('prio', 'reminder'), calendar('other', 'reminder')], {
      prio: [
        vtodo('p1', ['SUMMARY:First', 'PRIORITY:1']),
        vtodo('p2', ['SUMMARY:Second', 'PRIORITY:2']),
        vtodo('p3', ['SUMMARY:Third', 'PRIORITY:3']),
        vtodo('s1', ['SUMMARY:Step', parent('p2'), created(10, 11)]),
      ],
      other: [vtodo('x', ['SUMMARY:Elsewhere', 'PRIORITY:1'])],
    });

    await it('reads only the configured list and reports the date it used', async () => {
      const r = await listPriorities(backend, { list: 'prio' }, NOW);
      expect(r.today).toBe('2026-10-12');
      expect(r.list).toBe('prio');
      expect(r.priorities.map((p) => p.uid)).toEqualArray(['p1', 'p2', 'p3']);
      expect(r.priorities[1].steps[0].daysOpen).toBe(1);
      expect(r.omitted).toBe(0);
    });

    await it('reports what the limit cut', async () => {
      const r = await listPriorities(backend, { list: 'prio', limit: 2 }, NOW);
      expect(r.priorities.length).toBe(2);
      expect(r.omitted).toBe(1);
    });

    await it('refuses with a ConfigError when no list is configured, instead of guessing one', async () => {
      const err = await rejection(listPriorities(backend, {}, NOW));
      expect(err instanceof ConfigError).toBe(true);
      expect((err as Error).message).toContain('priorities');
    });

    await it('refuses a list uid that is no task list, instead of answering "none"', async () => {
      const err = await rejection(listPriorities(backend, { list: 'typo' }, NOW));
      expect(err instanceof ConfigError).toBe(true);
      expect((err as Error).message).toContain('typo');
    });
  });
};
