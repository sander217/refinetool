import { useState } from 'react';
import type { ParsedRefinement, RefinementItem } from '../../shared/types';
import { combinePromptsMarkdown } from '../../services/promptTemplates';
import { downloadBlob, exportItemJson } from '../../services/export';
import { EditDiffList } from './EditDiffList';

type Props = {
  item: RefinementItem;
  onUpdate: (patch: Partial<RefinementItem>) => void;
  onRegeneratePrompts: () => void;
  onReparse: () => void;
  onDelete: () => void;
};

const PROMPT_TABS: Array<{ key: keyof RefinementItem['prompts']; label: string }> = [
  { key: 'claude', label: 'Claude Code' },
  { key: 'codex', label: 'Codex' },
  { key: 'generic', label: 'Generic' },
];

export function RefinementItemCard({
  item,
  onUpdate,
  onRegeneratePrompts,
  onReparse,
  onDelete,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const [editingNote, setEditingNote] = useState(false);
  const [noteDraft, setNoteDraft] = useState(item.rawInput);
  const [editingParsed, setEditingParsed] = useState(false);
  const [parsedDraft, setParsedDraft] = useState<ParsedRefinement>(item.parsed);
  const [activePrompt, setActivePrompt] =
    useState<keyof RefinementItem['prompts']>('claude');
  const [copied, setCopied] = useState<string | null>(null);

  const doCopy = async (key: string, text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
  };

  return (
    <article className="ifl-card ifl-item">
      <header className="ifl-item-header" onClick={() => setExpanded((x) => !x)}>
        <div>
          <div className="ifl-item-title">{item.parsed.target}</div>
          <div className="ifl-subtle ifl-subtle-small">
            {new Date(item.createdAt).toLocaleString()} · {item.inputMode} · {item.parsed.priority}
          </div>
        </div>
        <span className="ifl-chevron">{expanded ? '▾' : '▸'}</span>
      </header>

      {expanded && (
        <div className="ifl-item-body">
          <div className="ifl-field">
            <div className="ifl-row-between">
              <div className="ifl-label">Raw note</div>
              {editingNote ? (
                <div className="ifl-row-end">
                  <button
                    className="ifl-button-ghost"
                    onClick={() => {
                      setNoteDraft(item.rawInput);
                      setEditingNote(false);
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    className="ifl-button"
                    onClick={() => {
                      onUpdate({ rawInput: noteDraft });
                      setEditingNote(false);
                    }}
                  >
                    Save
                  </button>
                </div>
              ) : (
                <button className="ifl-button-ghost" onClick={() => setEditingNote(true)}>
                  Edit
                </button>
              )}
            </div>
            {editingNote ? (
              <textarea
                className="ifl-textarea"
                value={noteDraft}
                onChange={(e) => setNoteDraft(e.currentTarget.value)}
                rows={4}
              />
            ) : (
              <>
                <p className="ifl-pre">
                  {item.rawInput || <em className="ifl-subtle">(empty)</em>}
                </p>
                {item.transcript ? (
                  <p className="ifl-pre">Transcript: {item.transcript}</p>
                ) : null}
              </>
            )}
          </div>

          <div className="ifl-field">
            <div className="ifl-row-between">
              <div className="ifl-label">Parsed</div>
              {editingParsed ? (
                <div className="ifl-row-end">
                  <button
                    className="ifl-button-ghost"
                    onClick={() => {
                      setParsedDraft(item.parsed);
                      setEditingParsed(false);
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    className="ifl-button"
                    onClick={() => {
                      onUpdate({ parsed: parsedDraft });
                      setEditingParsed(false);
                    }}
                  >
                    Save
                  </button>
                </div>
              ) : (
                <div className="ifl-row-end">
                  <button className="ifl-button-ghost" onClick={onReparse}>Re-parse</button>
                  <button className="ifl-button-ghost" onClick={() => setEditingParsed(true)}>
                    Edit
                  </button>
                </div>
              )}
            </div>
            {editingParsed ? (
              <ParsedEditor value={parsedDraft} onChange={setParsedDraft} />
            ) : (
              <ParsedView parsed={item.parsed} />
            )}
          </div>

          <div className="ifl-field">
            <div className="ifl-row-between">
              <div className="ifl-label">Direct edit diffs</div>
              <div className="ifl-subtle ifl-subtle-small">{item.diffs.length} captured</div>
            </div>
            <EditDiffList
              diffs={item.diffs}
              editable
              emptyLabel="No direct edits were saved with this item."
              onChangeDiff={(id, next) =>
                onUpdate({
                  diffs: item.diffs.map((diff) => (diff.id === id ? next : diff)),
                })
              }
              onRemoveDiff={(id) =>
                onUpdate({ diffs: item.diffs.filter((diff) => diff.id !== id) })
              }
            />
          </div>

          <div className="ifl-field">
            <div className="ifl-row-between">
              <div className="ifl-label">Prompts</div>
              <button className="ifl-button-ghost" onClick={onRegeneratePrompts}>
                Regenerate
              </button>
            </div>
            <div className="ifl-tabs ifl-tabs-small">
              {PROMPT_TABS.map((p) => (
                <button
                  key={p.key}
                  className={activePrompt === p.key ? 'is-active' : ''}
                  onClick={() => setActivePrompt(p.key)}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <pre className="ifl-prompt">{item.prompts[activePrompt]}</pre>
            <div className="ifl-row-end">
              <button
                className="ifl-button"
                onClick={() => doCopy(`prompt-${activePrompt}`, item.prompts[activePrompt])}
              >
                {copied === `prompt-${activePrompt}`
                  ? 'Copied!'
                  : `Copy ${PROMPT_TABS.find((p) => p.key === activePrompt)?.label}`}
              </button>
              <button
                className="ifl-button-ghost"
                onClick={() => doCopy('combined', combinePromptsMarkdown(item))}
              >
                {copied === 'combined' ? 'Copied!' : 'Copy combined'}
              </button>
              <button
                className="ifl-button-ghost"
                onClick={() =>
                  downloadBlob(
                    `refinement-${item.id}.json`,
                    'application/json',
                    exportItemJson(item),
                  )
                }
              >
                Export JSON
              </button>
            </div>
          </div>

          <div className="ifl-row-end">
            <button className="ifl-button-danger" onClick={onDelete}>Delete</button>
          </div>
        </div>
      )}
    </article>
  );
}

function ParsedView({ parsed }: { parsed: ParsedRefinement }) {
  return (
    <dl className="ifl-meta">
      <dt>Target</dt><dd>{parsed.target}</dd>
      <dt>Issue</dt><dd>{parsed.currentIssue}</dd>
      <dt>Change</dt><dd>{parsed.requestedChange}</dd>
      <dt>Intent</dt><dd>{parsed.designIntent}</dd>
      <dt>Constraints</dt>
      <dd>
        {parsed.constraints.length ? (
          <ul className="ifl-list">
            {parsed.constraints.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        ) : (
          <em className="ifl-subtle">none</em>
        )}
      </dd>
      <dt>Priority</dt><dd>{parsed.priority}</dd>
    </dl>
  );
}

function ParsedEditor({ value, onChange }: { value: ParsedRefinement; onChange: (v: ParsedRefinement) => void }) {
  const update = <K extends keyof ParsedRefinement>(key: K, v: ParsedRefinement[K]) =>
    onChange({ ...value, [key]: v });

  return (
    <div className="ifl-form">
      <label>
        <span>Target</span>
        <input
          value={value.target}
          onChange={(e) => update('target', e.currentTarget.value)}
        />
      </label>
      <label>
        <span>Current issue</span>
        <textarea
          value={value.currentIssue}
          onChange={(e) => update('currentIssue', e.currentTarget.value)}
          rows={2}
        />
      </label>
      <label>
        <span>Requested change</span>
        <textarea
          value={value.requestedChange}
          onChange={(e) => update('requestedChange', e.currentTarget.value)}
          rows={2}
        />
      </label>
      <label>
        <span>Design intent</span>
        <textarea
          value={value.designIntent}
          onChange={(e) => update('designIntent', e.currentTarget.value)}
          rows={2}
        />
      </label>
      <label>
        <span>Constraints (one per line)</span>
        <textarea
          value={value.constraints.join('\n')}
          onChange={(e) =>
            update(
              'constraints',
              e.currentTarget.value
                .split(/\n+/)
                .map((s) => s.trim())
                .filter(Boolean),
            )
          }
          rows={3}
        />
      </label>
      <label>
        <span>Priority</span>
        <select
          value={value.priority}
          onChange={(e) =>
            update('priority', e.currentTarget.value as ParsedRefinement['priority'])
          }
        >
          <option value="low">low</option>
          <option value="medium">medium</option>
          <option value="high">high</option>
        </select>
      </label>
    </div>
  );
}
