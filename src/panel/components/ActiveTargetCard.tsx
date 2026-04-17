import { useState } from 'react';
import type { ImageReferenceKind, PendingSelection } from '../../shared/types';
import { hasImageIntent, hasVisibilityDiff } from '../../shared/editDiffs';
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
  onAttachImageReference: (payload: {
    referenceKind: ImageReferenceKind;
    referenceUrl?: string;
    referenceNote?: string;
  }) => void;
  onMarkImageRegenerate: (prompt?: string) => void;
  onClearImageIntent: () => void;
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
  onAttachImageReference,
  onMarkImageRegenerate,
  onClearImageIntent,
}: Props) {
  const { target, pageTitle, pageUrl } = pending;
  const blockedByVisibility = hasVisibilityDiff(pending.diffs);
  const imageIntentActive = hasImageIntent(pending.diffs);

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

      {target.hasImage ? (
        <ImageIntentPanel
          isApplyingEdit={isApplyingEdit}
          imageIntentActive={imageIntentActive}
          onAttachImageReference={onAttachImageReference}
          onMarkImageRegenerate={onMarkImageRegenerate}
          onClearImageIntent={onClearImageIntent}
        />
      ) : null}

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

function ImageIntentPanel({
  isApplyingEdit,
  imageIntentActive,
  onAttachImageReference,
  onMarkImageRegenerate,
  onClearImageIntent,
}: {
  isApplyingEdit: boolean;
  imageIntentActive: boolean;
  onAttachImageReference: Props['onAttachImageReference'];
  onMarkImageRegenerate: Props['onMarkImageRegenerate'];
  onClearImageIntent: Props['onClearImageIntent'];
}) {
  const [mode, setMode] = useState<'url' | 'figma' | 'note'>('url');
  const [url, setUrl] = useState('');
  const [note, setNote] = useState('');
  const [regeneratePrompt, setRegeneratePrompt] = useState('');

  const canAttach =
    (mode === 'note' && note.trim().length > 0) ||
    ((mode === 'url' || mode === 'figma') && url.trim().length > 0);

  const submit = () => {
    if (!canAttach) return;
    onAttachImageReference({
      referenceKind: mode,
      referenceUrl: mode === 'note' ? undefined : url,
      referenceNote: mode === 'note' ? note : undefined,
    });
    setUrl('');
    setNote('');
  };

  const submitRegenerate = () => {
    onMarkImageRegenerate(regeneratePrompt.trim() || undefined);
    setRegeneratePrompt('');
  };

  return (
    <div className="ifl-field">
      <div className="ifl-row-between">
        <div className="ifl-label">Image intent</div>
        {imageIntentActive ? (
          <button
            className="ifl-button-ghost"
            disabled={isApplyingEdit}
            onClick={onClearImageIntent}
          >
            Clear image intent
          </button>
        ) : null}
      </div>
      <p className="ifl-subtle ifl-subtle-small">
        Capture replace or regenerate intent — the live image is unchanged; the intent lands in the diff list for downstream AI.
      </p>

      <div className="ifl-row">
        <label className="ifl-chip">
          <input
            type="radio"
            name="ifl-image-ref-kind"
            checked={mode === 'url'}
            onChange={() => setMode('url')}
          />
          URL
        </label>
        <label className="ifl-chip">
          <input
            type="radio"
            name="ifl-image-ref-kind"
            checked={mode === 'figma'}
            onChange={() => setMode('figma')}
          />
          Figma
        </label>
        <label className="ifl-chip">
          <input
            type="radio"
            name="ifl-image-ref-kind"
            checked={mode === 'note'}
            onChange={() => setMode('note')}
          />
          Note
        </label>
      </div>

      {mode === 'note' ? (
        <textarea
          className="ifl-textarea"
          rows={2}
          placeholder="Describe the replacement image"
          value={note}
          onChange={(event) => setNote(event.currentTarget.value)}
        />
      ) : (
        <input
          className="ifl-input"
          placeholder={mode === 'figma' ? 'Figma frame URL' : 'https://…'}
          value={url}
          onChange={(event) => setUrl(event.currentTarget.value)}
        />
      )}

      <div className="ifl-row">
        <button
          className="ifl-button"
          disabled={isApplyingEdit || !canAttach}
          onClick={submit}
        >
          Attach replace-image intent
        </button>
      </div>

      <div className="ifl-divider" />

      <input
        className="ifl-input"
        placeholder="Optional regenerate prompt / hint"
        value={regeneratePrompt}
        onChange={(event) => setRegeneratePrompt(event.currentTarget.value)}
      />
      <div className="ifl-row">
        <button
          className="ifl-button-ghost"
          disabled={isApplyingEdit}
          onClick={submitRegenerate}
        >
          Mark for regeneration
        </button>
      </div>
    </div>
  );
}
