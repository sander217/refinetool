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
  createdAt: string;
};

export type PendingSelection = {
  pageUrl: string;
  pageTitle: string;
  target: SelectedTarget;
  capturedAt: string;
};

export const STORAGE_KEYS = {
  items: 'iflRefinementItems',
  pending: 'iflPendingSelection',
} as const;
