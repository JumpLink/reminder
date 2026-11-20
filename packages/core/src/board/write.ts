/**
 * Writing to a board: grant → source → write (docs/adr/0013).
 *
 * The grant check is the first statement of every function here and nothing touches a source
 * before it passes — the CLI, the GUI and the MCP tool all call these, so there is no second path
 * on which the rule could drift. A source that cannot write is refused after the grant, so a
 * missing grant is always the first thing a person hears about.
 *
 * Failures are the port's own typed errors, not a result type: `GrantDeniedError` before any
 * source call, `InputError` for bad input or a read-only source, `ConflictError` from the source
 * when the card changed under the caller. The source's answer is returned as it came.
 */

import { InputError } from '../errors.ts';
import { boardTarget, requireGrant, type BoardCapability, type Grant } from '../grants.ts';
import { _, fmt } from '../i18n.ts';
import { classifyColumn, type BoardLane, type ColumnOverrides } from './rules.ts';
import {
  CARD_TIME,
  type BoardSource,
  type BoardSourceType,
  type Card,
  type CardChanges,
  type CardRef,
  type CardWrite,
  type SourceColumn,
} from './types.ts';

export interface BoardWriteContext {
  grants: readonly Grant[];
  /** The configured source with this `SourceInfo.id`, or undefined. */
  source(id: string): BoardSource | undefined;
}

export interface MoveCardInput {
  ref: CardRef;
  /** The `Card.version` the caller saw; null only for a source that has none. */
  version: string | null;
  /** A SOURCE column, verbatim as `listColumns` reports it — a lane is not a write target. */
  toColumn: string;
  position?: number;
}

export interface UpdateCardInput {
  ref: CardRef;
  version: string | null;
  changes: CardChanges;
}

export interface CreateCardInput {
  source: string;
  board: string;
  column: string;
  title: string;
  due?: string | null;
}

type WritableSource = BoardSource & Required<Pick<BoardSource, 'writeCard'>>;

/** Grant first; only then is the source looked up, so a refusal never reveals what is configured. */
function writer(
  context: BoardWriteContext,
  capability: BoardCapability,
  sourceId: string,
  board: string,
): WritableSource {
  requireGrant(context.grants, capability, boardTarget(sourceId, board));
  const source = context.source(sourceId);
  if (source === undefined) throw new InputError(fmt(_('no board source "{id}"'), { id: sourceId }));
  if (!source.describe().canWrite || source.writeCard === undefined) {
    throw new InputError(fmt(_('source "{id}" is read-only'), { id: sourceId }));
  }
  return source as WritableSource;
}

function requireVersion(version: string | null | undefined): void {
  // `undefined` is a caller that never read the card; null is a source without versions.
  if (version === undefined) {
    throw new InputError(_('a board write needs the version of the card as it was read'));
  }
}

function requireColumn(column: string): void {
  if (column.trim() === '') throw new InputError(_('a column name must not be empty'));
}

function requireTime(due: string | null | undefined): void {
  if (due !== undefined && due !== null && !CARD_TIME.test(due)) {
    throw new InputError(fmt(_('unparseable due date {due}'), { due }));
  }
}

function requireTitle(title: string): void {
  if (title.trim() === '') throw new InputError(_('a card title must not be empty'));
}

/** Changes the column of a card that exists, and its position inside the column (`board.move`). */
export async function moveCard(context: BoardWriteContext, input: MoveCardInput): Promise<Card> {
  const source = writer(context, 'board.move', input.ref.source, input.ref.board);
  requireVersion(input.version);
  requireColumn(input.toColumn);
  if (input.position !== undefined && (!Number.isInteger(input.position) || input.position < 0)) {
    throw new InputError(_('a position must be a non-negative integer'));
  }
  const write: CardWrite = {
    kind: 'move',
    ref: input.ref,
    version: input.version,
    toColumn: input.toColumn,
    ...(input.position === undefined ? {} : { position: input.position }),
  };
  return source.writeCard(write);
}

/** Changes the title or the due date of a card that exists (`board.update`). */
export async function updateCard(context: BoardWriteContext, input: UpdateCardInput): Promise<Card> {
  const source = writer(context, 'board.update', input.ref.source, input.ref.board);
  requireVersion(input.version);
  const { title, due } = input.changes;
  if (title === undefined && due === undefined) throw new InputError(_('nothing to change'));
  if (title !== undefined) requireTitle(title);
  requireTime(due);
  const changes: CardChanges = {
    ...(title === undefined ? {} : { title }),
    ...(due === undefined ? {} : { due }),
  };
  return source.writeCard({ kind: 'update', ref: input.ref, version: input.version, changes });
}

/** Adds a card to a column (`board.create`). */
export async function createCard(context: BoardWriteContext, input: CreateCardInput): Promise<Card> {
  const source = writer(context, 'board.create', input.source, input.board);
  requireColumn(input.column);
  requireTitle(input.title);
  requireTime(input.due);
  return source.writeCard({
    kind: 'create',
    board: input.board,
    column: input.column,
    title: input.title,
    ...(input.due === undefined ? {} : { due: input.due }),
  });
}

/** What a lane means as a write target on one board. */
export type LaneColumn =
  | { kind: 'column'; column: SourceColumn }
  | { kind: 'ambiguous'; candidates: SourceColumn[] }
  | { kind: 'none' };

/**
 * The way back through ADR 0008's mapping is not a function: several source columns map onto one
 * lane. This answers the unambiguous case and names the candidates otherwise, so the caller asks
 * once and remembers the answer — the core never picks one of several "done" stacks itself.
 */
export function resolveLaneColumn(
  type: BoardSourceType,
  columns: readonly SourceColumn[],
  lane: BoardLane,
  overrides: ColumnOverrides = {},
): LaneColumn {
  const candidates = columns.filter((column) => classifyColumn(type, column, overrides) === lane);
  if (candidates.length === 0) return { kind: 'none' };
  if (candidates.length === 1) return { kind: 'column', column: candidates[0] };
  return { kind: 'ambiguous', candidates };
}

/** Matches a typed column name against `listColumns`, case-insensitively and otherwise exact (ADR 0013 §8). */
export function findSourceColumn(columns: readonly SourceColumn[], name: string): SourceColumn[] {
  const wanted = name.toLowerCase();
  return columns.filter((column) => column.name.toLowerCase() === wanted);
}
