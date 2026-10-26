import { strict as assert } from "node:assert";
import { test } from "node:test";
import { transcribeVoiceMessage } from "../agent/lib/transcribe.ts";

test("transcribeVoiceMessage lanza error si falta ASSEMBLYAI_API_KEY", async () => {
  const originalKey = process.env.ASSEMBLYAI_API_KEY;
  delete process.env.ASSEMBLYAI_API_KEY;
  try {
    await assert.rejects(
      async () => {
        await transcribeVoiceMessage("https://example.com/audio.ogg");
      },
      {
        name: "Error",
        message: "ASSEMBLYAI_API_KEY no está configurada.",
      },
    );
  } finally {
    if (originalKey !== undefined) {
      process.env.ASSEMBLYAI_API_KEY = originalKey;
    }
  }
});
