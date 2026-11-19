/**
 * A Nextcloud Deck on localhost: the REST endpoints the adapter reads, with a board ETag that
 * moves when anything under the board moves, as the Deck API documents. Invented data only.
 */

import { createHash } from 'node:crypto';
import type { ServerResponse } from 'node:http';

import { json, startFakeRest, type FakeRest, type RecordedRequest } from '../http/fake-rest-server.ts';

export const DECK_USER = 'alice';
export const DECK_PASSWORD = 'not-a-real-password';

const API = '/index.php/apps/deck/api/v1.0';

interface Stack {
  id: number;
  boardId: number;
  title: string;
  order: number;
  deletedAt: number;
  cards: Record<string, unknown>[];
}

const user = (uid: string, displayname: string) => ({ primaryKey: uid, uid, displayname, type: 0 });
const assigned = (uid: string, displayname: string) => ({
  id: 1,
  participant: user(uid, displayname),
  cardId: 0,
});

function card(id: number, stackId: number, title: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    stackId,
    title,
    description: 'a body the board never shows',
    labels: [],
    assignedUsers: [],
    archived: false,
    done: null,
    duedate: null,
    order: id,
    deletedAt: 0,
    lastModified: 1_790_000_000 + id,
    ...extra,
  };
}

function seed() {
  const boards = [
    {
      id: 10,
      title: 'Workshop',
      color: '0082c9',
      archived: false,
      deletedAt: 0,
      lastModified: 1_790_000_100,
    },
    { id: 11, title: 'Garden', color: '31cc7c', archived: false, deletedAt: 0, lastModified: 1_790_000_200 },
    { id: 12, title: 'Retired', color: 'ff0000', archived: true, deletedAt: 0, lastModified: 1_700_000_000 },
  ];
  const stacks: Stack[] = [
    {
      id: 2,
      boardId: 10,
      title: 'Zu erledigen',
      order: 1,
      deletedAt: 0,
      cards: [
        card(101, 2, 'Sharpen the plane iron', {
          duedate: '2026-12-01T00:00:00+00:00',
          assignedUsers: [assigned(DECK_USER, 'Alice Example')],
          labels: [{ id: 1, title: 'Urgent', color: 'ff7a66', boardId: 10, cardId: null }],
        }),
        card(102, 2, 'Rewire the bench lamp', {
          assignedUsers: [assigned('bob', 'Bob Example')],
        }),
      ],
    },
    {
      id: 1,
      boardId: 10,
      title: 'Backlog',
      order: 0,
      deletedAt: 0,
      cards: [card(103, 1, 'Sort the offcuts')],
    },
    {
      id: 3,
      boardId: 10,
      title: 'In Arbeit',
      order: 2,
      deletedAt: 0,
      cards: [
        card(104, 3, 'Build the shelf', {
          duedate: '2026-12-04T17:00:00+00:00',
          assignedUsers: [assigned(DECK_USER, 'Alice Example'), assigned('bob', 'Bob Example')],
        }),
      ],
    },
    {
      id: 4,
      boardId: 10,
      title: 'Erledigt',
      order: 3,
      deletedAt: 0,
      cards: [
        card(105, 4, 'Oil the vice', {
          done: '2026-11-01T10:00:00+00:00',
          assignedUsers: [assigned(DECK_USER, 'Alice Example')],
        }),
      ],
    },
    { id: 9, boardId: 10, title: 'Gone', order: 9, deletedAt: 1_790_000_000, cards: [] },
    {
      id: 5,
      boardId: 11,
      title: 'To do',
      order: 0,
      deletedAt: 0,
      cards: [card(201, 5, 'Order seed potatoes', { assignedUsers: [assigned(DECK_USER, 'Alice Example')] })],
    },
    { id: 6, boardId: 11, title: 'Done', order: 1, deletedAt: 0, cards: [] },
  ];
  const archived: Stack[] = [
    {
      id: 2,
      boardId: 10,
      title: 'Zu erledigen',
      order: 1,
      deletedAt: 0,
      cards: [
        card(106, 2, 'Paint the old door', {
          archived: true,
          assignedUsers: [assigned(DECK_USER, 'Alice Example')],
        }),
      ],
    },
  ];
  return { boards, stacks, archived };
}

export interface FakeDeck {
  /** Server root; the adapter appends `index.php/apps/deck/api/v1.0/`. */
  baseUrl: string;
  requests: RecordedRequest[];
  /** Answer every request with 401, as a revoked app password does. */
  rejectCredentials(on?: boolean): void;
  /** Something under board 10 changed: its ETag moves. */
  touch(): void;
  close(): Promise<void>;
}

export async function startFakeDeck(): Promise<FakeDeck> {
  const rest: FakeRest = await startFakeRest();
  const data = seed();
  let revision = 1;
  let rejecting = false;

  const etagOf = (what: string): string =>
    `"${createHash('md5').update(`${what}:${revision}`).digest('hex')}"`;

  const guarded = (handler: (req: RecordedRequest, res: ServerResponse) => void) => {
    return (req: RecordedRequest, res: ServerResponse) => {
      const header = req.headers.authorization ?? '';
      const expected = `Basic ${Buffer.from(`${DECK_USER}:${DECK_PASSWORD}`).toString('base64')}`;
      if (rejecting || header !== expected) {
        json(res, 401, { message: 'Current user is not logged in' });
        return;
      }
      handler(req, res);
    };
  };

  const revalidated = (what: string, body: () => unknown) =>
    guarded((req, res) => {
      const etag = etagOf(what);
      if (req.headers['if-none-match'] === etag) {
        res.writeHead(304, { ETag: etag });
        res.end();
        return;
      }
      json(res, 200, body(), { ETag: etag });
    });

  rest.on(
    '/ocs/v2.php/cloud/user',
    guarded((_req, res) =>
      json(res, 200, {
        ocs: { meta: { status: 'ok' }, data: { id: DECK_USER, 'display-name': 'Alice Example' } },
      }),
    ),
  );
  rest.on(
    `${API}/boards`,
    revalidated('boards', () => data.boards),
  );
  for (const board of data.boards) {
    const own = (list: Stack[]) => list.filter((stack) => stack.boardId === board.id);
    rest.on(
      `${API}/boards/${board.id}/stacks`,
      revalidated(`stacks:${board.id}`, () => own(data.stacks)),
    );
    rest.on(
      `${API}/boards/${board.id}/stacks/archived`,
      revalidated(`archived:${board.id}`, () => own(data.archived)),
    );
  }

  const origin = new URL(rest.url).origin;
  return {
    baseUrl: `${origin}/`,
    requests: rest.requests,
    rejectCredentials: (on = true) => {
      rejecting = on;
    },
    touch: () => {
      revision += 1;
    },
    close: () => rest.close(),
  };
}
