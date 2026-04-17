import type { RefinementItem } from '../../shared/types';
import { describeDiff } from '../promptTemplates';

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
      `- **Priority:** ${it.parsed.priority}`,
      `- **Input mode:** ${it.inputMode}`,
      `- **Created:** ${it.createdAt}`,
      ``,
      `### User note`,
      it.rawInput || '_(empty)_',
      ``,
      it.transcript ? `### Transcript\n${it.transcript}\n` : '',
      `### Direct edits`,
      ...(it.diffs.length
        ? it.diffs.map((d, i) => `${i + 1}. ${describeDiff(d)}`)
        : ['_(none)_']),
      ``,
      `### Parsed`,
      `- Issue: ${it.parsed.currentIssue}`,
      `- Change: ${it.parsed.requestedChange}`,
      `- Intent: ${it.parsed.designIntent}`,
      `- Constraints:`,
      ...(it.parsed.constraints.length
        ? it.parsed.constraints.map((c) => `  - ${c}`)
        : ['  - _(none)_']),
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
