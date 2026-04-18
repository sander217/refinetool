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
  // Human-readable DOM path of meaningful ancestors from root → target, for
  // orientation in the panel. Last entry is the current target. Optional so
  // previously-stored selections from before this field existed still load.
  breadcrumb?: string[];
};

export type InputMode = 'text' | 'voice';

export type ParsedRefinement = {
  target: string;
  currentIssue: string;
  requestedChange: string;
  designIntent: string;
  constraints: string[];
  implementationNotes: string[];
  // Aspects of the selected region that must survive the change (a11y,
  // event handlers, data flow, copy the user did not touch, etc.).
  preserve?: string[];
  // Regions or concerns outside the selected target that must not be
  // modified (other sections on the page, unrelated files, shared styles).
  doNotTouch?: string[];
};

export type GeneratedPrompts = {
  claude: string;
  codex: string;
  generic: string;
  // One-paragraph human-readable handoff. Sits alongside the code-agent
  // prompts so a reviewer can grok the change without parsing the long form.
  summary?: string;
};

export type ChangelogKind = 'created' | 'edited' | 'reparsed' | 'regenerated';

export type ChangelogEntry = {
  at: string;
  kind: ChangelogKind;
  note?: string;
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

export type RemoveDiff = EditDiffBase & {
  type: 'remove';
  // Short snippet / label of what was removed. Survives the DOM node being
  // detached so downstream prompts can still reference it concretely.
  preview?: string;
};

export type HideDiff = EditDiffBase & {
  type: 'hide';
  preview?: string;
};

export type ReorderDiff = EditDiffBase & {
  type: 'reorder';
  before: string[];
  after: string[];
  // The label of the child that moved and the direction it was moved. Gives
  // prompt output a pointable "X moved up past Y" rather than just two lists.
  movedLabel?: string;
  direction?: 'up' | 'down';
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

// Preview-only style nudges: position (transform translate), font size,
// border radius, and explicit width/height. One diff per property per
// region — repeated adjustments update the same diff's `after` value.
export type StyleProperty =
  | 'translate'
  | 'fontSize'
  | 'borderRadius'
  | 'width'
  | 'height';

export type StyleChangeDiff = EditDiffBase & {
  type: 'style_change';
  property: StyleProperty;
  // Human-readable before/after values, e.g. "16px", "translate(4px, -8px)",
  // "120×40px". Prompt output cites these directly.
  before: string;
  after: string;
};

export type EditDiff =
  | TextChangeDiff
  | RemoveDiff
  | HideDiff
  | ReorderDiff
  | ImageReplaceIntentDiff
  | ImageRegenerateIntentDiff
  | StyleChangeDiff;

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
  // Append-only edit history for the item. Optional because legacy records
  // from earlier sessions won't have this field.
  changelog?: ChangelogEntry[];
};

// Structured, schema-stable output for downstream execution systems. Built
// from a RefinementItem on demand — not persisted directly.
export type RefinementArtifact = {
  schemaVersion: '1';
  id: string;
  createdAt: string;
  page: { url: string; title: string };
  region: {
    label: string;
    selector: string;
    tag: string;
    breadcrumb: string[];
    boundingBox: BoundingBox;
    snippet: string;
    hasImage: boolean;
  };
  intent: {
    currentIssue: string;
    requestedChange: string;
    designIntent: string;
    implementationNotes: string[];
  };
  constraints: {
    preserve: string[];
    doNotTouch: string[];
    other: string[];
  };
  diffs: EditDiff[];
  userNote: {
    raw: string;
    transcript?: string;
    inputMode: InputMode;
  };
  changelog: ChangelogEntry[];
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
  | { type: 'nudge_position'; direction: 'up' | 'down' | 'left' | 'right' }
  | { type: 'adjust_font_size'; direction: 'up' | 'down' }
  | { type: 'adjust_border_radius'; direction: 'up' | 'down' }
  | { type: 'adjust_size'; axis: 'width' | 'height'; direction: 'up' | 'down' }
  | { type: 'reset_style_adjustments' }
  | { type: 'reset_pending_selection'; revert?: boolean };

export const STORAGE_KEYS = {
  items: 'iflRefinementItems',
  pending: 'iflPendingSelection',
} as const;
