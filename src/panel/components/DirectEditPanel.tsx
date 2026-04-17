import { useState } from 'react';
import type {
  BlockAction,
  EditDiff,
  PendingSelection,
} from '../../shared/types';
import type {
  BlockActionResponse,
  EndTextEditResponse,
  ExtensionMessage,
  RevertResponse,
  StartTextEditResponse,
} from '../../shared/messages';
import { DiffList } from './DiffList';

type Props = {
  pending: PendingSelection;
  onAddDiffs: (diffs: EditDiff[]) => void;
  onRevertDiff: (diffId: string) => void;
  onClearAll: () => void;
};

export function DirectEditPanel({
  pending,
  onAddDiffs,
  onRevertDiff,
  onClearAll,
}: Props) {
  const [textEditing, setTextEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ tone: 'info' | 'error'; text: string } | null>(
    null,
  );

  const selector = pending.target.selector;

  const info = (text: string) => setStatus({ tone: 'info', text });
  const fail = (text: string) => setStatus({ tone: 'error', text });

  const handleStartText = async () => {
    setBusy(true);
    try {
      const res = (await chrome.runtime.sendMessage({
        type: 'START_TEXT_EDIT',
        selector,
      } satisfies ExtensionMessage)) as StartTextEditResponse | undefined;
      if (!res) return fail('No response from page.');
      if (!res.ok) return fail(res.error);
      setTextEditing(true);
      info(`Editing ${res.elementCount} text element${res.elementCount === 1 ? '' : 's'}. Click "Done" when finished.`);
    } catch (err) {
      fail(err instanceof Error ? err.message : 'Failed to start text edit.');
    } finally {
      setBusy(false);
    }
  };

  const handleEndText = async (commit: boolean) => {
    setBusy(true);
    try {
      const res = (await chrome.runtime.sendMessage({
        type: 'END_TEXT_EDIT',
        selector,
        commit,
      } satisfies ExtensionMessage)) as EndTextEditResponse | undefined;
      setTextEditing(false);
      if (!res || !res.ok) return fail('Failed to end text edit.');
      if (commit) {
        if (res.diffs.length === 0) info('No text changes detected.');
        else {
          onAddDiffs(res.diffs);
          info(`Captured ${res.diffs.length} text change${res.diffs.length === 1 ? '' : 's'}.`);
        }
      } else {
        info('Text edits discarded.');
      }
    } catch (err) {
      fail(err instanceof Error ? err.message : 'Failed to end text edit.');
    } finally {
      setBusy(false);
    }
  };

  const handleBlockAction = async (action: BlockAction) => {
    setBusy(true);
    try {
      const res = (await chrome.runtime.sendMessage({
        type: 'BLOCK_ACTION',
        selector,
        action,
      } satisfies ExtensionMessage)) as BlockActionResponse | undefined;
      if (!res) return fail('No response from page.');
      if (!res.ok) return fail(res.error);
      onAddDiffs([res.diff]);
      info(`Applied ${action.replace('_', ' ')}.`);
    } catch (err) {
      fail(err instanceof Error ? err.message : 'Block action failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleRevert = async (diffId: string) => {
    setBusy(true);
    try {
      const res = (await chrome.runtime.sendMessage({
        type: 'REVERT_DIFF',
        diffId,
      } satisfies ExtensionMessage)) as RevertResponse | undefined;
      // Remove from session diffs either way — page may have navigated away.
      onRevertDiff(diffId);
      if (!res?.ok) info('Revert recorded, but page change could not be undone (DOM may have changed).');
      else info('Edit reverted.');
    } catch (err) {
      fail(err instanceof Error ? err.message : 'Revert failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleClearAll = async () => {
    if (pending.diffs.length === 0) return;
    if (!confirm('Revert all direct edits on the page?')) return;
    setBusy(true);
    try {
      await chrome.runtime.sendMessage({
        type: 'CLEAR_ALL_EDITS',
      } satisfies ExtensionMessage);
      onClearAll();
      info('All edits reverted.');
    } catch (err) {
      fail(err instanceof Error ? err.message : 'Clear all failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="ifl-card">
      <div className="ifl-row-between">
        <div className="ifl-label">Direct edits</div>
        {pending.diffs.length > 0 && (
          <button
            className="ifl-button-ghost"
            onClick={handleClearAll}
            disabled={busy}
          >
            Clear all
          </button>
        )}
      </div>

      <div className="ifl-row">
        {!textEditing ? (
          <button
            className="ifl-button"
            onClick={handleStartText}
            disabled={busy}
            title="Make text inside this region editable on the page"
          >
            Edit text
          </button>
        ) : (
          <>
            <button
              className="ifl-button ifl-button-primary"
              onClick={() => handleEndText(true)}
              disabled={busy}
            >
              Done
            </button>
            <button
              className="ifl-button-ghost"
              onClick={() => handleEndText(false)}
              disabled={busy}
            >
              Cancel
            </button>
          </>
        )}
        <button
          className="ifl-button"
          onClick={() => handleBlockAction('hide')}
          disabled={busy || textEditing}
          title="Hide this block on the page"
        >
          Hide
        </button>
        <button
          className="ifl-button"
          onClick={() => handleBlockAction('remove')}
          disabled={busy || textEditing}
          title="Remove this block"
        >
          Remove
        </button>
        <button
          className="ifl-button"
          onClick={() => handleBlockAction('move_up')}
          disabled={busy || textEditing}
          title="Move this block up among its siblings"
        >
          ↑ Move up
        </button>
        <button
          className="ifl-button"
          onClick={() => handleBlockAction('move_down')}
          disabled={busy || textEditing}
          title="Move this block down among its siblings"
        >
          ↓ Move down
        </button>
      </div>

      {status && (
        <div
          className={
            status.tone === 'error' ? 'ifl-status ifl-status-error' : 'ifl-status'
          }
        >
          {status.text}
        </div>
      )}

      <DiffList diffs={pending.diffs} onRevert={handleRevert} />
    </section>
  );
}
