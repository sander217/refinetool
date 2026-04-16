import { useCallback, useEffect, useState } from 'react';
import type { ExtensionMessage, RefineModeResponse } from '../shared/messages';
import type {
  PendingSelection,
  RefinementItem,
} from '../shared/types';
import { STORAGE_KEYS } from '../shared/types';
import {
  addItem,
  clearPendingSelection,
  deleteItem,
  getItems,
  getPendingSelection,
  setItems,
  subscribeToStorage,
  updateItem,
} from '../storage';
import { refinementParser } from '../services/parser';
import { generatePrompts } from '../services/promptTemplates';
import { uid, nowIso } from '../shared/utils';

import { Header } from './components/Header';
import { ActiveTargetCard } from './components/ActiveTargetCard';
import { NoteEditor } from './components/NoteEditor';
import { RefinementItemCard } from './components/RefinementItemCard';
import { ExportBar } from './components/ExportBar';

export default function App() {
  const [refineEnabled, setRefineEnabled] = useState(false);
  const [pending, setPending] = useState<PendingSelection | null>(null);
  const [items, setItemsState] = useState<RefinementItem[]>([]);
  const [draftInput, setDraftInput] = useState('');
  const [draftInputMode, setDraftInputMode] = useState<'text' | 'voice'>('text');
  const [isSaving, setIsSaving] = useState(false);
  const [pendingLabel, setPendingLabel] = useState('');

  // Initial load.
  useEffect(() => {
    let cancelled = false;
    void Promise.all([getItems(), getPendingSelection(), queryRefineMode()]).then(
      ([storedItems, storedPending, enabled]) => {
        if (cancelled) return;
        setItemsState(storedItems);
        setPending(storedPending);
        if (storedPending) setPendingLabel(storedPending.target.label);
        setRefineEnabled(enabled);
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  // React to storage changes (pending selection written by the content script).
  useEffect(() => {
    return subscribeToStorage((changes) => {
      if (STORAGE_KEYS.pending in changes) {
        const next = changes[STORAGE_KEYS.pending].newValue as PendingSelection | undefined;
        setPending(next ?? null);
        if (next) setPendingLabel(next.target.label);
      }
      if (STORAGE_KEYS.items in changes) {
        const next = changes[STORAGE_KEYS.items].newValue as RefinementItem[] | undefined;
        setItemsState(next ?? []);
      }
    });
  }, []);

  // Refine-mode broadcasts from the background worker.
  useEffect(() => {
    const listener = (msg: ExtensionMessage) => {
      if (msg.type === 'REFINE_MODE_CHANGED') {
        setRefineEnabled(msg.enabled);
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  const toggleRefine = useCallback(async (enabled: boolean) => {
    setRefineEnabled(enabled);
    try {
      await chrome.runtime.sendMessage({
        type: 'SET_REFINE_MODE',
        enabled,
      } satisfies ExtensionMessage);
    } catch (err) {
      console.warn('[IFL] toggleRefine failed', err);
    }
  }, []);

  const handleDiscardPending = useCallback(async () => {
    await clearPendingSelection();
    setPending(null);
    setDraftInput('');
    setPendingLabel('');
  }, []);

  const handleSave = useCallback(
    async (opts: { inputMode: 'text' | 'voice'; rawInput: string; transcript?: string }) => {
      if (!pending) return;
      setIsSaving(true);
      try {
        const effectiveTarget = {
          ...pending.target,
          label: pendingLabel.trim() || pending.target.label,
        };
        const parsed = await refinementParser.parse({
          rawInput: opts.rawInput,
          target: effectiveTarget,
        });
        const prompts = generatePrompts({
          parsed,
          target: effectiveTarget,
          pageUrl: pending.pageUrl,
          pageTitle: pending.pageTitle,
          rawInput: opts.rawInput,
        });
        const item: RefinementItem = {
          id: uid(),
          pageUrl: pending.pageUrl,
          pageTitle: pending.pageTitle,
          target: effectiveTarget,
          inputMode: opts.inputMode,
          rawInput: opts.rawInput,
          transcript: opts.transcript,
          parsed,
          prompts,
          createdAt: nowIso(),
        };
        const next = await addItem(item);
        setItemsState(next);
        await clearPendingSelection();
        setPending(null);
        setPendingLabel('');
        setDraftInput('');
      } finally {
        setIsSaving(false);
      }
    },
    [pending, pendingLabel],
  );

  const handleItemUpdate = useCallback(
    async (id: string, patch: Partial<RefinementItem>) => {
      const next = await updateItem(id, patch);
      setItemsState(next);
    },
    [],
  );

  const handleRegenerate = useCallback(
    async (id: string) => {
      const item = items.find((i) => i.id === id);
      if (!item) return;
      const prompts = generatePrompts({
        parsed: item.parsed,
        target: item.target,
        pageUrl: item.pageUrl,
        pageTitle: item.pageTitle,
        rawInput: item.rawInput,
      });
      const next = await updateItem(id, { prompts });
      setItemsState(next);
    },
    [items],
  );

  const handleReparse = useCallback(
    async (id: string) => {
      const item = items.find((i) => i.id === id);
      if (!item) return;
      const parsed = await refinementParser.parse({
        rawInput: item.rawInput,
        target: item.target,
      });
      const prompts = generatePrompts({
        parsed,
        target: item.target,
        pageUrl: item.pageUrl,
        pageTitle: item.pageTitle,
        rawInput: item.rawInput,
      });
      const next = await updateItem(id, { parsed, prompts });
      setItemsState(next);
    },
    [items],
  );

  const handleDelete = useCallback(async (id: string) => {
    const next = await deleteItem(id);
    setItemsState(next);
  }, []);

  const handleClearAll = useCallback(async () => {
    if (!confirm('Clear all refinement items in this session?')) return;
    await setItems([]);
    setItemsState([]);
  }, []);

  return (
    <div className="ifl-app">
      <Header
        refineEnabled={refineEnabled}
        onToggleRefine={toggleRefine}
        itemCount={items.length}
      />
      <main className="ifl-main">
        {pending ? (
          <>
            <ActiveTargetCard
              pending={pending}
              label={pendingLabel}
              onRenameLabel={setPendingLabel}
              onDiscard={handleDiscardPending}
            />
            <NoteEditor
              value={draftInput}
              onChange={setDraftInput}
              inputMode={draftInputMode}
              onInputModeChange={setDraftInputMode}
              isSaving={isSaving}
              onSave={handleSave}
            />
          </>
        ) : (
          <EmptyState refineEnabled={refineEnabled} onEnable={() => toggleRefine(true)} />
        )}

        <section className="ifl-section">
          <h2 className="ifl-section-title">Session ({items.length})</h2>
          {items.length === 0 ? (
            <p className="ifl-subtle ifl-subtle-small">No refinements captured yet.</p>
          ) : (
            <ul className="ifl-items">
              {items.map((item) => (
                <li key={item.id}>
                  <RefinementItemCard
                    item={item}
                    onUpdate={(patch) => handleItemUpdate(item.id, patch)}
                    onRegeneratePrompts={() => handleRegenerate(item.id)}
                    onReparse={() => handleReparse(item.id)}
                    onDelete={() => handleDelete(item.id)}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>

        <ExportBar items={items} onClearAll={handleClearAll} />
      </main>
    </div>
  );
}

function EmptyState({
  refineEnabled,
  onEnable,
}: {
  refineEnabled: boolean;
  onEnable: () => void;
}) {
  return (
    <section className="ifl-empty">
      <h2>Pick a region to refine</h2>
      <ol>
        <li>Open the AI-generated preview page in this tab.</li>
        <li>Enable <strong>Refine Mode</strong> (top right of this panel).</li>
        <li>Hover the page and click the region you want changed.</li>
        <li>Describe the change — typed or voice — and generate a prompt.</li>
      </ol>
      {!refineEnabled && (
        <button className="ifl-button ifl-button-primary" onClick={onEnable}>
          Enable Refine Mode
        </button>
      )}
    </section>
  );
}

async function queryRefineMode(): Promise<boolean> {
  try {
    const res = (await chrome.runtime.sendMessage({
      type: 'GET_REFINE_MODE',
    } satisfies ExtensionMessage)) as RefineModeResponse | undefined;
    return !!res?.enabled;
  } catch {
    return false;
  }
}
