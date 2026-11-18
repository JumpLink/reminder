/**
 * `@gjsify/adwaita-extended` — GTK4/libadwaita widgets libadwaita does not ship.
 *
 * Incubates in reminder and moves to gjsify unchanged, so it imports nothing from `@reminder/*` or
 * `@gjsify/pim` (held by the `no-restricted-imports` override in the repo's `.oxlintrc.json`).
 * The pure helper `@gjsify/adwaita-extended/due-state` runs on Node as well; this barrel needs GJS.
 */

export { DueChip } from './due-chip.ts';
export { dueState, SOON_DAYS, type DueState } from './due-state.ts';
