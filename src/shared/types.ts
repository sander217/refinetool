export type BoundingBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type SelectedTarget = {
  selector: string;
  label: string;
  boundingBox: BoundingBox;
  snippet: string;
  tag: string;
};

export type InputMode = 'text' | 'voice';

export type Priority = 'low' | 'medium' | 'high';

export type ParsedRefinement = {
  target: string;
  currentIssue: string;
  requestedChange: string;
  designIntent: string;
  constraints: string[];
  priority: Priority;
};

export type GeneratedPrompts = {
  claude: string;
  codex: string;
  generic: string;
};

export type BlockAction = 'hide' | 'remove' | 'move_up' | 'move_down';

type EditDiffBase = {
  id: string;
  selector: string;
  target: string;
  createdAt: string;
};

export type TextChangeDiff = EditDiffBase & {
  type: 'text_change';
  before: string;
  after: string;
};

export type HideDiff = EditDiffBase & { type: 'hide' };
export type RemoveDiff = EditDiffBase & { type: 'remove' };

export type ReorderDiff = EditDiffBase & {
  type: 'reorder';
  before: string[];
  after: string[];
};

export type EditDiff = TextChangeDiff | HideDiff | RemoveDiff | ReorderDiff;

export type RefinementItem = {
  id: string;
  pageUrl: string;
  pageTitle: string;
  target: SelectedTarget;
  inputMode: InputMode;
  rawInput: string;
  transcript?: string;
  parsed: ParsedRefinement;
  prompts: GeneratedPrompts;
  diffs: EditDiff[];
  createdAt: string;
};

export type PendingSelection = {
  pageUrl: string;
  pageTitle: string;
  target: SelectedTarget;
  capturedAt: string;
  diffs: EditDiff[];
};

export const STORAGE_KEYS = {
  items: 'iflRefinementItems',
  pending: 'iflPendingSelection',
} as const;
