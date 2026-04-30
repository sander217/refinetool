import type {
  EditDiff,
  GeneratedPrompts,
  RefinementArtifact,
  RefinementItem,
} from '../../shared/types';
import { describeImageReference, formatEditDiffForPrompt } from '../../shared/editDiffs';
import { buildArtifact } from '../artifact';

export interface PromptTemplate {
  readonly id: string;
  render(artifact: RefinementArtifact): string;
}

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
    case 'move': {
      const dest = diff.toBeforeLabel
        ? `before ${diff.toBeforeLabel}`
        : 'at end';
      return `Move ${diff.target} (${diff.selector}) from ${diff.fromParentLabel} (${diff.fromParentSelector}) -> ${diff.toParentLabel} (${diff.toParentSelector}), ${dest}`;
    }
    case 'image_replace_intent':
      return `Replace image in ${diff.target} (${diff.selector}) — ${describeImageReference(diff)}`;
    case 'image_regenerate_intent':
      return `Regenerate image in ${diff.target} (${diff.selector})${
        diff.prompt ? ` — hint: ${diff.prompt}` : ''
      }`;
    case 'style_change':
      return `${diff.property} change on ${diff.target} (${diff.selector}): ${diff.before} -> ${diff.after}`;
    case 'color_change':
      return `${diff.role} change on ${diff.target} (${diff.selector}): ${diff.before} -> ${diff.after}`;
  }
}

// ---- Shared helpers ----------------------------------------------------

function bulletList(items: string[]): string {
  return items.map((line) => `- ${line}`).join('\n');
}

function section(title: string, body: string | string[] | undefined): string | null {
  if (body == null) return null;
  if (Array.isArray(body)) {
    if (body.length === 0) return null;
    return `${title}:\n${bulletList(body)}`;
  }
  const trimmed = body.trim();
  if (!trimmed) return null;
  return `${title}:\n${trimmed}`;
}

function joinSections(sections: Array<string | null>): string {
  return sections.filter((s): s is string => Boolean(s)).join('\n\n');
}

function formatDiffs(diffs: EditDiff[]): string[] {
  return diffs.map((diff) => formatEditDiffForPrompt(diff).replace(/^- /, ''));
}

function diffsRedundantWithChange(
  diffs: EditDiff[],
  requestedChange: string,
): boolean {
  // If the parser summarized the diffs into requestedChange (empty raw note
  // path), don't repeat them in the prompt body.
  if (diffs.length === 0) return false;
  if (!requestedChange) return false;
  const normalized = requestedChange.toLowerCase();
  return diffs.every((diff) => {
    if (diff.type === 'hide') return normalized.includes('hide');
    if (diff.type === 'remove') return normalized.includes('remove');
    if (diff.type === 'text_change') {
      return normalized.includes('update') && normalized.includes(diff.after.toLowerCase().slice(0, 20));
    }
    return false;
  });
}

function shouldIncludeRawNote(raw: string, requestedChange: string): boolean {
  if (!raw.trim()) return false;
  // Skip when the parser echoed the note almost verbatim into requestedChange.
  return raw.trim().toLowerCase() !== requestedChange.trim().toLowerCase();
}

function shouldIncludeTranscript(transcript: string | undefined, raw: string): boolean {
  if (!transcript || !transcript.trim()) return false;
  return transcript.trim() !== raw.trim();
}

// ---- Claude ------------------------------------------------------------

export const claudeTemplate: PromptTemplate = {
  id: 'claude-code',
  render(artifact) {
    const { region, page, intent, constraints, diffs, userNote } = artifact;
    const showDiffs = diffs.length > 0 && !diffsRedundantWithChange(diffs, intent.requestedChange);

    const regionLines = [
      `- Region: ${region.label}`,
      `- Selector: ${region.selector}`,
      `- Element: <${region.tag}>`,
    ];
    if (region.breadcrumb.length) {
      regionLines.push(`- Path: ${region.breadcrumb.join(' › ')}`);
    }
    if (page.title || page.url) {
      regionLines.push(`- Page: ${page.title || '(untitled)'} — ${page.url}`);
    }

    return joinSections([
      `Scope: Modify ONLY the "${region.label}" region. Leave other sections of this page unchanged.`,
      section('Target', regionLines),
      showDiffs ? section('Direct edits already applied in preview', formatDiffs(diffs)) : null,
      section('Issue', intent.currentIssue),
      section('Requested change', intent.requestedChange),
      section('Design intent', intent.designIntent),
      section('Implementation direction', intent.implementationNotes),
      section('Preserve', constraints.preserve),
      section('Do not touch', constraints.doNotTouch),
      constraints.other.length ? section('Other constraints', constraints.other) : null,
      `Instructions:
1. Inspect the current implementation for this region before editing — match its component + state pattern.
2. Apply the requested change in source (not just the DOM). Preserve any direct edits already reflected above unless they're contradicted.
3. Respect every "Preserve" / "Do not touch" item and leave surrounding regions alone.`,
      shouldIncludeRawNote(userNote.raw, intent.requestedChange)
        ? section('Raw note (context, not instruction)', `"${userNote.raw.replace(/"/g, '\\"')}"`)
        : null,
      shouldIncludeTranscript(userNote.transcript, userNote.raw)
        ? section('Transcript', `"${(userNote.transcript ?? '').replace(/"/g, '\\"')}"`)
        : null,
    ]);
  },
};

// ---- Codex -------------------------------------------------------------

export const codexTemplate: PromptTemplate = {
  id: 'codex',
  render(artifact) {
    const { region, intent, constraints, diffs, userNote } = artifact;
    const showDiffs = diffs.length > 0 && !diffsRedundantWithChange(diffs, intent.requestedChange);

    const headerLines = [
      `Target: ${region.label} (${region.selector})`,
      intent.requestedChange ? `Goal: ${intent.requestedChange}` : null,
      intent.currentIssue ? `Issue: ${intent.currentIssue}` : null,
      intent.designIntent ? `Intent: ${intent.designIntent}` : null,
      intent.implementationNotes.length
        ? `Direction: ${intent.implementationNotes.join('; ')}`
        : null,
      constraints.preserve.length ? `Preserve: ${constraints.preserve.join('; ')}` : null,
      constraints.doNotTouch.length ? `Do not touch: ${constraints.doNotTouch.join('; ')}` : null,
    ].filter((line): line is string => Boolean(line));

    const body: string[] = [headerLines.join('\n')];
    if (showDiffs) {
      body.push(`Applied preview edits: ${formatDiffs(diffs).join('; ')}`);
    }
    body.push(
      [
        `Do:`,
        `- Edit only this region; implement in the component/state layer.`,
        `- Preserve already-applied preview edits unless contradicted.`,
      ].join('\n'),
    );
    if (shouldIncludeRawNote(userNote.raw, intent.requestedChange)) {
      body.push(`User note: ${userNote.raw}`);
    }
    return body.join('\n\n');
  },
};

// ---- Generic -----------------------------------------------------------

export const genericTemplate: PromptTemplate = {
  id: 'generic',
  render(artifact) {
    const { region, intent, constraints, diffs } = artifact;
    const showDiffs = diffs.length > 0 && !diffsRedundantWithChange(diffs, intent.requestedChange);

    return joinSections([
      `Refinement request`,
      `Target region: ${region.label} (${region.selector})`,
      showDiffs ? section('Direct preview edits', formatDiffs(diffs)) : null,
      section('Issue', intent.currentIssue),
      section('Change', intent.requestedChange),
      section('Intent', intent.designIntent),
      section('Implementation direction', intent.implementationNotes),
      section('Preserve', constraints.preserve),
      section('Do not touch', constraints.doNotTouch),
    ]);
  },
};

// ---- Handoff summary ---------------------------------------------------

export const summaryTemplate: PromptTemplate = {
  id: 'handoff-summary',
  render(artifact) {
    const { region, intent, constraints, diffs } = artifact;
    const parts: string[] = [];

    if (intent.requestedChange) {
      parts.push(
        `In the ${region.label}, ${lowerFirst(intent.requestedChange).replace(/\.$/, '')}.`,
      );
    } else if (diffs.length > 0) {
      parts.push(`Apply ${diffs.length} direct preview edit${diffs.length > 1 ? 's' : ''} captured in ${region.label}.`);
    } else {
      parts.push(`Refine the ${region.label}.`);
    }

    if (intent.currentIssue) {
      parts.push(`It currently ${lowerFirst(intent.currentIssue).replace(/\.$/, '')}.`);
    }
    if (intent.designIntent) {
      parts.push(`Goal: ${lowerFirst(intent.designIntent).replace(/\.$/, '')}.`);
    }
    if (constraints.preserve.length) {
      parts.push(`Preserve: ${constraints.preserve.join('; ')}.`);
    }
    if (constraints.doNotTouch.length) {
      parts.push(`Do not touch: ${constraints.doNotTouch.join('; ')}.`);
    }
    if (diffs.length) {
      parts.push(`${diffs.length} preview edit${diffs.length > 1 ? 's' : ''} already applied: ${formatDiffs(diffs).join('; ')}.`);
    }
    return parts.join(' ');
  },
};

function lowerFirst(s: string): string {
  if (!s) return s;
  return s.charAt(0).toLowerCase() + s.slice(1);
}

// ---- Public API --------------------------------------------------------

export function generatePromptsFromArtifact(artifact: RefinementArtifact): GeneratedPrompts {
  return {
    claude: claudeTemplate.render(artifact),
    codex: codexTemplate.render(artifact),
    generic: genericTemplate.render(artifact),
    summary: summaryTemplate.render(artifact),
  };
}

export function generatePromptsForItem(
  item: Pick<
    RefinementItem,
    | 'id'
    | 'createdAt'
    | 'pageUrl'
    | 'pageTitle'
    | 'target'
    | 'inputMode'
    | 'rawInput'
    | 'transcript'
    | 'parsed'
    | 'diffs'
    | 'changelog'
  >,
): GeneratedPrompts {
  const full: RefinementItem = {
    id: item.id,
    pageUrl: item.pageUrl,
    pageTitle: item.pageTitle,
    target: item.target,
    inputMode: item.inputMode,
    rawInput: item.rawInput,
    transcript: item.transcript,
    parsed: item.parsed,
    diffs: item.diffs,
    prompts: { claude: '', codex: '', generic: '' },
    createdAt: item.createdAt,
    changelog: item.changelog,
  };
  return generatePromptsFromArtifact(buildArtifact(full));
}

export function combinePromptsMarkdown(item: RefinementItem): string {
  const blocks = [
    `# Refinement — ${item.parsed.target}`,
    '',
    `## Handoff summary`,
    item.prompts.summary ?? '(not generated)',
    '',
    `## Claude Code`,
    '```text',
    item.prompts.claude,
    '```',
    '',
    `## Codex`,
    '```text',
    item.prompts.codex,
    '```',
    '',
    `## Generic`,
    '```text',
    item.prompts.generic,
    '```',
  ];
  return blocks.join('\n');
}
