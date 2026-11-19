/**
 * OpenProject (API v3) as a read-only board (docs/adr/0007).
 *
 * Projects are boards, statuses are columns, work packages are cards. The adapter normalises and
 * decides nothing: a card's `sourceColumn` is its status name and `closed` is the status's own
 * `isClosed`; the lane is `rules.ts`.
 *
 * Two things the server forces on the shape of this file:
 *  · filters are AND-combined, so "assigned to me" (assignee OR responsible) is two queries
 *    united by work package id, and "watching" adds a third;
 *  · a collection has no ETag, so change detection is a cheap probe per query (see `probe`).
 */

import {
  createHttpClient,
  NotFoundError,
  paginateAll,
  ResponseFormatError,
  type HttpAuth,
  type HttpClient,
  type HostLimiter,
} from '@gjsify/http-client';
import {
  _,
  boardNotFound,
  ConfigError,
  fmt,
  type BoardRef,
  type BoardSource,
  type Card,
  type CardPage,
  type CardQuery,
  type SourceColumn,
  type SourceInfo,
  type SourceUser,
} from '@reminder/core';

export interface OpenProjectOptions {
  /** `SourceInfo.id`; default `openproject:<host>`. */
  id?: string;
  /** The instance root as a browser sees it, e.g. `https://projects.example.org/`. No credentials. */
  baseUrl: string;
  auth: HttpAuth;
  /** Elements per request; default 100. */
  pageSize?: number;
  /** Injected for tests. */
  fetch?: typeof fetch;
  limiter?: HostLimiter;
}

/** OpenProject accepts an API token as the Basic password of the fixed user name `apikey`. */
export function apiKeyAuth(token: string): HttpAuth {
  return { type: 'basic', username: 'apikey', password: token };
}

interface Link {
  href?: string | null;
  title?: string | null;
}

interface StatusResource {
  id: number;
  name: string;
  isClosed?: boolean;
  isDefault?: boolean;
  position?: number;
}

interface ProjectResource {
  id: number;
  identifier?: string;
  name: string;
}

interface WorkPackageResource {
  id: number;
  subject?: string;
  lockVersion?: number;
  dueDate?: string | null;
  date?: string | null;
  updatedAt?: string | null;
  _links?: Record<string, Link | undefined>;
}

type FilterSet = Record<string, { operator: string; values: string[] }>;

/** One server query; the filters of the whole read are these plus the scope. */
interface QuerySpec {
  kind: 'assigned' | 'responsible' | 'watcher' | 'all';
  filter: FilterSet | null;
}

const DEFAULT_PAGE_SIZE = 100;
const NEWEST_FIRST = JSON.stringify([['updatedAt', 'desc']]);

const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function lastSegments(href: string | null | undefined): string[] {
  return (href ?? '').split('?')[0].split('/').filter((part) => part !== '');
}

/** OpenProject stamps carry milliseconds (`…:20.396Z`); the core's instant shape has none. */
function instant(value: string | null | undefined): string | null {
  return value ? value.replace(/\.\d+(?=Z|[+-]\d{2}:\d{2}$)/, '') : null;
}

/** `/api/v3/statuses/7` → `7`. */
function idOf(link: Link | undefined): string | null {
  const segments = lastSegments(link?.href);
  return segments.length > 0 ? segments[segments.length - 1] : null;
}

export function createOpenProjectSource(options: OpenProjectOptions): BoardSource {
  let web: URL;
  try {
    web = new URL(options.baseUrl);
  } catch {
    throw new ConfigError(fmt(_('OpenProject base URL "{url}" is not a URL'), { url: '(invalid)' }));
  }
  if (web.protocol !== 'http:' && web.protocol !== 'https:') {
    throw new ConfigError(_('OpenProject base URL must start with http:// or https://'));
  }
  web.search = '';
  web.hash = '';
  if (!web.pathname.endsWith('/')) web.pathname += '/';
  const webBase = web.href;

  const id = options.id ?? `openproject:${web.host}`;
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
  const client: HttpClient = createHttpClient({
    baseUrl: new URL('api/v3/', webBase).href,
    auth: options.auth,
    fetch: options.fetch,
    limiter: options.limiter,
  });

  const info: SourceInfo = { id, type: 'openproject', canWrite: false, hasWatchers: true, changeToken: true };

  let me: SourceUser | null = null;

  const elementsOf = <T>(body: unknown): T[] => {
    const elements = (body as { _embedded?: { elements?: unknown } } | null)?._embedded?.elements;
    if (!Array.isArray(elements)) {
      throw new ResponseFormatError('a collection has no _embedded.elements', { url: client.origin });
    }
    return elements as T[];
  };

  async function whoAmI(): Promise<SourceUser> {
    if (me) return me;
    const result = await client.getJson<{ id: number; name?: string }>('users/me');
    if (result.status !== 'ok' || result.data?.id === undefined) {
      throw new ResponseFormatError('/users/me did not name a user', { url: client.origin });
    }
    me = { id: String(result.data.id), displayName: result.data.name?.trim() || null, isMe: true };
    return me;
  }

  /** A project the server does not have answers 404; that is the port's `boardNotFound`. */
  async function inBoard<T>(board: BoardRef, run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (err) {
      if (err instanceof NotFoundError) throw boardNotFound(board.id);
      throw err;
    }
  }

  const workPackagesPath = (board: BoardRef): string => `projects/${encodeURIComponent(board.id)}/work_packages`;

  async function statuses(): Promise<StatusResource[]> {
    const result = await client.getJson<unknown>('statuses');
    if (result.status !== 'ok') return [];
    return elementsOf<StatusResource>(result.data);
  }

  function specsFor(mine: NonNullable<CardQuery['mine']>, meId: string): QuerySpec[] {
    const is = (property: string): FilterSet => ({ [property]: { operator: '=', values: [meId] } });
    // The watcher query always runs: without it `watchedByMe` would have to be null, and null
    // means "no such concept" (ADR 0008 §5), which is not true of OpenProject.
    const watcher: QuerySpec = { kind: 'watcher', filter: is('watcher') };
    if (mine === 'all') return [{ kind: 'all', filter: null }, watcher];
    return [
      { kind: 'assigned', filter: is('assignee') },
      { kind: 'responsible', filter: is('responsible') },
      watcher,
    ];
  }

  const filtersOf = (spec: QuerySpec, includeClosed: boolean): string => {
    const all: FilterSet[] = [];
    if (!includeClosed) all.push({ status: { operator: 'o', values: [] } });
    if (spec.filter) all.push(spec.filter);
    return JSON.stringify(all);
  };

  /**
   * The cheapest change detection the server offers: one element, newest `updatedAt` first. The
   * pair (`total`, newest `updatedAt`) moves when a work package inside the query is edited, added
   * or deleted, and `total` also moves when one leaves the query (reassigned, closed).
   */
  async function probe(board: BoardRef, filters: string): Promise<string> {
    const result = await client.getJson<{ total?: number; _embedded?: { elements?: WorkPackageResource[] } }>(
      workPackagesPath(board),
      { query: { filters, sortBy: NEWEST_FIRST, pageSize: 1, offset: 1 } },
    );
    if (result.status !== 'ok') return '';
    const newest = result.data._embedded?.elements?.[0]?.updatedAt ?? '';
    return `${result.data.total ?? 0}@${newest}`;
  }

  function fetchAll(board: BoardRef, filters: string): Promise<WorkPackageResource[]> {
    return paginateAll<WorkPackageResource>(client, workPackagesPath(board), {
      style: 'offset',
      offsetUnit: 'pages',
      pageSize,
      query: { filters, sortBy: NEWEST_FIRST },
      items: (body) => elementsOf<WorkPackageResource>(body),
    });
  }

  function principal(link: Link | undefined, meId: string): SourceUser | null {
    const segments = lastSegments(link?.href);
    if (segments.length < 2) return null;
    const kind = segments[segments.length - 2];
    const raw = segments[segments.length - 1];
    const isUser = kind === 'users';
    return {
      id: isUser ? raw : `${kind}/${raw}`,
      displayName: link?.title?.trim() || null,
      isMe: isUser && raw === meId,
    };
  }

  function toCard(
    board: BoardRef,
    wp: WorkPackageResource,
    statusById: Map<string, StatusResource>,
    meId: string,
    watched: Set<number>,
  ): Card {
    const links = wp._links ?? {};
    const status = statusById.get(idOf(links.status) ?? '');
    const assignees: SourceUser[] = [];
    for (const link of [links.assignee, links.responsible]) {
      const user = principal(link, meId);
      if (user && !assignees.some((known) => known.id === user.id)) assignees.push(user);
    }
    return {
      ref: { source: id, board: board.id, id: String(wp.id) },
      title: wp.subject?.trim() || `#${wp.id}`,
      sourceColumn: status?.name ?? links.status?.title ?? '',
      closed: status?.isClosed ?? null,
      due: wp.dueDate ?? wp.date ?? null,
      assignees,
      watchedByMe: watched.has(wp.id),
      labels: [],
      url: `${webBase}work_packages/${wp.id}`,
      version: wp.lockVersion === undefined ? null : String(wp.lockVersion),
      updated: instant(wp.updatedAt),
    };
  }

  /** Newest first, then by id: a stable order that does not depend on which query answered first. */
  const newestFirst = (a: Card, b: Card): number =>
    byCodeUnit(b.updated ?? '', a.updated ?? '') || byCodeUnit(a.ref.id, b.ref.id);

  return {
    describe: () => ({ ...info }),
    whoAmI,
    async listBoards() {
      const projects = await paginateAll<ProjectResource>(client, 'projects', {
        style: 'offset',
        offsetUnit: 'pages',
        pageSize,
        items: (body) => elementsOf<ProjectResource>(body),
      });
      return projects.map((project) => ({
        source: id,
        id: String(project.id),
        title: project.name,
        url: project.identifier ? `${webBase}projects/${encodeURIComponent(project.identifier)}` : null,
      }));
    },
    async listColumns(board) {
      await inBoard(board, () => client.getJson(`projects/${encodeURIComponent(board.id)}`));
      const all = await statuses();
      return all
        .map((status) => ({
          name: status.name,
          position: Number.isInteger(status.position) ? (status.position as number) : null,
          closed: status.isClosed ?? null,
          initial: status.isDefault ?? null,
        }))
        .sort((a: SourceColumn, b: SourceColumn) => (a.position ?? 1e9) - (b.position ?? 1e9) || byCodeUnit(a.name, b.name));
    },
    async listCards(board, query: CardQuery = {}, since = null): Promise<CardPage> {
      const mine = query.mine ?? 'assigned';
      const includeClosed = query.includeClosed === true;
      return inBoard(board, async () => {
        const meId = (await whoAmI()).id;
        const specs = specsFor(mine, meId);
        const filters = specs.map((spec) => filtersOf(spec, includeClosed));

        // Probed before the fetch: an edit that lands in between shows as a change next time
        // instead of being swallowed by a token newer than the cards.
        const token = (await Promise.all(filters.map((filter) => probe(board, filter)))).join('|');
        if (since !== null && since === token) return { kind: 'unchanged' };

        const [byStatus, ...results] = await Promise.all([
          statuses(),
          ...filters.map((filter) => fetchAll(board, filter)),
        ]);
        const statusById = new Map(byStatus.map((status) => [String(status.id), status]));
        const watchedResult = results[specs.findIndex((spec) => spec.kind === 'watcher')];
        const watched = new Set(watchedResult.map((wp) => wp.id));

        // The watcher query only flags cards, except when watching is what was asked for.
        const unite = specs.flatMap((spec, index) =>
          spec.kind === 'watcher' && mine !== 'watching' ? [] : [results[index]],
        );
        const cards = new Map<string, Card>();
        for (const list of unite) {
          for (const wp of list) {
            const key = String(wp.id);
            if (!cards.has(key)) cards.set(key, toCard(board, wp, statusById, meId, watched));
          }
        }
        const matched = [...cards.values()].sort(newestFirst);
        const limit = query.limit === undefined ? matched.length : Math.max(0, query.limit);
        return {
          kind: 'changed',
          cards: matched.slice(0, limit),
          token,
          omitted: Math.max(0, matched.length - limit),
        };
      });
    },
  };
}
