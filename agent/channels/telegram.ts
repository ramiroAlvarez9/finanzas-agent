import {
  defaultTelegramAuth,
  registerTelegramFreeformPrompt,
  renderTelegramInputRequest,
  telegramChannel,
  type TelegramContext,
  type TelegramMessage,
} from "eve/channels/telegram";
import {
  buildApprovalMessage,
  CANCEL_OPTION_LABEL,
  CONFIRM_OPTION_LABEL,
} from "../lib/approval-message";
import { DEFAULT_TIMEZONE, getUserToday } from "../lib/date";
import {
  getExpenseById,
  getOrCreateUser,
  grantUser,
  isUserGranted,
} from "../lib/db";
import { DEFAULT_CURRENCY } from "../lib/money";
import { FALLBACK_USER_ID } from "../lib/session";
import { transcribeVoiceMessage } from "../lib/transcribe";

function getAccessCode(): string {
  const code = process.env.ACCESS_CODE?.trim();
  if (!code && process.env.NODE_ENV !== "test") {
    throw new Error("ACCESS_CODE is required");
  }
  return code ?? "";
}

export function isBotCommand(text: string): boolean {
  return /^\/(?<command>[A-Za-z0-9_]+)(?:@(?<target>[A-Za-z0-9_]+))?(?:\s|$)/u.test(
    text,
  );
}

export function mentionsBotUsername(
  text: string,
  botUsername?: string,
): boolean {
  if (!botUsername) return false;
  const escaped = botUsername.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(
    `(?:^|[^A-Za-z0-9_])@${escaped}(?=$|[^A-Za-z0-9_])`,
    "iu",
  ).test(text);
}

function readRawVoice(message: TelegramMessage): {
  voiceFileId?: string;
  audioFileId?: string;
} {
  const raw = message.raw as {
    voice?: { file_id?: string };
    audio?: { file_id?: string };
  };
  return {
    voiceFileId: raw.voice?.file_id,
    audioFileId: raw.audio?.file_id,
  };
}

export function shouldDispatch(
  message: TelegramMessage,
  botUsername?: string,
): boolean {
  if (message.from?.isBot === true) return false;
  if (message.chat.type === "channel") return false;

  const text = message.text || message.caption;
  const { voiceFileId, audioFileId } = readRawVoice(message);
  const hasContent =
    text.trim().length > 0 ||
    message.attachments.length > 0 ||
    Boolean(voiceFileId) ||
    Boolean(audioFileId);
  if (!hasContent) return false;

  if (message.chat.type === "private") return true;
  if (message.replyToMessage?.from?.isBot === true) return true;
  if (isBotCommand(text)) return true;
  return mentionsBotUsername(text, botUsername);
}

function parseStartCode(text: string): string | null {
  const match = /^\/start(?:@[A-Za-z0-9_]+)?(?:\s+(\S+))?/u.exec(text.trim());
  if (!match) return null;
  return match[1] ?? null;
}

async function transcribeTelegramVoice(
  ctx: TelegramContext,
  fileId: string,
): Promise<string | null> {
  const fileInfo = await ctx.telegram.request("getFile", {
    file_id: fileId,
  });
  const fi = fileInfo as {
    body?: { result?: { file_path?: string } };
    result?: { file_path?: string };
    file_path?: string;
  };
  const filePath =
    fi.body?.result?.file_path ?? fi.result?.file_path ?? fi.file_path;
  if (!filePath) return null;

  const downloadUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN ?? ""}/${filePath}`;
  return transcribeVoiceMessage(downloadUrl);
}

export default telegramChannel({
  botUsername: process.env.TELEGRAM_BOT_USERNAME,
  events: {
    async "input.requested"(data, channel, ctx) {
      for (const request of data.requests) {
        const userId =
          ctx.session.auth.current?.principalId ?? FALLBACK_USER_ID;

        let user = null;
        try {
          user = await getOrCreateUser(userId);
        } catch (error) {
          console.error(
            "[telegram] no se pudo cargar el usuario para la aprobación:",
            error,
          );
        }

        const today = getUserToday(user?.timezone ?? DEFAULT_TIMEZONE);
        let text = request.prompt;
        let options = request.options;

        if (request.kind === "tool-approval") {
          const toolName = request.action.toolName;
          let expense = null;

          if (toolName === "delete_expense") {
            const input =
              typeof request.action.input === "object" &&
              request.action.input !== null
                ? (request.action.input as Record<string, unknown>)
                : {};
            const expenseId = Number(input.expense_id);
            if (Number.isInteger(expenseId) && expenseId > 0) {
              try {
                expense = await getExpenseById(userId, expenseId, true);
              } catch (error) {
                console.error(
                  "[telegram] no se pudo cargar el gasto para la aprobación:",
                  error,
                );
              }
            }
          }

          const customText = buildApprovalMessage(toolName, request.action.input, {
            today,
            defaultCurrency: user?.default_currency ?? DEFAULT_CURRENCY,
            expense,
          });
          if (customText) text = customText;

          options = [
            { id: "approve", label: CONFIRM_OPTION_LABEL },
            { id: "cancel", label: CANCEL_OPTION_LABEL },
          ];
        }

        const customRequest = { ...request, prompt: text, options };
        const rendered = renderTelegramInputRequest(customRequest, channel.state);
        const posted = await channel.telegram.post({
          text: rendered.text,
          reply_markup: rendered.replyMarkup,
        });

        if (!posted.id) continue;

        if (rendered.freeformRequestId) {
          registerTelegramFreeformPrompt(channel.state, {
            messageId: posted.id,
            requestId: rendered.freeformRequestId,
          });
        } else {
          // Mismo registro que hace el handler default de EVE, para que
          // `input.resolved` pueda editar la tarjeta cuando se responde.
          channel.state.hitlPrompts = {
            ...channel.state.hitlPrompts,
            [customRequest.requestId]: {
              messageId: posted.id,
              text: rendered.text,
              options: (customRequest.options ?? []).map(({ id, label }) => ({
                id,
                label,
              })),
            },
          };
        }
      }
    },
  },
  async onMessage(ctx, message) {
    if (!shouldDispatch(message, ctx.telegram.botUsername)) return null;

    const auth = defaultTelegramAuth(message);
    const rawUserId = auth?.principalId;

    if (rawUserId) {
      const granted = await isUserGranted(rawUserId);

      if (!granted) {
        const text = message.text?.trim() ?? "";
        const submittedCode = parseStartCode(text);

        if (submittedCode === null) {
          await ctx.telegram.sendMessage(
            "🔒 Este bot es privado. Enviá /start seguido de la clave de acceso para continuar.",
          );
          return null;
        }

        if (submittedCode !== getAccessCode()) {
          await ctx.telegram.sendMessage(
            "❌ Clave incorrecta. Intentá de nuevo con /start <clave>.",
          );
          return null;
        }

        await grantUser(rawUserId);
        await ctx.telegram.sendMessage(
          "✅ ¡Acceso concedido! Ya podés usar el bot.",
        );
        return null;
      }
    }

    const { voiceFileId, audioFileId } = readRawVoice(message);
    const voiceFileIdToUse = voiceFileId ?? audioFileId;

    if (voiceFileIdToUse) {
      if (!process.env.ASSEMBLYAI_API_KEY) {
        await ctx.telegram.sendMessage(
          "🎙️ El modo voz no está configurado. Escribime el gasto por texto.",
        );
        return null;
      }

      void ctx.telegram.startTyping("typing").catch(() => {});
      try {
        const transcription = await transcribeTelegramVoice(
          ctx,
          voiceFileIdToUse,
        );
        if (!transcription) {
          await ctx.telegram.sendMessage(
            "🎙️ No pude entender el audio. Probá de nuevo o escribime el gasto.",
          );
          return null;
        }
        (message as { text: string }).text = transcription;
      } catch (error) {
        console.error("[telegram] no se pudo transcribir el audio:", error);
        await ctx.telegram.sendMessage(
          "🎙️ No pude entender el audio. Probá de nuevo o escribime el gasto.",
        );
        return null;
      }
    } else if (message.attachments.length > 0) {
      await ctx.telegram.sendMessage(
        "📷 Por ahora no puedo leer fotos ni archivos. Contame el gasto por texto o mandame un audio.",
      );
      return null;
    }

    const context: string[] = [];
    if (rawUserId) {
      try {
        const user = await getOrCreateUser(rawUserId);
        const today = getUserToday(user.timezone);
        context.push(
          `<current_date>\ntoday: ${today}\ntimezone: ${user.timezone}\n</current_date>`,
          `<user_profile>\ndefault_currency: ${user.default_currency}\ntimezone: ${user.timezone}\n</user_profile>`,
        );
      } catch (error) {
        console.error(
          "[telegram] no se pudo cargar el perfil del usuario:",
          error,
        );
      }
    }

    return {
      auth,
      ...(context.length > 0 ? { context } : {}),
    };
  },
});
