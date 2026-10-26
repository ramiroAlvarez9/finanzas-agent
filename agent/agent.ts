import { defineAgent } from "eve";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY ?? "",
});

export default defineAgent({
  model: openrouter("openai/gpt-5.6-luna"),
  modelContextWindowTokens: 1_048_576,
  build: {
    externalDependencies: ["@libsql/client"],
  },
});
