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
  ColorChangeDiff,
  ColorRole,
  DirectEditAction,
  EditDiff,
  HideDiff,
  ImageRegenerateIntentDiff,
  ImageReplaceIntentDiff,
  PendingSelection,
  RemoveDiff,
  SelectedTarget,
  StyleChangeDiff,
  StyleProperty,
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

// Originals captured when a region is selected, so style mutations can be
// reverted (REVERT_DIFFS) and so the panel can show "before" values in
// generated prompts. Cleared on reset_pending_selection.
type OriginalStyles = {
  fontSize: string;
  fontWeight: string;
  borderRadius: string;
  borderWidth: string;
  padding: string;
  color: string;
  backgroundColor: string;
  borderColor: string;
};
let originalStyles: OriginalStyles | null = null;

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

function captureOriginalStyles(el: Element): OriginalStyles {
  const cs = window.getComputedStyle(el);
  return {
    fontSize: cs.fontSize,
    fontWeight: cs.fontWeight,
    borderRadius: cs.borderRadius,
    borderWidth: cs.borderWidth,
    padding: cs.padding,
    color: cs.color,
    backgroundColor: cs.backgroundColor,
    borderColor: cs.borderColor,
  };
}

function selectRegion(picked: Element): void {
  selected = picked;
  inlineTextActive = false;
  originalStyles = captureOriginalStyles(picked);
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

// Scroll/resize tracking: keep the selection overlay anchored to its
// element as the page scrolls or the viewport resizes. Throttled via rAF
// so a fast scroll doesn't flood layout work.
let viewportRaf = 0;
function refreshSelectionOverlay(): void {
  if (!selected || !overlay) return;
  if (!document.contains(selected)) {
    overlay.hideSelection();
    return;
  }
  const rect = selected.getBoundingClientRect();
  // currentSelectionState mirrors what the chrome content-script tracks; in
  // the iframe variant we don't have an "edited" flag yet, so 'locked' is
  // correct unless we're mid-inline-text-edit.
  const state = inlineTextActive ? 'editing' : 'locked';
  overlay.showSelection(rect, activePending?.target.label ?? '', state);
}
function onViewportChange(): void {
  if (viewportRaf) return;
  viewportRaf = window.requestAnimationFrame(() => {
    viewportRaf = 0;
    if (refineEnabled && overlay && currentHover && document.contains(currentHover)) {
      overlay.showHover(currentHover.getBoundingClientRect());
    }
    refreshSelectionOverlay();
  });
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

// Double-click on (or inside) the current selection drills to the inner-most
// text element AND immediately starts inline editing — so the user can pick
// a button, double-click, and start typing the new label without going
// through the panel's "Pick text inside" + "Edit text" buttons.
function onDblClick(ev: MouseEvent): void {
  if (!refineEnabled) return;
  if (inlineTextActive) return;
  if (!selected) return;
  // Only triggers when the dblclick is within the current selection.
  const el = document.elementFromPoint(ev.clientX, ev.clientY);
  if (!el || !(el instanceof Element)) return;
  if (!selected.contains(el) && el !== selected) return;

  // If the selection itself IS already a text-bearing leaf (h1, p, span,
  // etc.), drill is a no-op — just start editing.
  let target: Element = selected;
  if (TEXT_TAGS.has(selected.tagName.toLowerCase())) {
    // already at a text element — edit in place
  } else {
    const inner = findInnerTextTarget(selected);
    if (inner) target = inner;
  }
  ev.preventDefault();
  ev.stopPropagation();
  // Re-select onto the inner element if we drilled.
  if (target !== selected) selectRegion(target);
  // Then immediately enter edit mode and broadcast the updated pending so
  // the panel reflects the editing state.
  try {
    startInlineTextEdit();
    if (activePending) {
      postToHost({ ns: PROTOCOL_NAMESPACE, type: 'TARGET_SELECTED', pending: activePending });
    }
  } catch (err) {
    console.warn('[ifl-companion] dblclick → inline edit failed', err);
  }
}

function onKey(ev: KeyboardEvent): void {
  if (!refineEnabled) return;
  if (ev.key === 'Escape') {
    setRefineMode(false);
    broadcastRefineMode(false);
  }
}

// Viewport listeners stay attached for the lifetime of the companion so the
// selection box keeps anchoring during scroll even when picker mode is OFF.
function attachViewportListenersOnce(): void {
  // capture: true so we hear nested scrollers as well; passive: true since
  // we don't preventDefault.
  document.addEventListener('scroll', onViewportChange, { capture: true, passive: true });
  window.addEventListener('resize', onViewportChange, { passive: true });
}
let viewportListenersAttached = false;

function setRefineMode(enabled: boolean): void {
  if (!viewportListenersAttached) {
    attachViewportListenersOnce();
    viewportListenersAttached = true;
  }
  if (refineEnabled === enabled) return;
  refineEnabled = enabled;
  if (enabled) {
    ensureOverlay().showBanner('Refine Mode — click any region · ESC to exit');
    document.documentElement.classList.add('ifl-picking-active');
    document.addEventListener('mousemove', onMouseMove, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('dblclick', onDblClick, true);
    document.addEventListener('keydown', onKey, true);
  } else {
    document.removeEventListener('mousemove', onMouseMove, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('dblclick', onDblClick, true);
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

// Style mutation: applies absolute value, returns the diff that records it.
// If a diff for the same property already exists, the function updates that
// existing diff's `after` instead of pushing a duplicate — this keeps the
// "n drags of a slider = 1 diff" invariant.
function setStyleValue(
  property: 'fontSize' | 'fontWeight' | 'borderRadius' | 'borderWidth' | 'padding',
  value: number,
): StyleChangeDiff | null {
  if (!selected || !activePending || !(selected instanceof HTMLElement) || !originalStyles) return null;

  const formatted = property === 'fontWeight' ? String(value) : `${value}px`;
  if (property === 'fontWeight') {
    selected.style.fontWeight = formatted;
  } else if (property === 'borderRadius') {
    selected.style.borderRadius = formatted;
  } else if (property === 'fontSize') {
    selected.style.fontSize = formatted;
  } else if (property === 'borderWidth') {
    selected.style.borderWidth = formatted;
    // Ensure border has a visible style — the user is asking for a border.
    if (!selected.style.borderStyle && getComputedStyle(selected).borderStyle === 'none') {
      selected.style.borderStyle = 'solid';
    }
  } else if (property === 'padding') {
    selected.style.padding = formatted;
  }

  const before = (originalStyles as Record<typeof property, string>)[property];
  const existing = activePending.diffs.find(
    (d) => d.type === 'style_change' && (d as StyleChangeDiff).property === property,
  ) as StyleChangeDiff | undefined;
  if (existing) {
    existing.after = formatted;
    return existing;
  }
  return {
    id: diffId(),
    type: 'style_change',
    property: property as StyleProperty,
    selector: activePending.target.selector,
    target: activePending.target.label,
    createdAt: nowIso(),
    before,
    after: formatted,
  };
}

function setColorValue(role: ColorRole, value: string): ColorChangeDiff | null {
  if (!selected || !activePending || !(selected instanceof HTMLElement) || !originalStyles) return null;

  if (role === 'color') {
    selected.style.color = value;
  } else if (role === 'backgroundColor') {
    selected.style.backgroundColor = value;
  } else if (role === 'borderColor') {
    selected.style.borderColor = value;
    if (!selected.style.borderStyle && getComputedStyle(selected).borderStyle === 'none') {
      selected.style.borderStyle = 'solid';
    }
    if (!selected.style.borderWidth && getComputedStyle(selected).borderWidth === '0px') {
      selected.style.borderWidth = '1px';
    }
  }

  const before = (originalStyles as Record<ColorRole, string>)[role];
  const existing = activePending.diffs.find(
    (d) => d.type === 'color_change' && (d as ColorChangeDiff).role === role,
  ) as ColorChangeDiff | undefined;
  if (existing) {
    existing.after = value;
    return existing;
  }
  return {
    id: diffId(),
    type: 'color_change',
    role,
    selector: activePending.target.selector,
    target: activePending.target.label,
    createdAt: nowIso(),
    before,
    after: value,
  };
}

// Walk into the current selection looking for the most specific text-bearing
// descendant. Lets the user "drill into" a button or link to address its inner
// text when the picker's LEAF_TAGS guard would otherwise stop them at the
// button itself.
const TEXT_TAGS = new Set([
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'p', 'span', 'a', 'em', 'strong', 'small', 'label', 'li', 'blockquote',
]);
function findInnerTextTarget(root: Element): Element | null {
  // Prefer a descendant whose tag is text-bearing AND has actual text.
  const candidates: Element[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  let node: Element | null = walker.nextNode() as Element | null;
  while (node) {
    if (TEXT_TAGS.has(node.tagName.toLowerCase())) {
      const text = (node as HTMLElement).innerText?.trim();
      if (text && text.length > 0) candidates.push(node);
    }
    node = walker.nextNode() as Element | null;
  }
  if (candidates.length === 0) return null;
  // Prefer the deepest non-empty text node — it's the "most specific."
  candidates.sort((a, b) => depthOf(b) - depthOf(a));
  return candidates[0];
}
function depthOf(el: Element): number {
  let d = 0;
  let n: Element | null = el;
  while (n) {
    d++;
    n = n.parentElement;
  }
  return d;
}

function attachImageReference(
  referenceUrl: string,
): ImageReplaceIntentDiff | null {
  if (!selected || !activePending) return null;
  const img = (selected.tagName.toLowerCase() === 'img'
    ? (selected as HTMLImageElement)
    : (selected.querySelector('img') as HTMLImageElement | null));
  const originalSrc = img?.src;
  // Live preview: if the user gave us a URL and the selection has an <img>,
  // swap its src so they see the change immediately.
  if (img && referenceUrl) {
    img.src = referenceUrl;
  }
  // De-dupe: one image_replace_intent per selector, mutate in place.
  const existing = activePending.diffs.find(
    (d) => d.type === 'image_replace_intent',
  ) as ImageReplaceIntentDiff | undefined;
  if (existing) {
    existing.referenceUrl = referenceUrl;
    existing.appliedToDom = !!img;
    return existing;
  }
  return {
    id: diffId(),
    type: 'image_replace_intent',
    selector: activePending.target.selector,
    target: activePending.target.label,
    createdAt: nowIso(),
    originalSrc,
    referenceKind: 'url',
    referenceUrl,
    appliedToDom: !!img,
  };
}

function markImageRegenerate(prompt?: string): ImageRegenerateIntentDiff | null {
  if (!selected || !activePending) return null;
  const img = (selected.tagName.toLowerCase() === 'img'
    ? (selected as HTMLImageElement)
    : (selected.querySelector('img') as HTMLImageElement | null));
  const originalSrc = img?.src;
  const existing = activePending.diffs.find(
    (d) => d.type === 'image_regenerate_intent',
  ) as ImageRegenerateIntentDiff | undefined;
  if (existing) {
    existing.prompt = prompt;
    return existing;
  }
  return {
    id: diffId(),
    type: 'image_regenerate_intent',
    selector: activePending.target.selector,
    target: activePending.target.label,
    createdAt: nowIso(),
    originalSrc,
    prompt,
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
    if (action.type === 'pick_inner_text') {
      if (!selected) return { ok: false, error: 'no current selection' };
      const inner = findInnerTextTarget(selected);
      if (!inner) {
        return { ok: false, error: 'no inner text element to drill into' };
      }
      // Re-select onto the inner element. selectRegion will broadcast a
      // fresh TARGET_SELECTED so the panel resets its state for the new
      // (deeper) target.
      selectRegion(inner);
      return { ok: true, pending: activePending };
    }
    if (action.type === 'attach_image_reference') {
      // v1 only handles url-kind. note / figma / upload are ignored — the
      // panel doesn't expose them yet.
      if (action.referenceKind !== 'url' || !action.referenceUrl) {
        return { ok: false, error: 'only url-kind image references supported in v1' };
      }
      const diff = attachImageReference(action.referenceUrl);
      if (diff && activePending) {
        const idx = activePending.diffs.findIndex((d) => d.id === diff.id);
        if (idx === -1) activePending.diffs = [...activePending.diffs, diff];
      }
      return { ok: true, pending: activePending };
    }
    if (action.type === 'mark_image_regenerate') {
      const diff = markImageRegenerate(action.prompt);
      if (diff && activePending) {
        const idx = activePending.diffs.findIndex((d) => d.id === diff.id);
        if (idx === -1) activePending.diffs = [...activePending.diffs, diff];
      }
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
    if (action.type === 'set_style_value') {
      const diff = setStyleValue(action.property, action.value);
      if (diff && activePending) {
        const idx = activePending.diffs.findIndex((d) => d.id === diff.id);
        if (idx === -1) activePending.diffs = [...activePending.diffs, diff];
      }
      return { ok: true, pending: activePending };
    }
    if (action.type === 'set_color_value') {
      const diff = setColorValue(action.role, action.value);
      if (diff && activePending) {
        const idx = activePending.diffs.findIndex((d) => d.id === diff.id);
        if (idx === -1) activePending.diffs = [...activePending.diffs, diff];
      }
      return { ok: true, pending: activePending };
    }
    if (action.type === 'reset_pending_selection') {
      // Optionally revert all diffs on the selection before clearing.
      if (action.revert && activePending) revertDiffs(activePending.diffs);
      selected = null;
      activePending = null;
      originalStyles = null;
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
      } else if (diff.type === 'style_change') {
        if (!(node instanceof HTMLElement)) continue;
        // Restore the inline style to what it was *before* we started
        // mutating. The captured `before` value comes from getComputedStyle,
        // so writing it back as inline-style is functionally equivalent and
        // is what matches the panel's "before" string.
        if (diff.property === 'fontSize') node.style.fontSize = diff.before;
        else if (diff.property === 'fontWeight') node.style.fontWeight = diff.before;
        else if (diff.property === 'borderRadius') node.style.borderRadius = diff.before;
        else if (diff.property === 'borderWidth') node.style.borderWidth = diff.before;
        else if (diff.property === 'padding') node.style.padding = diff.before;
        // translate / width / height not used by panel v1 — leave alone
      } else if (diff.type === 'color_change') {
        if (!(node instanceof HTMLElement)) continue;
        if (diff.role === 'color') node.style.color = diff.before;
        else if (diff.role === 'backgroundColor') node.style.backgroundColor = diff.before;
        else if (diff.role === 'borderColor') node.style.borderColor = diff.before;
      }
      // Other diff types (reorder, move, image_*) are no-op in v1.
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
