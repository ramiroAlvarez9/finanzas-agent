import { AssemblyAI, type SpeechModel } from "assemblyai";

const TRANSCRIBE_TIMEOUT_MS = Number(
  process.env.ASSEMBLYAI_TIMEOUT_MS ?? 120_000,
);

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`AssemblyAI no respondió en ${ms}ms.`)),
      ms,
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export async function transcribeVoiceMessage(
  audioSource: string | Buffer,
): Promise<string> {
  const apiKey = process.env.ASSEMBLYAI_API_KEY;
  if (!apiKey) {
    throw new Error("ASSEMBLYAI_API_KEY no está configurada.");
  }

  const client = new AssemblyAI({ apiKey });

  const transcript = await withTimeout(
    client.transcripts.transcribe({
      audio: audioSource,
      language_code: (process.env.ASSEMBLYAI_LANGUAGE_CODE ?? "es") as "es",
      ...(process.env.ASSEMBLYAI_SPEECH_MODEL
        ? { speech_model: process.env.ASSEMBLYAI_SPEECH_MODEL as SpeechModel }
        : {}),
    }),
    TRANSCRIBE_TIMEOUT_MS,
  );

  if (transcript.status === "error") {
    throw new Error(
      `AssemblyAI devolvió un error al transcribir: ${transcript.error ?? "desconocido"}`.trim(),
    );
  }

  return (transcript.text ?? "").trim();
}
