/**
 * An in-process OpenProject on localhost: the slice of API v3 the adapter reads, with the server
 * behaviours it relies on — AND-combined JSON `filters`, `sortBy`, and an `offset` that is a page
 * number. Every request is recorded. All names, hosts and ids are invented.
 */

import { createServer, type Server, type ServerResponse } from 'node:http';

export const TOKEN = 'op-test-token-0000';
export const ME = 7;
export const OTHER = 8;

export interface FakeStatus {
  id: number;
  name: string;
  isClosed: boolean;
  isDefault: boolean;
  position: number;
}

export interface FakeWorkPackage {
  id: number;
  project: number;
  subject: string;
  status: number;
  assignee?: number;
  responsible?: number;
  watchers: number[];
  dueDate?: string;
  updatedAt: string;
  lockVersion: number;
}

export interface FakeData {
  users: Record<number, string>;
  projects: { id: number; identifier: string; name: string }[];
  statuses: FakeStatus[];
  workPackages: FakeWorkPackage[];
}

export function fixtures(): FakeData {
  const wp = (
    id: number,
    subject: string,
    status: number,
    updatedAt: string,
    rest: Partial<FakeWorkPackage> = {},
  ): FakeWorkPackage => ({
    id,
    project: 1,
    subject,
    status,
    watchers: [],
    updatedAt,
    lockVersion: 1,
    ...rest,
  });
  return {
    users: { [ME]: 'Pat Example', [OTHER]: 'Robin Example' },
    projects: [
      { id: 1, identifier: 'workshop', name: 'Workshop' },
      { id: 2, identifier: 'garden', name: 'Garden' },
    ],
    statuses: [
      { id: 1, name: 'New', isClosed: false, isDefault: true, position: 1 },
      { id: 2, name: 'In progress', isClosed: false, isDefault: false, position: 2 },
      { id: 3, name: 'Closed', isClosed: true, isDefault: false, position: 3 },
      { id: 4, name: 'Rejected', isClosed: true, isDefault: false, position: 4 },
    ],
    workPackages: [
      wp(101, 'Sharpen the plane iron', 1, '2026-11-18T08:00:00.000Z', {
        assignee: ME,
        dueDate: '2026-12-01',
      }),
      wp(102, 'Rewire the bench lamp', 2, '2026-11-17T08:00:00.000Z', { responsible: ME, lockVersion: 4 }),
      wp(103, 'Order a new blade', 1, '2026-11-16T08:00:00.000Z', { assignee: ME, responsible: ME }),
      wp(104, 'Return the borrowed clamps', 1, '2026-11-15T08:00:00.000Z', {
        assignee: OTHER,
        watchers: [ME],
      }),
      wp(105, 'Oil the vice', 3, '2026-11-10T08:00:00.000Z', { assignee: ME }),
      wp(106, 'Tidy the offcuts', 1, '2026-11-14T08:00:00.000Z', { assignee: OTHER }),
      wp(107, 'Label the drawers', 1, '2026-11-13T08:00:00.000Z'),
      wp(201, 'Order seed potatoes', 1, '2026-11-12T08:00:00.000Z', { project: 2, assignee: ME }),
    ],
  };
}

export interface RecordedRequest {
  path: string;
  query: URLSearchParams;
  authorization: string | undefined;
}

export interface FakeOpenProject {
  /** The instance root a browser would use. */
  url: string;
  data: FakeData;
  requests: RecordedRequest[];
  close(): Promise<void>;
}

type Filter = Record<string, { operator: string; values?: string[] }>;

export async function startFakeOpenProject(data: FakeData = fixtures()): Promise<FakeOpenProject> {
  const requests: RecordedRequest[] = [];
  const open = new Set<ServerResponse>();
  const expected = `Basic ${Buffer.from(`apikey:${TOKEN}`).toString('base64')}`;

  const href = (kind: string, id: number | string) => `/api/v3/${kind}/${id}`;
  const userLink = (id: number | undefined) =>
    id === undefined ? { href: null } : { href: href('users', id), title: data.users[id] };

  const element = (w: FakeWorkPackage) => {
    const status = data.statuses.find((s) => s.id === w.status);
    return {
      _type: 'WorkPackage',
      id: w.id,
      subject: w.subject,
      lockVersion: w.lockVersion,
      dueDate: w.dueDate ?? null,
      updatedAt: w.updatedAt,
      _links: {
        self: { href: href('work_packages', w.id) },
        status: { href: href('statuses', w.status), title: status?.name },
        assignee: userLink(w.assignee),
        responsible: userLink(w.responsible),
      },
    };
  };

  const matches = (w: FakeWorkPackage, filters: Filter[]): boolean =>
    filters.every((filter) =>
      Object.entries(filter).every(([name, { operator, values = [] }]) => {
        const closed = data.statuses.find((s) => s.id === w.status)?.isClosed === true;
        if (name === 'status' && operator === 'o') return !closed;
        if (name === 'status' && operator === 'c') return closed;
        const ids = values.map(Number);
        if (name === 'assignee') return w.assignee !== undefined && ids.includes(w.assignee);
        if (name === 'responsible') return w.responsible !== undefined && ids.includes(w.responsible);
        if (name === 'watcher') return w.watchers.some((id) => ids.includes(id));
        throw new Error(`the fake does not know the filter ${name} ${operator}`);
      }),
    );

  const server: Server = createServer((req, res) => {
    open.add(res);
    res.on('close', () => open.delete(res));
    const url = new URL(req.url ?? '/', 'http://localhost');
    requests.push({ path: url.pathname, query: url.searchParams, authorization: req.headers.authorization });
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/hal+json; charset=utf-8' });
      res.end(JSON.stringify(body));
    };
    if (req.headers.authorization !== expected) {
      send(401, { _type: 'Error', errorIdentifier: 'urn:openproject-org:api:v3:errors:Unauthenticated' });
      return;
    }
    const collection = (items: unknown[], total = items.length, pageSize = items.length, offset = 1) =>
      send(200, {
        _type: 'Collection',
        total,
        count: items.length,
        pageSize,
        offset,
        _embedded: { elements: items },
      });

    if (url.pathname === '/api/v3/users/me') {
      send(200, { _type: 'User', id: ME, name: data.users[ME] });
      return;
    }
    if (url.pathname === '/api/v3/statuses') {
      collection(data.statuses.map((s) => ({ _type: 'Status', ...s })));
      return;
    }
    if (url.pathname === '/api/v3/projects') {
      const size = Number(url.searchParams.get('pageSize') ?? 20);
      const page = Number(url.searchParams.get('offset') ?? 1);
      collection(
        data.projects.slice((page - 1) * size, page * size).map((p) => ({ _type: 'Project', ...p })),
        data.projects.length,
        size,
        page,
      );
      return;
    }
    const project = /^\/api\/v3\/projects\/([^/]+)(\/work_packages)?$/.exec(url.pathname);
    const found = project ? data.projects.find((p) => String(p.id) === project[1]) : undefined;
    if (!project || !found) {
      send(404, { _type: 'Error', errorIdentifier: 'urn:openproject-org:api:v3:errors:NotFound' });
      return;
    }
    if (!project[2]) {
      send(200, { _type: 'Project', ...found });
      return;
    }
    const filters = JSON.parse(url.searchParams.get('filters') ?? '[]') as Filter[];
    const size = Number(url.searchParams.get('pageSize') ?? 25);
    const page = Number(url.searchParams.get('offset') ?? 1);
    const hits = data.workPackages
      .filter((w) => w.project === found.id && matches(w, filters))
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : a.id - b.id));
    collection(hits.slice((page - 1) * size, page * size).map(element), hits.length, size, page);
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as { port: number }).port;
  return {
    url: `http://127.0.0.1:${port}/`,
    data,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        for (const res of open) res.destroy();
        server.close(() => resolve());
      }),
  };
}
