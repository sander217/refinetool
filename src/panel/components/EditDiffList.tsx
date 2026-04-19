import { useState } from 'react';
import {
  describeEditDiff,
  describeImageReference,
  diffTypeLabel,
  formatMoveSummary,
  formatReorderSummary,
} from '../../shared/editDiffs';
import type { EditDiff, ImageReferenceKind } from '../../shared/types';

type Props = {
  diffs: EditDiff[];
  editable?: boolean;
  emptyLabel?: string;
  onChangeDiff?: (id: string, next: EditDiff) => void;
  onRemoveDiff?: (id: string) => void;
};

export function EditDiffList({
  diffs,
  editable = false,
  emptyLabel = 'No direct edits captured yet.',
  onChangeDiff,
  onRemoveDiff,
}: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);

  if (diffs.length === 0) {
    return <p className="ifl-subtle ifl-subtle-small">{emptyLabel}</p>;
  }

  return (
    <div className="ifl-diff-list">
      {diffs.map((diff) => (
        <article key={diff.id} className="ifl-diff-card">
          <div className="ifl-row-between">
            <div>
              <div className="ifl-diff-title">{diffTypeLabel(diff)}</div>
              <div className="ifl-subtle ifl-subtle-small">{diff.target}</div>
            </div>
            {editable ? (
              <div className="ifl-row-end">
                <button
                  className="ifl-button-ghost"
                  onClick={() => setEditingId((current) => (current === diff.id ? null : diff.id))}
                >
                  {editingId === diff.id ? 'Close' : 'Edit diff'}
                </button>
                <button
                  className="ifl-button-ghost"
                  onClick={() => onRemoveDiff?.(diff.id)}
                >
                  Remove diff
                </button>
              </div>
            ) : null}
          </div>

          {editingId === diff.id && editable && onChangeDiff ? (
            <DiffEditor
              diff={diff}
              onSave={(next) => {
                onChangeDiff(diff.id, next);
                setEditingId(null);
              }}
            />
          ) : (
            <DiffSummary diff={diff} />
          )}
        </article>
      ))}
    </div>
  );
}

function DiffSummary({ diff }: { diff: EditDiff }) {
  if (diff.type === 'reorder') {
    return <pre className="ifl-pre">{formatReorderSummary(diff)}</pre>;
  }
  if (diff.type === 'move') {
    return <pre className="ifl-pre">{formatMoveSummary(diff)}</pre>;
  }
  if (diff.type === 'image_replace_intent') {
    return (
      <div className="ifl-pre">
        <div>Replace image</div>
        <div className="ifl-subtle ifl-subtle-small">
          {describeImageReference(diff)}
        </div>
        {diff.originalSrc ? (
          <div className="ifl-subtle ifl-subtle-small">from: {diff.originalSrc}</div>
        ) : null}
      </div>
    );
  }
  if (diff.type === 'image_regenerate_intent') {
    return (
      <div className="ifl-pre">
        <div>Regenerate image</div>
        {diff.prompt ? (
          <div className="ifl-subtle ifl-subtle-small">hint: {diff.prompt}</div>
        ) : (
          <div className="ifl-subtle ifl-subtle-small">no prompt hint</div>
        )}
      </div>
    );
  }
  return <p className="ifl-pre">{describeEditDiff(diff)}</p>;
}

function DiffEditor({
  diff,
  onSave,
}: {
  diff: EditDiff;
  onSave: (diff: EditDiff) => void;
}) {
  const [draft, setDraft] = useState<EditDiff>(diff);

  return (
    <div className="ifl-form">
      <label>
        <span>Target</span>
        <input
          value={draft.target}
          onChange={(event) => setDraft({ ...draft, target: event.currentTarget.value })}
        />
      </label>

      {draft.type === 'text_change' ? (
        <>
          <label>
            <span>Before</span>
            <textarea
              rows={2}
              value={draft.before}
              onChange={(event) =>
                setDraft({ ...draft, before: event.currentTarget.value })
              }
            />
          </label>
          <label>
            <span>After</span>
            <textarea
              rows={2}
              value={draft.after}
              onChange={(event) =>
                setDraft({ ...draft, after: event.currentTarget.value })
              }
            />
          </label>
        </>
      ) : null}

      {draft.type === 'reorder' ? (
        <>
          <label>
            <span>Before order (one per line)</span>
            <textarea
              rows={3}
              value={draft.before.join('\n')}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  before: parseLines(event.currentTarget.value),
                })
              }
            />
          </label>
          <label>
            <span>After order (one per line)</span>
            <textarea
              rows={3}
              value={draft.after.join('\n')}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  after: parseLines(event.currentTarget.value),
                })
              }
            />
          </label>
        </>
      ) : null}

      {(draft.type === 'hide' || draft.type === 'remove') ? (
        <label>
          <span>Action type</span>
          <select
            value={draft.type}
            onChange={(event) =>
              setDraft({
                ...draft,
                type: event.currentTarget.value as 'hide' | 'remove',
              })
            }
          >
            <option value="hide">hide</option>
            <option value="remove">remove</option>
          </select>
        </label>
      ) : null}

      {draft.type === 'image_replace_intent' ? (
        <>
          <label>
            <span>Reference kind</span>
            <select
              value={draft.referenceKind}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  referenceKind: event.currentTarget.value as ImageReferenceKind,
                })
              }
            >
              <option value="upload">upload</option>
              <option value="url">url</option>
              <option value="figma">figma</option>
              <option value="note">note</option>
            </select>
          </label>
          {draft.referenceKind === 'note' ? (
            <label>
              <span>Reference note</span>
              <textarea
                rows={2}
                value={draft.referenceNote ?? ''}
                onChange={(event) =>
                  setDraft({ ...draft, referenceNote: event.currentTarget.value })
                }
              />
            </label>
          ) : draft.referenceKind === 'upload' ? (
            <div className="ifl-subtle ifl-subtle-small">
              Uploaded file: {draft.fileName ?? '(unnamed)'}. To swap the file, clear the intent on the target card and re-upload.
            </div>
          ) : (
            <label>
              <span>Reference URL</span>
              <input
                value={draft.referenceUrl ?? ''}
                onChange={(event) =>
                  setDraft({ ...draft, referenceUrl: event.currentTarget.value })
                }
              />
            </label>
          )}
        </>
      ) : null}

      {draft.type === 'image_regenerate_intent' ? (
        <label>
          <span>Regenerate prompt</span>
          <textarea
            rows={2}
            value={draft.prompt ?? ''}
            onChange={(event) => setDraft({ ...draft, prompt: event.currentTarget.value })}
          />
        </label>
      ) : null}

      <div className="ifl-row-end">
        <button className="ifl-button" onClick={() => onSave(draft)}>
          Save diff
        </button>
      </div>
    </div>
  );
}

function parseLines(value: string): string[] {
  return value
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
}
