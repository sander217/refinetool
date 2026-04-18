import type { RefinementItem } from '../../shared/types';
import { formatEditDiffForPrompt } from '../../shared/editDiffs';

export function exportItemsJson(items: RefinementItem[]): string {
  return JSON.stringify(
    { version: 1, exportedAt: new Date().toISOString(), items },
    null,
    2,
  );
}

export function exportItemJson(item: RefinementItem): string {
  return JSON.stringify(item, null, 2);
}

export function exportItemsMarkdown(items: RefinementItem[]): string {
  if (items.length === 0) return '# Interface Finetuning Session\n\n_No items yet._';
  const blocks = items.map((it) =>
    [
      `## ${it.parsed.target}`,
      ``,
      `- **Page:** ${it.pageTitle || '(untitled)'}`,
      `- **URL:** ${it.pageUrl}`,
      `- **Selector:** \`${it.target.selector}\``,
      `- **Input mode:** ${it.inputMode}`,
      `- **Created:** ${it.createdAt}`,
      ``,
      `### User note`,
      it.rawInput || '_(empty)_',
      ``,
      it.transcript ? `### Transcript\n${it.transcript}\n` : '',
      `### Parsed`,
      `- Issue: ${it.parsed.currentIssue || '_(none)_'}`,
      `- Change: ${it.parsed.requestedChange || '_(none)_'}`,
      `- Intent: ${it.parsed.designIntent || '_(none)_'}`,
      `- Implementation direction:`,
      ...(it.parsed.implementationNotes.length
        ? it.parsed.implementationNotes.map((note) => `  - ${note}`)
        : ['  - _(none)_']),
      `- Preserve:`,
      ...((it.parsed.preserve ?? []).length
        ? (it.parsed.preserve ?? []).map((c) => `  - ${c}`)
        : ['  - _(none)_']),
      `- Do not touch:`,
      ...((it.parsed.doNotTouch ?? []).length
        ? (it.parsed.doNotTouch ?? []).map((c) => `  - ${c}`)
        : ['  - _(none)_']),
      `- Other constraints:`,
      ...(it.parsed.constraints.length
        ? it.parsed.constraints.map((c) => `  - ${c}`)
        : ['  - _(none)_']),
      ``,
      `### Direct edit diffs`,
      ...(it.diffs.length ? it.diffs.map((diff) => formatEditDiffForPrompt(diff)) : ['- _(none)_']),
      ``,
      `### Claude Code prompt`,
      '```text',
      it.prompts.claude,
      '```',
      ``,
      `### Codex prompt`,
      '```text',
      it.prompts.codex,
      '```',
      ``,
      `### Generic prompt`,
      '```text',
      it.prompts.generic,
      '```',
      ``,
      ...(it.prompts.summary
        ? [`### Handoff summary`, it.prompts.summary, ``]
        : []),
    ].join('\n'),
  );

  return ['# Interface Finetuning Session', '', ...blocks].join('\n\n---\n\n');
}

export function downloadBlob(filename: string, mime: string, content: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
