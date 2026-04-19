import { useCallback, useEffect, useRef, useState } from 'react';
import type { ExtensionMessage, RefineModeResponse } from '../shared/messages';
import type {
  DirectEditAction,
  EditDiff,
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
  updatePendingSelection,
} from '../storage';
import { refinementParser } from '../services/parser';
import { generatePromptsForItem } from '../services/promptTemplates';
import { appendChangelog } from '../services/artifact';
import { nowIso, uid } from '../shared/utils';

import { ActiveTargetCard } from './components/ActiveTargetCard';
import { ExportBar } from './components/ExportBar';
import { Header } from './components/Header';
import { NoteEditor } from './components/NoteEditor';
import { RefinementItemCard } from './components/RefinementItemCard';

export default function App() {
  const [refineEnabled, setRefineEnabled] = useState(false);
  const [pending, setPending] = useState<PendingSelection | null>(null);
  const [items, setItemsState] = useState<RefinementItem[]>([]);
  const [draftInput, setDraftInput] = useState('');
  const [draftInputMode, setDraftInputMode] = useState<'text' | 'voice'>('text');
  const [isSaving, setIsSaving] = useState(false);
  const [isApplyingEdit, setIsApplyingEdit] = useState(false);
  const [inlineTextEditing, setInlineTextEditing] = useState(false);
  const [moveActive, setMoveActive] = useState(false);
  const [editError, setEditError] = useState('');
  const [pendingLabel, setPendingLabel] = useState('');
  // Tracks which pending.capturedAt values have already been auto-saved, so
  // rapid storage updates don't spawn duplicate session items for the same
  // selection.
  const autoSavedKeys = useRef<Set<string>>(new Set());
  // Keep a ref to the latest draft so the auto-save path (which runs from a
  // storage listener closure) sees the user's typed note without needing to
  // be re-bound on every keystroke.
  const draftInputRef = useRef(draftInput);
  const draftInputModeRef = useRef(draftInputMode);
  useEffect(() => {
    draftInputRef.current = draftInput;
    draftInputModeRef.current = draftInputMode;
  }, [draftInput, draftInputMode]);

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

  const autoSavePending = useCallback(async (outgoing: PendingSelection) => {
    if (outgoing.diffs.length === 0) return;
    if (autoSavedKeys.current.has(outgoing.capturedAt)) return;
    autoSavedKeys.current.add(outgoing.capturedAt);

    const rawInput = draftInputRef.current;
    const inputMode = draftInputModeRef.current;
    try {
      const parsed = await refinementParser.parse({
        rawInput,
        target: outgoing.target,
        diffs: outgoing.diffs,
      });
      const createdAt = nowIso();
      const item: RefinementItem = {
        id: uid(),
        pageUrl: outgoing.pageUrl,
        pageTitle: outgoing.pageTitle,
        target: outgoing.target,
        inputMode,
        rawInput,
        parsed,
        diffs: outgoing.diffs,
        prompts: { claude: '', codex: '', generic: '' },
        createdAt,
        changelog: [
          {
            at: createdAt,
            kind: 'created',
            note: `Auto-saved ${outgoing.diffs.length} direct edit${
              outgoing.diffs.length === 1 ? '' : 's'
            }.`,
          },
        ],
      };
      item.prompts = generatePromptsForItem(item);
      const next = await addItem(item);
      setItemsState(next);
    } catch (err) {
      console.warn('[IFL] auto-save failed', err);
      autoSavedKeys.current.delete(outgoing.capturedAt);
    }
  }, []);

  useEffect(() => {
    return subscribeToStorage((changes) => {
      if (STORAGE_KEYS.pending in changes) {
        const prev = changes[STORAGE_KEYS.pending].oldValue as PendingSelection | undefined;
        const next = changes[STORAGE_KEYS.pending].newValue as PendingSelection | undefined;
        const isSwap = !next || (prev && next.capturedAt !== prev.capturedAt);
        if (prev && isSwap) {
          void autoSavePending(prev);
        }
        setPending(next ?? null);
        if (next) {
          setPendingLabel(next.target.label);
        } else {
          setInlineTextEditing(false);
          setEditError('');
        }
      }
      if (STORAGE_KEYS.items in changes) {
        const next = changes[STORAGE_KEYS.items].newValue as RefinementItem[] | undefined;
        setItemsState(next ?? []);
      }
    });
  }, [autoSavePending]);

  useEffect(() => {
    if (!pending) return;
    setDraftInput('');
    setDraftInputMode('text');
    setEditError('');
  }, [pending?.capturedAt]);

  useEffect(() => {
    const listener = (msg: ExtensionMessage) => {
      if (msg.type === 'REFINE_MODE_CHANGED') {
        setRefineEnabled(msg.enabled);
      }
      if (msg.type === 'INLINE_TEXT_STATE_CHANGED') {
        setInlineTextEditing(msg.active);
      }
      if (msg.type === 'MOVE_MODE_CHANGED') {
        setMoveActive(msg.active);
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

  const runDirectEditAction = useCallback(async (action: DirectEditAction) => {
    setIsApplyingEdit(true);
    setEditError('');
    try {
      const response = (await chrome.runtime.sendMessage({
        type: 'APPLY_DIRECT_EDIT',
        action,
      } satisfies ExtensionMessage)) as
        | { ok?: boolean; pending?: PendingSelection | null; error?: string }
        | undefined;

      if (!response?.ok) {
        setEditError(response?.error ?? 'Unable to apply the preview edit.');
        return false;
      }

      if (action.type === 'start_inline_text_edit') {
        setInlineTextEditing(true);
      }
      if (action.type === 'stop_inline_text_edit' || action.type === 'reset_pending_selection') {
        setInlineTextEditing(false);
      }
      if (action.type === 'start_move') {
        setMoveActive(true);
      }
      if (action.type === 'cancel_move' || action.type === 'reset_pending_selection') {
        setMoveActive(false);
      }
      return true;
    } catch (err) {
      console.warn('[IFL] direct edit failed', err);
      setEditError('Unable to reach the preview page for this action.');
      return false;
    } finally {
      setIsApplyingEdit(false);
    }
  }, []);

  const revertDiffsOnPreview = useCallback(async (diffs: EditDiff[]) => {
    if (diffs.length === 0) return;
    try {
      await chrome.runtime.sendMessage({
        type: 'REVERT_DIFFS',
        diffs,
      } satisfies ExtensionMessage);
    } catch (err) {
      console.warn('[IFL] revert diffs failed', err);
    }
  }, []);

  const handleDiscardPending = useCallback(async () => {
    // Discard button skips the auto-save path: block auto-save first, then
    // revert the captured diffs directly on the preview. We pass revert=false
    // to the content-script reset because REVERT_DIFFS already handled the
    // rollback — the per-pending originals snapshot would just be redundant.
    if (pending) {
      autoSavedKeys.current.add(pending.capturedAt);
      await revertDiffsOnPreview(pending.diffs);
    }
    await runDirectEditAction({ type: 'reset_pending_selection', revert: false });
    await clearPendingSelection();
    setPending(null);
    setDraftInput('');
    setPendingLabel('');
    setInlineTextEditing(false);
    setMoveActive(false);
  }, [pending, revertDiffsOnPreview, runDirectEditAction]);

  const handleRenamePendingLabel = useCallback(
    (label: string) => {
      setPendingLabel(label);
      if (!pending) return;
      void updatePendingSelection({
        target: {
          ...pending.target,
          label,
        },
      });
    },
    [pending],
  );

  const handleSave = useCallback(
    async (opts: { inputMode: 'text' | 'voice'; rawInput: string; transcript?: string }) => {
      if (!pending) return;
      // Block the storage-listener auto-save from also firing on this same
      // pending — manual Save owns the item creation here.
      autoSavedKeys.current.add(pending.capturedAt);
      setIsSaving(true);
      try {
        const effectiveTarget = {
          ...pending.target,
          label: pendingLabel.trim() || pending.target.label,
        };
        const parsed = await refinementParser.parse({
          rawInput: opts.rawInput,
          target: effectiveTarget,
          diffs: pending.diffs,
        });

        const createdAt = nowIso();
        const item: RefinementItem = {
          id: uid(),
          pageUrl: pending.pageUrl,
          pageTitle: pending.pageTitle,
          target: effectiveTarget,
          inputMode: opts.inputMode,
          rawInput: opts.rawInput,
          transcript: opts.transcript,
          parsed,
          diffs: pending.diffs,
          prompts: { claude: '', codex: '', generic: '' },
          createdAt,
          changelog: [
            {
              at: createdAt,
              kind: 'created',
              note: `Captured ${pending.diffs.length} direct edit${pending.diffs.length === 1 ? '' : 's'}.`,
            },
          ],
        };
        item.prompts = generatePromptsForItem(item);

        const next = await addItem(item);
        setItemsState(next);
        await clearPendingSelection();
        await runDirectEditAction({ type: 'reset_pending_selection', revert: false });
        setPending(null);
        setPendingLabel('');
        setDraftInput('');
        setInlineTextEditing(false);
        setMoveActive(false);
      } finally {
        setIsSaving(false);
      }
    },
    [pending, pendingLabel, runDirectEditAction],
  );

  const handleItemUpdate = useCallback(
    async (id: string, patch: Partial<RefinementItem>) => {
      const current = items.find((item) => item.id === id);
      if (!current) return;

      const nextItem: RefinementItem = {
        ...current,
        ...patch,
        prompts: current.prompts,
      };
      nextItem.prompts = generatePromptsForItem(nextItem);
      nextItem.changelog = appendChangelog(current.changelog, {
        at: nowIso(),
        kind: 'edited',
        note: describePatch(patch),
      });

      const next = await updateItem(id, nextItem);
      setItemsState(next);
    },
    [items],
  );

  const handleRegenerate = useCallback(
    async (id: string) => {
      const item = items.find((entry) => entry.id === id);
      if (!item) return;
      const prompts = generatePromptsForItem(item);
      const changelog = appendChangelog(item.changelog, {
        at: nowIso(),
        kind: 'regenerated',
      });
      const next = await updateItem(id, { prompts, changelog });
      setItemsState(next);
    },
    [items],
  );

  const handleReparse = useCallback(
    async (id: string) => {
      const item = items.find((entry) => entry.id === id);
      if (!item) return;

      const parsed = await refinementParser.parse({
        rawInput: item.rawInput,
        target: item.target,
        diffs: item.diffs,
      });

      const nextItem: RefinementItem = {
        ...item,
        parsed,
        prompts: item.prompts,
      };
      nextItem.prompts = generatePromptsForItem(nextItem);
      nextItem.changelog = appendChangelog(item.changelog, {
        at: nowIso(),
        kind: 'reparsed',
      });

      const next = await updateItem(id, nextItem);
      setItemsState(next);
    },
    [items],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      const current = items.find((entry) => entry.id === id);
      if (current) {
        await revertDiffsOnPreview(current.diffs);
      }
      const next = await deleteItem(id);
      setItemsState(next);
    },
    [items, revertDiffsOnPreview],
  );

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
              onRenameLabel={handleRenamePendingLabel}
              onDiscard={handleDiscardPending}
              inlineTextEditing={inlineTextEditing}
              moveActive={moveActive}
              isApplyingEdit={isApplyingEdit}
              editError={editError}
              onStartInlineTextEdit={() => void runDirectEditAction({ type: 'start_inline_text_edit' })}
              onStopInlineTextEdit={() => void runDirectEditAction({ type: 'stop_inline_text_edit' })}
              onHideSelected={() => void runDirectEditAction({ type: 'hide_selected' })}
              onRemoveSelected={() => void runDirectEditAction({ type: 'remove_selected' })}
              onReorderSelected={(direction) =>
                void runDirectEditAction({ type: 'reorder_selected', direction })
              }
              onStartMove={() => void runDirectEditAction({ type: 'start_move' })}
              onCancelMove={() => void runDirectEditAction({ type: 'cancel_move' })}
              onAttachImageReference={(payload) =>
                void runDirectEditAction({ type: 'attach_image_reference', ...payload })
              }
              onMarkImageRegenerate={(prompt) =>
                void runDirectEditAction({ type: 'mark_image_regenerate', prompt })
              }
              onClearImageIntent={() =>
                void runDirectEditAction({ type: 'clear_image_intent' })
              }
              onNudgePosition={(direction) =>
                void runDirectEditAction({ type: 'nudge_position', direction })
              }
              onAdjustFontSize={(direction) =>
                void runDirectEditAction({ type: 'adjust_font_size', direction })
              }
              onAdjustBorderRadius={(direction) =>
                void runDirectEditAction({ type: 'adjust_border_radius', direction })
              }
              onAdjustSize={(axis, direction) =>
                void runDirectEditAction({ type: 'adjust_size', axis, direction })
              }
              onResetStyleAdjustments={() =>
                void runDirectEditAction({ type: 'reset_style_adjustments' })
              }
            />
            <NoteEditor
              value={draftInput}
              onChange={setDraftInput}
              inputMode={draftInputMode}
              onInputModeChange={setDraftInputMode}
              hasCapturedDiffs={pending.diffs.length > 0}
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
        <li>Annotate it, then optionally apply direct preview edits before generating prompts.</li>
      </ol>
      {!refineEnabled ? (
        <button className="ifl-button ifl-button-primary" onClick={onEnable}>
          Enable Refine Mode
        </button>
      ) : null}
    </section>
  );
}

function describePatch(patch: Partial<RefinementItem>): string {
  const changed = Object.keys(patch).filter((key) => key !== 'prompts' && key !== 'changelog');
  if (changed.length === 0) return 'Regenerated prompts.';
  return `Updated ${changed.join(', ')}.`;
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
