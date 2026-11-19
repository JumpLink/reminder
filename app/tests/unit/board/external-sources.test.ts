import { describe, expect, it } from '@gjsify/unit';
import { ConfigError, parseConfig, serializeConfig } from '@reminder/core';

import { createBoardSources } from '../../../src/core/board-sources.ts';
import { resolveExternalSecrets } from '../../../src/core/context.ts';

const FILE = {
  accounts: [{ id: 'home', backend: 'eds' }],
  boardSources: [
    { id: 'cloud', type: 'deck', url: 'https://cloud.example.org/', username: 'alice', boards: ['10'] },
    { id: 'projects', type: 'openproject', url: 'https://projects.example.org/' },
    { id: 'zen', type: 'zenkit', lists: { abc: { columnField: 'Status', personField: 'Owner' } } },
  ],
};

const SECRETS = new Map([
  ['cloud', 'app-pass'],
  ['projects', 'op-token'],
  ['zen', 'zk-key'],
]);

function thrown(fn: () => unknown): unknown {
  try {
    fn();
  } catch (err) {
    return err;
  }
  return null;
}

interface Call {
  url: string;
  authorization: string;
  zenkitKey: string;
}

function fakeFetch(calls: Call[]): typeof fetch {
  return (async (input: unknown, init?: { headers?: Record<string, string> | Headers }) => {
    const headers = new Headers(init?.headers as HeadersInit | undefined);
    calls.push({
      url: String(input),
      authorization: headers.get('authorization') ?? '',
      zenkitKey: headers.get('zenkit-api-key') ?? '',
    });
    const url = String(input);
    const body = url.includes('/boards')
      ? [
          { id: 10, title: 'Workshop', archived: false },
          { id: 11, title: 'Garden', archived: false },
        ]
      : { _embedded: { elements: [{ id: 1, name: 'Plan', identifier: 'plan' }] } };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
}

const basic = (user: string, pass: string): string => `Basic ${btoa(`${user}:${pass}`)}`;

export default async () => {
  await describe('external board sources from configuration', async () => {
    await it('builds one source per entry with the right type and host', async () => {
      const config = parseConfig(FILE);
      const set = createBoardSources({
        config,
        backend: () => null,
        externalSecrets: SECRETS,
        fetch: fakeFetch([]),
      });
      expect(set.problems.length).toBe(0);
      expect(set.sources.map((s) => `${s.info.id}:${s.info.type}`).join(',')).toBe(
        'cloud:deck,projects:openproject,zen:zenkit',
      );
      expect(set.sources.map((s) => s.host).join(',')).toBe(
        'cloud.example.org,projects.example.org,zenkit.com',
      );
    });

    await it('talks to Deck and OpenProject with the resolved secret, and filters Deck by allowlist', async () => {
      const calls: Call[] = [];
      const set = createBoardSources({
        config: parseConfig(FILE),
        backend: () => null,
        externalSecrets: SECRETS,
        fetch: fakeFetch(calls),
      });
      const deck = set.sources.find((s) => s.info.id === 'cloud')?.source;
      const boards = await deck?.listBoards();
      expect(boards?.map((b) => b.id).join(',')).toBe('10');
      expect(calls[0].authorization).toBe(basic('alice', 'app-pass'));

      const projects = set.sources.find((s) => s.info.id === 'projects')?.source;
      expect((await projects?.listBoards())?.length).toBe(1);
      expect(calls[calls.length - 1].authorization).toBe(basic('apikey', 'op-token'));
    });

    await it('never constructs a disabled source and never reads its secret', async () => {
      const config = parseConfig({
        ...FILE,
        boardSources: FILE.boardSources.map((s) => ({ ...s, enabled: false })),
      });
      const calls: Call[] = [];
      const set = createBoardSources({
        config,
        backend: () => null,
        externalSecrets: SECRETS,
        fetch: fakeFetch(calls),
      });
      expect(set.sources.length).toBe(0);
      expect(set.problems.length).toBe(0);
      expect(calls.length).toBe(0);

      let lookups = 0;
      const resolved = await resolveExternalSecrets(config, {
        id: 'fake',
        lookup: async () => {
          lookups++;
          return { status: 'missing' };
        },
        store: async () => ({ status: 'ok' }),
        clear: async () => ({ status: 'ok' }),
      });
      expect(lookups).toBe(0);
      expect(resolved.size).toBe(0);
    });

    await it('turns a missing credential into a problem line and keeps the other sources', async () => {
      const set = createBoardSources({
        config: parseConfig(FILE),
        backend: () => null,
        externalSecrets: new Map([['projects', 'op-token']]),
        fetch: fakeFetch([]),
      });
      expect(set.sources.map((s) => s.info.id).join(',')).toBe('projects');
      expect(set.problems.length).toBe(2);
      expect(set.problems[0].includes('cloud')).toBe(true);
      expect(set.problems[0].includes('cloud:password')).toBe(true);
      expect(set.problems.join('\n').includes('app-pass')).toBe(false);
    });

    await it('turns a factory failure into a problem line', async () => {
      // A URL the config accepts but the adapter refuses cannot exist; a hand-built entry can.
      const config = parseConfig(FILE);
      config.boardSources[1] = { ...config.boardSources[1], url: 'ftp://projects.example.org/' };
      const set = createBoardSources({
        config,
        backend: () => null,
        externalSecrets: SECRETS,
        fetch: fakeFetch([]),
      });
      expect(set.sources.length).toBe(2);
      expect(set.problems.length).toBe(1);
      expect(set.problems[0].includes('projects')).toBe(true);
    });

    await it('hands Zenkit its list settings, and its key in the right header', async () => {
      const calls: Call[] = [];
      const set = createBoardSources({
        config: parseConfig(FILE),
        backend: () => null,
        externalSecrets: SECRETS,
        fetch: fakeFetch(calls),
      });
      const zen = set.sources.find((s) => s.info.id === 'zen')?.source;
      await zen?.listBoards().catch(() => undefined);
      expect(calls.length > 0).toBe(true);
      expect(calls.every((c) => c.zenkitKey === 'zk-key')).toBe(true);
    });
  });

  await describe('boardSources in the configuration file', async () => {
    await it('defaults the secret reference and round-trips with unknown keys kept', async () => {
      const raw = {
        future: { keep: 1 },
        accounts: [{ id: 'home', backend: 'eds' }],
        boardSources: [
          { id: 'cloud', type: 'deck', url: 'https://cloud.example.org/', username: 'alice', note: 'x' },
          { id: 'zen', type: 'zenkit', enabled: false },
        ],
      };
      const config = parseConfig(raw);
      expect(config.boardSources[0].secret).toBe('cloud:password');
      expect(config.boardSources[1].secret).toBe('zen:token');
      expect(config.boardSources[1].enabled).toBe(false);
      const once = serializeConfig(config);
      expect(serializeConfig(parseConfig(JSON.parse(once)))).toBe(once);
      const written = JSON.parse(once);
      expect(written.future.keep).toBe(1);
      expect(written.boardSources[0].note).toBe('x');
      expect(written.boardSources[0].secret).toBe('cloud:password');
      expect(written.boardSources[1].enabled).toBe(false);
      expect(written.boardSources[0].enabled).toBe(undefined);
    });

    await it('writes nothing when no external source exists', async () => {
      expect('boardSources' in JSON.parse(serializeConfig(parseConfig({})))).toBe(false);
    });

    const bad: Array<[string, unknown, string]> = [
      [
        'a password in the file',
        [{ id: 'c', type: 'deck', url: 'https://c.example.org/', username: 'a', password: 'x' }],
        'password',
      ],
      [
        'a token in the file',
        [{ id: 'p', type: 'openproject', url: 'https://p.example.org/', token: 'x' }],
        'token',
      ],
      ['an unknown type', [{ id: 'p', type: 'trello', url: 'https://p.example.org/' }], 'trello'],
      ['a missing url', [{ id: 'p', type: 'openproject' }], 'url'],
      [
        'plain http to a remote host',
        [{ id: 'p', type: 'openproject', url: 'http://p.example.org/' }],
        'https',
      ],
      [
        'credentials in the url',
        [{ id: 'p', type: 'openproject', url: 'https://u:s@p.example.org/' }],
        'credentials',
      ],
      ['deck without a username', [{ id: 'c', type: 'deck', url: 'https://c.example.org/' }], 'username'],
      ['an id that is also an account', [{ id: 'home', type: 'zenkit' }], 'home'],
      ['a bad secret reference', [{ id: 'z', type: 'zenkit', secret: 'nocolon' }], ''],
      [
        'lists on a deck',
        [{ id: 'c', type: 'deck', url: 'https://c.example.org/', username: 'a', lists: {} }],
        'lists',
      ],
      ['a non-boolean enabled', [{ id: 'z', type: 'zenkit', enabled: 'no' }], 'enabled'],
    ];
    for (const [name, boardSources, mention] of bad) {
      await it(`rejects ${name}`, async () => {
        const err = thrown(() => parseConfig({ accounts: [{ id: 'home', backend: 'eds' }], boardSources }));
        expect(err instanceof ConfigError).toBe(true);
        expect((err as Error).message.includes(mention)).toBe(true);
        expect((err as Error).message.includes('"x"')).toBe(false);
      });
    }
  });
};
