import type { EditDiff } from '../../shared/types';

type Props = {
  diffs: EditDiff[];
  onRevert?: (diffId: string) => void;
};

export function DiffList({ diffs, onRevert }: Props) {
  if (diffs.length === 0) {
    return <p className="ifl-subtle ifl-subtle-small">No direct edits captured yet.</p>;
  }
  return (
    <ul className="ifl-diff-list">
      {diffs.map((d) => (
        <li key={d.id} className="ifl-diff">
          <div className="ifl-diff-head">
            <span className={`ifl-diff-badge ifl-diff-${d.type}`}>{badgeLabel(d)}</span>
            <span className="ifl-diff-target" title={d.selector}>{d.target}</span>
            {onRevert && (
              <button
                className="ifl-button-ghost ifl-diff-revert"
                onClick={() => onRevert(d.id)}
                title="Revert this edit on the page"
              >
                Revert
              </button>
            )}
          </div>
          <div className="ifl-diff-body">{diffBody(d)}</div>
        </li>
      ))}
    </ul>
  );
}

function badgeLabel(d: EditDiff): string {
  switch (d.type) {
    case 'text_change':
      return 'TEXT';
    case 'hide':
      return 'HIDE';
    case 'remove':
      return 'REMOVE';
    case 'reorder':
      return 'REORDER';
  }
}

function diffBody(d: EditDiff) {
  switch (d.type) {
    case 'text_change':
      return (
        <div className="ifl-diff-text">
          <div className="ifl-diff-before">&minus; {d.before || <em>(empty)</em>}</div>
          <div className="ifl-diff-after">&#43; {d.after || <em>(empty)</em>}</div>
        </div>
      );
    case 'hide':
      return <div className="ifl-subtle ifl-subtle-small">Hidden via display:none</div>;
    case 'remove':
      return <div className="ifl-subtle ifl-subtle-small">Removed from rendered UI</div>;
    case 'reorder':
      return (
        <div className="ifl-diff-reorder-body">
          <div className="ifl-diff-before">before: {d.before.join(' → ')}</div>
          <div className="ifl-diff-after">after: {d.after.join(' → ')}</div>
        </div>
      );
  }
}
