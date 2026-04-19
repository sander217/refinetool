import type { DirectEditAction, EditDiff, PendingSelection } from './types';

export type ExtensionMessage =
  | { type: 'SET_REFINE_MODE'; enabled: boolean }
  | { type: 'REFINE_MODE_CHANGED'; tabId: number; enabled: boolean }
  | { type: 'GET_REFINE_MODE' }
  | { type: 'TARGET_SELECTED'; payload: PendingSelection }
  | { type: 'INLINE_TEXT_STATE_CHANGED'; active: boolean }
  | { type: 'MOVE_MODE_CHANGED'; active: boolean }
  | { type: 'APPLY_DIRECT_EDIT'; action: DirectEditAction }
  // Roll back a set of diffs on the live preview (used when a session item
  // is deleted, or when a pending is discarded after having been auto-saved).
  | { type: 'REVERT_DIFFS'; diffs: EditDiff[] };

export type RefineModeResponse = { enabled: boolean };
