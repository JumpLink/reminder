/**
 * Pagination as an async generator of pages, so a caller can stop early and nothing is fetched
 * ahead. Two styles cover the three target servers: `Link: <…>; rel="next"` and offset + page size.
 * A runaway server is an error, never a silently truncated list.
 */

import type { HttpClient, JsonResult, QueryValue } from './client.ts';
import { ResponseFormatError } from './errors.ts';

export interface PageOptions<T> {
  /** Items of one response body. Default: the body itself, which must be an array. */
  readonly items?: (body: unknown) => T[];
  /** More pages than this is an error. Default 100. */
  readonly maxPages?: number;
  readonly query?: Record<string, QueryValue>;
  readonly headers?: Record<string, string>;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

export interface LinkPagination<T> extends PageOptions<T> {
  readonly style: 'link';
}

export interface OffsetPagination<T> extends PageOptions<T> {
  readonly style: 'offset';
  readonly pageSize: number;
  /** Default `offset`. */
  readonly offsetParam?: string;
  /** Default `pageSize`. */
  readonly limitParam?: string;
}

export interface LinkRef {
  readonly url: string;
  readonly rel: string[];
}

export function parseLinkHeader(header: string | null | undefined): LinkRef[] {
  const refs: LinkRef[] = [];
  if (!header) return refs;
  for (const match of header.matchAll(/<([^>]*)>((?:\s*;\s*[^;,]+)*)/g)) {
    const rel = /rel\s*=\s*"?([^";]+)"?/i.exec(match[2] ?? '')?.[1];
    refs.push({ url: match[1] ?? '', rel: rel ? rel.trim().toLowerCase().split(/\s+/) : [] });
  }
  return refs;
}

export async function* paginate<T>(
  client: HttpClient,
  path: string,
  options: LinkPagination<T> | OffsetPagination<T>,
): AsyncGenerator<T[], void, undefined> {
  const maxPages = options.maxPages ?? 100;
  const items =
    options.items ??
    ((body: unknown): T[] => {
      if (Array.isArray(body)) return body as T[];
      throw new ResponseFormatError('a page body is not an array', { url: client.origin });
    });
  const request = { headers: options.headers, signal: options.signal, timeoutMs: options.timeoutMs };

  if (options.style === 'link') {
    let next: string | undefined = path;
    for (let page = 0; next; page += 1) {
      if (page >= maxPages) throw new ResponseFormatError(`more than ${maxPages} pages`, { url: client.origin });
      const current: URL = client.resolve(next);
      const result: JsonResult<unknown> = await client.getJson<unknown>(next, { ...request, query: page === 0 ? options.query : undefined });
      if (result.status === 'unchanged') return;
      yield items(result.data);

      const link: LinkRef | undefined = parseLinkHeader(result.headers.get('link')).find((ref) => ref.rel.includes('next'));
      if (!link) return;
      const target: URL = new URL(link.url, current);
      if (target.origin !== client.origin) {
        throw new ResponseFormatError('the next page link leaves the server', { url: client.origin });
      }
      next = target.href;
    }
    return;
  }

  const offsetParam = options.offsetParam ?? 'offset';
  const limitParam = options.limitParam ?? 'pageSize';
  let offset = 0;
  for (let page = 0; ; page += 1) {
    if (page >= maxPages) throw new ResponseFormatError(`more than ${maxPages} pages`, { url: client.origin });
    const query = { ...options.query, [limitParam]: options.pageSize, [offsetParam]: offset };
    const result = await client.getJson<unknown>(path, { ...request, query });
    if (result.status === 'unchanged') return;
    const batch = items(result.data);
    if (batch.length > 0) yield batch;
    if (batch.length < options.pageSize) return;
    offset += batch.length;
  }
}

/** Every item of every page; the page cap still applies. */
export async function paginateAll<T>(
  client: HttpClient,
  path: string,
  options: LinkPagination<T> | OffsetPagination<T>,
): Promise<T[]> {
  const all: T[] = [];
  for await (const page of paginate(client, path, options)) all.push(...page);
  return all;
}
