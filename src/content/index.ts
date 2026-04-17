import type { ExtensionMessage } from '../shared/messages';
import type { DirectEditAction, EditDiff, PendingSelection } from '../shared/types';
import { nowIso, uid } from '../shared/utils';
import {
  buildSelectedTarget,
  describeChildren,
  describeEditableTextTarget,
  generateSelector,
  getEditableTextElements,
  getElementTextValue,
  pickMeaningfulTarget,
  resolveSelectedElement,
} from './dom';
import { createOverlay, OVERLAY_IDS, type OverlayHandles } from './overlay';

const globalState = globalThis as typeof globalThis & {
  __iflContentScriptInitialized__?: boolean;
};

if (!globalState.__iflContentScriptInitialized__) {
  globalState.__iflContentScriptInitialized__ = true;

  let refineEnabled = false;
  let overlay: OverlayHandles | null = null;
  let currentHover: Element | null = null;

  let activePending: PendingSelection | null = null;
  let selectedElement: Element | null = null;
  let selectionVisible = false;
  let inlineTextMode = false;
  let textOriginals = new Map<HTMLElement, string>();
  let originalParent: Element | null = null;
  let originalNextSibling: ChildNode | null = null;
  let originalDisplay = '';
  let refreshFrame = 0;

  function isOverlayNode(el: Element | null): boolean {
    if (!el) return false;
    const id = el.id;
    return id === OVERLAY_IDS.hover || id === OVERLAY_IDS.selection || id === OVERLAY_IDS.banner;
  }

  function elementFromEvent(event: PointerEvent): Element | null {
    const el = document.elementFromPoint(event.clientX, event.clientY);
    if (isOverlayNode(el)) return null;
    return el;
  }

  function onPointerMove(event: PointerEvent) {
  if (!refineEnabled || !overlay) return;
  const raw = elementFromEvent(event);
  const target = pickMeaningfulTarget(raw);
  if (!target) {
    overlay.hideHover();
    currentHover = null;
    return;
  }
  if (target === currentHover) return;
  currentHover = target;
  overlay.showHover(target.getBoundingClientRect());
  }

  function onClickCapture(event: MouseEvent) {
  if (!refineEnabled) return;
  event.preventDefault();
  event.stopImmediatePropagation();

  const raw = document.elementFromPoint(event.clientX, event.clientY) ?? currentHover ?? null;
  const picked = pickMeaningfulTarget(isOverlayNode(raw) ? null : raw);
  if (!picked) return;
  selectRegion(picked, { revertPreviousPending: true, disableRefineMode: false });
  }

  function onKeyDown(event: KeyboardEvent) {
  if (!refineEnabled) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopImmediatePropagation();
    setRefineEnabled(false);
    chrome.runtime
      .sendMessage({ type: 'SET_REFINE_MODE', enabled: false } satisfies ExtensionMessage)
      .catch(() => {});
  }
  }

  function setRefineEnabled(enabled: boolean, opts: { keepSelection?: boolean } = {}) {
  if (refineEnabled === enabled) return;
  refineEnabled = enabled;
  if (enabled) {
    overlay = overlay ?? createOverlay();
    overlay.showBanner();
    document.documentElement.classList.add('ifl-refine-mode');
    window.addEventListener('pointermove', onPointerMove, true);
    window.addEventListener('click', onClickCapture, true);
    window.addEventListener('keydown', onKeyDown, true);
  } else {
    window.removeEventListener('pointermove', onPointerMove, true);
    window.removeEventListener('click', onClickCapture, true);
    window.removeEventListener('keydown', onKeyDown, true);
    document.documentElement.classList.remove('ifl-refine-mode');
    overlay?.hideBanner();
    overlay?.hideHover();
    if (!opts.keepSelection) {
      selectionVisible = false;
      overlay?.hideSelection();
    }
    currentHover = null;
  }
  }

  function applyDirectEdit(action: DirectEditAction) {
  if (action.type === 'reset_pending_selection') {
    resetSessionState({ revertPreview: action.revert !== false });
    return { ok: true, pending: null };
  }

  const element = resolveCurrentSelection();
  if (!element || !activePending) {
    return { ok: false, error: 'No selected region found on the page.' };
  }

  if (action.type === 'start_inline_text_edit') {
    return startInlineTextEdit(element);
  }

  if (action.type === 'stop_inline_text_edit') {
    stopInlineTextEdit();
    return { ok: true, pending: activePending };
  }

  stopInlineTextEdit();

  if (action.type === 'hide_selected') {
    applyVisibilityChange(element, 'hide');
    return { ok: true, pending: activePending };
  }

  if (action.type === 'remove_selected') {
    applyVisibilityChange(element, 'remove');
    return { ok: true, pending: activePending };
  }

  if (action.type === 'reorder_selected') {
    return reorderSelectedElement(element, action.direction);
  }

  return { ok: false, error: 'Unsupported action.' };
  }

  function startInlineTextEdit(element: Element) {
  const editableElements = getEditableTextElements(element);
  if (editableElements.length === 0) {
    return { ok: false, error: 'No editable text nodes found in the selected region.' };
  }

  stopInlineTextEdit();
  inlineTextMode = true;
  selectionVisible = true;
  refreshSelectionOverlay();
  overlay?.showBanner(
    'Inline Text Edit — click text inside the selected region, edit it, then click away to capture the diff',
  );

  const nextOriginals = new Map(textOriginals);
  editableElements.forEach((node) => {
    if (!nextOriginals.has(node)) {
      nextOriginals.set(node, getElementTextValue(node));
    }
  });
  textOriginals = nextOriginals;

  editableElements.forEach((node) => {
    node.setAttribute('contenteditable', 'true');
    node.setAttribute('spellcheck', 'true');
    node.classList.add(OVERLAY_IDS.inlineEditable);
  });

  window.addEventListener('focusin', onInlineFocus, true);
  window.addEventListener('focusout', onInlineBlur, true);
  window.addEventListener('keydown', onInlineEditorKeyDown, true);

  return { ok: true, pending: activePending };
  }

  function stopInlineTextEdit() {
  if (!inlineTextMode) return;
  inlineTextMode = false;
  window.removeEventListener('focusin', onInlineFocus, true);
  window.removeEventListener('focusout', onInlineBlur, true);
  window.removeEventListener('keydown', onInlineEditorKeyDown, true);

  for (const node of textOriginals.keys()) {
    node.removeAttribute('contenteditable');
    node.removeAttribute('spellcheck');
    node.classList.remove(OVERLAY_IDS.inlineEditable, OVERLAY_IDS.inlineEditing);
  }

  overlay?.hideBanner();
  }

  function onInlineFocus(event: FocusEvent) {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  if (!textOriginals.has(target)) return;
  target.classList.add(OVERLAY_IDS.inlineEditing);
  }

  function onInlineBlur(event: FocusEvent) {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  if (!textOriginals.has(target)) return;
  target.classList.remove(OVERLAY_IDS.inlineEditing);
  captureTextDiff(target);
  }

  function onInlineEditorKeyDown(event: KeyboardEvent) {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  if (!textOriginals.has(target)) return;

  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    target.blur();
  }

  if (event.key === 'Escape') {
    event.preventDefault();
    const original = textOriginals.get(target);
    if (original != null) {
      target.innerText = original;
    }
    target.blur();
  }
  }

  function captureTextDiff(element: HTMLElement) {
  if (!activePending) return;
  const before = textOriginals.get(element);
  if (before == null) return;
  const after = getElementTextValue(element);
  const diffTarget = describeEditableTextTarget(activePending.target.label, element);

  updatePendingDiffs((diffs) => {
    const next = diffs.filter(
      (diff) => !(diff.type === 'text_change' && diff.target === diffTarget),
    );

    if (after === before) {
      return next;
    }

    next.push({
      id: uid(),
      type: 'text_change',
      selector: generateSelector(element),
      target: diffTarget,
      before,
      after,
      createdAt: nowIso(),
    });
    return next;
  });
  }

  function applyVisibilityChange(element: Element, type: 'hide' | 'remove') {
  const htmlElement = element as HTMLElement;
  const targetLabel = activePending?.target.label ?? 'selected region';
  htmlElement.style.display = 'none';
  selectionVisible = false;
  overlay?.hideSelection();
  overlay?.showBanner(
    type === 'hide'
      ? 'Region hidden locally — the diff is stored in the panel'
      : 'Region removed locally — the diff is stored in the panel',
  );

  updatePendingDiffs((diffs) => {
    const existing = diffs.find(
      (diff) => diff.type === 'hide' || diff.type === 'remove',
    );
    const next: EditDiff[] = diffs.filter(
      (diff) => diff.type !== 'hide' && diff.type !== 'remove',
    );
    next.push({
      id: existing?.id ?? uid(),
      type,
      selector: activePending?.target.selector ?? generateSelector(element),
      target: targetLabel,
      createdAt: existing?.createdAt ?? nowIso(),
    });
    return next;
  });
  }

  function reorderSelectedElement(element: Element, direction: 'up' | 'down') {
  const parent = element.parentElement;
  if (!parent || !activePending) {
    return { ok: false, error: 'The selected block cannot be reordered.' };
  }
  const targetLabel = activePending.target.label;

  const siblings = Array.from(parent.children);
  const index = siblings.indexOf(element);
  if (index < 0) return { ok: false, error: 'The selected block is no longer in its parent.' };

  const before = describeChildren(parent);

  if (direction === 'up') {
    if (index === 0) return { ok: false, error: 'The selected block is already first.' };
    parent.insertBefore(element, siblings[index - 1]);
  } else {
    if (index === siblings.length - 1) {
      return { ok: false, error: 'The selected block is already last.' };
    }
    parent.insertBefore(element, siblings[index + 2] ?? null);
  }

  const after = describeChildren(parent);
  selectionVisible = true;
  refreshSelectionOverlay();

  updatePendingDiffs((diffs) => {
    const existing = diffs.find((diff) => diff.type === 'reorder');
    const next: EditDiff[] = diffs.filter((diff) => diff.type !== 'reorder');
    next.push({
      id: existing?.id ?? uid(),
      type: 'reorder',
      selector: generateSelector(parent),
      target: targetLabel,
      before: existing?.type === 'reorder' ? existing.before : before,
      after,
      createdAt: existing?.createdAt ?? nowIso(),
    });
    return next;
  });

  return { ok: true, pending: activePending };
  }

  function updatePendingDiffs(updater: (diffs: EditDiff[]) => EditDiff[]) {
  if (!activePending) return;
  activePending = { ...activePending, diffs: updater(activePending.diffs) };
  }

  function refreshSelectionOverlay() {
  const element = resolveCurrentSelection();
  if (!element || !activePending) return;
  if (!selectionVisible) {
    overlay?.hideSelection();
    return;
  }
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {
    overlay?.hideSelection();
    return;
  }
  overlay?.showSelection(rect, activePending.target.label);
  }

  function resolveCurrentSelection(): Element | null {
  if (selectedElement && document.contains(selectedElement)) {
    return selectedElement;
  }
  if (!activePending) return null;
  const resolved = resolveSelectedElement(activePending.target);
  if (resolved) selectedElement = resolved;
  return resolved;
  }

  function onDocumentClick(event: MouseEvent) {
  if (refineEnabled || inlineTextMode || !activePending || !selectionVisible) return;
  const target = event.target;
  if (!(target instanceof Node)) return;

  const element = resolveCurrentSelection();
  if (!element) {
    selectionVisible = false;
    overlay?.hideSelection();
    return;
  }

  if (element.contains(target)) {
    selectionVisible = true;
    refreshSelectionOverlay();
    return;
  }

  const targetElement =
    target instanceof Element
      ? pickMeaningfulTarget(isOverlayNode(target) ? null : target)
      : pickMeaningfulTarget(target.parentElement);

  if (targetElement && targetElement !== element) {
    event.preventDefault();
    event.stopImmediatePropagation();
    selectRegion(targetElement, {
      revertPreviousPending: true,
      disableRefineMode: false,
    });
    return;
  }

  selectionVisible = false;
  overlay?.hideSelection();
  }

  function onViewportChange() {
  if (refreshFrame) return;
  refreshFrame = window.requestAnimationFrame(() => {
    refreshFrame = 0;
    if (refineEnabled && overlay && currentHover && document.contains(currentHover)) {
      overlay.showHover(currentHover.getBoundingClientRect());
    }
    refreshSelectionOverlay();
  });
  }

  function selectRegion(
  picked: Element,
  opts: { revertPreviousPending: boolean; disableRefineMode: boolean },
  ) {
  resetSessionState({ revertPreview: opts.revertPreviousPending });

  const target = buildSelectedTarget(picked);
  const payload: PendingSelection = {
    tabId: -1,
    pageUrl: location.href,
    pageTitle: document.title,
    target,
    diffs: [],
    capturedAt: nowIso(),
  };

  selectedElement = picked;
  activePending = payload;
  selectionVisible = true;
  originalParent = picked.parentElement;
  originalNextSibling = picked.nextSibling;
  originalDisplay = (picked as HTMLElement).style.display;

  overlay?.showSelection(picked.getBoundingClientRect(), target.label);
  overlay?.hideHover();

  chrome.runtime
    .sendMessage({ type: 'TARGET_SELECTED', payload } satisfies ExtensionMessage)
    .catch((err) => console.warn('[IFL] TARGET_SELECTED send failed', err));

  if (opts.disableRefineMode) {
    setRefineEnabled(false, { keepSelection: true });
  }
  }

  function resetSessionState(opts: { revertPreview: boolean }) {
  stopInlineTextEdit();

  if (opts.revertPreview) {
    for (const [element, originalText] of textOriginals.entries()) {
      if (document.contains(element)) {
        element.innerText = originalText;
      }
    }

    const element = resolveCurrentSelection();
    if (element instanceof HTMLElement) {
      element.style.display = originalDisplay;
      if (originalParent) {
        originalParent.insertBefore(element, originalNextSibling);
      }
    }
  }

  textOriginals.clear();
  activePending = null;
  selectedElement = null;
  selectionVisible = false;
  originalParent = null;
  originalNextSibling = null;
  originalDisplay = '';
  overlay?.hideSelection();
  overlay?.hideBanner();
  }

  chrome.runtime.onMessage.addListener((msg: ExtensionMessage, _sender, sendResponse) => {
    if (msg.type === 'SET_REFINE_MODE') {
      setRefineEnabled(msg.enabled);
      sendResponse({ ok: true });
      return;
    }

    if (msg.type === 'APPLY_DIRECT_EDIT') {
      sendResponse(applyDirectEdit(msg.action));
    }
  });

  window.addEventListener('click', onDocumentClick, true);
  window.addEventListener('resize', onViewportChange, true);
  document.addEventListener('scroll', onViewportChange, true);
}
