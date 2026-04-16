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
  /\b(card|hero|cta|panel|container|block|section|modal|dialog|pricing|feature|sidebar|navbar|banner|grid|list|toolbar|drawer|popover|tooltip|tab|row|col|stack|cluster|wrapper|layout|group|item)\b/i;

const MAX_WALK = 8;

export function pickMeaningfulTarget(start: Element | null): Element | null {
  if (!start) return null;
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
    if (MEANINGFUL_TAGS.has(tag)) return current;
    if (current.getAttribute('role')) return current;
    if (current.getAttribute('aria-label')) return current;
    if (current.getAttribute('data-testid')) return current;

    const cls = readClassName(current);
    if (cls && MEANINGFUL_CLASS_REGEX.test(cls)) return current;

    const rect = current.getBoundingClientRect();
    if (rect.width >= 220 && rect.height >= 100 && hasVisibleChildren(current)) {
      return current;
    }
    current = current.parentElement;
  }
  return start;
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
  if (tag === 'ul' || tag === 'ol') return 'List block';
  if (tag === 'table') return 'Table block';
  if (tag === 'section' || tag === 'article') {
    const heading = el.querySelector('h1, h2, h3');
    const text = heading?.textContent?.trim().slice(0, 40);
    return text ? `${titleCase(tag)}: ${text}` : titleCase(tag);
  }

  const meaningful = matchMeaningfulClass(el);
  if (meaningful) return `${titleCase(meaningful)} block`;

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
  };
}
