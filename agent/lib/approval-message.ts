import { getCategory } from "./categories";
import { formatAmount, formatMoney, resolveCurrency } from "./money";
import { formatDateHuman, isValidIsoDate } from "./periods";
import { truncate } from "./text";

export const CONFIRM_OPTION_LABEL = "✅ Confirmar";
export const CANCEL_OPTION_LABEL = "❌ Cancelar";

export interface ExpenseDisplay {
  description: string;
  amount_minor: number;
  currency: string;
  category_slug: string;
  spent_on: string;
}

export interface ApprovalContext {
  /** Fecha de hoy en la zona horaria del usuario (YYYY-MM-DD). */
  today: string;
  /** Moneda por defecto del usuario. */
  defaultCurrency: string;
  /** Solo para delete_expense: el gasto que se va a eliminar. */
  expense?: ExpenseDisplay | null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function safeFormatAmount(amount: unknown, currency: string): string {
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
    return "(sin monto)";
  }
  try {
    return formatAmount(amount, currency);
  } catch {
    return "(monto inválido)";
  }
}

function safeFormatMinor(minor: unknown, currency: string): string {
  if (typeof minor !== "number" || !Number.isFinite(minor) || minor <= 0) {
    return "(sin monto)";
  }
  try {
    return formatMoney(minor, currency);
  } catch {
    return "(monto inválido)";
  }
}

function categoryLine(slug: string): string {
  const category = getCategory(slug);
  return category ? `${category.emoji} ${category.label}` : "📦 Otros";
}

function buildLogExpenseMessage(
  input: Record<string, unknown>,
  context: ApprovalContext,
): string {
  const description =
    typeof input.description === "string" && input.description.trim().length > 0
      ? truncate(input.description, 180)
      : "Gasto";
  const currency = resolveCurrency(
    typeof input.currency === "string" ? input.currency : undefined,
    context.defaultCurrency,
  );
  const amount = safeFormatAmount(input.amount, currency);
  const category =
    typeof input.category === "string" ? input.category : "otros";
  const date =
    typeof input.date === "string" && isValidIsoDate(input.date)
      ? input.date
      : context.today;

  return [
    "💸 Voy a anotar este gasto",
    "",
    `• Concepto: ${description}`,
    `• Monto: ${amount}`,
    `• Categoría: ${categoryLine(category)}`,
    `• Fecha: ${formatDateHuman(date, context.today)}`,
    "",
    "¿Confirmás?",
  ].join("\n");
}

function buildDeleteExpenseMessage(
  context: ApprovalContext,
): string {
  const expense = context.expense;
  if (!expense) {
    return [
      "🗑️ Voy a eliminar un gasto",
      "",
      "No encontré el detalle del gasto, pero no se va a borrar nada hasta que confirmes.",
      "",
      "¿Confirmás?",
    ].join("\n");
  }

  return [
    "🗑️ Voy a eliminar este gasto",
    "",
    `• Concepto: ${truncate(expense.description, 180)}`,
    `• Monto: ${safeFormatMinor(expense.amount_minor, expense.currency)}`,
    `• Categoría: ${categoryLine(expense.category_slug)}`,
    `• Fecha: ${formatDateHuman(expense.spent_on, context.today)}`,
    "",
    "¿Confirmás?",
  ].join("\n");
}

/**
 * Devuelve el texto en español para una aprobación de herramienta.
 * `null` significa que el canal debe usar el prompt genérico de EVE.
 */
export function buildApprovalMessage(
  toolName: string,
  input: unknown,
  context: ApprovalContext,
): string | null {
  const record = asRecord(input);
  switch (toolName) {
    case "log_expense":
      return buildLogExpenseMessage(record, context);
    case "delete_expense":
      return buildDeleteExpenseMessage(context);
    default:
      return null;
  }
}
