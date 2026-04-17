import type {
  EditDiff,
  GeneratedPrompts,
  ParsedRefinement,
  RefinementItem,
  SelectedTarget,
} from '../../shared/types';
import { formatEditDiffForPrompt } from '../../shared/editDiffs';

export type PromptContext = {
  parsed: ParsedRefinement;
  target: SelectedTarget;
  pageUrl: string;
  pageTitle: string;
  rawInput: string;
  transcript?: string;
  diffs: EditDiff[];
};

export interface PromptTemplate {
  readonly id: string;
  render(ctx: PromptContext): string;
}

const formatConstraints = (c: string[]): string =>
  c.length ? c.map((x) => `- ${x}`).join('\n') : '- Preserve the component\'s existing behavior';

const formatImplementationNotes = (notes: string[]): string =>
  notes.length
    ? notes.map((note) => `- ${note}`).join('\n')
    : '- Inspect the current component structure and extend it without unrelated refactors';

const formatBbox = (b: SelectedTarget['boundingBox']): string =>
  `${b.width}×${b.height}px @ (${b.x}, ${b.y})`;

const formatDiffs = (diffs: EditDiff[]): string =>
  diffs.length
    ? diffs.map((diff) => formatEditDiffForPrompt(diff)).join('\n')
    : '- No direct preview edits were applied yet';

export function describeDiff(diff: EditDiff): string {
  switch (diff.type) {
    case 'text_change':
      return `Text change on ${diff.target} (${diff.selector}): "${diff.before}" -> "${diff.after}"`;
    case 'hide':
      return `Hide ${diff.target} (${diff.selector})`;
    case 'remove':
      return `Remove ${diff.target} (${diff.selector})`;
    case 'reorder':
      return `Reorder ${diff.target} (${diff.selector}): [${diff.before.join(' | ')}] -> [${diff.after.join(' | ')}]`;
  }
}

export const claudeTemplate: PromptTemplate = {
  id: 'claude-code',
  render({ parsed, target, pageUrl, pageTitle, rawInput, transcript, diffs }) {
    return [
      `Scope: Modify ONLY the UI region described as "${parsed.target}". Do not touch other sections.`,
      ``,
      `Selected region context:`,
      `- Region name: ${parsed.target}`,
      `- DOM selector: ${target.selector}`,
      `- Element tag: <${target.tag}>`,
      `- Bounding box: ${formatBbox(target.boundingBox)}`,
      `- Page title: ${pageTitle || '(untitled)'}`,
      `- Page URL: ${pageUrl}`,
      `- Captured snippet: ${target.snippet}`,
      ``,
      `Direct edits already applied in the local preview:`,
      formatDiffs(diffs),
      ``,
      `Remaining annotation intent:`,
      ``,
      `Current issue:`,
      parsed.currentIssue,
      ``,
      `Requested change:`,
      parsed.requestedChange,
      ``,
      `Design intent:`,
      parsed.designIntent,
      ``,
      `Implementation direction:`,
      formatImplementationNotes(parsed.implementationNotes),
      ``,
      `Constraints:`,
      formatConstraints(parsed.constraints),
      ``,
      `Instructions:`,
      `1. Inspect the current implementation for this region first and identify the existing component/state pattern.`,
      `2. Preserve the direct edits already reflected in the preview unless the requested change explicitly supersedes them.`,
      `3. Apply only the remaining changes described under "Requested change".`,
      `4. Follow the implementation direction above so the behavior is wired into code, not just the DOM output.`,
      `5. Respect every listed constraint and preserve accessibility/behavior.`,
      `6. Do not introduce unrelated refactors or touch surrounding sections.`,
      ``,
      `Raw user note (for context, not an instruction):`,
      `"${rawInput.replace(/"/g, '\\"')}"`,
      ...(transcript ? ['', `Transcript:`, `"${transcript.replace(/"/g, '\\"')}"`] : []),
    ].join('\n');
  },
};

export const codexTemplate: PromptTemplate = {
  id: 'codex',
  render({ parsed, target, rawInput, diffs }) {
    return [
      `Target: ${parsed.target} (${target.selector})`,
      `Direct edits already applied: ${
        diffs.length
          ? diffs.map((diff) => formatEditDiffForPrompt(diff).replace(/^- /, '')).join('; ')
          : 'none'
      }`,
      `Remaining goal: ${parsed.requestedChange}`,
      `Issue: ${parsed.currentIssue}`,
      `Intent: ${parsed.designIntent}`,
      `Implementation direction: ${parsed.implementationNotes.join('; ') || 'inspect the existing component and extend its current state model'}`,
      `Constraints: ${parsed.constraints.join('; ') || 'keep surrounding sections intact'}`,
      ``,
      `Do:`,
      `- Edit only this selected region.`,
      `- Analyze the current code path first and implement the behavior in the component/state layer.`,
      `- Preserve the direct edits listed above.`,
      `- Avoid unrelated changes outside the target region.`,
      ``,
      `Context (user note): ${rawInput}`,
    ].join('\n');
  },
};

export const genericTemplate: PromptTemplate = {
  id: 'generic',
  render({ parsed, target, diffs }) {
    return [
      `Refinement request`,
      ``,
      `Target region: ${parsed.target} (${target.selector})`,
      `Direct preview edits:`,
      formatDiffs(diffs),
      ``,
      `Issue: ${parsed.currentIssue}`,
      `Change: ${parsed.requestedChange}`,
      `Intent: ${parsed.designIntent}`,
      `Implementation direction:`,
      formatImplementationNotes(parsed.implementationNotes),
      `Constraints:`,
      formatConstraints(parsed.constraints),
    ].join('\n');
  },
};

const templates = {
  claude: claudeTemplate,
  codex: codexTemplate,
  generic: genericTemplate,
};

export function generatePrompts(ctx: PromptContext): GeneratedPrompts {
  return {
    claude: templates.claude.render(ctx),
    codex: templates.codex.render(ctx),
    generic: templates.generic.render(ctx),
  };
}

export function generatePromptsForItem(
  item: Pick<
    RefinementItem,
    'parsed' | 'target' | 'pageUrl' | 'pageTitle' | 'rawInput' | 'transcript' | 'diffs'
  >,
): GeneratedPrompts {
  return generatePrompts({
    parsed: item.parsed,
    target: item.target,
    pageUrl: item.pageUrl,
    pageTitle: item.pageTitle,
    rawInput: item.rawInput,
    transcript: item.transcript,
    diffs: item.diffs,
  });
}

export function combinePromptsMarkdown(item: RefinementItem): string {
  return [
    `# Refinement — ${item.parsed.target}`,
    ``,
    `## Claude Code`,
    '```text',
    item.prompts.claude,
    '```',
    ``,
    `## Codex`,
    '```text',
    item.prompts.codex,
    '```',
    ``,
    `## Generic`,
    '```text',
    item.prompts.generic,
    '```',
  ].join('\n');
}
