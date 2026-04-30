// PostMessage transport — for the iframe-embedded variant.
//
// Architecture:
//   host page (parent)                            artifact iframe
//   ┌─────────────────────────────┐               ┌─────────────────────────┐
//   │ panel UI (React)            │               │ generated artifact      │
//   │  ↳ createPostMessageTransp..│ ← postMessage │  ↳ refine-companion.js  │
//   │       .send(req)            │ ─────────→    │       .handle(req)      │
//   │                             │ ←──────────── │                         │
//   └─────────────────────────────┘    response   └─────────────────────────┘
//
// Requests carry a unique `id`; the companion echoes the same `id` in its
// response so multiple in-flight calls don't tangle.
//
// Storage in this mode is local to the host page (localStorage). Items and
// pending live under the same STORAGE_KEYS as the Chrome transport so the
// services/exporters work unmodified.

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

const PROTOCOL_NAMESPACE = 'ifl/iframe';

export type IframeRequest =
  | { ns: typeof PROTOCOL_NAMESPACE; id: string; type: 'SET_REFINE_MODE'; enabled: boolean }
  | { ns: typeof PROTOCOL_NAMESPACE; id: string; type: 'GET_REFINE_MODE' }
  | {
      ns: typeof PROTOCOL_NAMESPACE;
      id: string;
      type: 'APPLY_DIRECT_EDIT';
      action: DirectEditAction;
    }
  | { ns: typeof PROTOCOL_NAMESPACE; id: string; type: 'REVERT_DIFFS'; diffs: EditDiff[] };

export type IframeResponse = {
  ns: typeof PROTOCOL_NAMESPACE;
  id: string;
  ok: boolean;
  result?: unknown;
  error?: string;
};

export type IframeBroadcast =
  | {
      ns: typeof PROTOCOL_NAMESPACE;
      type: 'REFINE_MODE_CHANGED';
      enabled: boolean;
    }
  | {
      ns: typeof PROTOCOL_NAMESPACE;
      type: 'TARGET_SELECTED';
      pending: PendingSelection;
    };

type Pending = {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
};

export interface PostMessageTransportOptions {
  /**
   * The iframe whose contentWindow we'll postMessage into. Must already be
   * loaded with the companion script.
   */
  iframe: HTMLIFrameElement;
  /**
   * Allowed origin for the iframe. If the iframe is loaded via srcdoc, set
   * this to '*' (browsers report srcdoc origin as 'null' or the parent).
   * Otherwise lock it down to the artifact's origin for safety.
   */
  targetOrigin: string;
  /**
   * Optional storage shim. Defaults to window.localStorage. Pass a memory
   * shim in tests.
   */
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  /**
   * Optional logger for debugging. Defaults to no-op.
   */
  log?: (event: string, detail?: unknown) => void;
}

export function createPostMessageTransport(opts: PostMessageTransportOptions): Transport {
  const { iframe, targetOrigin } = opts;
  const storage = opts.storage ?? window.localStorage;
  const log = opts.log ?? (() => {});

  const pending = new Map<string, Pending>();
  const refineModeListeners = new Set<(state: RefineModeChange) => void>();
  const storageListeners = new Set<
    (changes: { items?: RefinementItem[]; pending?: PendingSelection | null }) => void
  >();
  let lastKnownRefineMode = false;

  type RequestBody =
    | { type: 'SET_REFINE_MODE'; enabled: boolean }
    | { type: 'GET_REFINE_MODE' }
    | { type: 'APPLY_DIRECT_EDIT'; action: DirectEditAction }
    | { type: 'REVERT_DIFFS'; diffs: EditDiff[] };

  function send<T>(req: RequestBody): Promise<T> {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const message = { ns: PROTOCOL_NAMESPACE, id, ...req } as IframeRequest;
    return new Promise<T>((resolve, reject) => {
      pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      const target = iframe.contentWindow;
      if (!target) {
        pending.delete(id);
        reject(new Error('iframe.contentWindow is null'));
        return;
      }
      log('send', message);
      target.postMessage(message, targetOrigin);
      // Safety net: if the companion never replies, fail the call after 8s.
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          reject(new Error(`postMessage RPC timeout for ${req.type}`));
        }
      }, 8000);
    });
  }

  // Single message listener for both responses and broadcasts from the iframe.
  function onWindowMessage(event: MessageEvent) {
    const data = event.data as IframeResponse | IframeBroadcast | undefined;
    if (!data || (data as { ns?: string }).ns !== PROTOCOL_NAMESPACE) return;
    // Origin check — if targetOrigin is '*' we accept anything (srcdoc case);
    // otherwise verify event.origin matches.
    if (targetOrigin !== '*' && event.origin !== targetOrigin) return;

    log('recv', data);

    if ('id' in data) {
      // Response to an outstanding request.
      const slot = pending.get(data.id);
      if (!slot) return;
      pending.delete(data.id);
      if (data.ok) slot.resolve(data.result);
      else slot.reject(new Error(data.error ?? 'companion error'));
      return;
    }

    // Broadcast.
    if (data.type === 'REFINE_MODE_CHANGED') {
      lastKnownRefineMode = data.enabled;
      for (const fn of refineModeListeners) fn({ enabled: data.enabled });
    } else if (data.type === 'TARGET_SELECTED') {
      void persistPending(data.pending);
    }
  }
  window.addEventListener('message', onWindowMessage);

  async function persistPending(p: PendingSelection): Promise<void> {
    storage.setItem(STORAGE_KEYS.pending, JSON.stringify(p));
    for (const fn of storageListeners) fn({ pending: p });
  }

  function readJSON<T>(key: string): T | null {
    const raw = storage.getItem(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  return {
    async setRefineMode(enabled) {
      await send<{ enabled: boolean }>({ type: 'SET_REFINE_MODE', enabled });
      lastKnownRefineMode = enabled;
      return { enabled };
    },

    async getRefineMode() {
      // The companion is the source of truth. Fall back to last-known if it
      // doesn't respond (which surfaces a timeout error to the caller).
      try {
        const result = await send<{ enabled: boolean }>({ type: 'GET_REFINE_MODE' });
        lastKnownRefineMode = result.enabled;
        return result;
      } catch {
        return { enabled: lastKnownRefineMode };
      }
    },

    onRefineModeChanged(handler) {
      refineModeListeners.add(handler);
      return () => {
        refineModeListeners.delete(handler);
      };
    },

    async applyDirectEdit(action: DirectEditAction): Promise<DirectEditResult> {
      try {
        const result = await send<DirectEditResult>({ type: 'APPLY_DIRECT_EDIT', action });
        // Mirror the background's persistence behavior: on a successful edit
        // with a returned `pending`, persist it locally so the panel sees it.
        if (result.ok) {
          if (action.type === 'reset_pending_selection') {
            storage.removeItem(STORAGE_KEYS.pending);
            for (const fn of storageListeners) fn({ pending: null });
          } else if (result.pending) {
            storage.setItem(STORAGE_KEYS.pending, JSON.stringify(result.pending));
            for (const fn of storageListeners) fn({ pending: result.pending });
          }
        }
        return result;
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : 'applyDirectEdit failed',
        };
      }
    },

    async revertDiffs(diffs: EditDiff[]): Promise<RevertResult> {
      try {
        const result = await send<RevertResult>({ type: 'REVERT_DIFFS', diffs });
        return result;
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : 'revertDiffs failed',
        };
      }
    },

    async getItems() {
      return readJSON<RefinementItem[]>(STORAGE_KEYS.items) ?? [];
    },

    async setItems(items) {
      storage.setItem(STORAGE_KEYS.items, JSON.stringify(items));
      for (const fn of storageListeners) fn({ items });
    },

    async getPendingSelection() {
      return readJSON<PendingSelection>(STORAGE_KEYS.pending);
    },

    async setPendingSelection(p) {
      storage.setItem(STORAGE_KEYS.pending, JSON.stringify(p));
      for (const fn of storageListeners) fn({ pending: p });
    },

    async clearPendingSelection() {
      storage.removeItem(STORAGE_KEYS.pending);
      for (const fn of storageListeners) fn({ pending: null });
    },

    onStorageChanged(handler) {
      storageListeners.add(handler);
      return () => {
        storageListeners.delete(handler);
      };
    },
  };
}
