// Chrome transport — wraps chrome.runtime / chrome.storage / chrome.tabs.
// This is a thin adapter over the same calls the panel was already making
// directly. Behavior is unchanged for the extension build.

import type {
  DirectEditAction,
  EditDiff,
  PendingSelection,
  RefinementItem,
} from '../shared/types';
import { STORAGE_KEYS } from '../shared/types';
import type {
  DirectEditResult,
  RefineModeChange,
  RevertResult,
  Transport,
} from './types';

export function createChromeTransport(): Transport {
  return {
    async setRefineMode(enabled) {
      const response = (await chrome.runtime.sendMessage({
        type: 'SET_REFINE_MODE',
        enabled,
      })) as { ok?: boolean; tabId?: number } | undefined;
      // Background re-broadcasts REFINE_MODE_CHANGED; we just echo the
      // requested state back so callers don't need to wait for the broadcast.
      void response;
      return { enabled };
    },

    async getRefineMode() {
      const response = (await chrome.runtime.sendMessage({ type: 'GET_REFINE_MODE' })) as
        | RefineModeChange
        | undefined;
      return response ?? { enabled: false };
    },

    onRefineModeChanged(handler) {
      const listener = (msg: unknown) => {
        if (
          typeof msg === 'object' &&
          msg !== null &&
          (msg as { type?: string }).type === 'REFINE_MODE_CHANGED'
        ) {
          handler({ enabled: Boolean((msg as { enabled?: boolean }).enabled) });
        }
      };
      chrome.runtime.onMessage.addListener(listener);
      return () => chrome.runtime.onMessage.removeListener(listener);
    },

    async applyDirectEdit(action: DirectEditAction): Promise<DirectEditResult> {
      const response = (await chrome.runtime.sendMessage({
        type: 'APPLY_DIRECT_EDIT',
        action,
      })) as DirectEditResult | undefined;
      return response ?? { ok: false, error: 'No response from background' };
    },

    async revertDiffs(diffs: EditDiff[]): Promise<RevertResult> {
      const response = (await chrome.runtime.sendMessage({
        type: 'REVERT_DIFFS',
        diffs,
      })) as RevertResult | undefined;
      return response ?? { ok: false, error: 'No response from background' };
    },

    async getItems() {
      const result = await chrome.storage.local.get(STORAGE_KEYS.items);
      return (result[STORAGE_KEYS.items] as RefinementItem[] | undefined) ?? [];
    },

    async setItems(items) {
      await chrome.storage.local.set({ [STORAGE_KEYS.items]: items });
    },

    async getPendingSelection() {
      const result = await chrome.storage.local.get(STORAGE_KEYS.pending);
      return (result[STORAGE_KEYS.pending] as PendingSelection | undefined) ?? null;
    },

    async setPendingSelection(p) {
      await chrome.storage.local.set({ [STORAGE_KEYS.pending]: p });
    },

    async clearPendingSelection() {
      await chrome.storage.local.remove(STORAGE_KEYS.pending);
    },

    onStorageChanged(handler) {
      const listener = (
        changes: { [key: string]: chrome.storage.StorageChange },
        areaName: string,
      ) => {
        if (areaName !== 'local') return;
        const out: { items?: RefinementItem[]; pending?: PendingSelection | null } = {};
        if (STORAGE_KEYS.items in changes) {
          out.items = changes[STORAGE_KEYS.items].newValue as RefinementItem[] | undefined;
        }
        if (STORAGE_KEYS.pending in changes) {
          out.pending =
            (changes[STORAGE_KEYS.pending].newValue as PendingSelection | undefined) ?? null;
        }
        if ('items' in out || 'pending' in out) handler(out);
      };
      chrome.storage.onChanged.addListener(listener);
      return () => chrome.storage.onChanged.removeListener(listener);
    },
  };
}
