// refine-companion: runs INSIDE the artifact iframe in postMessage / iframe-host
// mode. Mirrors the chrome content-script's primitives over a postMessage RPC,
// reusing dom.ts (picker) and overlay.ts (visuals) directly.
//
// Scope (v1): text_change, hide, remove diffs + region picking. Reorder, move,
// image intents, and style adjustments are intentionally NOT ported yet —
// they're more involved and don't block the sanstudio-iteration use case. Add
// them by extending the action handlers below.
//
// Wire-up:
//   import './iframe/companion';
//   // companion auto-attaches a 'message' listener and stays passive until
//   // the host sends SET_REFINE_MODE.

import { buildSelectedTarget, pickMeaningfulTarget } from '../content/dom';
import { OVERLAY_IDS, createOverlay, type OverlayHandles } from '../content/overlay';
import type {
  DirectEditAction,
  EditDiff,
  HideDiff,
  PendingSelection,
  RemoveDiff,
  SelectedTarget,
  TextChangeDiff,
} from '../shared/types';

const PROTOCOL_NAMESPACE = 'ifl/iframe';

type Request =
  | { ns: typeof PROTOCOL_NAMESPACE; id: string; type: 'SET_REFINE_MODE'; enabled: boolean }
  | { ns: typeof PROTOCOL_NAMESPACE; id: string; type: 'GET_REFINE_MODE' }
  | { ns: typeof PROTOCOL_NAMESPACE; id: string; type: 'APPLY_DIRECT_EDIT'; action: DirectEditAction }
  | { ns: typeof PROTOCOL_NAMESPACE; id: string; type: 'REVERT_DIFFS'; diffs: EditDiff[] };

type Response = {
  ns: typeof PROTOCOL_NAMESPACE;
  id: string;
  ok: boolean;
  result?: unknown;
  error?: string;
};

type Broadcast =
  | { ns: typeof PROTOCOL_NAMESPACE; type: 'REFINE_MODE_CHANGED'; enabled: boolean }
  | { ns: typeof PROTOCOL_NAMESPACE; type: 'TARGET_SELECTED'; pending: PendingSelection };

let refineEnabled = false;
let overlay: OverlayHandles | null = null;
let currentHover: Element | null = null;
let selected: Element | null = null;
let activePending: PendingSelection | null = null;
let inlineTextActive = false;
let originalTextBeforeEdit: string | null = null;

function nowIso(): string {
  return new Date().toISOString();
}

function diffId(): string {
  return `diff-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function postToHost(message: Response | Broadcast): void {
  // The host (parent) is a different window context. We use '*' as the
  // target origin because we don't know the parent's origin from inside
  // the iframe in srcdoc mode. The host should still origin-check OUR
  // origin on its end — see postmessage transport.
  window.parent.postMessage(message, '*');
}

function ensureOverlay(): OverlayHandles {
  if (!overlay) overlay = createOverlay();
  return overlay;
}

function teardownOverlay(): void {
  overlay?.teardown();
  overlay = null;
}

function broadcastRefineMode(enabled: boolean): void {
  postToHost({ ns: PROTOCOL_NAMESPACE, type: 'REFINE_MODE_CHANGED', enabled });
}

function selectRegion(picked: Element): void {
  selected = picked;
  inlineTextActive = false;
  const target: SelectedTarget = buildSelectedTarget(picked);
  const pending: PendingSelection = {
    tabId: -1,
    pageUrl: location.href,
    pageTitle: document.title,
    target,
    diffs: [],
    capturedAt: nowIso(),
  };
  activePending = pending;
  ensureOverlay().showSelection(picked.getBoundingClientRect(), target.label, 'locked');
  ensureOverlay().hideHover();
  postToHost({ ns: PROTOCOL_NAMESPACE, type: 'TARGET_SELECTED', pending });
}

function onMouseMove(ev: MouseEvent): void {
  if (!refineEnabled) return;
  const el = document.elementFromPoint(ev.clientX, ev.clientY);
  // Skip our own overlay nodes.
  if (
    el &&
    el instanceof Element &&
    (el.id === OVERLAY_IDS.hover ||
      el.id === OVERLAY_IDS.selection ||
      el.id === OVERLAY_IDS.banner)
  ) {
    return;
  }
  const picked = pickMeaningfulTarget(el ?? null);
  if (!picked || picked === currentHover) return;
  currentHover = picked;
  ensureOverlay().showHover(picked.getBoundingClientRect());
}

function onClick(ev: MouseEvent): void {
  if (!refineEnabled) return;
  if (inlineTextActive) return;
  const el = document.elementFromPoint(ev.clientX, ev.clientY);
  if (!el || !(el instanceof Element)) return;
  const picked = pickMeaningfulTarget(el);
  if (!picked) return;
  ev.preventDefault();
  ev.stopPropagation();
  selectRegion(picked);
}

function onKey(ev: KeyboardEvent): void {
  if (!refineEnabled) return;
  if (ev.key === 'Escape') {
    setRefineMode(false);
    broadcastRefineMode(false);
  }
}

function setRefineMode(enabled: boolean): void {
  if (refineEnabled === enabled) return;
  refineEnabled = enabled;
  if (enabled) {
    ensureOverlay().showBanner('Refine Mode — click any region · ESC to exit');
    document.documentElement.classList.add('ifl-picking-active');
    document.addEventListener('mousemove', onMouseMove, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKey, true);
  } else {
    document.removeEventListener('mousemove', onMouseMove, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onKey, true);
    document.documentElement.classList.remove('ifl-picking-active');
    overlay?.hideBanner();
    overlay?.hideHover();
    currentHover = null;
    if (!selected) teardownOverlay();
  }
}

function recordTextChange(before: string, after: string): TextChangeDiff {
  if (!selected || !activePending) {
    throw new Error('No active selection for text change');
  }
  return {
    id: diffId(),
    type: 'text_change',
    selector: activePending.target.selector,
    target: activePending.target.label,
    createdAt: nowIso(),
    before,
    after,
  };
}

function startInlineTextEdit(): void {
  if (!selected || !(selected instanceof HTMLElement)) {
    throw new Error('No selection to edit');
  }
  if (inlineTextActive) return;
  inlineTextActive = true;
  originalTextBeforeEdit = selected.innerText;
  selected.classList.add(OVERLAY_IDS.inlineEditable, OVERLAY_IDS.inlineEditing);
  selected.setAttribute('contenteditable', 'true');
  selected.focus();
  ensureOverlay().showSelection(
    selected.getBoundingClientRect(),
    activePending?.target.label ?? 'editing',
    'editing',
  );
}

function stopInlineTextEdit(): TextChangeDiff | null {
  if (!selected || !(selected instanceof HTMLElement) || !inlineTextActive) return null;
  inlineTextActive = false;
  selected.classList.remove(OVERLAY_IDS.inlineEditable, OVERLAY_IDS.inlineEditing);
  selected.removeAttribute('contenteditable');
  const after = selected.innerText;
  const before = originalTextBeforeEdit ?? '';
  originalTextBeforeEdit = null;
  ensureOverlay().showSelection(
    selected.getBoundingClientRect(),
    activePending?.target.label ?? 'edited',
    after === before ? 'locked' : 'edited',
  );
  if (after === before) return null;
  return recordTextChange(before, after);
}

function hideSelected(): HideDiff {
  if (!selected || !activePending || !(selected instanceof HTMLElement)) {
    throw new Error('No selection to hide');
  }
  const originalDisplay = selected.style.display;
  const preview = (selected.innerText || selected.outerHTML).slice(0, 80);
  selected.style.display = 'none';
  return {
    id: diffId(),
    type: 'hide',
    selector: activePending.target.selector,
    target: activePending.target.label,
    createdAt: nowIso(),
    preview,
    originalDisplay,
  };
}

function removeSelected(): RemoveDiff {
  if (!selected || !activePending || !(selected instanceof HTMLElement)) {
    throw new Error('No selection to remove');
  }
  const originalDisplay = selected.style.display;
  const preview = (selected.innerText || selected.outerHTML).slice(0, 80);
  // We hide rather than detach so REVERT_DIFFS can simply restore display.
  // Same end-user effect as the chrome variant.
  selected.style.display = 'none';
  return {
    id: diffId(),
    type: 'remove',
    selector: activePending.target.selector,
    target: activePending.target.label,
    createdAt: nowIso(),
    preview,
    originalDisplay,
  };
}

function applyDirectEdit(action: DirectEditAction): {
  ok: boolean;
  pending?: PendingSelection | null;
  error?: string;
} {
  try {
    if (action.type === 'start_inline_text_edit') {
      startInlineTextEdit();
      return { ok: true, pending: activePending };
    }
    if (action.type === 'stop_inline_text_edit') {
      const diff = stopInlineTextEdit();
      if (diff && activePending) activePending.diffs = [...activePending.diffs, diff];
      return { ok: true, pending: activePending };
    }
    if (action.type === 'hide_selected') {
      const diff = hideSelected();
      if (activePending) activePending.diffs = [...activePending.diffs, diff];
      return { ok: true, pending: activePending };
    }
    if (action.type === 'remove_selected') {
      const diff = removeSelected();
      if (activePending) activePending.diffs = [...activePending.diffs, diff];
      return { ok: true, pending: activePending };
    }
    if (action.type === 'reset_pending_selection') {
      // Optionally revert all diffs on the selection before clearing.
      if (action.revert && activePending) revertDiffs(activePending.diffs);
      selected = null;
      activePending = null;
      overlay?.hideSelection();
      return { ok: true, pending: null };
    }
    return {
      ok: false,
      error: `Unsupported action in iframe companion (v1): ${action.type}`,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'edit failed' };
  }
}

function revertDiffs(diffs: EditDiff[]): { ok: boolean; error?: string } {
  // Walk the diffs in reverse — later diffs shadow earlier ones.
  for (let i = diffs.length - 1; i >= 0; i--) {
    const diff = diffs[i];
    try {
      const node = document.querySelector(diff.selector);
      if (!node) continue;
      if (diff.type === 'text_change') {
        if (node instanceof HTMLElement) node.innerText = diff.before;
      } else if (diff.type === 'hide' || diff.type === 'remove') {
        if (node instanceof HTMLElement) node.style.display = diff.originalDisplay ?? '';
      }
      // Other diff types are no-op in v1.
    } catch (err) {
      console.warn('[ifl-companion] revert failed for diff', diff, err);
    }
  }
  return { ok: true };
}

function handleRequest(req: Request): Response {
  if (req.type === 'SET_REFINE_MODE') {
    setRefineMode(req.enabled);
    broadcastRefineMode(req.enabled);
    return { ns: PROTOCOL_NAMESPACE, id: req.id, ok: true, result: { enabled: refineEnabled } };
  }
  if (req.type === 'GET_REFINE_MODE') {
    return { ns: PROTOCOL_NAMESPACE, id: req.id, ok: true, result: { enabled: refineEnabled } };
  }
  if (req.type === 'APPLY_DIRECT_EDIT') {
    const result = applyDirectEdit(req.action);
    return { ns: PROTOCOL_NAMESPACE, id: req.id, ok: result.ok, result, error: result.error };
  }
  if (req.type === 'REVERT_DIFFS') {
    const result = revertDiffs(req.diffs);
    return { ns: PROTOCOL_NAMESPACE, id: req.id, ok: result.ok, error: result.error };
  }
  // Exhaustiveness — TS will flag if a Request variant is missed.
  const _exhaust: never = req;
  void _exhaust;
  return {
    ns: PROTOCOL_NAMESPACE,
    id: (req as { id: string }).id,
    ok: false,
    error: 'unknown request type',
  };
}

window.addEventListener('message', (event: MessageEvent) => {
  const data = event.data as Request | undefined;
  if (!data || (data as { ns?: string }).ns !== PROTOCOL_NAMESPACE) return;
  if (!('id' in data)) return; // ignore broadcasts; we only handle requests
  const response = handleRequest(data);
  window.parent.postMessage(response, '*');
});
