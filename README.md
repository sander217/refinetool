# Interface Finetuning Layer — Chrome Extension

A locally-installable Chrome extension that turns any AI-generated preview page into a
precise **annotation + direct-edit refinement workflow**:

1. Enable Refine Mode on the page.
2. Hover + click a meaningful region (card, section, CTA, iframe block, …).
3. **Annotate**: describe the change via typed note **or** voice recording.
4. **Direct-edit**: inline-edit text, hide, remove, or reorder blocks on the page.
   Every direct edit is captured as a structured `EditDiff`.
5. The extension merges the note + diffs into structured refinement data.
6. It generates copy-ready prompts for **Claude Code**, **Codex**, and a generic
   fallback, with direct edits rendered as before→after specs inside each prompt.
7. Paste the prompt back into your AI coding workflow and re-run.

Transcription and parsing are mocked behind swappable service interfaces. No cloud,
no sync, no auto-code-modification — the extension is a refinement layer, not a
page builder or a Figma replacement.

---

## 1. Setup

```bash
cd /Users/sanderchen/Documents/Claude/Projects/interface-finetuning-extension
npm install
npm run build
```

The extension is emitted to `dist/`.

## 2. Load unpacked in Chrome

1. Open `chrome://extensions`.
2. Toggle **Developer mode** (top-right).
3. Click **Load unpacked** and pick the `dist/` folder produced above.
4. Pin **Interface Finetuning Layer** to your toolbar.

## 3. Use it

1. Open an AI-generated preview page in any tab.
2. Click the extension icon — the **side panel** opens.
3. Toggle **Refine Mode** in the panel header.
4. Hover over the page — the target region is highlighted.
5. Click to select. Press **Esc** to cancel refine mode at any time.
6. In the panel, optionally apply **direct edits** on the selected region:
   - **Edit text** → turns inline text inside the region editable; click Done to capture a `text_change` diff.
   - **Hide** → sets `display:none` and records a `hide` diff.
   - **Remove** → currently equivalent to hide (non-destructive in MVP); recorded as `remove`.
   - **Move up / Move down** → reorders the block among its parent's children; recorded as `reorder`.
   - Each captured diff has a **Revert** button that undoes just that edit.
7. Type or record what should change. The raw note + captured diffs both feed the prompts.
8. Click **Save refinement**.
9. Copy the Claude Code or Codex prompt (direct edits appear as before→after lines inside the prompt).
10. Export the whole session as JSON or Markdown when done.

---

## Architecture

```
src/
├── background/          Service worker — message hub + per-tab refine state + direct-edit relay
├── content/             Overlay, hover highlight, meaningful-target picker, selector gen,
│                        direct-edit engine (inline text editing, hide/remove, reorder, undo)
├── panel/               React side panel UI
│   └── components/      ActiveTargetCard, DirectEditPanel, DiffList, NoteEditor, RefinementItemCard, …
├── shared/              Types (incl. EditDiff union), messages, small utils
├── storage/             chrome.storage.local wrapper for items + pending selection
└── services/
    ├── transcription/   Speech-to-text interface (mock implementation included)
    ├── parser/          Raw-text → structured refinement (rule-based mock)
    ├── promptTemplates/ Claude Code / Codex / Generic prompt renderers (diffs merged in)
    └── export/          JSON + Markdown serialization (diffs included) + download helper
```

### Runtime flow

```
[content] pointermove → pickMeaningfulTarget → overlay highlight
[content] click       → buildSelectedTarget  → chrome.runtime.sendMessage TARGET_SELECTED
[background] stores pending selection (+ empty diffs[]) in chrome.storage.local
[panel] subscribes to storage changes → loads pending selection
[panel] direct-edit buttons → runtime.sendMessage →
  [background] relays to active tab →
    [content/edits.ts] startTextEdit / endTextEdit / applyBlockAction / revertDiff / clearAllEdits
    Each mutation records an EditDiff + an undo closure.
[panel] persists pending.diffs via storage; DirectEditPanel shows them with per-diff Revert.
[panel] user types / records → parser.parse() → promptTemplates.generatePrompts({ diffs }) →
  saves RefinementItem (including diffs[]) to chrome.storage.local.refinementItems[]
```

### Diff model

```ts
// shared/types.ts
type EditDiff =
  | TextChangeDiff   // before/after strings, selector scoped to the edited node
  | HideDiff         // display:none; undo restores original inline style
  | RemoveDiff       // alias of hide in the DOM layer (treated as a delete in the prompt)
  | ReorderDiff      // before/after = labelTarget() list of the parent's children
```

Each `applyBlockAction` / `endTextEdit` call produces an `EditDiff` *and* stashes an
undo closure in a `Map<diffId, AppliedEdit>` inside `content/edits.ts`. Reverts run
that closure; `clearAllEdits` unwinds in LIFO order so stacked reorder + hide
combinations restore cleanly.

### Service interfaces (swap mocks with real impls later)

```ts
// src/services/transcription
export interface TranscriptionService {
  readonly id: string;
  transcribe(audio: Blob): Promise<TranscriptionResult>;
}

// src/services/parser
export interface RefinementParser {
  readonly id: string;
  parse(input: ParserInput): Promise<ParsedRefinement>;
}

// src/services/promptTemplates
export interface PromptTemplate {
  readonly id: string;
  render(ctx: PromptContext): string;
}
```

Each service exports a concrete default (mock) that can be replaced with an API-backed
implementation without touching call sites.

---

## Known limitations

- **Cross-origin iframes** are treated as opaque blocks — the extension selects the
  `<iframe>` element but cannot traverse into its document for hover, edits, or diffs.
- **Dynamic DOM** — if the page rerenders after selection, the stored selector may no
  longer match. The user can re-select. Direct-edit undo closures hold references to
  the original DOM nodes, so a full rerender will invalidate pending reverts.
- **Direct-edit scope** is intentionally narrow: inline text, hide/remove,
  constrained sibling reorder. No drag-drop across parents, no style editing, no
  component surgery — those are out of scope and belong to the downstream AI tool.
- **Hide vs Remove** both currently apply `display:none` — the semantic difference is
  expressed in the prompt (“hide” → tolerate conditional rendering; “remove” → delete
  from source). A true DOM removal would make undo closures fragile.
- **Mock transcription** returns placeholder text; the user is expected to edit it
  before saving. Swap `services/transcription` for a real Whisper/Deepgram client.
- **Mock parser** is rule-based and coarse. Swap `services/parser` for an LLM-backed
  implementation when ready.
- **No cloud sync** — all data lives in `chrome.storage.local`, scoped to this profile.
- **No Chrome Web Store packaging** — this is a dev-mode unpacked extension.
- **Icons** intentionally omitted (Chrome shows a default puzzle icon); add PNGs to
  `public/` and reference them under `action.default_icon` in `manifest.config.ts`.

---

## TODOs for future agents

- `services/transcription/` — replace `MockTranscriber` with a real provider. Add a
  settings screen in the panel to configure the provider (API key, model, endpoint).
- `services/parser/` — swap `MockParser` for an LLM-backed parser. Consider streaming
  the parse with function-call-style JSON output so fields populate progressively.
- `services/promptTemplates/` — templates are currently plain string builders. If
  template variants proliferate, consider a small template DSL or a handlebars-style
  helper.
- `content/dom.ts` — the "meaningful target" heuristic is tuned for typical web UIs
  but misses uncommon frameworks. Consider supporting React DevTools-style fiber walks
  or shadow DOM traversal.
- `content/edits.ts` — `TEXT_EDITABLE_TAGS` is a conservative allow-list. Consider
  detecting inline editability via computed style (`white-space`, `display`) instead.
- **Selector robustness** — today we generate structural selectors (`main > section:nth-of-type(2) > …`).
  Consider capturing a fingerprint (text hash, size, position) so re-selection works
  after rerenders, and so diffs remain meaningful when the DOM mutates.
- **Diff replay** — export a mini "replay script" (JS snippet) alongside the prompt so
  a teammate can re-apply the direct edits in their browser for review.
- **Side panel → content script** hot-reload coordination — currently the panel
  listens to storage changes; a push channel would feel snappier.
- **Tests** — none yet. Start with the selector/labeler/parser/diff-describer, all pure.

---

## Handoff notes

- Every module file is kept short and single-purpose on purpose — easier for another
  coding agent (Codex, etc.) to extend.
- Service interfaces are declared alongside their default mock. A real implementation
  should drop into the same file or a sibling file and re-export from `index.ts`.
- `shared/types.ts` is the single source of truth for the data model. Keep it in sync
  with the `RefinementItem` contract when extending.
