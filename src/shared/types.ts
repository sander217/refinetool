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
  // True when the selected element is an <img> or contains an <img>. Drives
  // the image-intent controls in the panel.
  hasImage: boolean;
};

export type InputMode = 'text' | 'voice';

export type ParsedRefinement = {
  target: string;
  currentIssue: string;
  requestedChange: string;
  designIntent: string;
  constraints: string[];
  implementationNotes: string[];
};

export type GeneratedPrompts = {
  claude: string;
  codex: string;
  generic: string;
};

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

export type RemoveDiff = EditDiffBase & { type: 'remove' };

export type HideDiff = EditDiffBase & { type: 'hide' };

export type ReorderDiff = EditDiffBase & {
  type: 'reorder';
  before: string[];
  after: string[];
};

// Image intents are captured-only — they don't mutate the live DOM. They tell
// a downstream execution system "replace this image" / "regenerate this image"
// and carry the reference material the user attached.
export type ImageReferenceKind = 'url' | 'figma' | 'note' | 'upload';

export type ImageReplaceIntentDiff = EditDiffBase & {
  type: 'image_replace_intent';
  originalSrc?: string;
  referenceKind: ImageReferenceKind;
  referenceUrl?: string;
  referenceNote?: string;
  // Populated for 'upload' — dataURL is assigned to <img>.src for live preview
  // and kept in storage so preview persists. Stripped from prompt output.
  dataUrl?: string;
  fileName?: string;
  fileSize?: number;
  mimeType?: string;
  // True when the live <img> in the page has been mutated by this intent
  // (URL + upload → true; figma + note → false).
  appliedToDom?: boolean;
};

export type ImageRegenerateIntentDiff = EditDiffBase & {
  type: 'image_regenerate_intent';
  originalSrc?: string;
  prompt?: string;
};

export type EditDiff =
  | TextChangeDiff
  | RemoveDiff
  | HideDiff
  | ReorderDiff
  | ImageReplaceIntentDiff
  | ImageRegenerateIntentDiff;

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
  tabId: number;
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
  | {
      type: 'attach_image_reference';
      referenceKind: ImageReferenceKind;
      referenceUrl?: string;
      referenceNote?: string;
      dataUrl?: string;
      fileName?: string;
      fileSize?: number;
      mimeType?: string;
    }
  | { type: 'mark_image_regenerate'; prompt?: string }
  | { type: 'clear_image_intent' }
  | { type: 'reset_pending_selection'; revert?: boolean };

export const STORAGE_KEYS = {
  items: 'iflRefinementItems',
  pending: 'iflPendingSelection',
} as const;
