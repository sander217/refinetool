import type {
  BlockAction,
  EditDiff,
  ReorderDiff,
  TextChangeDiff,
} from '../shared/types';
import { nowIso, uid } from '../shared/utils';
import { generateSelector, labelTarget } from './dom';

// Tags whose text content we treat as directly editable inline.
const TEXT_EDITABLE_TAGS = new Set([
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'P',
  'BUTTON',
  'A',
  'LI',
  'SPAN',
  'LABEL',
  'FIGCAPTION',
  'BLOCKQUOTE',
  'STRONG',
  'EM',
  'SMALL',
  'CODE',
  'DT',
  'DD',
]);

type AppliedEdit = {
  diff: EditDiff;
  undo: () => void;
};

// Each applied edit keeps the undo closure around so "Revert" on a specific
// diff restores the exact prior DOM state, even if many edits stack up.
const appliedEdits = new Map<string, AppliedEdit>();

type TextEditEntry = {
  el: Element;
  original: string; // normalized textContent
  originalHTML: string; // for clean revert of nested markup
  originalContentEditable: string | null;
};

type TextEditSession = {
  rootSelector: string;
  entries: TextEditEntry[];
};

let textEditSession: TextEditSession | null = null;

export function startTextEdit(
  rootSelector: string,
):
  | { ok: true; elementCount: number }
  | { ok: false; error: string } {
  if (textEditSession) {
    return { ok: false, error: 'A text-edit session is already active — click Done first.' };
  }
  let rootEl: Element | null = null;
  try {
    rootEl = document.querySelector(rootSelector);
  } catch {
    return { ok: false, error: `Invalid selector: ${rootSelector}` };
  }
  if (!rootEl) return { ok: false, error: 'Target element not found on this page.' };

  const candidates = collectTextElements(rootEl);
  if (candidates.length === 0) {
    return { ok: false, error: 'No editable text elements inside this region.' };
  }

  ensureTextEditStyles();
  const entries: TextEditEntry[] = candidates.map((el) => {
    const entry: TextEditEntry = {
      el,
      original: normalize(el.textContent ?? ''),
      originalHTML: el.innerHTML,
      originalContentEditable: el.getAttribute('contenteditable'),
    };
    el.setAttribute('contenteditable', 'true');
    el.setAttribute('spellcheck', 'true');
    (el as HTMLElement).classList.add('ifl-text-editing');
    return entry;
  });
  textEditSession = { rootSelector, entries };

  // Focus the first editable element so typing starts right away.
  const first = entries[0]?.el as HTMLElement | undefined;
  first?.focus();
  return { ok: true, elementCount: entries.length };
}

export function endTextEdit(commit: boolean): { diffs: EditDiff[] } {
  if (!textEditSession) return { diffs: [] };
  const diffs: EditDiff[] = [];

  for (const entry of textEditSession.entries) {
    const { el, original, originalHTML, originalContentEditable } = entry;
    const currentText = normalize(el.textContent ?? '');

    // Always strip contenteditable, regardless of commit/cancel.
    if (originalContentEditable === null) el.removeAttribute('contenteditable');
    else el.setAttribute('contenteditable', originalContentEditable);
    el.removeAttribute('spellcheck');
    (el as HTMLElement).classList.remove('ifl-text-editing');

    if (!commit) {
      // Cancel: revert to original HTML so the page looks exactly as before.
      if (el.innerHTML !== originalHTML) el.innerHTML = originalHTML;
      continue;
    }
    if (currentText === original) continue;

    const diff: TextChangeDiff = {
      id: uid(),
      type: 'text_change',
      selector: safeSelector(el),
      target: labelTarget(el),
      before: original,
      after: currentText,
      createdAt: nowIso(),
    };
    const restoredHTML = originalHTML;
    const undo = () => {
      el.innerHTML = restoredHTML;
    };
    appliedEdits.set(diff.id, { diff, undo });
    diffs.push(diff);
  }

  textEditSession = null;
  return { diffs };
}

export function applyBlockAction(
  selector: string,
  action: BlockAction,
):
  | { ok: true; diff: EditDiff }
  | { ok: false; error: string } {
  let el: Element | null = null;
  try {
    el = document.querySelector(selector);
  } catch {
    return { ok: false, error: `Invalid selector: ${selector}` };
  }
  if (!el) return { ok: false, error: 'Target element not found on this page.' };

  if (action === 'hide' || action === 'remove') {
    const htmlEl = el as HTMLElement;
    const originalInlineStyle = htmlEl.getAttribute('style');
    htmlEl.style.display = 'none';
    const diff = {
      id: uid(),
      type: action,
      selector,
      target: labelTarget(el),
      createdAt: nowIso(),
    } as EditDiff;
    const undo = () => {
      if (originalInlineStyle === null) htmlEl.removeAttribute('style');
      else htmlEl.setAttribute('style', originalInlineStyle);
    };
    appliedEdits.set(diff.id, { diff, undo });
    return { ok: true, diff };
  }

  if (action === 'move_up' || action === 'move_down') {
    const parent = el.parentElement;
    if (!parent) return { ok: false, error: 'Selected element has no parent to reorder within.' };
    const siblings = Array.from(parent.children);
    const idx = siblings.indexOf(el);
    if (idx < 0) return { ok: false, error: 'Element is not a direct child of its parent.' };

    const swapIdx = action === 'move_up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= siblings.length) {
      return {
        ok: false,
        error: `Cannot move ${action === 'move_up' ? 'up' : 'down'} — no sibling in that direction.`,
      };
    }

    const before = siblings.map((c) => labelTarget(c));
    const originalAnchor = siblings[idx + 1] ?? null;

    if (action === 'move_up') {
      parent.insertBefore(el, siblings[swapIdx]);
    } else {
      parent.insertBefore(el, siblings[swapIdx].nextSibling);
    }
    const after = Array.from(parent.children).map((c) => labelTarget(c));

    const parentLabel = labelTarget(parent);
    const diff: ReorderDiff = {
      id: uid(),
      type: 'reorder',
      selector: safeSelector(parent),
      target: `Children of ${parentLabel}`,
      before,
      after,
      createdAt: nowIso(),
    };
    const undo = () => {
      parent.insertBefore(el as Element, originalAnchor);
    };
    appliedEdits.set(diff.id, { diff, undo });
    return { ok: true, diff };
  }

  return { ok: false, error: `Unknown block action: ${String(action)}` };
}

export function revertDiff(diffId: string): boolean {
  const entry = appliedEdits.get(diffId);
  if (!entry) return false;
  try {
    entry.undo();
  } catch (err) {
    console.warn('[IFL] revert failed', err);
  }
  appliedEdits.delete(diffId);
  return true;
}

export function clearAllEdits(): void {
  // Undo in reverse insertion order so reorder + hide stacks unwind cleanly.
  const entries = Array.from(appliedEdits.values()).reverse();
  for (const entry of entries) {
    try {
      entry.undo();
    } catch (err) {
      console.warn('[IFL] undo failed', err);
    }
  }
  appliedEdits.clear();
}

function collectTextElements(root: Element): Element[] {
  const selector = Array.from(TEXT_EDITABLE_TAGS)
    .map((t) => t.toLowerCase())
    .join(',');
  const all = Array.from(root.querySelectorAll(selector));
  if (TEXT_EDITABLE_TAGS.has(root.tagName)) all.unshift(root);

  const result: Element[] = [];
  for (const el of all) {
    const text = (el.textContent ?? '').trim();
    if (!text) continue;
    // Avoid nested overlaps — prefer outer element when both contain the same text.
    if (result.some((ex) => ex.contains(el) || el.contains(ex))) continue;
    result.push(el);
  }
  return result;
}

function normalize(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function safeSelector(el: Element): string {
  try {
    return generateSelector(el);
  } catch {
    return el.tagName.toLowerCase();
  }
}

function ensureTextEditStyles() {
  if (document.getElementById('ifl-text-edit-styles')) return;
  const style = document.createElement('style');
  style.id = 'ifl-text-edit-styles';
  style.textContent = `
    .ifl-text-editing {
      outline: 2px dashed rgba(88, 101, 242, 0.7) !important;
      outline-offset: 2px !important;
      background: rgba(88, 101, 242, 0.06) !important;
      cursor: text !important;
    }
    .ifl-text-editing:focus {
      outline-color: rgba(88, 101, 242, 1) !important;
      background: rgba(88, 101, 242, 0.12) !important;
    }
  `;
  document.head.appendChild(style);
}
