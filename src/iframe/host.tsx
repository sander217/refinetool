// iframe-host: the parent-side bootstrap for the iframe-embedded variant.
// Renders a thin panel beside the artifact iframe, wires the postmessage
// transport, and injects the companion script into the iframe before use.
//
// Standalone demo: src/iframe/host.html loads this entry against a sample
// artifact in src/iframe/sample-artifact.html — open it via `pnpm dev:iframe`.
//
// Sanstudio integration: import { mountIframePanel } from this module and
// pass your own iframe element + the artifact URL. The panel will postMessage
// directly to the iframe; nothing else is required on sanstudio's side.

import { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { createPostMessageTransport } from '../transports/postmessage';
import type { Transport } from '../transports/types';
import { describeEditDiff } from '../shared/editDiffs';
import type { EditDiff, PendingSelection, RefinementItem } from '../shared/types';

export interface MountOptions {
  /**
   * The DOM node to mount the panel UI into. The panel does not own the
   * iframe — you provide both.
   */
  panelHost: HTMLElement;
  /**
   * The artifact iframe. Either already in the DOM, or freshly created and
   * about to be inserted. Companion injection happens on iframe `load`.
   */
  iframe: HTMLIFrameElement;
  /**
   * URL to the companion bundle (built from src/iframe/companion.ts as
   * `dist-iframe/companion.iife.js`). The host fetches this and injects the
   * text into the iframe document so it can attach to the artifact's DOM.
   *
   * In the standalone demo, the path is /companion.iife.js (served by Vite).
   * In sanstudio, the host page chooses where to serve the bundle from.
   */
  companionUrl: string;
  /**
   * Origin restriction for postMessage. Use '*' for srcdoc artifacts (most
   * common with sanstudio); use the artifact's origin for cross-origin URLs.
   */
  targetOrigin?: string;
}

export function mountIframePanel(opts: MountOptions): { unmount: () => void } {
  const { panelHost, iframe, companionUrl, targetOrigin = '*' } = opts;

  void injectCompanion(iframe, companionUrl);
  const transport = createPostMessageTransport({ iframe, targetOrigin });
  const root = createRoot(panelHost);
  root.render(<Panel transport={transport} />);

  return {
    unmount() {
      root.unmount();
    },
  };
}

/**
 * Fetches the companion bundle text and injects it into the iframe document.
 * Re-fires on every iframe `load` so refreshing the artifact reattaches.
 */
async function injectCompanion(iframe: HTMLIFrameElement, companionUrl: string): Promise<void> {
  let companionText: string | null = null;
  async function loadText(): Promise<string> {
    if (companionText) return companionText;
    const res = await fetch(companionUrl);
    if (!res.ok) throw new Error(`companion fetch ${res.status}`);
    companionText = await res.text();
    return companionText;
  }

  const inject = async () => {
    try {
      const doc = iframe.contentDocument;
      if (!doc) {
        console.warn('[ifl-host] iframe.contentDocument unavailable — same-origin required');
        return;
      }
      // Skip if already injected on this navigation.
      if (doc.getElementById('ifl-companion-script')) return;
      const text = await loadText();
      const script = doc.createElement('script');
      script.id = 'ifl-companion-script';
      script.textContent = text;
      doc.documentElement.appendChild(script);
    } catch (err) {
      console.error('[ifl-host] companion injection failed', err);
    }
  };

  iframe.addEventListener('load', () => void inject());
  if (iframe.contentDocument?.readyState === 'complete') await inject();
}

// ---- Panel UI -------------------------------------------------------------

function Panel({ transport }: { transport: Transport }) {
  const [refineOn, setRefineOn] = useState(false);
  const [pending, setPending] = useState<PendingSelection | null>(null);
  const [items, setItems] = useState<RefinementItem[]>([]);
  const [note, setNote] = useState('');
  const [editing, setEditing] = useState(false);

  // Initial load + subscribe to refinement-mode + storage broadcasts.
  useEffect(() => {
    let cancelled = false;
    void transport.getRefineMode().then((s) => !cancelled && setRefineOn(s.enabled));
    void transport.getPendingSelection().then((p) => !cancelled && setPending(p));
    void transport.getItems().then((list) => !cancelled && setItems(list));
    const offMode = transport.onRefineModeChanged((s) => setRefineOn(s.enabled));
    const offStorage = transport.onStorageChanged((changes) => {
      if (changes.items !== undefined) setItems(changes.items);
      if (changes.pending !== undefined) setPending(changes.pending);
    });
    return () => {
      cancelled = true;
      offMode();
      offStorage();
    };
  }, [transport]);

  async function togglePicker() {
    const next = !refineOn;
    await transport.setRefineMode(next);
    setRefineOn(next);
  }

  async function startEdit() {
    if (!pending) return;
    const r = await transport.applyDirectEdit({ type: 'start_inline_text_edit' });
    if (r.ok) setEditing(true);
  }

  async function stopEdit() {
    const r = await transport.applyDirectEdit({ type: 'stop_inline_text_edit' });
    if (r.ok) setEditing(false);
    if (r.pending) setPending(r.pending);
  }

  async function hide() {
    const r = await transport.applyDirectEdit({ type: 'hide_selected' });
    if (r.ok && r.pending) setPending(r.pending);
  }

  async function remove() {
    const r = await transport.applyDirectEdit({ type: 'remove_selected' });
    if (r.ok && r.pending) setPending(r.pending);
  }

  async function discard() {
    await transport.applyDirectEdit({ type: 'reset_pending_selection', revert: true });
    setPending(null);
    setNote('');
    setEditing(false);
  }

  async function saveItem() {
    if (!pending) return;
    const item: RefinementItem = {
      id: `item-${Date.now()}`,
      pageUrl: pending.pageUrl,
      pageTitle: pending.pageTitle,
      target: pending.target,
      inputMode: 'text',
      rawInput: note,
      parsed: {
        target: pending.target.label,
        currentIssue: '',
        requestedChange: note,
        designIntent: '',
        constraints: [],
        implementationNotes: [],
      },
      diffs: pending.diffs,
      prompts: { claude: '', codex: '', generic: '' },
      createdAt: new Date().toISOString(),
    };
    const next = [item, ...items];
    await transport.setItems(next);
    await transport.clearPendingSelection();
    setItems(next);
    setPending(null);
    setNote('');
  }

  function exportJson() {
    const blob = new Blob([JSON.stringify(items, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `refinetool-export-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const diffSummary = useMemo(
    () => (pending ? pending.diffs.map(describeEditDiff) : []),
    [pending],
  );

  return (
    <div style={panelStyle}>
      <header style={headerStyle}>
        <strong>Refinetool · iframe</strong>
        <button onClick={togglePicker} style={refineOn ? btnPrimary : btn}>
          {refineOn ? 'Picker ON · click iframe' : 'Start picker'}
        </button>
      </header>

      {!pending && (
        <p style={hint}>
          Click <em>Start picker</em>, then click any region in the artifact iframe
          to select it.
        </p>
      )}

      {pending && (
        <section style={cardStyle}>
          <div style={{ marginBottom: 8 }}>
            <strong>{pending.target.label}</strong>
            <div style={meta}>{pending.target.tag}</div>
          </div>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What should change about this region?"
            rows={4}
            style={textareaStyle}
          />
          <div style={btnRow}>
            {!editing ? (
              <button onClick={startEdit} style={btn}>Edit text</button>
            ) : (
              <button onClick={stopEdit} style={btnPrimary}>Done editing</button>
            )}
            <button onClick={hide} style={btn}>Hide</button>
            <button onClick={remove} style={btn}>Remove</button>
            <button onClick={discard} style={btnGhost}>Discard</button>
          </div>
          {diffSummary.length > 0 && (
            <ul style={diffList}>
              {diffSummary.map((d, i) => (
                <li key={i}>{d}</li>
              ))}
            </ul>
          )}
          <button onClick={saveItem} disabled={!note.trim()} style={btnPrimary}>
            Save refinement
          </button>
        </section>
      )}

      {items.length > 0 && (
        <section>
          <header style={sectionHeader}>
            <span>Saved ({items.length})</span>
            <button onClick={exportJson} style={btnGhost}>
              Export JSON
            </button>
          </header>
          <ul style={itemsList}>
            {items.map((item) => (
              <li key={item.id} style={itemRow}>
                <strong>{item.target.label}</strong>
                <div style={meta}>{item.parsed.requestedChange}</div>
                <div style={metaSmall}>{item.diffs.length} diff(s)</div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

// ---- styles (inline so sanstudio doesn't need to import a CSS bundle) -----

const panelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
  padding: 16,
  fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
  fontSize: 13,
  color: '#0f172a',
  background: '#fff',
  height: '100%',
  overflow: 'auto',
};
const headerStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
};
const sectionHeader: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  margin: '12px 0 6px',
  color: '#475569',
};
const cardStyle: React.CSSProperties = {
  border: '1px solid #e2e8f0',
  borderRadius: 8,
  padding: 12,
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  background: '#f8fafc',
};
const textareaStyle: React.CSSProperties = {
  width: '100%',
  resize: 'vertical',
  border: '1px solid #cbd5e1',
  borderRadius: 6,
  padding: 8,
  fontFamily: 'inherit',
  fontSize: 13,
};
const btnRow: React.CSSProperties = { display: 'flex', gap: 6, flexWrap: 'wrap' };
const btn: React.CSSProperties = {
  padding: '6px 10px',
  borderRadius: 6,
  border: '1px solid #cbd5e1',
  background: '#fff',
  cursor: 'pointer',
  fontSize: 12,
};
const btnPrimary: React.CSSProperties = {
  ...btn,
  background: '#2563eb',
  color: '#fff',
  borderColor: '#2563eb',
};
const btnGhost: React.CSSProperties = { ...btn, color: '#64748b', borderColor: '#e2e8f0' };
const hint: React.CSSProperties = { color: '#64748b', fontSize: 12, lineHeight: 1.5 };
const meta: React.CSSProperties = { color: '#64748b', fontSize: 11 };
const metaSmall: React.CSSProperties = { color: '#94a3b8', fontSize: 10 };
const diffList: React.CSSProperties = {
  margin: 0,
  paddingLeft: 18,
  fontSize: 12,
  color: '#334155',
};
const itemsList: React.CSSProperties = { listStyle: 'none', padding: 0, margin: 0 };
const itemRow: React.CSSProperties = {
  borderBottom: '1px solid #f1f5f9',
  padding: '8px 0',
};
