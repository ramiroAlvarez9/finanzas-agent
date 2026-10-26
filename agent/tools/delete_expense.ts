import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";
import { getUserToday } from "../lib/date";
import {
  getOrCreateUser,
  getSpendingSnapshot,
  softDeleteExpense,
} from "../lib/db";
import {
  formatCurrencyTotals,
  formatExpense,
} from "../lib/presentation";
import { resolveUserId } from "../lib/session";

export default defineTool({
  description:
    "Elimina lógicamente un gasto existente (lo saca de los totales, pero conserva el registro). Pide confirmación al usuario antes de ejecutar. Usá primero list_expenses para obtener el expense_id correcto.",
  inputSchema: z.object({
    expense_id: z
      .number()
      .int()
      .positive()
      .describe("ID del gasto a eliminar, tal como lo devuelve list_expenses."),
  }),
  approval: always(),
  async execute(input, ctx) {
    const userId = resolveUserId(ctx);
    const user = await getOrCreateUser(userId);
    const today = getUserToday(user.timezone);

    const result = await softDeleteExpense(userId, input.expense_id);
    if (!result) {
      return {
        deleted: false,
        error:
          "No encontré ese gasto. Puede que ya no exista o que sea de otro usuario.",
      };
    }

    const snapshot = await getSpendingSnapshot(userId, today);

    return {
      deleted: true,
      already_deleted: result.already_deleted,
      expense: formatExpense(result.expense, today),
      today: formatCurrencyTotals(snapshot.today),
      month: formatCurrencyTotals(snapshot.month),
    };
  },
});
