import type { EditDiff, ReorderDiff } from './types';

export function describeEditDiff(diff: EditDiff): string {
  if (diff.type === 'text_change') {
    return `${diff.target}: "${diff.before}" -> "${diff.after}"`;
  }
  if (diff.type === 'reorder') {
    return `${diff.target}: reordered within parent`;
  }
  return `${diff.target}: ${diff.type}`;
}

export function diffTypeLabel(diff: EditDiff): string {
  if (diff.type === 'text_change') return 'Text change';
  if (diff.type === 'remove') return 'Remove';
  if (diff.type === 'hide') return 'Hide';
  return 'Reorder';
}

export function hasVisibilityDiff(diffs: EditDiff[]): boolean {
  return diffs.some((diff) => diff.type === 'hide' || diff.type === 'remove');
}

export function formatEditDiffForPrompt(diff: EditDiff): string {
  if (diff.type === 'text_change') {
    return `- Text change on ${diff.target}: "${diff.before}" -> "${diff.after}"`;
  }
  if (diff.type === 'reorder') {
    return [
      `- Reorder ${diff.target}:`,
      `  Before: ${formatOrder(diff.before)}`,
      `  After: ${formatOrder(diff.after)}`,
    ].join('\n');
  }
  return `- ${capitalize(diff.type)} ${diff.target}`;
}

export function formatReorderSummary(diff: ReorderDiff): string {
  return `Before: ${formatOrder(diff.before)}\nAfter: ${formatOrder(diff.after)}`;
}

function formatOrder(order: string[]): string {
  return order.length ? order.join(' -> ') : '(empty)';
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
