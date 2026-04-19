import type { EditDiff } from '../../shared/types';
import { describeEditDiff, diffCountBreakdown } from '../../shared/editDiffs';

type Props = {
  diffs: EditDiff[];
};

const EMOJI: Record<string, string> = {
  text_change: '✍️',
  hide: '🙈',
  remove: '🗑️',
  reorder: '↕',
  move: '⇄',
  image_replace_intent: '🖼️',
  image_regenerate_intent: '✨',
  style_change: '📐',
};

export function ChangesSummary({ diffs }: Props) {
  const counts = diffCountBreakdown(diffs);

  if (counts.total === 0) {
    return (
      <section className="ifl-changes-summary ifl-changes-summary-empty">
        <div className="ifl-changes-summary-head">
          <span className="ifl-changes-summary-title">Current changes</span>
          <span className="ifl-changes-summary-count">0</span>
        </div>
        <p className="ifl-subtle ifl-subtle-small">
          No edits captured yet. Use the preview actions below.
        </p>
      </section>
    );
  }

  const chips: string[] = [];
  if (counts.text) chips.push(`${counts.text} text`);
  if (counts.visibility) chips.push(`${counts.visibility} hide/remove`);
  if (counts.reorder) chips.push(`${counts.reorder} reorder`);
  if (counts.move) chips.push(`${counts.move} move`);
  if (counts.image) chips.push(`${counts.image} image`);
  if (counts.style) chips.push(`${counts.style} style`);

  return (
    <section className="ifl-changes-summary">
      <div className="ifl-changes-summary-head">
        <span className="ifl-changes-summary-title">Current changes</span>
        <span className="ifl-changes-summary-count">{counts.total}</span>
      </div>
      <div className="ifl-changes-summary-chips">
        {chips.map((chip) => (
          <span key={chip} className="ifl-changes-summary-chip">{chip}</span>
        ))}
      </div>
      <ul className="ifl-changes-summary-list">
        {diffs.map((diff) => (
          <li key={diff.id}>
            <span className="ifl-changes-summary-emoji" aria-hidden>
              {EMOJI[diff.type] ?? '•'}
            </span>
            <span className="ifl-changes-summary-text">{describeEditDiff(diff)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
