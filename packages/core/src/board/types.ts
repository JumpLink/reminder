/**
 * The `BoardSource` port and the card that crosses it (docs/adr/0007).
 *
 * A second port next to `CalendarBackend`, not a replacement: Deck, OpenProject and Zenkit speak
 * JSON, and pressing their cards into iCalendar would make a driver invent a `STATUS`, drop the
 * labels and lose the link home. `CalendarBackend` stays what it is — iCalendar text only — and
 * VTODO task lists reach the board through `createVtodoBoardSource`, an adapter in the core.
 *
 * An adapter normalises and decides nothing: the column stays verbatim in `sourceColumn`, the four
 * lanes are `rules.ts`, "mine" is `mine.ts`, and whether a source is on at all is ADR 0006.
 */

import { InputError } from '../errors.ts';
import { _, fmt } from '../i18n.ts';

/** The kinds of board source there are. Same vocabulary as `SyncSourceKind`, minus the pure calendars. */
export type BoardSourceType = 'vtodo' | 'deck' | 'openproject' | 'zenkit';

/** One person as a source names them. `isMe` is the source's own answer, never a name comparison. */
export interface SourceUser {
  /** Stable within the source: Deck's uid, OpenProject's user id, a mailto address for VTODO. */
  id: string;
  displayName: string | null;
  isMe: boolean;
}

export interface SourceInfo {
  /** The configured instance this source serves, e.g. an account id. */
  id: string;
  type: BoardSourceType;
  /**
   * Writing to a board is its own decision and its own grant (ADR 0007 §5); every source answers
   * `false` in this phase. The field is a `boolean` so that a later write is one adapter plus a
   * grant, not a change to the port.
   */
  canWrite: boolean;
  /** The source knows who follows a card. When false, every `Card.watchedByMe` is null. */
  hasWatchers: boolean;
  /** The source can answer "unchanged"; when false, every read returns cards. */
  changeToken: boolean;
}

/** One board, project or task list. */
export interface BoardRef {
  /** `SourceInfo.id` of the source that serves it. */
  source: string;
  id: string;
  title: string;
  /** The board in its own web UI, or null for a source that has no page (ADR 0007 §6). */
  url: string | null;
}

/**
 * One column as the source has it: a Deck stack, an OpenProject status, a Zenkit choice value, a
 * VTODO `STATUS`. `name` is what a card carries in `sourceColumn`; mapping it to a lane is
 * `rules.ts`.
 */
export interface SourceColumn {
  name: string;
  /** The source's own order, ascending; null when it has none. */
  position: number | null;
  /** The source itself calls this column finished (`isClosed`, archived). Null: no such notion. */
  closed: boolean | null;
  /** New cards land here (OpenProject's `isDefault`). Null: no such notion. */
  initial: boolean | null;
}

export interface CardLabel {
  name: string;
  /** As the source writes it (`#rrggbb`, a name); never parsed here. Null when it has none. */
  color: string | null;
}

export interface CardRef {
  source: string;
  board: string;
  id: string;
}

/**
 * What a board shows. Deliberately poorer than every source's own model: no description, no
 * comments, no attachments, so the board stays cheap to fetch and an MCP answer cannot carry a
 * body of text nobody asked for.
 */
export interface Card {
  ref: CardRef;
  title: string;
  /** The column verbatim — shown next to the lane, and what the rules read. */
  sourceColumn: string;
  /** What the source says about being finished. Null when it has no such notion. */
  closed: boolean | null;
  /** One of the three time shapes of `types.ts`; never guessed. */
  due: string | null;
  assignees: SourceUser[];
  /** Null means the source has no watching concept — never read as "no" (ADR 0008 §5). */
  watchedByMe: boolean | null;
  labels: CardLabel[];
  /** The card in its own web UI, or null for a source that has no page. */
  url: string | null;
  /** Opaque, like the etag of ADR 0003: handed back, never compared. */
  version: string | null;
  updated: string | null;
}

/** Whose cards a query asks for (ADR 0008 §5). Part of the request, not a filter on the view. */
export const MINE_FILTERS = ['assigned', 'watching', 'all'] as const;
export type MineFilter = (typeof MINE_FILTERS)[number];

export interface CardQuery {
  /** Default `assigned`. */
  mine?: MineFilter;
  /** Include what the source itself calls closed; default false. */
  includeClosed?: boolean;
  limit?: number;
}

/**
 * The marker of a read, opaque above the adapter: Deck's ETag, OpenProject's `updatedAt`
 * watermark, a collection's ctag. It belongs to the board AND the query it came from — handing a
 * token back with a different query would compare two different questions.
 */
export type ChangeToken = string;

export type CardPage =
  | {
      kind: 'changed';
      cards: Card[];
      /** Null when the source has no change detection (`changeToken: false`). */
      token: ChangeToken | null;
      /** How many matched beyond the limit — a cap nobody reports reads as "that's all". */
      omitted: number;
    }
  | { kind: 'unchanged' };

export interface BoardSource {
  describe(): SourceInfo;
  /** Who the configured credentials belong to; `isMe` is true. */
  whoAmI(): Promise<SourceUser>;
  listBoards(): Promise<BoardRef[]>;
  listColumns(board: BoardRef): Promise<SourceColumn[]>;
  /** `since` is the token of the previous read of the SAME board and query, or null. */
  listCards(board: BoardRef, query?: CardQuery, since?: ChangeToken | null): Promise<CardPage>;
}

/**
 * The one refusal every source owes for a board it does not have. Answering an empty page instead
 * looks exactly like "nothing to do" — see the contract test.
 */
export function boardNotFound(id: string): InputError {
  return new InputError(fmt(_('no board {id} in this source'), { id }));
}
