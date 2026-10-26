import { defineTool } from "eve/tools";
import { z } from "zod";
import { CATEGORY_SLUGS } from "../lib/categories";
import { getUserToday } from "../lib/date";
import { getOrCreateUser, listExpenses } from "../lib/db";
import { normalizeCurrencyCode } from "../lib/money";
import { isValidIsoDate } from "../lib/periods";
import { formatExpense } from "../lib/presentation";
import { resolveUserId } from "../lib/session";

export default defineTool({
  description:
    "Lista los gastos del usuario, del más reciente al más viejo. Usalo para consultar movimientos o para encontrar el gasto que el usuario quiere eliminar. Devuelve IDs que después se usan en delete_expense.",
  inputSchema: z.object({
    query: z
      .string()
      .min(1)
      .max(100)
      .optional()
      .describe(
        "Texto libre para buscar en el concepto del gasto (ej. 'luz', 'súper', 'ChatGPT').",
      ),
    category: z
      .enum(CATEGORY_SLUGS)
      .optional()
      .describe("Filtrar por categoría."),
    currency: z
      .string()
      .regex(/^[A-Za-z]{3}$/)
      .optional()
      .describe("Filtrar por moneda ISO (ARS, USD, etc.)."),
    date_from: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional()
      .describe("Fecha desde (YYYY-MM-DD)."),
    date_to: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional()
      .describe("Fecha hasta (YYYY-MM-DD)."),
    limit: z
      .number()
      .int()
      .min(1)
      .max(50)
      .default(10)
      .describe("Cantidad máxima de gastos a devolver."),
  }),
  async execute(input, ctx) {
    const userId = resolveUserId(ctx);
    const user = await getOrCreateUser(userId);
    const today = getUserToday(user.timezone);

    if (input.currency) {
      const currency = normalizeCurrencyCode(input.currency);
      if (!currency) {
        return {
          error: `La moneda "${input.currency}" no es válida. Usá un código ISO de 3 letras.`,
        };
      }
    }
    if (input.date_from && !isValidIsoDate(input.date_from)) {
      return { error: "La fecha desde no es válida." };
    }
    if (input.date_to && !isValidIsoDate(input.date_to)) {
      return { error: "La fecha hasta no es válida." };
    }
    if (input.date_from && input.date_to && input.date_from > input.date_to) {
      return { error: "La fecha desde no puede ser posterior a la fecha hasta." };
    }

    const expenses = await listExpenses(userId, {
      query: input.query,
      category: input.category,
      currency: input.currency
        ? normalizeCurrencyCode(input.currency) ?? undefined
        : undefined,
      dateFrom: input.date_from,
      dateTo: input.date_to,
      limit: input.limit,
    });

    return {
      count: expenses.length,
      expenses: expenses.map((expense) => formatExpense(expense, today)),
    };
  },
});
