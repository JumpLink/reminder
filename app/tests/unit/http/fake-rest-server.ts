/**
 * An in-process REST server on localhost for the HTTP client tests: scripted handlers per path,
 * every request recorded so tests can assert on headers and counts.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

export interface RecordedRequest {
  method: string;
  path: string;
  query: string;
  headers: IncomingMessage['headers'];
}

export type Handler = (req: RecordedRequest, res: ServerResponse) => void;

export interface FakeRest {
  url: string;
  requests: RecordedRequest[];
  /** Replace the handler for a path. */
  on(path: string, handler: Handler): void;
  close(): Promise<void>;
}

export async function startFakeRest(): Promise<FakeRest> {
  const handlers = new Map<string, Handler>();
  const requests: RecordedRequest[] = [];
  const pending = new Set<ServerResponse>();

  const server: Server = createServer((req, res) => {
    const [path, query = ''] = (req.url ?? '/').split('?');
    const recorded: RecordedRequest = { method: req.method ?? 'GET', path, query, headers: req.headers };
    requests.push(recorded);
    pending.add(res);
    res.on('close', () => pending.delete(res));
    const handler = handlers.get(path);
    if (!handler) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end('{}');
      return;
    }
    handler(recorded, res);
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as { port: number }).port;
  return {
    url: `http://127.0.0.1:${port}/api/`,
    requests,
    on: (path, handler) => void handlers.set(path, handler),
    close: () =>
      new Promise<void>((resolve) => {
        for (const res of pending) res.destroy();
        server.close(() => resolve());
      }),
  };
}

export const json = (
  res: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
) => {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
};
