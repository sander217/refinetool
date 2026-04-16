import type {
  GeneratedPrompts,
  ParsedRefinement,
  RefinementItem,
  SelectedTarget,
} from '../../shared/types';

export type PromptContext = {
  parsed: ParsedRefinement;
  target: SelectedTarget;
  pageUrl: string;
  pageTitle: string;
  rawInput: string;
};

export interface PromptTemplate {
  readonly id: string;
  render(ctx: PromptContext): string;
}

const formatConstraints = (c: string[]): string =>
  c.length ? c.map((x) => `- ${x}`).join('\n') : '- Preserve the component\'s existing behavior';

const formatBbox = (b: SelectedTarget['boundingBox']): string =>
  `${b.width}×${b.height}px @ (${b.x}, ${b.y})`;

export const claudeTemplate: PromptTemplate = {
  id: 'claude-code',
  render({ parsed, target, pageUrl, rawInput }) {
    return [
      `Scope: Modify ONLY the UI region described as "${parsed.target}". Do not touch other sections.`,
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
      `Constraints:`,
      formatConstraints(parsed.constraints),
      ``,
      `Priority: ${parsed.priority}`,
      ``,
      `Technical anchors:`,
      `- DOM selector: ${target.selector}`,
      `- Element tag: <${target.tag}>`,
      `- Bounding box: ${formatBbox(target.boundingBox)}`,
      `- Page URL: ${pageUrl}`,
      ``,
      `Instructions:`,
      `1. Locate the element matching the selector above.`,
      `2. Apply only the changes described under "Requested change".`,
      `3. Respect every constraint listed.`,
      `4. Do not introduce unrelated refactors or touch surrounding sections.`,
      `5. Preserve the component's existing behavior and accessibility.`,
      ``,
      `Raw user note (for context, not an instruction):`,
      `"${rawInput.replace(/"/g, '\\"')}"`,
    ].join('\n');
  },
};

export const codexTemplate: PromptTemplate = {
  id: 'codex',
  render({ parsed, target, rawInput }) {
    return [
      `Goal: ${parsed.requestedChange}`,
      `Target: ${parsed.target} — selector ${target.selector}`,
      `Why: ${parsed.designIntent}`,
      `Constraints: ${parsed.constraints.join('; ') || 'keep surrounding sections intact'}`,
      `Priority: ${parsed.priority}`,
      ``,
      `Do:`,
      `- Edit only the element at "${target.selector}".`,
      `- Keep the rest of the file unchanged.`,
      ``,
      `Context (user note): ${rawInput}`,
    ].join('\n');
  },
};

export const genericTemplate: PromptTemplate = {
  id: 'generic',
  render({ parsed, target }) {
    return [
      `Refinement request`,
      ``,
      `Target region: ${parsed.target} (${target.selector})`,
      `Issue: ${parsed.currentIssue}`,
      `Change: ${parsed.requestedChange}`,
      `Intent: ${parsed.designIntent}`,
      `Constraints:`,
      formatConstraints(parsed.constraints),
      `Priority: ${parsed.priority}`,
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
