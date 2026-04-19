import { useState } from 'react';
import type {
  ChangelogEntry,
  ParsedRefinement,
  RefinementItem,
} from '../../shared/types';
import { combinePromptsMarkdown } from '../../services/promptTemplates';
import { buildArtifact, serializeArtifact } from '../../services/artifact';
import { downloadBlob, exportItemJson } from '../../services/export';
import { EditDiffList } from './EditDiffList';

type Props = {
  item: RefinementItem;
  onUpdate: (patch: Partial<RefinementItem>) => void;
  onRegeneratePrompts: () => void;
  onReparse: () => void;
  onDelete: () => void;
};

type PromptKey = 'summary' | 'claude' | 'codex' | 'generic';

const PROMPT_TABS: Array<{ key: PromptKey; label: string }> = [
  { key: 'summary', label: 'Handoff' },
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
  const [activePrompt, setActivePrompt] = useState<PromptKey>('summary');
  const [copied, setCopied] = useState<string | null>(null);

  const doCopy = async (key: string, text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
  };

  const promptText = item.prompts[activePrompt] ?? '';
  const activeTab = PROMPT_TABS.find((p) => p.key === activePrompt);

  return (
    <article className="ifl-card ifl-item">
      <header className="ifl-item-header" onClick={() => setExpanded((x) => !x)}>
        <div>
          <div className="ifl-item-title">{item.parsed.target}</div>
          <div className="ifl-subtle ifl-subtle-small">
            {new Date(item.createdAt).toLocaleString()} · {item.inputMode}
          </div>
        </div>
        <div className="ifl-row-end">
          <button
            className="ifl-icon-button ifl-icon-button-danger"
            title="Delete and revert preview"
            aria-label="Delete"
            onClick={(event) => {
              event.stopPropagation();
              onDelete();
            }}
          >
            ×
          </button>
          <span className="ifl-chevron">{expanded ? '▾' : '▸'}</span>
        </div>
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
                {item.transcript ? <p className="ifl-pre">Transcript: {item.transcript}</p> : null}
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
                  <button className="ifl-button-ghost" onClick={onReparse}>
                    Re-parse
                  </button>
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
            <pre className="ifl-prompt">{promptText || <em className="ifl-subtle">(not generated)</em>}</pre>
            <div className="ifl-row-end">
              <button
                className="ifl-button"
                onClick={() => doCopy(`prompt-${activePrompt}`, promptText)}
              >
                {copied === `prompt-${activePrompt}`
                  ? 'Copied!'
                  : `Copy ${activeTab?.label ?? 'prompt'}`}
              </button>
              <button
                className="ifl-button-ghost"
                onClick={() => doCopy('combined', combinePromptsMarkdown(item))}
              >
                {copied === 'combined' ? 'Copied!' : 'Copy combined'}
              </button>
              <button
                className="ifl-button-ghost"
                onClick={() => doCopy('artifact', serializeArtifact(buildArtifact(item)))}
              >
                {copied === 'artifact' ? 'Copied!' : 'Copy artifact JSON'}
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

          <ChangelogView entries={item.changelog ?? []} />

          <div className="ifl-row-end">
            <button className="ifl-button-danger" onClick={onDelete}>
              Delete
            </button>
          </div>
        </div>
      )}
    </article>
  );
}

function ChangelogView({ entries }: { entries: ChangelogEntry[] }) {
  if (entries.length === 0) return null;
  const recent = entries.slice(-5).reverse();
  return (
    <div className="ifl-field">
      <div className="ifl-label">Changelog</div>
      <ul className="ifl-changelog">
        {recent.map((entry, i) => (
          <li key={`${entry.at}-${i}`}>
            <span className="ifl-changelog-kind">{entry.kind}</span>
            <span className="ifl-changelog-at">{new Date(entry.at).toLocaleString()}</span>
            {entry.note ? <span className="ifl-changelog-note">— {entry.note}</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ParsedView({ parsed }: { parsed: ParsedRefinement }) {
  return (
    <dl className="ifl-meta">
      <dt>Target</dt><dd>{parsed.target}</dd>
      <dt>Issue</dt><dd>{parsed.currentIssue || <em className="ifl-subtle">none</em>}</dd>
      <dt>Change</dt><dd>{parsed.requestedChange || <em className="ifl-subtle">none</em>}</dd>
      <dt>Intent</dt><dd>{parsed.designIntent || <em className="ifl-subtle">none</em>}</dd>
      <dt>Preserve</dt>
      <dd>{renderList(parsed.preserve ?? [])}</dd>
      <dt>Do not touch</dt>
      <dd>{renderList(parsed.doNotTouch ?? [])}</dd>
      <dt>Other constraints</dt>
      <dd>{renderList(parsed.constraints)}</dd>
      <dt>Implementation direction</dt>
      <dd>{renderList(parsed.implementationNotes)}</dd>
    </dl>
  );
}

function renderList(list: string[]) {
  if (!list.length) return <em className="ifl-subtle">none</em>;
  return (
    <ul className="ifl-list">
      {list.map((entry, i) => (
        <li key={i}>{entry}</li>
      ))}
    </ul>
  );
}

function ParsedEditor({
  value,
  onChange,
}: {
  value: ParsedRefinement;
  onChange: (v: ParsedRefinement) => void;
}) {
  const update = <K extends keyof ParsedRefinement>(key: K, v: ParsedRefinement[K]) =>
    onChange({ ...value, [key]: v });

  const parseLines = (raw: string) =>
    raw
      .split(/\n+/)
      .map((s) => s.trim())
      .filter(Boolean);

  return (
    <div className="ifl-form">
      <label>
        <span>Target</span>
        <input value={value.target} onChange={(e) => update('target', e.currentTarget.value)} />
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
        <span>Preserve (one per line)</span>
        <textarea
          value={(value.preserve ?? []).join('\n')}
          onChange={(e) => update('preserve', parseLines(e.currentTarget.value))}
          rows={3}
        />
      </label>
      <label>
        <span>Do not touch (one per line)</span>
        <textarea
          value={(value.doNotTouch ?? []).join('\n')}
          onChange={(e) => update('doNotTouch', parseLines(e.currentTarget.value))}
          rows={3}
        />
      </label>
      <label>
        <span>Other constraints (one per line)</span>
        <textarea
          value={value.constraints.join('\n')}
          onChange={(e) => update('constraints', parseLines(e.currentTarget.value))}
          rows={3}
        />
      </label>
      <label>
        <span>Implementation direction (one per line)</span>
        <textarea
          value={value.implementationNotes.join('\n')}
          onChange={(e) => update('implementationNotes', parseLines(e.currentTarget.value))}
          rows={4}
        />
      </label>
    </div>
  );
}
