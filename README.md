# Interface Finetuning Layer — Chrome Extension (MVP)

A locally-installable Chrome extension that turns any AI-generated preview page into a
precise **refinement workflow**:

1. Enable Refine Mode on the page.
2. Hover + click a meaningful region (card, section, CTA, iframe block, …).
3. Describe the change via typed note **or** voice recording.
4. The extension converts the raw intent into structured refinement data.
5. It generates copy-ready prompts for **Claude Code**, **Codex**, and a generic fallback.
6. Paste the prompt back into your AI coding workflow and re-run.

This is an MVP: the transcription and parser are mocked behind swappable service
interfaces. No cloud, no sync, no auto-code-modification — just the finetuning layer.

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
6. In the panel, type or record what should change.
7. Click **Generate prompts**.
8. Copy the Claude Code or Codex prompt and paste it back into your coding tool.
9. Export the whole session as JSON or Markdown when done.

---

## Architecture

```
src/
├── background/          Service worker — message hub + per-tab refine state
├── content/             Overlay, hover highlight, meaningful-target picker, selector gen
├── panel/               React side panel UI
│   └── components/
├── shared/              Types, messages, small utils (id, nowIso, truncate)
├── storage/             chrome.storage.local wrapper for items + pending selection
└── services/
    ├── transcription/   Speech-to-text interface (mock implementation included)
    ├── parser/          Raw-text → structured refinement (rule-based mock)
    ├── promptTemplates/ Claude Code / Codex / Generic prompt renderers
    └── export/          JSON + Markdown serialization + download helper
```

### Runtime flow

```
[content] pointermove → pickMeaningfulTarget → overlay highlight
[content] click       → buildSelectedTarget  → chrome.runtime.sendMessage TARGET_SELECTED
[background] stores pending selection in chrome.storage.local
[panel] subscribes to storage changes → loads pending selection
[panel] user types / records → parser.parse() → promptTemplates.generatePrompts()
[panel] saves RefinementItem to chrome.storage.local.refinementItems[]
```

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

## Known limitations (MVP)

- **Cross-origin iframes** are treated as opaque blocks — the extension selects the
  `<iframe>` element but cannot traverse into its document.
- **Dynamic DOM** — if the page rerenders after selection, the stored selector may no
  longer match. The user can re-select.
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
- **Selector robustness** — today we generate structural selectors (`main > section:nth-of-type(2) > …`).
  Consider capturing a fingerprint (text hash, size, position) so re-selection works
  after rerenders.
- **Side panel → content script** hot-reload coordination — currently the panel
  listens to storage changes; a push channel would feel snappier.
- **Tests** — none yet. Start with the selector/labeler/parser, all of which are pure.

---

## Handoff notes

- Every module file is kept short and single-purpose on purpose — easier for another
  coding agent (Codex, etc.) to extend.
- Service interfaces are declared alongside their default mock. A real implementation
  should drop into the same file or a sibling file and re-export from `index.ts`.
- `shared/types.ts` is the single source of truth for the data model. Keep it in sync
  with the `RefinementItem` contract when extending.
