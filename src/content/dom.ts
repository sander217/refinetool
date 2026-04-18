import type { BoundingBox, SelectedTarget } from '../shared/types';
import { truncate } from '../shared/utils';

const MEANINGFUL_TAGS = new Set([
  'section',
  'article',
  'aside',
  'nav',
  'header',
  'footer',
  'main',
  'form',
  'iframe',
  'table',
  'dialog',
  'figure',
  'picture',
  'fieldset',
  'ul',
  'ol',
  'dl',
  'menu',
]);

const LEAF_TAGS = new Set([
  'button',
  'a',
  'img',
  'input',
  'textarea',
  'select',
  'iframe',
  'video',
  'audio',
  'canvas',
]);

const MEANINGFUL_CLASS_REGEX =
  /\b(card|hero|cta|panel|container|block|section|modal|dialog|pricing|feature|sidebar|navbar|banner|grid|list|toolbar|drawer|popover|tooltip|tab|row|col|stack|cluster|wrapper|layout|group|item|actions|media|testimonial|footer|header|field-group|btn-group|controls|figure)\b/i;

const MAX_WALK = 8;

// Minimum size for size-only (unnamed) container candidates. Raised to filter
// out the "layout divs" that make hover jitter between overlapping wrappers.
const SIZE_FALLBACK_MIN_WIDTH = 260;
const SIZE_FALLBACK_MIN_HEIGHT = 140;

// Below this size a node can't anchor a block-level selection regardless of
// its tag/class — prevents tiny inline decoration from being a cycle target.
const BLOCK_MIN_WIDTH = 80;
const BLOCK_MIN_HEIGHT = 32;

const EDITABLE_TEXT_TAGS = new Set([
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'p',
  'span',
  'button',
  'a',
  'label',
  'strong',
  'em',
  'small',
  'li',
  'blockquote',
]);

export function pickMeaningfulTarget(start: Element | null): Element | null {
  if (!start) return null;
  if (isRootContainer(start)) return null;
  const startTag = start.tagName.toLowerCase();
  if (LEAF_TAGS.has(startTag)) return start;

  let current: Element | null = start;
  for (
    let i = 0;
    i < MAX_WALK &&
    current &&
    current !== document.body &&
    current !== document.documentElement;
    i++
  ) {
    const tag = current.tagName.toLowerCase();
    if (MEANINGFUL_TAGS.has(tag) && isSelectableCandidate(current)) return current;
    if (current.getAttribute('role') && isSelectableCandidate(current)) return current;
    if (current.getAttribute('aria-label') && isSelectableCandidate(current)) return current;
    if (current.getAttribute('data-testid') && isSelectableCandidate(current)) return current;

    const cls = readClassName(current);
    if (cls && MEANINGFUL_CLASS_REGEX.test(cls) && isSelectableCandidate(current)) return current;

    const rect = current.getBoundingClientRect();
    if (
      rect.width >= SIZE_FALLBACK_MIN_WIDTH &&
      rect.height >= SIZE_FALLBACK_MIN_HEIGHT &&
      hasVisibleChildren(current) &&
      isSelectableCandidate(current)
    ) {
      return current;
    }
    current = current.parentElement;
  }
  return isSelectableCandidate(start) ? start : null;
}

// Stickiness: if the pointer is still inside the previously-hovered target,
// keep it. Prevents swapping to a sibling container when the cursor moves
// between nested children within the same block.
export function pickStableTarget(
  raw: Element | null,
  currentStable: Element | null,
): Element | null {
  if (!raw) return null;
  if (
    currentStable &&
    document.contains(currentStable) &&
    currentStable.contains(raw) &&
    isSelectableCandidate(currentStable)
  ) {
    return currentStable;
  }
  return pickMeaningfulTarget(raw);
}

function isBlockCandidate(el: Element): boolean {
  if (!isSelectableCandidate(el)) return false;
  const rect = el.getBoundingClientRect();
  if (rect.width < BLOCK_MIN_WIDTH || rect.height < BLOCK_MIN_HEIGHT) return false;

  const tag = el.tagName.toLowerCase();
  if (LEAF_TAGS.has(tag)) return true;
  if (MEANINGFUL_TAGS.has(tag)) return true;
  if (el.getAttribute('role')) return true;
  if (el.getAttribute('aria-label')) return true;
  if (el.getAttribute('data-testid')) return true;
  const cls = readClassName(el);
  if (cls && MEANINGFUL_CLASS_REGEX.test(cls)) return true;
  if (
    rect.width >= SIZE_FALLBACK_MIN_WIDTH &&
    rect.height >= SIZE_FALLBACK_MIN_HEIGHT &&
    hasVisibleChildren(el)
  ) {
    return true;
  }
  return false;
}

export function walkToParentBlock(el: Element): Element | null {
  let node: Element | null = el.parentElement;
  while (
    node &&
    node !== document.body &&
    node !== document.documentElement
  ) {
    if (isBlockCandidate(node)) return node;
    node = node.parentElement;
  }
  return null;
}

export function walkToSiblingBlock(
  el: Element,
  direction: 'prev' | 'next',
): Element | null {
  // First pass: walk siblings at the same level. If none qualify as a block,
  // climb to the parent and scan its siblings — this keeps navigation useful
  // inside wrappers that split the layout into non-block children.
  const step = (n: Element): Element | null =>
    direction === 'next' ? n.nextElementSibling : n.previousElementSibling;

  let node: Element | null = el;
  while (node && node !== document.body && node !== document.documentElement) {
    let sibling = step(node);
    while (sibling) {
      if (isBlockCandidate(sibling)) return sibling;
      sibling = step(sibling);
    }
    node = node.parentElement;
  }
  return null;
}

export function walkToChildBlock(el: Element): Element | null {
  let best: Element | null = null;
  let bestArea = 0;
  for (const child of Array.from(el.children)) {
    if (!isBlockCandidate(child)) continue;
    const rect = child.getBoundingClientRect();
    const area = rect.width * rect.height;
    if (area > bestArea) {
      best = child;
      bestArea = area;
    }
  }
  return best;
}

function readClassName(el: Element): string | null {
  const cls = (el as HTMLElement).className;
  if (typeof cls === 'string') return cls;
  // SVG elements use SVGAnimatedString.
  if (cls && typeof (cls as SVGAnimatedString).baseVal === 'string') {
    return (cls as SVGAnimatedString).baseVal;
  }
  return null;
}

function hasVisibleChildren(el: Element): boolean {
  let seen = 0;
  for (const c of Array.from(el.children)) {
    const r = c.getBoundingClientRect();
    if (r.width > 20 && r.height > 20) seen += 1;
    if (seen >= 2) return true;
  }
  return false;
}

function isRootContainer(el: Element): boolean {
  return el === document.body || el === document.documentElement;
}

function isSelectableCandidate(el: Element): boolean {
  if (isRootContainer(el)) return false;
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;

  const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;

  if (viewportWidth > 0 && rect.width >= viewportWidth * 0.97) return false;
  if (viewportHeight > 0 && rect.height >= viewportHeight * 0.92) return false;

  return true;
}

export function generateSelector(el: Element): string {
  if (el.id && isUnique(`#${CSS.escape(el.id)}`)) {
    return `#${CSS.escape(el.id)}`;
  }
  const dataTestId = el.getAttribute('data-testid');
  if (dataTestId) {
    const sel = `[data-testid="${cssEscapeAttr(dataTestId)}"]`;
    if (isUnique(sel)) return sel;
  }

  const parts: string[] = [];
  let node: Element | null = el;
  while (
    node &&
    node.nodeType === 1 &&
    node !== document.body &&
    node !== document.documentElement &&
    parts.length < 6
  ) {
    let part = node.tagName.toLowerCase();
    if (node.id) {
      parts.unshift(`#${CSS.escape(node.id)}`);
      break;
    }
    const parent = node.parentElement;
    if (parent) {
      const same = Array.from(parent.children).filter((c) => c.tagName === node!.tagName);
      if (same.length > 1) {
        const idx = same.indexOf(node) + 1;
        part += `:nth-of-type(${idx})`;
      }
    }
    parts.unshift(part);
    node = node.parentElement;
  }
  return parts.join(' > ') || el.tagName.toLowerCase();
}

function isUnique(selector: string): boolean {
  try {
    return document.querySelectorAll(selector).length === 1;
  } catch {
    return false;
  }
}

function cssEscapeAttr(value: string): string {
  return value.replace(/"/g, '\\"');
}

export function labelTarget(el: Element): string {
  const aria = el.getAttribute('aria-label');
  if (aria) return truncate(aria.trim(), 60);
  const dataLabel = el.getAttribute('data-label') || el.getAttribute('data-testid');
  if (dataLabel) return truncate(dataLabel.trim(), 60);

  const tag = el.tagName.toLowerCase();
  const role = el.getAttribute('role');
  if (role) return `${role} (${tag})`;

  if (tag === 'button') {
    const text = textContent(el, 40);
    return text ? `Button: ${text}` : 'Button';
  }
  if (tag === 'a') {
    const text = textContent(el, 40);
    return text ? `Link: ${text}` : 'Link';
  }
  if (tag === 'iframe') {
    const title = el.getAttribute('title');
    return title ? `Iframe: ${truncate(title, 40)}` : 'Iframe block';
  }
  if (tag === 'img') {
    const alt = el.getAttribute('alt');
    return alt ? `Image: ${truncate(alt, 40)}` : 'Image';
  }
  if (tag === 'header') return 'Header';
  if (tag === 'footer') return 'Footer';
  if (tag === 'nav') return 'Nav';
  if (tag === 'aside') return 'Sidebar';
  if (tag === 'main') return 'Main content';
  if (tag === 'form') return 'Form block';
  if (tag === 'fieldset') return 'Form fieldset';
  if (tag === 'ul' || tag === 'ol' || tag === 'menu') return 'List block';
  if (tag === 'dl') return 'Description list';
  if (tag === 'table') return 'Table block';
  if (tag === 'figure' || tag === 'picture') {
    const caption = el.querySelector('figcaption')?.textContent?.trim().slice(0, 40);
    return caption ? `Figure: ${caption}` : 'Figure';
  }
  if (tag === 'section' || tag === 'article') {
    const heading = el.querySelector('h1, h2, h3');
    const text = heading?.textContent?.trim().slice(0, 40);
    return text ? `${titleCase(tag)}: ${text}` : titleCase(tag);
  }

  const meaningful = matchMeaningfulClass(el);
  if (meaningful) {
    const inner = firstInnerIdentifier(el);
    return inner ? `${titleCase(meaningful)}: ${inner}` : `${titleCase(meaningful)} block`;
  }

  const heading = el.querySelector('h1, h2, h3');
  const headingText = heading?.textContent?.trim().slice(0, 40);
  if (headingText) return `${tag} with heading "${headingText}"`;

  const t = textContent(el, 40);
  if (t) return `${tag}: ${t}`;

  return `${tag} element`;
}

function matchMeaningfulClass(el: Element): string | null {
  const cls = readClassName(el);
  if (!cls) return null;
  const m = cls.match(
    /\b(card|hero|cta|panel|container|block|section|modal|dialog|pricing|feature|sidebar|navbar|banner|toolbar)\b/i,
  );
  return m ? m[1].toLowerCase() : null;
}

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function textContent(el: Element, max: number): string {
  return (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, max);
}

function firstInnerIdentifier(el: Element): string | null {
  const heading = el.querySelector('h1, h2, h3, h4, h5, h6');
  const headingText = heading?.textContent?.trim().replace(/\s+/g, ' ').slice(0, 40);
  if (headingText) return headingText;
  const labelled = el.querySelector('[aria-label], [data-label], [data-testid]');
  const labelAttr =
    labelled?.getAttribute('aria-label') ||
    labelled?.getAttribute('data-label') ||
    labelled?.getAttribute('data-testid');
  if (labelAttr) return labelAttr.slice(0, 40);
  const firstBtn = el.querySelector('button, a');
  const btnText = firstBtn?.textContent?.trim().replace(/\s+/g, ' ').slice(0, 30);
  if (btnText) return btnText;
  const direct = (el.textContent || '').trim().replace(/\s+/g, ' ');
  if (direct.length > 0 && direct.length < 60) return direct.slice(0, 40);
  return null;
}

export function getBoundingBox(el: Element): BoundingBox {
  const r = el.getBoundingClientRect();
  return {
    x: Math.round(r.left + window.scrollX),
    y: Math.round(r.top + window.scrollY),
    width: Math.round(r.width),
    height: Math.round(r.height),
  };
}

export function buildSelectedTarget(el: Element): SelectedTarget {
  const outer = (el as HTMLElement).outerHTML || '';
  return {
    selector: generateSelector(el),
    label: labelTarget(el),
    boundingBox: getBoundingBox(el),
    snippet: truncate(outer.replace(/\s+/g, ' '), 400),
    tag: el.tagName.toLowerCase(),
    hasImage: findImageTarget(el) !== null,
    breadcrumb: buildBreadcrumb(el),
  };
}

function buildBreadcrumb(el: Element): string[] {
  const chain: Element[] = [];
  let node: Element | null = el;
  while (
    node &&
    node !== document.body &&
    node !== document.documentElement
  ) {
    chain.unshift(node);
    node = node.parentElement;
  }

  const path = chain
    .filter((n, idx) => idx === chain.length - 1 || isBreadcrumbCandidate(n))
    .slice(-5)
    .map((n, idx, arr) => (idx === arr.length - 1 ? labelTarget(n) : shortLabel(n)));
  return ['Page', ...path];
}

function isBreadcrumbCandidate(el: Element): boolean {
  const tag = el.tagName.toLowerCase();
  if (MEANINGFUL_TAGS.has(tag)) return true;
  if (el.getAttribute('role')) return true;
  const cls = readClassName(el);
  if (cls && MEANINGFUL_CLASS_REGEX.test(cls)) return true;
  return false;
}

function shortLabel(el: Element): string {
  const tag = el.tagName.toLowerCase();
  if (tag === 'section' || tag === 'article') {
    const heading = el.querySelector('h1, h2, h3');
    const text = heading?.textContent?.trim().slice(0, 24);
    return text ? text : titleCase(tag);
  }
  if (tag === 'header') return 'Header';
  if (tag === 'footer') return 'Footer';
  if (tag === 'nav') return 'Nav';
  if (tag === 'aside') return 'Sidebar';
  if (tag === 'main') return 'Main';
  if (tag === 'form') return 'Form';
  if (tag === 'figure' || tag === 'picture') return 'Figure';
  if (tag === 'ul' || tag === 'ol' || tag === 'menu') return 'List';
  const meaningful = matchMeaningfulClass(el);
  if (meaningful) return titleCase(meaningful);
  return tag;
}

export function resolveSelectedElement(target: SelectedTarget): Element | null {
  try {
    return document.querySelector(target.selector);
  } catch {
    return null;
  }
}

export function findImageTarget(root: Element): HTMLImageElement | null {
  if (root.tagName.toLowerCase() === 'img') return root as HTMLImageElement;
  const direct = root.querySelector('img');
  if (direct instanceof HTMLImageElement) return direct;
  return null;
}

export function getEditableTextElements(root: Element): HTMLElement[] {
  const candidates = new Set<HTMLElement>();
  const rootEl = root as HTMLElement;
  if (isEditableTextElement(rootEl)) candidates.add(rootEl);

  for (const node of Array.from(root.querySelectorAll<HTMLElement>('*'))) {
    if (isEditableTextElement(node)) {
      candidates.add(node);
    }
  }

  return Array.from(candidates);
}

export function getElementTextValue(el: HTMLElement): string {
  return cleanText(el.innerText || el.textContent || '');
}

export function describeEditableTextTarget(regionLabel: string, el: Element): string {
  const tag = el.tagName.toLowerCase();
  const text = getElementTextValue(el as HTMLElement);
  const preview = text ? ` "${truncate(text, 36)}"` : '';

  if (/^h[1-6]$/.test(tag)) return `${regionLabel} heading${preview}`;
  if (tag === 'button') return `${regionLabel} button label${preview}`;
  if (tag === 'a') return `${regionLabel} link label${preview}`;
  if (tag === 'p') return `${regionLabel} paragraph${preview}`;
  if (tag === 'label') return `${regionLabel} field label${preview}`;
  return `${regionLabel} ${tag}${preview}`;
}

export function describeChildren(parent: Element): string[] {
  return Array.from(parent.children)
    .map((child) => labelTarget(child))
    .map((label) => truncate(label, 60));
}

function isEditableTextElement(el: HTMLElement): boolean {
  if (!isVisible(el)) return false;
  if (el.isContentEditable) return false;
  if (el.closest(`#ifl-banner`)) return false;

  const tag = el.tagName.toLowerCase();
  if (!EDITABLE_TEXT_TAGS.has(tag)) return false;

  const text = getElementTextValue(el);
  if (!text) return false;
  if (tag === 'span' || tag === 'strong' || tag === 'em' || tag === 'small') {
    return hasSimpleTextStructure(el);
  }
  return text.length > 0;
}

function hasSimpleTextStructure(el: HTMLElement): boolean {
  if (el.children.length === 0) return true;
  return Array.from(el.children).every((child) => child.children.length === 0);
}

function isVisible(el: HTMLElement): boolean {
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  const style = window.getComputedStyle(el);
  return style.display !== 'none' && style.visibility !== 'hidden';
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}
