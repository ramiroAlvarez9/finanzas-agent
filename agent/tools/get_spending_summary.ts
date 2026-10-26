import { defineTool } from "eve/tools";
import { z } from "zod";
import { CATEGORY_SLUGS } from "../lib/categories";
import { getUserToday } from "../lib/date";
import { getOrCreateUser, getSpendingSummary } from "../lib/db";
import { normalizeCurrencyCode } from "../lib/money";
import {
  getCustomRange,
  getPeriodRange,
  isValidIsoDate,
  type DateRange,
  type Period,
} from "../lib/periods";
import { formatSummary } from "../lib/presentation";
import { resolveUserId } from "../lib/session";

const PERIODS = [
  "today",
  "week",
  "month",
  "last_month",
  "year",
  "custom",
] as const satisfies readonly Period[];

export default defineTool({
  description:
    "Consulta cuánto gastó el usuario en un período: totales separados por moneda, desglose por categoría, porcentajes y los gastos más grandes. Nunca sumes monedas distintas. Si el usuario no indica período, usá 'month'.",
  inputSchema: z.object({
    period: z
      .enum(PERIODS)
      .default("month")
      .describe(
        "Período a consultar: today, week, month, last_month, year o custom.",
      ),
    date_from: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional()
      .describe("Solo para period=custom: fecha desde (YYYY-MM-DD)."),
    date_to: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional()
      .describe("Solo para period=custom: fecha hasta (YYYY-MM-DD)."),
    category: z
      .enum(CATEGORY_SLUGS)
      .optional()
      .describe("Filtrar por una categoría."),
    currency: z
      .string()
      .regex(/^[A-Za-z]{3}$/)
      .optional()
      .describe("Filtrar por moneda ISO (ARS, USD, etc.)."),
    limit: z
      .number()
      .int()
      .min(1)
      .max(20)
      .default(5)
      .describe("Cantidad de gastos más grandes a devolver por moneda."),
  }),
  async execute(input, ctx) {
    const userId = resolveUserId(ctx);
    const user = await getOrCreateUser(userId);
    const today = getUserToday(user.timezone);

    let currency: string | undefined;
    if (input.currency) {
      const normalized = normalizeCurrencyCode(input.currency);
      if (!normalized) {
        return {
          error: `La moneda "${input.currency}" no es válida. Usá un código ISO de 3 letras.`,
        };
      }
      currency = normalized;
    }

    let range: DateRange;
    if (input.period === "custom") {
      if (!input.date_from || !input.date_to) {
        return {
          error:
            "Para un período personalizado necesito date_from y date_to en formato YYYY-MM-DD.",
        };
      }
      if (
        !isValidIsoDate(input.date_from) ||
        !isValidIsoDate(input.date_to)
      ) {
        return { error: "Alguna de las fechas no es válida." };
      }
      try {
        range = getCustomRange(input.date_from, input.date_to);
      } catch (error) {
        return {
          error:
            error instanceof Error ? error.message : "El rango de fechas no es válido.",
        };
      }
    } else {
      range = getPeriodRange(input.period, today);
    }

    const summary = await getSpendingSummary(
      userId,
      range.from,
      range.to,
      {
        category: input.category,
        currency,
        limit: input.limit,
      },
    );

    return {
      period: input.period,
      period_label: range.label,
      ...formatSummary(summary, today),
    };
  },
});
