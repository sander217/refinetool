import type { ParsedRefinement, Priority, SelectedTarget } from '../../shared/types';

export type ParserInput = {
  rawInput: string;
  target: SelectedTarget;
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

  async parse({ rawInput, target }: ParserInput): Promise<ParsedRefinement> {
    const text = rawInput.trim();
    if (!text) {
      return {
        target: target.label,
        currentIssue: '(no user input provided)',
        requestedChange: '(describe the change)',
        designIntent: '(describe the intent)',
        constraints: defaultConstraints(),
        priority: 'medium',
      };
    }

    const sentences = splitSentences(text);
    const priority = detectPriority(text);
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
      priority,
    };
  }
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function detectPriority(text: string): Priority {
  if (/\b(urgent|critical|asap|blocker|high priority|must)\b/i.test(text)) return 'high';
  if (/\b(nice to have|when you have time|low priority|minor|later)\b/i.test(text)) return 'low';
  return 'medium';
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

// TODO: swap for an LLM-backed parser once available.
export const refinementParser: RefinementParser = new MockParser();
