import type { ExtensionMessage } from '../shared/messages';
import type { DirectEditAction, EditDiff, PendingSelection } from '../shared/types';
import { nowIso, uid } from '../shared/utils';
import {
  buildSelectedTarget,
  describeChildren,
  describeEditableTextTarget,
  findEditableTextLeafAt,
  findImageTarget,
  generateSelector,
  getEditableTextElements,
  getElementTextValue,
  labelTarget,
  pickMeaningfulTarget,
  pickStableTarget,
  resolveSelectedElement,
  walkToChildBlock,
  walkToParentBlock,
  walkToSiblingBlock,
} from './dom';
import { STORAGE_KEYS } from '../shared/types';
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
  // Snapshot of inline style values for every element we've style-adjusted in
  // the preview, so "Discard" puts the DOM back exactly as it was.
  type StyleSnapshot = {
    transform: string;
    fontSize: string;
    borderRadius: string;
    width: string;
    height: string;
    computedFontSize: number;
    computedBorderRadius: number;
    computedWidth: number;
    computedHeight: number;
    translateX: number;
    translateY: number;
  };
  let styleOriginals = new Map<HTMLElement, StyleSnapshot>();
  let originalParent: Element | null = null;
  let originalNextSibling: ChildNode | null = null;
  let originalDisplay = '';
  let refreshFrame = 0;

  const POSITION_STEP = 4;
  const FONT_SIZE_STEP = 1;
  const BORDER_RADIUS_STEP = 2;
  const SIZE_STEP = 8;

  const REFINE_BANNER =
    'Refine — hold ⌘ (or Ctrl) and click a region · ESC exit';
  const SELECTION_BANNER =
    'Locked — ↑ parent · ↓ child · ← prev · → next · R reselect · ESC exit';

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

  // Modifier-held = "picking mode". Without it, refine mode is passive so the
  // user can still interact with the page normally (click buttons, drag text).
  const isPickingModifier = (event: MouseEvent | PointerEvent | KeyboardEvent) =>
    event.metaKey || event.ctrlKey;

  function setPickingClass(active: boolean) {
    document.documentElement.classList.toggle('ifl-picking-active', active);
  }

  // --- Hover reveal pinning ------------------------------------------------
  // Tooltips/popovers disappear as soon as the trigger loses :hover, and many
  // also sit under `pointer-events: none`. When the user Cmd+clicks a trigger
  // we (a) fire synthetic hover events so JS-driven tooltips surface,
  // (b) locate the associated reveal element (aria-describedby /
  // role="tooltip" / popover / dropdown adjacent to trigger), and
  // (c) pin *just that element* with !important inline styles so it stays
  // visible and interactive throughout the edit session. Everything is
  // restored when editing ends, the user exits refine mode, or focus leaves.
  type PinnedFloater = {
    el: HTMLElement;
    prev: { display: string; visibility: string; opacity: string; pointerEvents: string };
  };
  let pinnedFloaters: PinnedFloater[] = [];
  let pinnedFloaterSet = new WeakSet<HTMLElement>();

  function pinElement(el: HTMLElement) {
    if (pinnedFloaterSet.has(el)) return;
    const computed = getComputedStyle(el);
    pinnedFloaters.push({
      el,
      prev: {
        display: el.style.display,
        visibility: el.style.visibility,
        opacity: el.style.opacity,
        pointerEvents: el.style.pointerEvents,
      },
    });
    pinnedFloaterSet.add(el);
    const display = computed.display === 'none' ? 'block' : computed.display;
    const opacity = Number(computed.opacity) > 0 ? computed.opacity : '1';
    el.style.setProperty('display', display, 'important');
    el.style.setProperty('visibility', 'visible', 'important');
    el.style.setProperty('opacity', opacity, 'important');
    el.style.setProperty('pointer-events', 'auto', 'important');
    // Cascades pointer-events:auto and user-select:text to descendants so
    // children that explicitly set pointer-events:none (common on tooltip
    // inner spans) can still receive a caret click.
    el.classList.add('ifl-reveal-pin');
  }

  function unfreezeHoverRevealedElements() {
    for (const { el, prev } of pinnedFloaters) {
      el.style.removeProperty('display');
      el.style.removeProperty('visibility');
      el.style.removeProperty('opacity');
      el.style.removeProperty('pointer-events');
      el.classList.remove('ifl-reveal-pin');
      if (prev.display) el.style.display = prev.display;
      if (prev.visibility) el.style.visibility = prev.visibility;
      if (prev.opacity) el.style.opacity = prev.opacity;
      if (prev.pointerEvents) el.style.pointerEvents = prev.pointerEvents;
    }
    pinnedFloaters = [];
    pinnedFloaterSet = new WeakSet<HTMLElement>();
    removeForceHoverChain();
  }

  // --- Force :hover (DevTools-style) --------------------------------------
  // Mirrors the DevTools "force :hover state" feature: once we've seen the
  // page's stylesheets, we clone every rule containing `:hover` into an
  // equivalent rule keyed on `.ifl-force-hover`. At Cmd+click time we apply
  // that class to the clicked element and all its ancestors so pure-CSS
  // tooltips/popovers stay open regardless of mouse position.
  const FORCE_HOVER_CLASS = 'ifl-force-hover';
  const FORCE_HOVER_STYLE_ID = 'ifl-force-hover-sheet';
  let forceHoverStyleInjected = false;
  let forceHoverAppliedElements: HTMLElement[] = [];

  function injectForceHoverStylesheet() {
    if (forceHoverStyleInjected) return;
    forceHoverStyleInjected = true;
    const clonedRules: string[] = [];
    for (const sheet of Array.from(document.styleSheets)) {
      let rules: CSSRuleList | null = null;
      try {
        rules = sheet.cssRules;
      } catch {
        // Cross-origin stylesheet — inaccessible, skip.
        continue;
      }
      if (rules) collectHoverRules(rules, clonedRules);
    }
    if (clonedRules.length === 0) return;
    const style = document.createElement('style');
    style.id = FORCE_HOVER_STYLE_ID;
    style.textContent = clonedRules.join('\n');
    document.documentElement.appendChild(style);
  }

  function collectHoverRules(rules: CSSRuleList, out: string[]) {
    for (let i = 0; i < rules.length; i++) {
      const rule = rules[i];
      if (rule instanceof CSSStyleRule) {
        if (!rule.selectorText.includes(':hover')) continue;
        const translated = rule.selectorText
          .split(',')
          .map((part) => part.replace(/:hover\b/g, `.${FORCE_HOVER_CLASS}`))
          .join(', ');
        const body = rule.style.cssText;
        if (body) out.push(`${translated} { ${body} }`);
      } else if (rule instanceof CSSMediaRule) {
        const inner: string[] = [];
        collectHoverRules(rule.cssRules, inner);
        if (inner.length > 0) out.push(`@media ${rule.media.mediaText} { ${inner.join('\n')} }`);
      } else if (typeof CSSSupportsRule !== 'undefined' && rule instanceof CSSSupportsRule) {
        const inner: string[] = [];
        collectHoverRules(rule.cssRules, inner);
        if (inner.length > 0) out.push(`@supports ${rule.conditionText} { ${inner.join('\n')} }`);
      }
    }
  }

  function applyForceHoverChain(el: Element) {
    injectForceHoverStylesheet();
    let cur: Element | null = el;
    while (cur && cur !== document.documentElement) {
      if (cur instanceof HTMLElement && !cur.classList.contains(FORCE_HOVER_CLASS)) {
        cur.classList.add(FORCE_HOVER_CLASS);
        forceHoverAppliedElements.push(cur);
      }
      cur = cur.parentElement;
    }
  }

  function removeForceHoverChain() {
    for (const el of forceHoverAppliedElements) {
      el.classList.remove(FORCE_HOVER_CLASS);
    }
    forceHoverAppliedElements = [];
  }

  function isElementVisible(el: HTMLElement): boolean {
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return false;
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden') return false;
    if (Number(s.opacity) < 0.05) return false;
    return true;
  }

  function snapshotVisibleFloaters(): Set<HTMLElement> {
    const set = new Set<HTMLElement>();
    if (!document.body) return set;
    for (const el of document.body.querySelectorAll<HTMLElement>('*')) {
      if (isOverlayNode(el) || (el.id && el.id.startsWith('ifl-'))) continue;
      const s = getComputedStyle(el);
      if (s.position !== 'absolute' && s.position !== 'fixed') continue;
      if (s.display === 'none' || s.visibility === 'hidden') continue;
      if (Number(s.opacity) < 0.05) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) continue;
      set.add(el);
    }
    return set;
  }

  function pickNewlyVisibleReveal(
    before: Set<HTMLElement>,
    trigger: Element,
  ): HTMLElement | null {
    const after = snapshotVisibleFloaters();
    const triggerRect = trigger.getBoundingClientRect();
    const tx = triggerRect.left + triggerRect.width / 2;
    const ty = triggerRect.top + triggerRect.height / 2;
    let best: HTMLElement | null = null;
    let bestScore = Infinity;
    for (const el of after) {
      if (before.has(el)) continue;
      if (trigger.contains(el) || el.contains(trigger)) continue;
      const r = el.getBoundingClientRect();
      if (r.width >= window.innerWidth * 0.9 && r.height >= window.innerHeight * 0.9) continue;
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const dist = Math.hypot(cx - tx, cy - ty);
      if (dist < bestScore) {
        bestScore = dist;
        best = el;
      }
    }
    return best;
  }

  function triggerHoverOn(el: Element) {
    if (!(el instanceof HTMLElement)) return;
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const base = { bubbles: true, cancelable: true, clientX: cx, clientY: cy } as const;
    try {
      el.dispatchEvent(new PointerEvent('pointerover', { ...base, pointerType: 'mouse', isPrimary: true }));
      el.dispatchEvent(new PointerEvent('pointerenter', { ...base, pointerType: 'mouse', isPrimary: true }));
    } catch {}
    el.dispatchEvent(new MouseEvent('mouseover', base));
    el.dispatchEvent(new MouseEvent('mouseenter', base));
    try {
      el.focus({ preventScroll: true });
    } catch {}
  }

  const HOVER_REVEAL_SELECTORS = [
    '[role="tooltip"]',
    '[data-tooltip-visible]',
    '[data-popper-placement]',
    '[data-state="open"]',
    '.tippy-box',
    '.tooltip',
    '.Tooltip',
    '.popover',
    '.Popover',
  ];

  function findAssociatedHoverReveal(trigger: Element): HTMLElement | null {
    const triggerEl = trigger instanceof HTMLElement ? trigger : null;

    // 1. ARIA linkage — the most reliable signal.
    const ariaRefIds = new Set<string>();
    const collectIds = (attr: string) => {
      const owner = triggerEl?.hasAttribute(attr)
        ? triggerEl
        : (trigger.closest(`[${attr}]`) as HTMLElement | null);
      const value = owner?.getAttribute(attr);
      if (!value) return;
      for (const id of value.split(/\s+/).filter(Boolean)) ariaRefIds.add(id);
    };
    collectIds('aria-describedby');
    collectIds('aria-controls');
    for (const id of ariaRefIds) {
      const el = document.getElementById(id);
      if (el instanceof HTMLElement && !isOverlayNode(el)) return el;
    }

    // 2. Nearest visible tooltip/popover outside the trigger's subtree.
    const triggerRect = trigger.getBoundingClientRect();
    const tx = triggerRect.left + triggerRect.width / 2;
    const ty = triggerRect.top + triggerRect.height / 2;
    let best: HTMLElement | null = null;
    let bestScore = Infinity;
    for (const sel of HOVER_REVEAL_SELECTORS) {
      let matches: NodeListOf<HTMLElement>;
      try {
        matches = document.querySelectorAll<HTMLElement>(sel);
      } catch {
        continue;
      }
      for (const el of matches) {
        if (isOverlayNode(el) || (el.id && el.id.startsWith('ifl-'))) continue;
        if (trigger.contains(el) || el.contains(trigger)) continue;
        if (!isElementVisible(el)) continue;
        const r = el.getBoundingClientRect();
        if (r.width >= window.innerWidth * 0.9 && r.height >= window.innerHeight * 0.9) continue;
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        const dist = Math.hypot(cx - tx, cy - ty);
        if (dist < bestScore) {
          bestScore = dist;
          best = el;
        }
      }
    }
    return best;
  }

  function firstTextLeafWithin(root: HTMLElement): HTMLElement | null {
    const direct = findEditableTextLeafAt(root);
    if (direct) return direct;
    const leaves = getEditableTextElements(root);
    if (leaves[0]) return leaves[0] as HTMLElement;
    // Tooltip reveals are commonly plain <div>s — if there's no whitelisted
    // leaf but the root holds visible text, use the root itself so the caret
    // lands inside the tooltip when we enter edit mode.
    const text = (root.innerText || root.textContent || '').trim();
    return text ? root : null;
  }

  function onPointerMove(event: PointerEvent) {
  if (!refineEnabled || !overlay) return;
  if (!isPickingModifier(event)) {
    // Modifier not held — hide any lingering hover so the page feels normal.
    if (currentHover) {
      overlay.hideHover();
      currentHover = null;
    }
    setPickingClass(false);
    return;
  }
  setPickingClass(true);
  const raw = elementFromEvent(event);
  const target = pickStableTarget(raw, currentHover);
  if (!target) {
    overlay.hideHover();
    currentHover = null;
    return;
  }
  if (target === currentHover) return;
  currentHover = target;
  overlay.showHover(target.getBoundingClientRect(), labelTarget(target));
  }

  // Swallow pointerdown / mousedown / pointerup / mouseup while the user is
  // holding ⌘/Ctrl — the synthesis of those events is what drives button
  // onClick, form submits, popover open/close, drag-selection, etc. The user
  // is explicitly in finetune mode at that moment, so the page's own
  // handlers should stay silent until they release the modifier.
  function onSuppressCapture(event: MouseEvent | PointerEvent) {
    if (!refineEnabled) return;
    if (!isPickingModifier(event)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  function onClickCapture(event: MouseEvent) {
  if (!refineEnabled) return;

  // While editing, a plain click outside the locked region exits edit mode
  // and lets the click proceed naturally (so the user can interact with
  // whatever they just clicked on). Clicks inside the region are left alone
  // so the user can retarget the caret between text leaves.
  if (inlineTextMode && !isPickingModifier(event)) {
    const target = event.target;
    const selected = resolveCurrentSelection();
    if (selected && target instanceof Node && !selected.contains(target) && !isOverlayNode(target instanceof Element ? target : null)) {
      stopInlineTextEdit();
      refreshSelectionOverlay();
      overlay?.showBanner(SELECTION_BANNER);
    }
    return;
  }

  // Only hijack clicks when the user explicitly opts in with ⌘/Ctrl. All
  // other clicks pass through so the user can click buttons, drag text, etc.
  if (!isPickingModifier(event)) return;
  // While editing, freeze selection changes — user must click outside or
  // use the panel's Stop button to exit first.
  if (inlineTextMode) return;

  event.preventDefault();
  event.stopImmediatePropagation();

  const raw = document.elementFromPoint(event.clientX, event.clientY) ?? currentHover ?? null;
  const cleaned = isOverlayNode(raw) ? null : raw;
  if (!cleaned) return;

  // If the click landed on a text leaf (heading, paragraph, button label…),
  // jump straight into edit mode on that leaf. The region itself is still the
  // enclosing meaningful container so non-text edits (hide/remove/image) keep
  // applying to the full block.
  const textLeaf = findEditableTextLeafAt(cleaned);
  const picked = pickMeaningfulTarget(cleaned);
  if (!picked) return;

  // Surface any hover-revealed tooltip/popover tied to this trigger:
  //  1. Snapshot which positioned elements are currently visible so we can
  //     diff against the post-reveal state.
  //  2. Apply `.ifl-force-hover` up the ancestor chain — userland replica of
  //     DevTools' "force :hover state" — firing every pure-CSS :hover rule.
  //  3. Fire synthetic pointer/mouse/focus events so JS-driven tooltips
  //     (Tippy, Popper, Radix, headless-UI, etc.) also open.
  //  4. Next frame, find the reveal: ARIA linkage first, then any newly
  //     visible floater near the trigger, then common tooltip selectors.
  const floatersBefore = snapshotVisibleFloaters();
  applyForceHoverChain(picked);
  triggerHoverOn(picked);
  requestAnimationFrame(() => {
    const reveal =
      findAssociatedHoverReveal(picked)
      ?? pickNewlyVisibleReveal(floatersBefore, picked);
    if (reveal) {
      pinElement(reveal);
      selectRegion(reveal, { revertPreviousPending: true, disableRefineMode: false });
      const leaf = firstTextLeafWithin(reveal);
      if (leaf) autoEnterInlineTextEdit(leaf);
      return;
    }

    // No tooltip surfaced — fall through to the normal button/region flow.
    const stayInSameRegion =
      !!(textLeaf && selectedElement && selectedElement.contains(textLeaf));
    if (!stayInSameRegion) {
      selectRegion(picked, { revertPreviousPending: true, disableRefineMode: false });
    }
    if (textLeaf) {
      autoEnterInlineTextEdit(textLeaf);
    } else {
      // No text leaf and no tooltip — release the force-hover classes so we
      // don't leave the page in a forced state.
      removeForceHoverChain();
    }
  });
  }

  function autoEnterInlineTextEdit(leaf: HTMLElement) {
  const region = resolveCurrentSelection();
  if (!region) return;
  if (!inlineTextMode) {
    const res = startInlineTextEdit(region);
    if (!res.ok) return;
    notifyInlineTextState(true);
  }
  // Wait one frame so startInlineTextEdit's DOM writes settle before focus.
  requestAnimationFrame(() => {
    if (!document.contains(leaf)) return;
    leaf.focus({ preventScroll: false });
    placeCaretAtEnd(leaf);
  });
  }

  function placeCaretAtEnd(el: HTMLElement) {
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
  }

  function notifyInlineTextState(active: boolean) {
  chrome.runtime
    .sendMessage({ type: 'INLINE_TEXT_STATE_CHANGED', active } satisfies ExtensionMessage)
    .catch(() => {});
  }

  function onKeyDown(event: KeyboardEvent) {
  if (!refineEnabled) return;

  if (event.key === 'Meta' || event.key === 'Control') {
    setPickingClass(true);
    return;
  }

  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopImmediatePropagation();
    setRefineEnabled(false);
    chrome.runtime
      .sendMessage({ type: 'SET_REFINE_MODE', enabled: false } satisfies ExtensionMessage)
      .catch(() => {});
    return;
  }

  if (!activePending || !selectionVisible) return;

  // Skip navigation if the user is typing in an input / textarea / editable.
  if (isTypingContext(event.target)) return;

  const wantsParent = event.key === 'ArrowUp' || event.key === '[';
  const wantsChild = event.key === 'ArrowDown' || event.key === ']';
  const wantsPrev = event.key === 'ArrowLeft';
  const wantsNext = event.key === 'ArrowRight';
  const wantsUnlock = event.key === 'r' || event.key === 'R';

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
  if (wantsPrev) {
    event.preventDefault();
    event.stopImmediatePropagation();
    cycleSelection('prev');
    return;
  }
  if (wantsNext) {
    event.preventDefault();
    event.stopImmediatePropagation();
    cycleSelection('next');
    return;
  }
  if (wantsUnlock) {
    event.preventDefault();
    event.stopImmediatePropagation();
    selectionLocked = false;
    overlay?.showBanner(REFINE_BANNER);
  }
  }

  function onKeyUp(event: KeyboardEvent) {
  if (!refineEnabled) return;
  if (event.key === 'Meta' || event.key === 'Control') {
    setPickingClass(false);
    if (currentHover) {
      overlay?.hideHover();
      currentHover = null;
    }
    // Keep tooltips pinned if the user just entered edit mode so they can
    // still see/edit them; otherwise release the page back to normal.
    if (!inlineTextMode) unfreezeHoverRevealedElements();
  }
  }

  function isTypingContext(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select';
  }

  function onWindowBlur() {
  // Cmd-tabbing away drops the modifier without firing keyup — reset so the
  // next pointermove starts clean.
  setPickingClass(false);
  if (currentHover) {
    overlay?.hideHover();
    currentHover = null;
  }
  if (!inlineTextMode) unfreezeHoverRevealedElements();
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
    window.addEventListener('mousedown', onSuppressCapture, true);
    window.addEventListener('pointerdown', onSuppressCapture, true);
    window.addEventListener('mouseup', onSuppressCapture, true);
    window.addEventListener('pointerup', onSuppressCapture, true);
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('blur', onWindowBlur, true);
  } else {
    window.removeEventListener('pointermove', onPointerMove, true);
    window.removeEventListener('click', onClickCapture, true);
    window.removeEventListener('mousedown', onSuppressCapture, true);
    window.removeEventListener('pointerdown', onSuppressCapture, true);
    window.removeEventListener('mouseup', onSuppressCapture, true);
    window.removeEventListener('pointerup', onSuppressCapture, true);
    window.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('keyup', onKeyUp, true);
    window.removeEventListener('blur', onWindowBlur, true);
    setPickingClass(false);
    document.documentElement.classList.remove('ifl-refine-mode');
    overlay?.hideBanner();
    overlay?.hideHover();
    if (!opts.keepSelection) {
      selectionVisible = false;
      selectionLocked = false;
      overlay?.hideSelection();
    }
    unfreezeHoverRevealedElements();
    currentHover = null;
  }
  }

  function cycleSelection(direction: 'parent' | 'child' | 'prev' | 'next') {
  if (!activePending) return;
  const current = resolveCurrentSelection();
  if (!current) return;

  const next =
    direction === 'parent'
      ? walkToParentBlock(current)
      : direction === 'child'
        ? walkToChildBlock(current)
        : walkToSiblingBlock(current, direction === 'next' ? 'next' : 'prev');
  if (!next || next === current) {
    overlay?.showBanner(
      direction === 'parent'
        ? 'No wider block available — already at the outermost meaningful region.'
        : direction === 'child'
          ? 'No nested block inside this region to cycle into.'
          : direction === 'prev'
            ? 'No previous sibling block available.'
            : 'No next sibling block available.',
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
  overlay?.showSelection(next.getBoundingClientRect(), target.label, currentSelectionState());
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

  if (action.type === 'nudge_position') {
    return nudgePosition(element, action.direction);
  }

  if (action.type === 'adjust_font_size') {
    return adjustFontSize(element, action.direction);
  }

  if (action.type === 'adjust_border_radius') {
    return adjustBorderRadius(element, action.direction);
  }

  if (action.type === 'adjust_size') {
    return adjustSize(element, action.axis, action.direction);
  }

  if (action.type === 'reset_style_adjustments') {
    return resetStyleAdjustments();
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
  let editableElements = getEditableTextElements(element);
  if (editableElements.length === 0) {
    // Many tooltips/popovers use plain <div>s which fall outside the
    // whitelisted editable tags. If the region itself carries visible text,
    // fall back to editing the region container directly.
    if (element instanceof HTMLElement) {
      const text = (element.innerText || element.textContent || '').trim();
      if (text) editableElements = [element];
    }
  }
  if (editableElements.length === 0) {
    return { ok: false, error: 'No editable text nodes found in the selected region.' };
  }

  stopInlineTextEdit();
  inlineTextMode = true;
  selectionVisible = true;
  refreshSelectionOverlay();
  overlay?.showBanner(
    'Editing text — type · click other text to jump · click outside the region to finish',
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
  notifyInlineTextState(false);
  window.removeEventListener('focusin', onInlineFocus, true);
  window.removeEventListener('focusout', onInlineBlur, true);
  window.removeEventListener('keydown', onInlineEditorKeyDown, true);

  for (const node of textOriginals.keys()) {
    node.removeAttribute('contenteditable');
    node.removeAttribute('spellcheck');
    node.classList.remove(OVERLAY_IDS.inlineEditable, OVERLAY_IDS.inlineEditing);
  }
  unfreezeHoverRevealedElements();
  refreshSelectionOverlay();

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
  // Snapshot a short preview of the element before we hide it — this is the
  // only handle downstream prompts will have for "what was this?".
  const preview = shortPreviewOf(htmlElement);
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
      preview,
      createdAt: existing?.createdAt ?? nowIso(),
    });
    return next;
  });
  }

  function shortPreviewOf(el: HTMLElement): string {
    const text = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
    if (text) return text.length > 80 ? `${text.slice(0, 77)}…` : text;
    if (el.tagName.toLowerCase() === 'img') {
      const img = el as unknown as HTMLImageElement;
      if (img.alt) return `image: ${img.alt}`;
      if (img.src) return `image`;
    }
    const aria = el.getAttribute('aria-label');
    if (aria) return aria;
    return `<${el.tagName.toLowerCase()}>`;
  }

  // --- Style adjustments --------------------------------------------------
  // Position uses `transform: translate(x, y)` so layout flow around the
  // element is preserved. Font-size / border-radius / width / height are
  // written to inline style in pixels. Each property gets one diff per
  // region — repeated nudges update the same diff's `after` value so the
  // user's total adjustment stays coherent.

  function ensureStyleSnapshot(element: HTMLElement): StyleSnapshot {
    let snap = styleOriginals.get(element);
    if (snap) return snap;
    const computed = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    snap = {
      transform: element.style.transform,
      fontSize: element.style.fontSize,
      borderRadius: element.style.borderRadius,
      width: element.style.width,
      height: element.style.height,
      computedFontSize: parseFloat(computed.fontSize) || 16,
      computedBorderRadius: parseFloat(computed.borderRadius) || 0,
      computedWidth: rect.width,
      computedHeight: rect.height,
      translateX: 0,
      translateY: 0,
    };
    styleOriginals.set(element, snap);
    return snap;
  }

  function restoreStyleOriginals() {
    for (const [el, snap] of styleOriginals.entries()) {
      if (!document.contains(el)) continue;
      el.style.transform = snap.transform;
      el.style.fontSize = snap.fontSize;
      el.style.borderRadius = snap.borderRadius;
      el.style.width = snap.width;
      el.style.height = snap.height;
    }
    styleOriginals.clear();
  }

  function upsertStyleDiff(args: {
    property: 'translate' | 'fontSize' | 'borderRadius' | 'width' | 'height';
    before: string;
    after: string;
    selector: string;
    label: string;
  }) {
    updatePendingDiffs((diffs) => {
      const existing = diffs.find(
        (diff) => diff.type === 'style_change' && diff.property === args.property,
      );
      const next: EditDiff[] = diffs.filter(
        (diff) => !(diff.type === 'style_change' && diff.property === args.property),
      );
      // Back to original — drop the diff entirely rather than store a no-op.
      if (args.before === args.after) return next;
      next.push({
        id: existing?.id ?? uid(),
        type: 'style_change',
        property: args.property,
        selector: args.selector,
        target: args.label,
        before: existing?.type === 'style_change' ? existing.before : args.before,
        after: args.after,
        createdAt: existing?.createdAt ?? nowIso(),
      });
      return next;
    });
  }

  function nudgePosition(element: Element, direction: 'up' | 'down' | 'left' | 'right') {
    if (!(element instanceof HTMLElement) || !activePending) {
      return { ok: false, error: 'Cannot adjust position on this region.' };
    }
    const snap = ensureStyleSnapshot(element);
    if (direction === 'up') snap.translateY -= POSITION_STEP;
    else if (direction === 'down') snap.translateY += POSITION_STEP;
    else if (direction === 'left') snap.translateX -= POSITION_STEP;
    else snap.translateX += POSITION_STEP;

    const translate = `translate(${snap.translateX}px, ${snap.translateY}px)`;
    element.style.transform = snap.translateX === 0 && snap.translateY === 0
      ? snap.transform
      : translate;

    const before = 'translate(0px, 0px)';
    const after = `translate(${snap.translateX}px, ${snap.translateY}px)`;
    upsertStyleDiff({
      property: 'translate',
      before,
      after,
      selector: activePending.target.selector,
      label: activePending.target.label,
    });
    refreshSelectionOverlay();
    return { ok: true, pending: activePending };
  }

  function adjustFontSize(element: Element, direction: 'up' | 'down') {
    if (!(element instanceof HTMLElement) || !activePending) {
      return { ok: false, error: 'Cannot adjust font size on this region.' };
    }
    const snap = ensureStyleSnapshot(element);
    const delta = direction === 'up' ? FONT_SIZE_STEP : -FONT_SIZE_STEP;
    const current = parseFloat(element.style.fontSize) || snap.computedFontSize;
    const next = Math.max(4, current + delta);
    element.style.fontSize = `${next}px`;

    upsertStyleDiff({
      property: 'fontSize',
      before: `${snap.computedFontSize}px`,
      after: `${next}px`,
      selector: activePending.target.selector,
      label: activePending.target.label,
    });
    refreshSelectionOverlay();
    return { ok: true, pending: activePending };
  }

  function adjustBorderRadius(element: Element, direction: 'up' | 'down') {
    if (!(element instanceof HTMLElement) || !activePending) {
      return { ok: false, error: 'Cannot adjust border radius on this region.' };
    }
    const snap = ensureStyleSnapshot(element);
    const delta = direction === 'up' ? BORDER_RADIUS_STEP : -BORDER_RADIUS_STEP;
    const current = parseFloat(element.style.borderRadius) || snap.computedBorderRadius;
    const next = Math.max(0, current + delta);
    element.style.borderRadius = `${next}px`;

    upsertStyleDiff({
      property: 'borderRadius',
      before: `${snap.computedBorderRadius}px`,
      after: `${next}px`,
      selector: activePending.target.selector,
      label: activePending.target.label,
    });
    refreshSelectionOverlay();
    return { ok: true, pending: activePending };
  }

  function adjustSize(
    element: Element,
    axis: 'width' | 'height',
    direction: 'up' | 'down',
  ) {
    if (!(element instanceof HTMLElement) || !activePending) {
      return { ok: false, error: 'Cannot adjust size on this region.' };
    }
    const snap = ensureStyleSnapshot(element);
    const delta = direction === 'up' ? SIZE_STEP : -SIZE_STEP;
    const baseline = axis === 'width' ? snap.computedWidth : snap.computedHeight;
    const current = parseFloat(element.style[axis]) || baseline;
    const next = Math.max(8, current + delta);
    element.style[axis] = `${next}px`;

    upsertStyleDiff({
      property: axis,
      before: `${Math.round(baseline)}px`,
      after: `${Math.round(next)}px`,
      selector: activePending.target.selector,
      label: activePending.target.label,
    });
    refreshSelectionOverlay();
    return { ok: true, pending: activePending };
  }

  function resetStyleAdjustments() {
    if (!activePending) return { ok: false, error: 'No region is selected.' };
    restoreStyleOriginals();
    updatePendingDiffs((diffs) => diffs.filter((diff) => diff.type !== 'style_change'));
    refreshSelectionOverlay();
    return { ok: true, pending: activePending };
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
      movedLabel: targetLabel,
      direction,
      createdAt: existing?.createdAt ?? nowIso(),
    });
    return next;
  });

  return { ok: true, pending: activePending };
  }

  function updatePendingDiffs(updater: (diffs: EditDiff[]) => EditDiff[]) {
  if (!activePending) return;
  activePending = { ...activePending, diffs: updater(activePending.diffs) };
  refreshSelectionOverlay();
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
  overlay?.showSelection(rect, activePending.target.label, currentSelectionState());
  }

  function currentSelectionState() {
  if (inlineTextMode) return 'editing' as const;
  if (activePending && activePending.diffs.length > 0) return 'edited' as const;
  return 'locked' as const;
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

  overlay?.showSelection(picked.getBoundingClientRect(), target.label, currentSelectionState());
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
    restoreStyleOriginals();
  } else {
    // Keep the current preview visible but drop our snapshot so a future
    // pending session doesn't accidentally restore someone else's img.
    imageOriginals.clear();
    styleOriginals.clear();
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

  // Panel rename writes to storage — mirror the label into activePending so
  // the on-page selection overlay stays in sync with what the user typed.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    const pendingChange = changes[STORAGE_KEYS.pending];
    if (!pendingChange) return;
    const next = pendingChange.newValue as { target?: { label?: string } } | undefined;
    if (!next?.target?.label || !activePending) return;
    if (next.target.label === activePending.target.label) return;
    activePending = {
      ...activePending,
      target: { ...activePending.target, label: next.target.label },
    };
    refreshSelectionOverlay();
  });

  window.addEventListener('click', onDocumentClick, true);
  window.addEventListener('resize', onViewportChange, true);
  document.addEventListener('scroll', onViewportChange, true);
}
