import type { ExtensionMessage } from '../shared/messages';
import type { DirectEditAction, EditDiff, PendingSelection } from '../shared/types';
import { nowIso, uid } from '../shared/utils';
import {
  buildSelectedTarget,
  describeChildren,
  describeEditableTextTarget,
  findImageTarget,
  generateSelector,
  getEditableTextElements,
  getElementTextValue,
  pickMeaningfulTarget,
  pickStableTarget,
  resolveSelectedElement,
  walkToChildBlock,
  walkToParentBlock,
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
  // When a selection is live we stop painting hover so the UI doesn't jitter
  // over nested siblings. Explicit unlock (R key) returns to hover picking.
  let selectionLocked = false;
  let inlineTextMode = false;
  let textOriginals = new Map<HTMLElement, string>();
  // Snapshot of any <img> we replaced for live preview, keyed by the img.
  // Includes any <picture><source> srcsets we had to clear so the browser
  // wouldn't override our direct src assignment.
  type ImageSnapshot = {
    src: string;
    srcset: string | null;
    pictureSources: { el: HTMLSourceElement; srcset: string | null }[];
  };
  let imageOriginals = new Map<HTMLImageElement, ImageSnapshot>();
  let originalParent: Element | null = null;
  let originalNextSibling: ChildNode | null = null;
  let originalDisplay = '';
  let refreshFrame = 0;

  const REFINE_BANNER =
    'Refine — click a region · [ / ] cycle parent·child · R reselect · ESC exit';
  const SELECTION_BANNER =
    'Selected — [ / ] parent·child · R reselect · Option+↑↓ also cycle · ESC exit';

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
  if (selectionLocked) {
    // Keep the selection box stable; drop any leftover hover outline.
    if (currentHover) {
      overlay.hideHover();
      currentHover = null;
    }
    return;
  }
  const raw = elementFromEvent(event);
  const target = pickStableTarget(raw, currentHover);
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

  // Clicking always re-selects, even when the previous selection is locked.
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
    return;
  }

  // Cycling: bracket keys (no modifier) or Option+Arrow. Only meaningful when
  // a selection exists — otherwise there's nothing to cycle from.
  const wantsParent =
    event.key === '[' || (event.altKey && event.key === 'ArrowUp');
  const wantsChild =
    event.key === ']' || (event.altKey && event.key === 'ArrowDown');
  const wantsUnlock = event.key === 'r' || event.key === 'R';

  if (!activePending || !selectionVisible) return;

  if (wantsParent) {
    event.preventDefault();
    event.stopImmediatePropagation();
    cycleSelection('parent');
    return;
  }
  if (wantsChild) {
    event.preventDefault();
    event.stopImmediatePropagation();
    cycleSelection('child');
    return;
  }
  if (wantsUnlock) {
    event.preventDefault();
    event.stopImmediatePropagation();
    selectionLocked = false;
    overlay?.showBanner(REFINE_BANNER);
  }
  }

  function setRefineEnabled(enabled: boolean, opts: { keepSelection?: boolean } = {}) {
  if (refineEnabled === enabled) return;
  refineEnabled = enabled;
  if (enabled) {
    overlay = overlay ?? createOverlay();
    overlay.showBanner(selectionVisible ? SELECTION_BANNER : REFINE_BANNER);
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
      selectionLocked = false;
      overlay?.hideSelection();
    }
    currentHover = null;
  }
  }

  function cycleSelection(direction: 'parent' | 'child') {
  if (!activePending) return;
  const current = resolveCurrentSelection();
  if (!current) return;

  const next =
    direction === 'parent' ? walkToParentBlock(current) : walkToChildBlock(current);
  if (!next || next === current) {
    overlay?.showBanner(
      direction === 'parent'
        ? 'No wider block available — already at the outermost meaningful region.'
        : 'No nested block inside this region to cycle into.',
    );
    return;
  }

  // Preserve already-captured diffs — cycling only re-scopes the region label
  // and bounding box; the existing edits stay attached to the pending item.
  const target = buildSelectedTarget(next);
  selectedElement = next;
  originalParent = next.parentElement;
  originalNextSibling = next.nextSibling;
  originalDisplay = (next as HTMLElement).style.display;

  activePending = { ...activePending, target };
  selectionVisible = true;
  selectionLocked = true;
  overlay?.showSelection(next.getBoundingClientRect(), target.label);
  overlay?.hideHover();
  overlay?.showBanner(SELECTION_BANNER);
  currentHover = null;

  chrome.runtime
    .sendMessage({
      type: 'TARGET_SELECTED',
      payload: activePending,
    } satisfies ExtensionMessage)
    .catch(() => {});
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

  if (action.type === 'attach_image_reference') {
    return attachImageReference(element, action);
  }

  if (action.type === 'mark_image_regenerate') {
    return markImageRegenerate(element, action);
  }

  if (action.type === 'clear_image_intent') {
    return clearImageIntent();
  }

  return { ok: false, error: 'Unsupported action.' };
  }

  function attachImageReference(
  element: Element,
  action: Extract<DirectEditAction, { type: 'attach_image_reference' }>,
  ) {
  const img = findImageTarget(element);
  const originalSrc = img?.currentSrc || img?.src || undefined;
  const targetLabel = activePending?.target.label ?? 'selected region';

  const url = action.referenceUrl?.trim();
  const note = action.referenceNote?.trim();
  const dataUrl = action.dataUrl;

  const hasReference =
    (action.referenceKind === 'upload' && dataUrl) ||
    ((action.referenceKind === 'url' || action.referenceKind === 'figma') && url) ||
    (action.referenceKind === 'note' && note);

  if (!hasReference) {
    return {
      ok: false,
      error: 'Provide a URL, Figma link, uploaded image, or note before attaching.',
    };
  }

  // Restore any previous image replacement — a new attach always replaces the
  // previous intent cleanly, even if the user switched reference kinds.
  restoreReplacedImages();

  let appliedToDom = false;
  const livePreviewSrc =
    action.referenceKind === 'upload'
      ? dataUrl
      : action.referenceKind === 'url'
        ? url
        : null;

  if (livePreviewSrc && img) {
    replaceImageSrc(img, livePreviewSrc);
    appliedToDom = true;
  }

  updatePendingDiffs((diffs) => {
    const existing = diffs.find((diff) => diff.type === 'image_replace_intent');
    const next: EditDiff[] = diffs.filter(
      (diff) => diff.type !== 'image_replace_intent' && diff.type !== 'image_regenerate_intent',
    );
    next.push({
      id: existing?.id ?? uid(),
      type: 'image_replace_intent',
      selector: generateSelector(img ?? element),
      target: targetLabel,
      originalSrc,
      referenceKind: action.referenceKind,
      referenceUrl: url || undefined,
      referenceNote: note || undefined,
      dataUrl: action.referenceKind === 'upload' ? dataUrl : undefined,
      fileName: action.fileName,
      fileSize: action.fileSize,
      mimeType: action.mimeType,
      appliedToDom,
      createdAt: existing?.createdAt ?? nowIso(),
    });
    return next;
  });

  overlay?.showBanner(
    appliedToDom
      ? 'Image replaced in preview — intent captured.'
      : 'Replace-image intent captured (no live preview for this reference kind).',
  );
  return { ok: true, pending: activePending };
  }

  function replaceImageSrc(img: HTMLImageElement, nextSrc: string): void {
  if (!imageOriginals.has(img)) {
    const snapshot: ImageSnapshot = {
      src: img.getAttribute('src') ?? '',
      srcset: img.getAttribute('srcset'),
      pictureSources: [],
    };
    const picture = img.closest('picture');
    if (picture) {
      picture.querySelectorAll('source').forEach((source) => {
        snapshot.pictureSources.push({
          el: source,
          srcset: source.getAttribute('srcset'),
        });
      });
    }
    imageOriginals.set(img, snapshot);
  }

  // Clear srcset / picture sources so the browser honors our direct .src.
  img.removeAttribute('srcset');
  const picture = img.closest('picture');
  if (picture) {
    picture.querySelectorAll('source').forEach((source) => {
      source.removeAttribute('srcset');
    });
  }
  img.src = nextSrc;
  }

  function restoreReplacedImages(): void {
  for (const [img, snap] of imageOriginals.entries()) {
    try {
      if (!document.contains(img)) continue;
      for (const { el, srcset } of snap.pictureSources) {
        if (!document.contains(el)) continue;
        if (srcset === null) el.removeAttribute('srcset');
        else el.setAttribute('srcset', srcset);
      }
      if (snap.srcset === null) img.removeAttribute('srcset');
      else img.setAttribute('srcset', snap.srcset);
      img.src = snap.src;
    } catch (err) {
      console.warn('[IFL] image restore failed', err);
    }
  }
  imageOriginals.clear();
  }

  function markImageRegenerate(
  element: Element,
  action: Extract<DirectEditAction, { type: 'mark_image_regenerate' }>,
  ) {
  const img = findImageTarget(element);
  const originalSrc = img?.currentSrc || img?.src || undefined;
  const targetLabel = activePending?.target.label ?? 'selected region';

  updatePendingDiffs((diffs) => {
    const existing = diffs.find((diff) => diff.type === 'image_regenerate_intent');
    const next: EditDiff[] = diffs.filter(
      (diff) => diff.type !== 'image_regenerate_intent' && diff.type !== 'image_replace_intent',
    );
    next.push({
      id: existing?.id ?? uid(),
      type: 'image_regenerate_intent',
      selector: generateSelector(img ?? element),
      target: targetLabel,
      originalSrc,
      prompt: action.prompt?.trim() || undefined,
      createdAt: existing?.createdAt ?? nowIso(),
    });
    return next;
  });

  overlay?.showBanner('Regenerate-image intent captured — image itself is unchanged.');
  return { ok: true, pending: activePending };
  }

  function clearImageIntent() {
  restoreReplacedImages();
  updatePendingDiffs((diffs) =>
    diffs.filter(
      (diff) =>
        diff.type !== 'image_replace_intent' && diff.type !== 'image_regenerate_intent',
    ),
  );
  return { ok: true, pending: activePending };
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
  selectionLocked = true;
  originalParent = picked.parentElement;
  originalNextSibling = picked.nextSibling;
  originalDisplay = (picked as HTMLElement).style.display;

  overlay?.showSelection(picked.getBoundingClientRect(), target.label);
  overlay?.hideHover();
  overlay?.showBanner(SELECTION_BANNER);
  currentHover = null;

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

    restoreReplacedImages();
  } else {
    // Keep the current preview visible but drop our snapshot so a future
    // pending session doesn't accidentally restore someone else's img.
    imageOriginals.clear();
  }

  textOriginals.clear();
  activePending = null;
  selectedElement = null;
  selectionVisible = false;
  selectionLocked = false;
  originalParent = null;
  originalNextSibling = null;
  originalDisplay = '';
  overlay?.hideSelection();
  if (refineEnabled) {
    overlay?.showBanner(REFINE_BANNER);
  } else {
    overlay?.hideBanner();
  }
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
