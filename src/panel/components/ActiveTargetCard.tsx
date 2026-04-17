import type { PendingSelection } from '../../shared/types';
import { hasVisibilityDiff } from '../../shared/editDiffs';
import { EditDiffList } from './EditDiffList';

type Props = {
  pending: PendingSelection;
  label: string;
  onRenameLabel: (label: string) => void;
  onDiscard: () => void;
  inlineTextEditing: boolean;
  isApplyingEdit: boolean;
  editError: string;
  onStartInlineTextEdit: () => void;
  onStopInlineTextEdit: () => void;
  onHideSelected: () => void;
  onRemoveSelected: () => void;
  onReorderSelected: (direction: 'up' | 'down') => void;
};

export function ActiveTargetCard({
  pending,
  label,
  onRenameLabel,
  onDiscard,
  inlineTextEditing,
  isApplyingEdit,
  editError,
  onStartInlineTextEdit,
  onStopInlineTextEdit,
  onHideSelected,
  onRemoveSelected,
  onReorderSelected,
}: Props) {
  const { target, pageTitle, pageUrl } = pending;
  const blockedByVisibility = hasVisibilityDiff(pending.diffs);

  return (
    <section className="ifl-card ifl-card-accent">
      <div className="ifl-card-header">
        <div className="ifl-grow">
          <div className="ifl-subtle ifl-subtle-small">Selected region</div>
          <input
            className="ifl-title-input"
            value={label}
            onChange={(e) => onRenameLabel(e.currentTarget.value)}
            aria-label="Region label"
            placeholder="Name this region"
          />
        </div>
        <button className="ifl-button-ghost" onClick={onDiscard}>Discard</button>
      </div>
      <dl className="ifl-meta">
        <dt>Page</dt>
        <dd title={pageUrl}>{pageTitle || pageUrl}</dd>
        <dt>Selector</dt>
        <dd><code>{target.selector}</code></dd>
        <dt>Tag</dt>
        <dd><code>&lt;{target.tag}&gt;</code></dd>
        <dt>Bounds</dt>
        <dd>
          {target.boundingBox.width}×{target.boundingBox.height}px @ (
          {target.boundingBox.x}, {target.boundingBox.y})
        </dd>
      </dl>

      <div className="ifl-field">
        <div className="ifl-label">Preview actions</div>
        <div className="ifl-row">
          <button
            className="ifl-button"
            disabled={isApplyingEdit || blockedByVisibility}
            onClick={inlineTextEditing ? onStopInlineTextEdit : onStartInlineTextEdit}
          >
            {inlineTextEditing ? 'Stop text edit' : 'Inline text edit'}
          </button>
          <button
            className="ifl-button-ghost"
            disabled={isApplyingEdit || blockedByVisibility}
            onClick={() => onReorderSelected('up')}
          >
            Move up
          </button>
          <button
            className="ifl-button-ghost"
            disabled={isApplyingEdit || blockedByVisibility}
            onClick={() => onReorderSelected('down')}
          >
            Move down
          </button>
          <button
            className="ifl-button-ghost"
            disabled={isApplyingEdit}
            onClick={onHideSelected}
          >
            Hide
          </button>
          <button
            className="ifl-button-danger"
            disabled={isApplyingEdit}
            onClick={onRemoveSelected}
          >
            Remove
          </button>
        </div>
        <p className="ifl-subtle ifl-subtle-small">
          Direct edits change the local preview only and are captured as structured diffs.
        </p>
        {editError ? <p className="ifl-error">{editError}</p> : null}
      </div>

      <div className="ifl-field">
        <div className="ifl-label">Captured diffs</div>
        <EditDiffList
          diffs={pending.diffs}
          emptyLabel="No direct edits captured for this region yet."
        />
      </div>
    </section>
  );
}
