import type { PendingSelection } from './types';

export type ExtensionMessage =
  | { type: 'SET_REFINE_MODE'; enabled: boolean }
  | { type: 'REFINE_MODE_CHANGED'; tabId: number; enabled: boolean }
  | { type: 'GET_REFINE_MODE' }
  | { type: 'TARGET_SELECTED'; payload: PendingSelection };

export type RefineModeResponse = { enabled: boolean };
