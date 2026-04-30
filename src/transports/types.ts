// Transport interface — the abstraction that lets the same panel run as a
// Chrome extension or as an embedded iframe panel inside a host page (e.g.
// sanstudio's preview shell).
//
// Two implementations:
//   - chrome.ts: wraps chrome.runtime / chrome.storage / chrome.tabs.
//   - postmessage.ts: wraps window.postMessage RPC + localStorage. Used when
//     the panel is embedded as a sibling iframe alongside the artifact iframe
//     in a host page.
//
// All chrome-specific types stay in chrome.ts. This file is portable.

import type { DirectEditAction, EditDiff, PendingSelection, RefinementItem } from '../shared/types';

export type RefineModeChange = { enabled: boolean };
export type DirectEditResult = {
  ok: boolean;
  pending?: PendingSelection | null;
  error?: string;
};
export type RevertResult = { ok: boolean; error?: string };

export interface Transport {
  /**
   * Toggle the picker / refine-mode in the target document. In Chrome this
   * walks through background → content script. Over postMessage this is a
   * single hop into the embedded iframe.
   */
  setRefineMode(enabled: boolean): Promise<RefineModeChange>;

  /**
   * Snapshot of the current refine-mode state. Panels call this on mount.
   */
  getRefineMode(): Promise<RefineModeChange>;

  /**
   * Subscribe to refine-mode flips that originate elsewhere (the user
   * pressed ESC inside the page, the content script auto-disabled, etc.).
   */
  onRefineModeChanged(handler: (state: RefineModeChange) => void): () => void;

  /**
   * Apply a direct edit (text change, hide, remove, reorder, image intent,
   * style nudge, ...). The transport routes the action to the document and
   * returns the resulting pending-selection state.
   */
  applyDirectEdit(action: DirectEditAction): Promise<DirectEditResult>;

  /**
   * Roll back a set of diffs on the live document. Used when the user
   * deletes an item or discards a pending without saving.
   */
  revertDiffs(diffs: EditDiff[]): Promise<RevertResult>;

  /**
   * Persistence — items list (saved refinements).
   */
  getItems(): Promise<RefinementItem[]>;
  setItems(items: RefinementItem[]): Promise<void>;

  /**
   * Persistence — pending selection (the in-flight target the user is
   * currently annotating, before save).
   */
  getPendingSelection(): Promise<PendingSelection | null>;
  setPendingSelection(p: PendingSelection): Promise<void>;
  clearPendingSelection(): Promise<void>;

  /**
   * Subscribe to storage changes from any source (other tabs, the content
   * script auto-saving a new pending, etc.).
   */
  onStorageChanged(
    handler: (changes: { items?: RefinementItem[]; pending?: PendingSelection | null }) => void,
  ): () => void;
}

/**
 * Pick the right transport at boot time. In a Chrome extension context
 * `chrome.runtime?.id` is defined; otherwise we assume embedded-iframe mode.
 */
export function detectTransportKind(): 'chrome' | 'postmessage' {
  const isChrome =
    typeof globalThis !== 'undefined' &&
    typeof (globalThis as { chrome?: { runtime?: { id?: string } } }).chrome?.runtime?.id ===
      'string';
  return isChrome ? 'chrome' : 'postmessage';
}
