process.env.ACCESS_CODE = "test-access-code";

import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  isBotCommand,
  mentionsBotUsername,
  shouldDispatch,
} from "../agent/channels/telegram.ts";

const message = (overrides: Record<string, unknown> = {}) =>
  ({
    from: { isBot: false },
    chat: { type: "group" },
    text: "",
    caption: "",
    attachments: [],
    raw: {},
    ...overrides,
  }) as never;

test("detecta comandos y menciones sin falsos positivos", () => {
  assert.equal(isBotCommand("/start"), true);
  assert.equal(isBotCommand("/start@finanzas_bot hola"), true);
  assert.equal(isBotCommand("hola /start"), false);
  assert.equal(mentionsBotUsername("hola @finanzas_bot", "finanzas_bot"), true);
  assert.equal(
    mentionsBotUsername("@finanzas_bot_extra", "finanzas_bot"),
    false,
  );
});

test("shouldDispatch filtra bots, canales y grupos no dirigidos", () => {
  assert.equal(
    shouldDispatch(message({ chat: { type: "private" }, text: "hola" }), "bot"),
    true,
  );
  assert.equal(
    shouldDispatch(message({ text: "/start" }), "bot"),
    true,
  );
  assert.equal(
    shouldDispatch(message({ text: "hola @bot" }), "bot"),
    true,
  );
  assert.equal(shouldDispatch(message({ text: "hola" }), "bot"), false);
  assert.equal(
    shouldDispatch(
      message({ from: { isBot: true }, text: "/start" }),
      "bot",
    ),
    false,
  );
  assert.equal(
    shouldDispatch(
      message({ chat: { type: "channel" }, text: "hola" }),
      "bot",
    ),
    false,
  );
  assert.equal(shouldDispatch(message(), "bot"), false);
});

test("los audios cuentan como contenido en chats privados", () => {
  assert.equal(
    shouldDispatch(
      message({
        chat: { type: "private" },
        raw: { voice: { file_id: "voice-1" } },
      }),
      "bot",
    ),
    true,
  );
  assert.equal(
    shouldDispatch(
      message({
        chat: { type: "private" },
        raw: { audio: { file_id: "audio-1" } },
      }),
      "bot",
    ),
    true,
  );
});

test("las fotos llegan al canal para que las rechace", () => {
  assert.equal(
    shouldDispatch(
      message({
        chat: { type: "private" },
        attachments: [{ kind: "photo", fileId: "photo-1" }],
      }),
      "bot",
    ),
    true,
  );
});
