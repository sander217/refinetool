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

export type TextChangeDiff = {
  id: string;
  type: 'text_change';
  target: string;
  before: string;
  after: string;
};

export type RemoveDiff = {
  id: string;
  type: 'remove';
  target: string;
};

export type HideDiff = {
  id: string;
  type: 'hide';
  target: string;
};

export type ReorderDiff = {
  id: string;
  type: 'reorder';
  target: string;
  before: string[];
  after: string[];
};

export type EditDiff = TextChangeDiff | RemoveDiff | HideDiff | ReorderDiff;

export type RefinementItem = {
  id: string;
  pageUrl: string;
  pageTitle: string;
  target: SelectedTarget;
  inputMode: InputMode;
  rawInput: string;
  transcript?: string;
  parsed: ParsedRefinement;
  diffs: EditDiff[];
  prompts: GeneratedPrompts;
  createdAt: string;
};

export type PendingSelection = {
  pageUrl: string;
  pageTitle: string;
  target: SelectedTarget;
  diffs: EditDiff[];
  capturedAt: string;
};

export type DirectEditAction =
  | { type: 'start_inline_text_edit' }
  | { type: 'stop_inline_text_edit' }
  | { type: 'hide_selected' }
  | { type: 'remove_selected' }
  | { type: 'reorder_selected'; direction: 'up' | 'down' }
  | { type: 'reset_pending_selection'; revert?: boolean };

export const STORAGE_KEYS = {
  items: 'iflRefinementItems',
  pending: 'iflPendingSelection',
} as const;
