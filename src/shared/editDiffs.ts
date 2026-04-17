import type {
  EditDiff,
  ImageRegenerateIntentDiff,
  ImageReplaceIntentDiff,
  ReorderDiff,
} from './types';

export function describeEditDiff(diff: EditDiff): string {
  if (diff.type === 'text_change') {
    return `${diff.target}: "${diff.before}" -> "${diff.after}"`;
  }
  if (diff.type === 'reorder') {
    return `${diff.target}: reordered within parent`;
  }
  if (diff.type === 'image_replace_intent') {
    return `${diff.target}: replace image (${describeImageReference(diff)})`;
  }
  if (diff.type === 'image_regenerate_intent') {
    const hint = diff.prompt ? ` — "${diff.prompt}"` : '';
    return `${diff.target}: regenerate image${hint}`;
  }
  return `${diff.target}: ${diff.type}`;
}

export function diffTypeLabel(diff: EditDiff): string {
  if (diff.type === 'text_change') return 'Text change';
  if (diff.type === 'remove') return 'Remove';
  if (diff.type === 'hide') return 'Hide';
  if (diff.type === 'reorder') return 'Reorder';
  if (diff.type === 'image_replace_intent') return 'Replace image';
  return 'Regenerate image';
}

export function hasVisibilityDiff(diffs: EditDiff[]): boolean {
  return diffs.some((diff) => diff.type === 'hide' || diff.type === 'remove');
}

export function hasImageIntent(diffs: EditDiff[]): boolean {
  return diffs.some(
    (diff) =>
      diff.type === 'image_replace_intent' || diff.type === 'image_regenerate_intent',
  );
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
  if (diff.type === 'image_replace_intent') {
    const lines = [`- Replace image in ${diff.target}`];
    if (diff.originalSrc) lines.push(`  Current src: ${diff.originalSrc}`);
    lines.push(`  Reference: ${describeImageReference(diff)}`);
    return lines.join('\n');
  }
  if (diff.type === 'image_regenerate_intent') {
    const lines = [`- Regenerate image in ${diff.target}`];
    if (diff.originalSrc) lines.push(`  Current src: ${diff.originalSrc}`);
    if (diff.prompt) lines.push(`  Prompt hint: ${diff.prompt}`);
    return lines.join('\n');
  }
  return `- ${capitalize(diff.type)} ${diff.target}`;
}

export function formatReorderSummary(diff: ReorderDiff): string {
  return `Before: ${formatOrder(diff.before)}\nAfter: ${formatOrder(diff.after)}`;
}

export function describeImageReference(diff: ImageReplaceIntentDiff): string {
  if (diff.referenceKind === 'url' && diff.referenceUrl) {
    return `URL: ${diff.referenceUrl}`;
  }
  if (diff.referenceKind === 'figma' && diff.referenceUrl) {
    return `Figma: ${diff.referenceUrl}`;
  }
  if (diff.referenceKind === 'note' && diff.referenceNote) {
    return `Note: ${diff.referenceNote}`;
  }
  return 'reference not provided';
}

export function imageRegeneratePrompt(
  diff: ImageRegenerateIntentDiff,
): string | undefined {
  return diff.prompt;
}

function formatOrder(order: string[]): string {
  return order.length ? order.join(' -> ') : '(empty)';
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
