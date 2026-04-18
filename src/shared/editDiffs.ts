import type {
  EditDiff,
  ImageRegenerateIntentDiff,
  ImageReplaceIntentDiff,
  ReorderDiff,
  StyleProperty,
} from './types';

const STYLE_PROPERTY_LABELS: Record<StyleProperty, string> = {
  translate: 'Position',
  fontSize: 'Font size',
  borderRadius: 'Border radius',
  width: 'Width',
  height: 'Height',
};

export function describeEditDiff(diff: EditDiff): string {
  if (diff.type === 'text_change') {
    return `${diff.target}: "${diff.before}" -> "${diff.after}"`;
  }
  if (diff.type === 'reorder') {
    if (diff.movedLabel && diff.direction) {
      return `${diff.target}: moved ${diff.direction} within parent`;
    }
    return `${diff.target}: reordered within parent`;
  }
  if (diff.type === 'hide' || diff.type === 'remove') {
    const action = diff.type === 'hide' ? 'hidden' : 'removed';
    const preview = diff.preview ? ` — "${diff.preview}"` : '';
    return `${diff.target}: ${action}${preview}`;
  }
  if (diff.type === 'image_replace_intent') {
    return `${diff.target}: replace image (${describeImageReference(diff)})`;
  }
  if (diff.type === 'image_regenerate_intent') {
    const hint = diff.prompt ? ` — "${diff.prompt}"` : '';
    return `${diff.target}: regenerate image${hint}`;
  }
  // style_change
  const label = STYLE_PROPERTY_LABELS[diff.property];
  return `${diff.target}: ${label.toLowerCase()} ${diff.before} -> ${diff.after}`;
}

export function diffTypeLabel(diff: EditDiff): string {
  if (diff.type === 'text_change') return 'Text change';
  if (diff.type === 'remove') return 'Remove';
  if (diff.type === 'hide') return 'Hide';
  if (diff.type === 'reorder') return 'Reorder';
  if (diff.type === 'image_replace_intent') return 'Replace image';
  if (diff.type === 'image_regenerate_intent') return 'Regenerate image';
  return STYLE_PROPERTY_LABELS[diff.property];
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

export function hasStyleChange(diffs: EditDiff[]): boolean {
  return diffs.some((diff) => diff.type === 'style_change');
}

export type DiffCountBreakdown = {
  total: number;
  text: number;
  visibility: number;
  reorder: number;
  image: number;
  style: number;
};

export function diffCountBreakdown(diffs: EditDiff[]): DiffCountBreakdown {
  const counts: DiffCountBreakdown = {
    total: diffs.length,
    text: 0,
    visibility: 0,
    reorder: 0,
    image: 0,
    style: 0,
  };
  for (const diff of diffs) {
    if (diff.type === 'text_change') counts.text += 1;
    else if (diff.type === 'hide' || diff.type === 'remove') counts.visibility += 1;
    else if (diff.type === 'reorder') counts.reorder += 1;
    else if (diff.type === 'style_change') counts.style += 1;
    else counts.image += 1;
  }
  return counts;
}

export function formatEditDiffForPrompt(diff: EditDiff): string {
  if (diff.type === 'text_change') {
    return `- Text change on ${diff.target}: "${diff.before}" -> "${diff.after}"`;
  }
  if (diff.type === 'reorder') {
    const lines = [`- Reorder ${diff.target}:`];
    if (diff.movedLabel && diff.direction) {
      lines.push(`  Moved: ${diff.movedLabel} (${diff.direction})`);
    }
    lines.push(`  Before: ${formatOrder(diff.before)}`);
    lines.push(`  After: ${formatOrder(diff.after)}`);
    return lines.join('\n');
  }
  if (diff.type === 'hide' || diff.type === 'remove') {
    const lines = [`- ${capitalize(diff.type)} ${diff.target}`];
    if (diff.preview) lines.push(`  Preview: "${diff.preview}"`);
    return lines.join('\n');
  }
  if (diff.type === 'image_replace_intent') {
    const lines = [`- Replace image in ${diff.target}`];
    if (diff.originalSrc) lines.push(`  Current src: ${sanitizeSrcForPrompt(diff.originalSrc)}`);
    lines.push(`  Reference: ${describeImageReference(diff)}`);
    return lines.join('\n');
  }
  if (diff.type === 'image_regenerate_intent') {
    const lines = [`- Regenerate image in ${diff.target}`];
    if (diff.originalSrc) lines.push(`  Current src: ${sanitizeSrcForPrompt(diff.originalSrc)}`);
    if (diff.prompt) lines.push(`  Prompt hint: ${diff.prompt}`);
    return lines.join('\n');
  }
  const label = STYLE_PROPERTY_LABELS[diff.property];
  return `- ${label} change on ${diff.target}: ${diff.before} -> ${diff.after}`;
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
  if (diff.referenceKind === 'upload') {
    const size = diff.fileSize != null ? ` (${formatBytesHuman(diff.fileSize)})` : '';
    const name = diff.fileName ?? 'uploaded image';
    return `Uploaded file: ${name}${size}`;
  }
  return 'reference not provided';
}

function formatBytesHuman(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

// Don't leak huge inline payloads into generated prompts.
function sanitizeSrcForPrompt(src: string): string {
  if (src.startsWith('data:')) return '(inline data URI)';
  if (src.length > 300) return `${src.slice(0, 280)}…`;
  return src;
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
