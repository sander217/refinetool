export type TranscriptionResult = {
  transcript: string;
  confidence?: number;
  durationMs?: number;
  provider: string;
};

export interface TranscriptionService {
  readonly id: string;
  transcribe(audio: Blob): Promise<TranscriptionResult>;
}

class MockTranscriber implements TranscriptionService {
  readonly id = 'mock';

  async transcribe(audio: Blob): Promise<TranscriptionResult> {
    // Simulate latency so the loading UI renders briefly.
    await new Promise((r) => setTimeout(r, 400));
    const kb = Math.round(audio.size / 1024);
    return {
      transcript:
        `[mock transcript · ${kb} KB audio] Describe here what should change about the selected region. ` +
        `Edit this text before saving — the real transcription service is not wired up yet.`,
      confidence: 0,
      durationMs: 400,
      provider: 'mock',
    };
  }
}

// Default export is the mock. Swap this line (or wire a factory) to use a real provider.
// TODO: replace with Whisper / Deepgram / Gemini STT when ready.
export const transcriptionService: TranscriptionService = new MockTranscriber();
