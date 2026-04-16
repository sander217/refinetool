import type { RefinementItem } from '../../shared/types';
import {
  downloadBlob,
  exportItemsJson,
  exportItemsMarkdown,
} from '../../services/export';

type Props = {
  items: RefinementItem[];
  onClearAll: () => void;
};

export function ExportBar({ items, onClearAll }: Props) {
  const disabled = items.length === 0;
  return (
    <section className="ifl-export">
      <h2 className="ifl-section-title">Export session</h2>
      <div className="ifl-row">
        <button
          className="ifl-button"
          disabled={disabled}
          onClick={() =>
            downloadBlob('ifl-session.json', 'application/json', exportItemsJson(items))
          }
        >
          Export JSON
        </button>
        <button
          className="ifl-button"
          disabled={disabled}
          onClick={() =>
            downloadBlob('ifl-session.md', 'text/markdown', exportItemsMarkdown(items))
          }
        >
          Export Markdown
        </button>
        <button
          className="ifl-button-ghost ifl-button-danger"
          disabled={disabled}
          onClick={onClearAll}
        >
          Clear all
        </button>
      </div>
    </section>
  );
}
