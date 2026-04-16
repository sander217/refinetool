import { useEffect, useRef, useState } from 'react';
import { transcriptionService } from '../../services/transcription';

type Status = 'idle' | 'recording' | 'processing' | 'error';

type Props = {
  transcript: string;
  onTranscriptChange: (t: string) => void;
};

export function VoiceRecorder({ transcript, onTranscriptChange }: Props) {
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    return () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
  }, [audioUrl]);

  const startRecording = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        const nextUrl = URL.createObjectURL(blob);
        setAudioUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return nextUrl;
        });
        setStatus('processing');
        try {
          const result = await transcriptionService.transcribe(blob);
          onTranscriptChange(result.transcript);
          setStatus('idle');
        } catch (err) {
          console.error(err);
          setError('Transcription failed — you can still type the transcript manually.');
          setStatus('error');
        }
      };
      setStatus('recording');
      recorder.start();
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'Microphone unavailable');
      setStatus('error');
    }
  };

  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
  };

  const retry = () => {
    setAudioUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    onTranscriptChange('');
    setError(null);
    setStatus('idle');
  };

  return (
    <div className="ifl-voice">
      <div className="ifl-voice-controls">
        {status === 'recording' ? (
          <button className="ifl-button" onClick={stopRecording}>Stop</button>
        ) : (
          <button
            className="ifl-button"
            onClick={startRecording}
            disabled={status === 'processing'}
          >
            {status === 'processing' ? 'Transcribing…' : audioUrl ? 'Re-record' : 'Record'}
          </button>
        )}
        {audioUrl && (
          <button className="ifl-button-ghost" onClick={retry}>Clear</button>
        )}
        <span className={`ifl-status ifl-status-${status}`}>
          {status === 'recording' && '● Recording…'}
          {status === 'processing' && 'Processing…'}
          {status === 'error' && error}
        </span>
      </div>
      {audioUrl && <audio className="ifl-audio" controls src={audioUrl} />}
      <textarea
        className="ifl-textarea"
        placeholder="Transcript (editable). Record above, then refine."
        value={transcript}
        onChange={(e) => onTranscriptChange(e.currentTarget.value)}
        rows={5}
      />
      <p className="ifl-subtle ifl-subtle-small">
        Mock transcription is active. Swap <code>services/transcription</code> for a real provider.
      </p>
    </div>
  );
}
