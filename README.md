# Interface Finetuning Layer

A region-picker + annotation + diff-capture tool for refining AI-generated UI.

Ships in **two forms** that share the same core (DOM picker, overlay, diff types, services):

1. **Chrome extension** — operates on any AI tool's output (v0, Lovable, Bolt, raw Claude HTML…)
2. **Embedded iframe panel** — drops into any host page that previews artifacts in an iframe (e.g. sanstudio's Gate 3 preview)

Both produce the same `RefinementItem` shape, so downstream prompt generation, JSON export, and integration with Claude Code / Codex work identically.

---

## Form 1 — Chrome extension

```bash
npm install
npm run build
```

Load `dist/` as an unpacked extension in `chrome://extensions`.

---

## Form 2 — Embedded iframe panel

For host pages that already render their AI output in an iframe (sanstudio, internal tools, etc.). No extension install required for end users.

### Build

```bash
npm install
npm run build:iframe
```

Outputs:
- `dist-iframe/` — the host bundle (HTML + JS)
- `public/companion.iife.js` — the script the host injects into the artifact iframe

### Local demo

```bash
npm run dev:iframe
```

Opens `http://localhost:5174` with a sample artifact + the panel beside it. Click **Start picker**, click any region in the iframe, edit/hide/remove, save the refinement, export JSON.

### Embedding in a host page

```ts
import { mountIframePanel } from 'refinetool/iframe/host';

const iframe = document.getElementById('artifact-iframe') as HTMLIFrameElement;
const panelHost = document.getElementById('refine-panel');

mountIframePanel({
  panelHost,
  iframe,
  companionUrl: '/companion.iife.js',  // wherever you serve the bundle
  targetOrigin: '*',                    // or the artifact's origin if cross-origin
});
```

### Architecture

```text
host page (parent)                            artifact iframe
┌─────────────────────────────┐               ┌─────────────────────────┐
│ Panel UI (React)            │               │ generated artifact      │
│  ↳ postmessage transport    │ ← postMessage │  ↳ refine-companion.js  │
│       .send(req)            │ ─────────→    │       .handle(req)      │
│                             │ ←──────────── │                         │
└─────────────────────────────┘    response   └─────────────────────────┘
```

The companion is a ~30 kB bundle that imports the same `dom.ts` (picker) and `overlay.ts` (visuals) the Chrome content script uses. State (items, pending) lives in the host's `localStorage` instead of `chrome.storage`.

### Iframe scope (v1)

| Capability | Status |
|---|---|
| Region picking | ✅ |
| Inline text edit | ✅ |
| Hide / remove | ✅ |
| Annotation + save | ✅ |
| JSON export | ✅ |
| Reorder | ⏳ port from content/index.ts |
| Drag-to-move | ⏳ |
| Image intent (replace / regenerate) | ⏳ |
| Style nudges (font / position / radius) | ⏳ |

The Chrome extension still has the full feature set; iframe variant is being grown incrementally to match. Adding a missing capability = extend `src/iframe/companion.ts`'s action handler + the panel buttons in `src/iframe/host.tsx`.

---

## Current workflow

1. Open an AI-generated preview page.
2. Open the side panel.
3. Enable **Refine Mode**.
4. Hover and click a meaningful region.
5. Add a typed note or voice note.
6. Optionally apply direct preview edits:
   - inline text editing
   - hide/remove the selected block
   - move the selected block up/down within its parent
7. Review captured diffs in the panel.
8. Generate and copy Claude Code or Codex prompts.

---

## Architecture

```text
src/
├── background/          Chrome service worker — message hub + per-tab refine mode
├── content/             Chrome content script — region picking + DOM ops + overlay
│   ├── dom.ts           PURE — picker + selector + breadcrumb (reused by iframe)
│   ├── overlay.ts       PURE — overlay creation + styles (reused by iframe)
│   └── index.ts         Chrome-coupled glue (full feature set)
├── panel/               React side panel UI (Chrome extension)
├── iframe/              Embedded iframe form
│   ├── companion.ts     Runs INSIDE the artifact iframe, mirrors content/index.ts core ops
│   ├── host.tsx         Runs in the host page, mounts panel + injects companion
│   ├── main.tsx         Standalone demo entry
│   └── host.html        Demo page
├── transports/          ★ Hybrid abstraction
│   ├── types.ts         Transport interface
│   ├── chrome.ts        Wraps chrome.runtime / chrome.storage
│   └── postmessage.ts   Wraps window.postMessage RPC + localStorage
├── services/
│   ├── parser/          Raw note -> structured refinement fields
│   ├── promptTemplates/ Prompt renderers for Claude Code / Codex / generic
│   ├── transcription/   Voice transcription abstraction (mocked)
│   └── export/          Session export helpers
├── shared/              Core types, messages, small utilities
└── storage/             chrome.storage.local wrappers
```

`content/dom.ts` and `content/overlay.ts` contain zero `chrome.*` calls — that's why both forms can share them. `services/`, `shared/types.ts`, and `shared/editDiffs.ts` are also transport-agnostic and shared.

The original runtime flow was:

```text
content selection -> background storage write -> panel loads pending target
panel note input -> parser -> prompt templates -> stored refinement item
```

That structure is still intact.

---

## What Was Added

### 1. Diff-aware session model

`shared/types.ts` now treats direct edits as part of the same refinement record:

- `PendingSelection.diffs`
- `RefinementItem.diffs`
- `EditDiff` union with `text_change`, `hide`, `remove`, and `reorder`

This keeps annotation intent and direct edits on one path instead of creating a parallel system.

### 2. Direct preview editing in the content script

The content layer now supports:

- inline text editing for visible text nodes inside the selected region
- hide/remove on the selected block
- constrained reorder up/down within the selected block's parent
- local diff capture while the preview updates immediately

The background worker now routes panel edit actions back into the content script and persists updated pending selection state into `chrome.storage.local`.

### 3. Diff-aware prompt generation

`services/promptTemplates` still owns prompt rendering, but now includes:

- target region context
- parsed note fields
- direct-edit diffs already applied in the preview
- clearer scope/constraint instructions for Claude Code and Codex

### 4. Panel upgrade

The side panel now shows:

- selected region metadata
- direct preview action buttons
- captured diff list on the pending selection
- diff list on saved refinement items
- diff editing/removal inside saved items
- prompt regeneration on note/parsed/diff updates

### 5. Export upgrade

Markdown and JSON exports now include direct-edit diffs alongside annotations and prompts.

---

## Assumptions Made

- Direct edits are local preview assists, not production code mutations.
- `remove` currently shares the same preview implementation as `hide` (`display: none`) but is stored as a distinct diff type for future expansion.
- Reorder is intentionally constrained to moving the selected element one position up/down within its current parent.
- Prompt accuracy matters more than building a sophisticated visual editing surface.
- The existing parser/transcription mocks remain in place; this handoff focused on extending the architecture cleanly rather than swapping those services out.

---

## Known Limitations

- Inline text editing is limited to simple visible text elements inside the selected region. It is not a rich text editor and may flatten markup in some edge cases.
- Saved refinement items store diffs, but editing those diffs in the panel does not replay them back onto the page DOM.
- Discarding a pending selection attempts to revert current direct edits in-page, but previously saved edits are not replayed/reverted globally across the session.
- `remove` is future-proofed in the data model but currently implemented visually the same as `hide`.
- Reorder works only within the selected element's current DOM parent and depends on a stable sibling structure.
- Cross-origin iframes are still opaque blocks.
- Selector stability is still heuristic-based; heavy rerenders can invalidate a pending selection.
- Voice transcription and note parsing are still mocked.

---

## Next Recommended Steps

1. Add tests around diff generation, reorder behavior, prompt rendering, and DOM target helpers.
2. Persist enough DOM fingerprints on diffs to support replay/revert of saved items across page reloads.
3. Replace the mock parser with an LLM-backed structured parser.
4. Replace the mock transcription service with a real provider.
5. Improve selector robustness with fallback fingerprints beyond CSS selectors.
6. Add a small undo surface for pending diffs directly in the active target card.
7. Add page-level QA for complex framework DOMs and shadow-DOM edge cases.

---

## Handoff Notes

- The direct-edit upgrade was added by extending the original architecture, not replacing it.
- `shared/types.ts` remains the single source of truth for the refinement/session contract.
- `services/promptTemplates` still owns prompt assembly; prompt logic was not moved into panel components.
- The content script owns preview mutation behavior; the panel triggers actions but does not mutate the DOM directly.
- The background worker remains the routing boundary between panel and content script.
