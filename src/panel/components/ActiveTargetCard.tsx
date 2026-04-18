import { useRef, useState } from 'react';
import type { ImageReferenceKind, PendingSelection } from '../../shared/types';
import { hasImageIntent, hasVisibilityDiff } from '../../shared/editDiffs';
import { EditDiffList } from './EditDiffList';

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024; // 8 MB cap

type AttachImagePayload = {
  referenceKind: ImageReferenceKind;
  referenceUrl?: string;
  referenceNote?: string;
  dataUrl?: string;
  fileName?: string;
  fileSize?: number;
  mimeType?: string;
};

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
  onAttachImageReference: (payload: AttachImagePayload) => void;
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
      <nav className="ifl-breadcrumb" aria-label="Selection path">
        {(target.breadcrumb ?? []).map((crumb, idx, arr) => (
          <span key={`${idx}-${crumb}`} className="ifl-crumb">
            <span className={idx === arr.length - 1 ? 'ifl-crumb-current' : ''}>{crumb}</span>
            {idx < arr.length - 1 ? <span className="ifl-crumb-sep">›</span> : null}
          </span>
        ))}
      </nav>
      <dl className="ifl-meta">
        <dt>Page</dt>
        <dd title={pageUrl}>{pageTitle || pageUrl}</dd>
        <dt>Type</dt>
        <dd>
          <code>&lt;{target.tag}&gt;</code>
          {target.hasImage ? <span className="ifl-tag"> image block</span> : null}
        </dd>
        <dt>Size</dt>
        <dd>
          {target.boundingBox.width}×{target.boundingBox.height}px
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
  const [mode, setMode] = useState<ImageReferenceKind>('upload');
  const [url, setUrl] = useState('');
  const [note, setNote] = useState('');
  const [regeneratePrompt, setRegeneratePrompt] = useState('');
  const [upload, setUpload] = useState<{
    dataUrl: string;
    fileName: string;
    fileSize: number;
    mimeType: string;
  } | null>(null);
  const [uploadError, setUploadError] = useState('');
  const [isReading, setIsReading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const canAttach =
    (mode === 'note' && note.trim().length > 0) ||
    ((mode === 'url' || mode === 'figma') && url.trim().length > 0) ||
    (mode === 'upload' && upload !== null);

  const handleFile = async (file: File | null) => {
    setUploadError('');
    if (!file) {
      setUpload(null);
      return;
    }
    if (!file.type.startsWith('image/')) {
      setUploadError('That file is not an image.');
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setUploadError(`File is too large (${formatBytes(file.size)}). Max is 8 MB.`);
      return;
    }
    setIsReading(true);
    try {
      const dataUrl = await readAsDataURL(file);
      setUpload({
        dataUrl,
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type || 'image/*',
      });
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Failed to read the file.');
    } finally {
      setIsReading(false);
    }
  };

  const submit = () => {
    if (!canAttach) return;
    if (mode === 'upload') {
      if (!upload) return;
      onAttachImageReference({
        referenceKind: 'upload',
        dataUrl: upload.dataUrl,
        fileName: upload.fileName,
        fileSize: upload.fileSize,
        mimeType: upload.mimeType,
      });
      return;
    }
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
        Upload or link a replacement — the live image swaps instantly for URL and upload. Figma / note are captured as intent only.
      </p>

      <div className="ifl-row">
        <ModeChip label="Upload" kind="upload" active={mode} setActive={setMode} />
        <ModeChip label="URL" kind="url" active={mode} setActive={setMode} />
        <ModeChip label="Figma" kind="figma" active={mode} setActive={setMode} />
        <ModeChip label="Note" kind="note" active={mode} setActive={setMode} />
      </div>

      {mode === 'upload' ? (
        <>
          <div className="ifl-row">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="ifl-file-input"
              onChange={(event) => void handleFile(event.currentTarget.files?.[0] ?? null)}
              disabled={isApplyingEdit || isReading}
            />
          </div>
          {upload ? (
            <div className="ifl-upload-preview">
              <img src={upload.dataUrl} alt={upload.fileName} />
              <div>
                <div className="ifl-upload-name" title={upload.fileName}>
                  {upload.fileName}
                </div>
                <div className="ifl-subtle ifl-subtle-small">
                  {formatBytes(upload.fileSize)} · {upload.mimeType}
                </div>
              </div>
            </div>
          ) : null}
          {uploadError ? <p className="ifl-error">{uploadError}</p> : null}
        </>
      ) : mode === 'note' ? (
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
          disabled={isApplyingEdit || !canAttach || isReading}
          onClick={submit}
        >
          {mode === 'upload' || mode === 'url'
            ? 'Replace image in preview'
            : 'Attach replace-image intent'}
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

function ModeChip({
  label,
  kind,
  active,
  setActive,
}: {
  label: string;
  kind: ImageReferenceKind;
  active: ImageReferenceKind;
  setActive: (kind: ImageReferenceKind) => void;
}) {
  return (
    <label className="ifl-chip">
      <input
        type="radio"
        name="ifl-image-ref-kind"
        checked={active === kind}
        onChange={() => setActive(kind)}
      />
      {label}
    </label>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function readAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === 'string') resolve(result);
      else reject(new Error('Unexpected reader result.'));
    };
    reader.onerror = () => reject(reader.error ?? new Error('FileReader error'));
    reader.readAsDataURL(file);
  });
}
