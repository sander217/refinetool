import { useState } from 'react';
import { VoiceRecorder } from './VoiceRecorder';

type Props = {
  value: string;
  onChange: (v: string) => void;
  inputMode: 'text' | 'voice';
  onInputModeChange: (m: 'text' | 'voice') => void;
  hasCapturedDiffs: boolean;
  isSaving: boolean;
  onSave: (opts: {
    inputMode: 'text' | 'voice';
    rawInput: string;
    transcript?: string;
  }) => void;
};

export function NoteEditor({
  value,
  onChange,
  inputMode,
  onInputModeChange,
  hasCapturedDiffs,
  isSaving,
  onSave,
}: Props) {
  const [transcript, setTranscript] = useState('');
  const canSave =
    !isSaving &&
    ((inputMode === 'text'
      ? value.trim().length > 0
      : transcript.trim().length > 0) ||
      hasCapturedDiffs);
  const buttonLabel =
    isSaving
      ? 'Parsing…'
      : hasCapturedDiffs &&
          (inputMode === 'text' ? value.trim().length === 0 : transcript.trim().length === 0)
        ? 'Add to session'
        : 'Generate prompts';

  return (
    <section className="ifl-card">
      <div className="ifl-tabs">
        <button
          className={inputMode === 'text' ? 'is-active' : ''}
          onClick={() => onInputModeChange('text')}
        >
          Typed note
        </button>
        <button
          className={inputMode === 'voice' ? 'is-active' : ''}
          onClick={() => onInputModeChange('voice')}
        >
          Voice note
        </button>
      </div>

      {inputMode === 'text' ? (
        <textarea
          className="ifl-textarea"
          placeholder={
            hasCapturedDiffs
              ? 'Optional: add design intent, constraints, or extra context for the direct edits already captured.'
              : 'What should change about this region? Describe the issue, the desired change, and any constraints.'
          }
          value={value}
          onChange={(e) => onChange(e.currentTarget.value)}
          rows={5}
        />
      ) : (
        <VoiceRecorder transcript={transcript} onTranscriptChange={setTranscript} />
      )}

      <div className="ifl-row-end">
        <button
          className="ifl-button ifl-button-primary"
          disabled={!canSave}
          onClick={() =>
            inputMode === 'text'
              ? onSave({ inputMode: 'text', rawInput: value })
              : onSave({ inputMode: 'voice', rawInput: transcript, transcript })
          }
        >
          {buttonLabel}
        </button>
      </div>
    </section>
  );
}
