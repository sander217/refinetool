import type { PendingSelection } from '../../shared/types';

type Props = {
  pending: PendingSelection;
  label: string;
  onRenameLabel: (label: string) => void;
  onDiscard: () => void;
};

export function ActiveTargetCard({ pending, label, onRenameLabel, onDiscard }: Props) {
  const { target, pageTitle, pageUrl } = pending;
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
    </section>
  );
}
