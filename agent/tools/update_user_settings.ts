import { defineTool } from "eve/tools";
import { z } from "zod";
import { getOrCreateUser, updateUserSettings } from "../lib/db";
import { normalizeCurrencyCode } from "../lib/money";
import { resolveUserId } from "../lib/session";

function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export default defineTool({
  description:
    "Actualiza la configuración del usuario: zona horaria y/o moneda por defecto. No requiere confirmación porque no registra ni elimina gastos.",
  inputSchema: z.object({
    timezone: z
      .string()
      .min(1)
      .optional()
      .describe(
        "Zona horaria IANA, por ejemplo 'America/Argentina/Buenos_Aires'.",
      ),
    default_currency: z
      .string()
      .regex(/^[A-Za-z]{3}$/)
      .optional()
      .describe("Moneda por defecto en código ISO 4217 (ARS, USD, EUR...)."),
  }),
  async execute(input, ctx) {
    const userId = resolveUserId(ctx);
    await getOrCreateUser(userId);

    if (input.timezone && !isValidTimezone(input.timezone)) {
      return { error: "La zona horaria no es válida." };
    }

    let currency: string | undefined;
    if (input.default_currency) {
      const normalized = normalizeCurrencyCode(input.default_currency);
      if (!normalized) {
        return {
          error: `La moneda "${input.default_currency}" no es válida. Usá un código ISO de 3 letras.`,
        };
      }
      currency = normalized;
    }

    const user = await updateUserSettings(userId, {
      timezone: input.timezone,
      defaultCurrency: currency,
    });

    return {
      user_id: user.user_id,
      timezone: user.timezone,
      default_currency: user.default_currency,
    };
  },
});
