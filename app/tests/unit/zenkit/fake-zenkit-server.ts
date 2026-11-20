/**
 * A Zenkit stand-in on localhost: the five endpoints the adapter uses, an API-key check, and the
 * sort/skip/limit of the entry filter. Invented data only (see fixtures.ts).
 */

import { json, startFakeRest, type FakeRest } from '../http/fake-rest-server.ts';

type Json = Record<string, unknown>;

export interface FakeList {
  shortId: string;
  uuid: string;
  name: string;
  elements: Json[];
  entries: Json[];
}

export interface FakeZenkitOptions {
  apiKey: string;
  me: { id: string; displayname: string };
  /** Answer every request with 429 and this `Retry-After`. */
  rateLimitSeconds?: number;
}

export interface FakeZenkit {
  rest: FakeRest;
  url: string;
  /** Edit an entry as a second person would; bumps its `updated_at`. */
  touch(list: string, entry: string, patch: Json): void;
  /** The entries of a list as the server holds them. */
  entriesOf(list: string): Json[];
  close(): Promise<void>;
}

export async function startFakeZenkit(lists: FakeList[], options: FakeZenkitOptions): Promise<FakeZenkit> {
  const rest = await startFakeRest();
  let clock = Date.parse('2026-11-19T12:00:00Z');

  const guarded =
    (answer: (query: Json, body: Json) => unknown) =>
    (req: { headers: Record<string, unknown>; body: string }, res: Parameters<typeof json>[0]) => {
      if (options.rateLimitSeconds !== undefined) {
        json(res, 429, {}, { 'Retry-After': String(options.rateLimitSeconds) });
      } else if (req.headers['zenkit-api-key'] !== options.apiKey) {
        json(res, 401, { error: 'Unauthorized' });
      } else {
        json(res, 200, answer({}, req.body ? (JSON.parse(req.body) as Json) : {}));
      }
    };

  rest.on(
    '/api/users/me',
    guarded(() => ({ id: options.me.id, displayname: options.me.displayname })),
  );
  rest.on(
    '/api/users/me/workspacesWithLists',
    guarded(() => [
      {
        id: 1,
        name: 'Invented workspace',
        lists: lists.map((l) => ({
          shortId: l.shortId,
          uuid: l.uuid,
          id: 1000 + l.shortId.length,
          name: l.name,
        })),
      },
    ]),
  );
  for (const list of lists) {
    rest.on(
      `/api/lists/${list.shortId}/elements`,
      guarded(() => list.elements),
    );
    rest.on(
      `/api/lists/${list.shortId}/entries/filter`,
      guarded((_query, body) => {
        const sorted = [...list.entries].sort((a, b) =>
          String(b.updated_at) < String(a.updated_at)
            ? -1
            : String(b.updated_at) > String(a.updated_at)
              ? 1
              : 0,
        );
        const skip = Number(body.skip ?? 0);
        const limit = Number(body.limit ?? 50);
        return { listEntries: sorted.slice(skip, skip + limit), countData: { filteredTotal: sorted.length } };
      }),
    );
  }

  const writeInto = (entry: Json, body: Json): void => {
    clock += 60_000;
    for (const [key, value] of Object.entries(body)) {
      if (key === 'updateAction') continue;
      entry[key] = value;
      if (key.endsWith('_text')) entry.displayString = value;
    }
    entry.updated_at = new Date(clock).toISOString();
  };
  for (const list of lists) {
    rest.on(`/api/lists/${list.shortId}/entries`, (req, res) => {
      if (req.headers['zenkit-api-key'] !== options.apiKey) return json(res, 401, {});
      if (req.method !== 'POST') return json(res, 404, {});
      const entry: Json = { shortId: `N${list.entries.length + 1}`, 'a-owner_persons': [] };
      writeInto(entry, JSON.parse(req.body) as Json);
      list.entries.push(entry);
      json(res, 200, entry);
    });
    rest.onMatch(new RegExp(`^/api/lists/${list.shortId}/entries/([A-Za-z0-9]+)$`), (req, res, [entryId]) => {
      if (req.headers['zenkit-api-key'] !== options.apiKey) return json(res, 401, {});
      const entry = list.entries.find((e) => e.shortId === entryId);
      if (!entry || req.method !== 'PUT') return json(res, 404, {});
      writeInto(entry, JSON.parse(req.body) as Json);
      res.writeHead(200);
      res.end();
    });
  }

  return {
    rest,
    entriesOf: (listId) => lists.find((l) => l.shortId === listId)?.entries ?? [],
    url: rest.url,
    touch(listId, entryId, patch) {
      const entry = lists.find((l) => l.shortId === listId)?.entries.find((e) => e.shortId === entryId);
      if (!entry) throw new Error(`no entry ${entryId} in ${listId}`);
      clock += 60_000;
      Object.assign(entry, patch, { updated_at: new Date(clock).toISOString() });
    },
    close: () => rest.close(),
  };
}
