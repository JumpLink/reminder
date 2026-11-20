/**
 * `@gjsify/adwaita-extended` — GTK4/libadwaita widgets libadwaita does not ship.
 *
 * Incubates in reminder and moves to gjsify unchanged, so it imports nothing from `@reminder/*` or
 * `@gjsify/pim` (held by the `no-restricted-imports` override in the repo's `.oxlintrc.json`).
 * The pure helpers (`/due-state`, `/source-names`, `/priority-marks`, `/swipe-rules`,
 * `/adaptive-container`, `/size-class`) run on Node as well; this barrel needs GJS.
 */

export { AdaptivePane } from './adaptive-pane.ts';
export { containerFor, type PaneContainer } from './adaptive-container.ts';
export { AgendaList, firstAgendaDate } from './agenda-list.ts';
export { groupByDay, type AgendaDay, type AgendaEntry, type AgendaOptions } from './agenda-rules.ts';
export { BoardCard, MAX_AVATARS, type BoardCardData } from './board-card.ts';
export { BoardColumn, type BoardColumnData } from './board-column.ts';
export {
  boardPresentation,
  canDrag,
  dropIndex,
  dropPlacement,
  moveColumn,
  visibleColumns,
  type BoardPresentation,
  type CardExtent,
} from './board-rules.ts';
export type { CalendarEvent, CalendarEventData } from './calendar-event.ts';
export {
  dayHeading,
  hourLabel,
  isoDate,
  monthTitle,
  parseIsoDate,
  shortDayHeading,
  timeLabel,
  timeRangeLabel,
  usesHour12,
  weekdayNames,
} from './calendar-format.ts';
export { KanbanBoard } from './kanban-board.ts';
export { MonthGrid, eventCountText, moreText, weekText } from './month-grid.ts';
export { barRows, dotsForDay, monthDensity, moveGridFocus, type GridMove, type MonthDensity } from './month-rules.ts';
export { ColorCheck } from './color-check.ts';
export { DueChip } from './due-chip.ts';
export { dueState, SOON_DAYS, type DueState } from './due-state.ts';
export { FilterChip } from './filter-chip.ts';
export { priorityLevel, priorityMarks, type PriorityLevel } from './priority-marks.ts';
export type { SizeClass } from './size-class.ts';
export { duplicateNameIds, type NamedSource } from './source-names.ts';
export { SourceBadge, SourceDot } from './source-badge.ts';
export { SourceList, type SourceItem, type SourceSection } from './source-list.ts';
export { commitDistance, rowMinHeight, swipeOutcome, type SwipeOutcome } from './swipe-rules.ts';
export { SwipeRow } from './swipe-row.ts';
export { TaskRow, type TaskRowData } from './task-row.ts';
export { TimeGrid } from './time-grid.ts';
export {
  GUTTER_WIDTH,
  HOUR_HEIGHT,
  MAX_UNITS,
  SLOT_MINUTES,
  clampDays,
  columnUnits,
  gridHeight,
  gridSlot,
  minuteAtOffset,
  nowOffset,
  offsetForMinute,
  scrollTarget,
  visibleRange,
} from './time-grid-rules.ts';
export { initI18n, TEXT_DOMAIN } from './i18n.ts';
