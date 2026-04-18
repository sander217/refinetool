import type { DirectEditAction, PendingSelection } from './types';

export type ExtensionMessage =
  | { type: 'SET_REFINE_MODE'; enabled: boolean }
  | { type: 'REFINE_MODE_CHANGED'; tabId: number; enabled: boolean }
  | { type: 'GET_REFINE_MODE' }
  | { type: 'TARGET_SELECTED'; payload: PendingSelection }
  | { type: 'INLINE_TEXT_STATE_CHANGED'; active: boolean }
  | { type: 'APPLY_DIRECT_EDIT'; action: DirectEditAction };

export type RefineModeResponse = { enabled: boolean };
