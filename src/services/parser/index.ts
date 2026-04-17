import type { EditDiff, ParsedRefinement, SelectedTarget } from '../../shared/types';

export type ParserInput = {
  rawInput: string;
  target: SelectedTarget;
  diffs?: EditDiff[];
};

export interface RefinementParser {
  readonly id: string;
  parse(input: ParserInput): Promise<ParsedRefinement>;
}

const ISSUE_REGEX =
  /\b(too|feels|looks|cluttered|crowded|weak|small|large|unclear|confusing|dense|sparse|busy|empty|boring|ugly|hard|tight|cramped|plain|noisy|messy|stale)\b/i;
const CHANGE_REGEX =
  /\b(make|change|update|add|remove|increase|decrease|improve|enhance|shrink|grow|swap|replace|reorder|highlight|dim|hide|show|move|align|simplify)\b/i;
const INTENT_REGEX =
  /\b(intent|goal|feel|vibe|premium|minimal|playful|serious|trustworthy|modern|bold|quiet|calm|confident|friendly|luxury|refined)\b/i;
const CONSTRAINT_CUES =
  /\b(don'?t|do not|avoid|keep|preserve|maintain|must not|mustn'?t|without|only|exclude)\b/i;

class MockParser implements RefinementParser {
  readonly id = 'mock-rules';

  async parse({ rawInput, target, diffs = [] }: ParserInput): Promise<ParsedRefinement> {
    const text = rawInput.trim();
    if (!text && diffs.length > 0) {
      const requestedChange = summarizeDiffsAsRequestedChange(diffs);
      const currentIssue = summarizeDiffsAsIssue(diffs, target.label);
      return {
        target: target.label,
        currentIssue,
        requestedChange,
        designIntent: 'Make the shipped implementation match the direct edits already applied in the local preview.',
        constraints: defaultConstraints(),
        implementationNotes: inferImplementationNotes({
          rawInput: requestedChange,
          target,
          currentIssue,
          requestedChange,
        }),
      };
    }

    if (!text) {
      return {
        target: target.label,
        currentIssue: '(no user input provided)',
        requestedChange: '(describe the change)',
        designIntent: '(describe the intent)',
        constraints: defaultConstraints(),
        implementationNotes: defaultImplementationNotes(target.label),
      };
    }

    const sentences = splitSentences(text);
    const constraints = detectConstraints(sentences);
    const currentIssue = findFirst(sentences, ISSUE_REGEX) ?? defaultIssueFromInput(text);
    const requestedChange = findFirst(sentences, CHANGE_REGEX) ?? defaultChangeFromInput(text);
    const designIntent = findFirst(sentences, INTENT_REGEX) ?? defaultIntent(target.label);

    return {
      target: target.label,
      currentIssue,
      requestedChange,
      designIntent,
      constraints: constraints.length ? constraints : defaultConstraints(),
      implementationNotes: inferImplementationNotes({
        rawInput: text,
        target,
        currentIssue,
        requestedChange,
      }),
    };
  }
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function detectConstraints(sentences: string[]): string[] {
  const out: string[] = [];
  for (const s of sentences) {
    if (CONSTRAINT_CUES.test(s)) {
      out.push(cleanSentence(s));
    }
  }
  return out.slice(0, 5);
}

function findFirst(sentences: string[], re: RegExp): string | null {
  for (const s of sentences) if (re.test(s)) return cleanSentence(s);
  return null;
}

function cleanSentence(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function defaultIssueFromInput(text: string): string {
  const first = text.split(/(?<=[.!?])\s+/)[0] ?? text;
  return cleanSentence(first).slice(0, 160);
}

function defaultChangeFromInput(text: string): string {
  return cleanSentence(text).slice(0, 240);
}

function defaultIntent(label: string): string {
  return `Improve the ${label} so it better serves the user's stated goal.`;
}

function defaultConstraints(): string[] {
  return ['Keep the current layout structure', 'Do not modify surrounding sections'];
}

function defaultImplementationNotes(label: string): string[] {
  return [
    `Inspect how the ${label} is currently rendered before changing it.`,
    `Prefer extending the existing component state/props model instead of patching the DOM directly.`,
  ];
}

function summarizeDiffsAsIssue(diffs: EditDiff[], label: string): string {
  if (diffs.length === 1) {
    const diff = diffs[0];
    if (diff.type === 'hide') return `${diff.target} is hidden in the preview but that behavior is not implemented in source yet.`;
    if (diff.type === 'remove') return `${diff.target} is removed in the preview but the real implementation still renders it.`;
    if (diff.type === 'text_change') {
      return `${diff.target} copy was changed in the preview, but the source implementation still uses the previous text.`;
    }
    return `${diff.target} was reordered in the preview, but the shipped implementation does not match that structure yet.`;
  }

  return `${label} has direct preview edits that still need to be implemented in the actual code.`;
}

function summarizeDiffsAsRequestedChange(diffs: EditDiff[]): string {
  return diffs
    .map((diff) => {
      if (diff.type === 'hide') return `Hide ${diff.target}.`;
      if (diff.type === 'remove') return `Remove ${diff.target}.`;
      if (diff.type === 'text_change') {
        return `Update ${diff.target} text from "${diff.before}" to "${diff.after}".`;
      }
      return `Reorder ${diff.target} to match the preview order.`;
    })
    .join(' ');
}

function inferImplementationNotes({
  rawInput,
  target,
  currentIssue,
  requestedChange,
}: {
  rawInput: string;
  target: SelectedTarget;
  currentIssue: string;
  requestedChange: string;
}): string[] {
  const haystack = `${rawInput} ${currentIssue} ${requestedChange} ${target.label} ${target.snippet}`.toLowerCase();
  const notes = new Set<string>();

  notes.add(`Inspect the existing component/file for ${target.label} and follow its current structure before editing.`);

  if (/\b(collapse|expand|open|close|toggle|accordion|drawer|modal|popover|dropdown|sheet|tab)\b/i.test(haystack)) {
    notes.add('Model the interaction with explicit component state such as `isOpen`, `expandedSection`, or a status enum instead of a one-off DOM/style change.');
    notes.add('Wire the trigger to update that state and derive visibility, height, and transition behavior from it consistently.');
  }

  if (/\b(collapse|close|expand|open|status|state|mode|variant|selected|active|current)\b/i.test(haystack)) {
    notes.add('If the UI has more than two meaningful states, introduce a dedicated status/variant value rather than overloading a single boolean.');
  }

  if (/\b(show|hide|dismiss|remove)\b/i.test(haystack)) {
    notes.add('Implement visibility changes through component state or conditional rendering in source, not only through manual DOM removal.');
  }

  if (/\b(loading|error|success|empty|disabled|hover|focus|pressed)\b/i.test(haystack)) {
    notes.add('Keep visual states driven by props/state and synchronize any accessibility attributes with the rendered state.');
  }

  if (target.tag === 'button' || target.tag === 'a' || /\b(click|tap|trigger)\b/i.test(haystack)) {
    notes.add('Update the interaction handler and supporting accessibility attributes such as `aria-expanded`, `aria-controls`, or `aria-hidden` when relevant.');
  }

  if (/\b(copy|label|text|headline|title|cta)\b/i.test(haystack)) {
    notes.add('Update source copy/constants/translations in the component data flow instead of hardcoding text ad hoc in the markup.');
  }

  return Array.from(notes).slice(0, 5);
}

// TODO: swap for an LLM-backed parser once available.
export const refinementParser: RefinementParser = new MockParser();
