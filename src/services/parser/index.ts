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
const PRESERVE_CUES = /\b(keep|preserve|maintain|retain)\b/i;
const DO_NOT_TOUCH_CUES =
  /\b(don'?t|do not|must not|mustn'?t|avoid|leave alone|exclude|without touching|except)\b/i;

class MockParser implements RefinementParser {
  readonly id = 'mock-rules';

  async parse({ rawInput, target, diffs = [] }: ParserInput): Promise<ParsedRefinement> {
    const text = rawInput.trim();
    if (!text && diffs.length > 0) {
      const requestedChange = summarizeDiffsAsRequestedChange(diffs);
      const currentIssue = summarizeDiffsAsIssue(diffs, target.label);
      return withDefaultGuardrails(
        {
          target: target.label,
          currentIssue,
          requestedChange,
          designIntent:
            'Make the shipped implementation match the direct edits already applied in the local preview.',
          constraints: [],
          implementationNotes: inferImplementationNotes({
            rawInput: requestedChange,
            target,
            currentIssue,
            requestedChange,
          }),
        },
        target,
        [],
      );
    }

    if (!text) {
      return withDefaultGuardrails(
        {
          target: target.label,
          currentIssue: '',
          requestedChange: '',
          designIntent: '',
          constraints: [],
          implementationNotes: defaultImplementationNotes(target.label),
        },
        target,
        [],
      );
    }

    const sentences = splitSentences(text);
    const constraints = detectConstraints(sentences);
    const currentIssue = findFirst(sentences, ISSUE_REGEX) ?? defaultIssueFromInput(text);
    const requestedChange = findFirst(sentences, CHANGE_REGEX) ?? defaultChangeFromInput(text);
    const designIntent = findFirst(sentences, INTENT_REGEX) ?? defaultIntent(target.label);

    return withDefaultGuardrails(
      {
        target: target.label,
        currentIssue,
        requestedChange,
        designIntent,
        constraints,
        implementationNotes: inferImplementationNotes({
          rawInput: text,
          target,
          currentIssue,
          requestedChange,
        }),
      },
      target,
      sentences,
    );
  }
}

function withDefaultGuardrails(
  parsed: ParsedRefinement,
  target: SelectedTarget,
  sentences: string[],
): ParsedRefinement {
  const { preserve, doNotTouch, leftoverConstraints } = partitionGuardrails(
    parsed.constraints,
    sentences,
    target,
  );
  return {
    ...parsed,
    constraints: leftoverConstraints,
    preserve,
    doNotTouch,
  };
}

function partitionGuardrails(
  constraints: string[],
  sentences: string[],
  target: SelectedTarget,
): { preserve: string[]; doNotTouch: string[]; leftoverConstraints: string[] } {
  const preserve = new Set<string>();
  const doNotTouch = new Set<string>();
  const leftover: string[] = [];

  for (const entry of constraints) {
    if (PRESERVE_CUES.test(entry)) preserve.add(entry);
    else if (DO_NOT_TOUCH_CUES.test(entry)) doNotTouch.add(entry);
    else leftover.push(entry);
  }

  // Scan remaining sentences for preserve/do-not-touch cues that weren't
  // already captured by detectConstraints (which returns raw sentences).
  for (const sentence of sentences) {
    if (PRESERVE_CUES.test(sentence) && !constraints.includes(sentence)) {
      preserve.add(cleanSentence(sentence));
    }
    if (DO_NOT_TOUCH_CUES.test(sentence) && !constraints.includes(sentence)) {
      doNotTouch.add(cleanSentence(sentence));
    }
  }

  if (preserve.size === 0) {
    preserve.add(`Keep the ${target.label}'s existing behavior and accessibility.`);
  }
  if (doNotTouch.size === 0) {
    doNotTouch.add('Do not modify sections of the page outside the selected region.');
  }

  return {
    preserve: Array.from(preserve).slice(0, 5),
    doNotTouch: Array.from(doNotTouch).slice(0, 5),
    leftoverConstraints: leftover.slice(0, 5),
  };
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
    if (diff.type === 'move') {
      return `${diff.target} was dragged into a different parent in the preview, but the shipped layout still renders it in its original position.`;
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
      if (diff.type === 'move') {
        const dest = diff.toBeforeLabel
          ? `before ${diff.toBeforeLabel}`
          : 'at the end';
        return `Move ${diff.target} into ${diff.toParentLabel} (${dest}).`;
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
