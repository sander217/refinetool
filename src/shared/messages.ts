import type { BlockAction, EditDiff, PendingSelection } from './types';

export type ExtensionMessage =
  | { type: 'SET_REFINE_MODE'; enabled: boolean }
  | { type: 'REFINE_MODE_CHANGED'; tabId: number; enabled: boolean }
  | { type: 'GET_REFINE_MODE' }
  | { type: 'TARGET_SELECTED'; payload: PendingSelection }
  | { type: 'START_TEXT_EDIT'; selector: string }
  | { type: 'END_TEXT_EDIT'; selector: string; commit: boolean }
  | { type: 'BLOCK_ACTION'; selector: string; action: BlockAction }
  | { type: 'REVERT_DIFF'; diffId: string }
  | { type: 'CLEAR_ALL_EDITS' };

export type RefineModeResponse = { enabled: boolean };

export type StartTextEditResponse =
  | { ok: true; elementCount: number }
  | { ok: false; error: string };

export type EndTextEditResponse = { ok: true; diffs: EditDiff[] };

export type BlockActionResponse =
  | { ok: true; diff: EditDiff }
  | { ok: false; error: string };

export type RevertResponse = { ok: boolean };

export const DIRECT_EDIT_MESSAGE_TYPES: ReadonlySet<ExtensionMessage['type']> = new Set([
  'START_TEXT_EDIT',
  'END_TEXT_EDIT',
  'BLOCK_ACTION',
  'REVERT_DIFF',
  'CLEAR_ALL_EDITS',
]);
