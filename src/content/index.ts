import type { ExtensionMessage } from '../shared/messages';
import { buildSelectedTarget, pickMeaningfulTarget } from './dom';
import { createOverlay, OVERLAY_IDS, type OverlayHandles } from './overlay';
import { nowIso } from '../shared/utils';
import {
  applyBlockAction,
  clearAllEdits,
  endTextEdit,
  revertDiff,
  startTextEdit,
} from './edits';

let refineEnabled = false;
let overlay: OverlayHandles | null = null;
let currentHover: Element | null = null;

function isOverlayNode(el: Element | null): boolean {
  if (!el) return false;
  const id = el.id;
  return id === OVERLAY_IDS.hover || id === OVERLAY_IDS.selection || id === OVERLAY_IDS.banner;
}

function elementFromEvent(event: PointerEvent): Element | null {
  // elementFromPoint honors `pointer-events: none`, so our overlays are skipped.
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

  // Re-pick under the click coordinates in case currentHover is stale.
  const raw =
    document.elementFromPoint(event.clientX, event.clientY) ?? currentHover ?? null;
  const picked = pickMeaningfulTarget(isOverlayNode(raw) ? null : raw);
  if (!picked) return;

  const target = buildSelectedTarget(picked);
  overlay?.showSelection(picked.getBoundingClientRect(), target.label);
  overlay?.hideHover();

  const payload = {
    pageUrl: location.href,
    pageTitle: document.title,
    target,
    capturedAt: nowIso(),
    diffs: [],
  };

  chrome.runtime
    .sendMessage({ type: 'TARGET_SELECTED', payload } satisfies ExtensionMessage)
    .catch((err) => console.warn('[IFL] TARGET_SELECTED send failed', err));

  setRefineEnabled(false, { keepSelection: true });
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
    if (!opts.keepSelection) overlay?.hideSelection();
    currentHover = null;
  }
}

chrome.runtime.onMessage.addListener((msg: ExtensionMessage, _sender, sendResponse) => {
  if (msg.type === 'SET_REFINE_MODE') {
    setRefineEnabled(msg.enabled);
    sendResponse({ ok: true });
    return;
  }
  if (msg.type === 'START_TEXT_EDIT') {
    sendResponse(startTextEdit(msg.selector));
    return;
  }
  if (msg.type === 'END_TEXT_EDIT') {
    sendResponse({ ok: true, ...endTextEdit(msg.commit) });
    return;
  }
  if (msg.type === 'BLOCK_ACTION') {
    sendResponse(applyBlockAction(msg.selector, msg.action));
    return;
  }
  if (msg.type === 'REVERT_DIFF') {
    sendResponse({ ok: revertDiff(msg.diffId) });
    return;
  }
  if (msg.type === 'CLEAR_ALL_EDITS') {
    clearAllEdits();
    sendResponse({ ok: true });
    return;
  }
});
