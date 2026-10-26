import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";
import { CATEGORY_SLUGS } from "../lib/categories";
import { getUserToday } from "../lib/date";
import {
  getOrCreateUser,
  getSpendingSnapshot,
  insertExpense,
} from "../lib/db";
import { normalizeCurrencyCode, toMinorUnits } from "../lib/money";
import { isFutureDate, isValidIsoDate } from "../lib/periods";
import {
  formatCurrencyTotals,
  formatExpense,
} from "../lib/presentation";
import { resolveUserId } from "../lib/session";

export default defineTool({
  description:
    "Registra un gasto personal. Pide confirmación al usuario antes de escribir en la base. Si el usuario no indicó moneda, omití 'currency' para usar la moneda por defecto. Si no indicó el día, omití 'date' para usar hoy en su zona horaria.",
  inputSchema: z.object({
    description: z
      .string()
      .min(1)
      .max(300)
      .describe(
        "Concepto breve del gasto (ej. 'Almuerzo', 'Nafta', 'Supermercado Coto')",
      ),
    amount: z
      .number()
      .positive()
      .max(1_000_000_000_000)
      .describe(
        "Monto en unidades, no en centavos. Ejemplos: 12500 para ARS 12.500; 12.5 para USD 12,50; 15000 para CLP 15.000.",
      ),
    currency: z
      .string()
      .regex(/^[A-Za-z]{3}$/)
      .optional()
      .describe(
        "Código ISO 4217 de la moneda (ARS, USD, EUR, BRL, CLP, etc.). Omitir para usar la moneda por defecto del usuario.",
      ),
    category: z
      .enum(CATEGORY_SLUGS)
      .describe("Categoría del gasto. Usá la más específica que corresponda."),
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional()
      .describe(
        "Fecha del gasto en formato YYYY-MM-DD. Omitir para registrar hoy. No usar fechas futuras.",
      ),
  }),
  approval: always(),
  async execute(input, ctx) {
    const userId = resolveUserId(ctx);
    const user = await getOrCreateUser(userId);
    const today = getUserToday(user.timezone);

    const currency = input.currency
      ? normalizeCurrencyCode(input.currency)
      : user.default_currency;

    if (!currency) {
      return {
        error: `La moneda "${input.currency}" no es válida. Usá un código ISO de 3 letras, por ejemplo ARS, USD o EUR.`,
      };
    }

    const spentOn = input.date ?? today;
    if (!isValidIsoDate(spentOn)) {
      return {
        error: "La fecha no es válida. Usá el formato YYYY-MM-DD.",
      };
    }
    if (isFutureDate(spentOn, today)) {
      return {
        error:
          "No puedo registrar un gasto en el futuro. Si es un gasto programado, avisame y lo vemos aparte.",
      };
    }

    let amountMinor: number;
    try {
      amountMinor = toMinorUnits(input.amount, currency);
    } catch {
      return {
        error: "El monto no es válido para esa moneda.",
      };
    }

    const { expense, inserted } = await insertExpense({
      userId,
      amountMinor,
      currency,
      categorySlug: input.category,
      description: input.description,
      spentOn,
      sourceCallId: ctx.callId,
    });

    const snapshot = await getSpendingSnapshot(userId, today);

    return {
      expense: formatExpense(expense, today),
      already_logged: !inserted,
      today: formatCurrencyTotals(snapshot.today),
      month: formatCurrencyTotals(snapshot.month),
    };
  },
});
