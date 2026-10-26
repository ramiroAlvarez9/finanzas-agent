import { getCategory } from "./categories";
import type {
  CategoryTotal,
  CurrencyTotal,
  ExpenseRecord,
  SpendingSnapshot,
  SpendingSummary,
} from "./db";
import { formatMoney } from "./money";
import { formatDateHuman } from "./periods";

export interface FormattedCurrencyTotal extends CurrencyTotal {
  total_formatted: string;
}

export interface FormattedCategoryTotal extends CategoryTotal {
  label: string;
  emoji: string;
  total_formatted: string;
}

export interface FormattedExpense {
  id: number;
  description: string;
  amount_minor: number;
  amount_formatted: string;
  currency: string;
  category: string;
  category_label: string;
  category_emoji: string;
  date: string;
  date_label: string;
}

export interface FormattedSpendingSummary {
  date_from: string;
  date_to: string;
  totals: FormattedCurrencyTotal[];
  by_category: Record<string, FormattedCategoryTotal[]>;
  top_expenses: Record<string, FormattedExpense[]>;
}

export interface FormattedSpendingSnapshot {
  today: FormattedCurrencyTotal[];
  month: FormattedCurrencyTotal[];
}

export function formatCurrencyTotal(
  total: CurrencyTotal,
): FormattedCurrencyTotal {
  return {
    ...total,
    total_formatted: formatMoney(total.total_minor, total.currency),
  };
}

export function formatCurrencyTotals(
  totals: CurrencyTotal[],
): FormattedCurrencyTotal[] {
  return totals.map(formatCurrencyTotal);
}

export function formatCategoryTotal(
  total: CategoryTotal,
): FormattedCategoryTotal {
  const category = getCategory(total.category_slug);
  return {
    ...total,
    label: category?.label ?? "Otros",
    emoji: category?.emoji ?? "📦",
    total_formatted: formatMoney(total.total_minor, total.currency),
  };
}

export function formatExpense(
  expense: ExpenseRecord,
  today: string,
): FormattedExpense {
  const category = getCategory(expense.category_slug);
  return {
    id: expense.id,
    description: expense.description,
    amount_minor: expense.amount_minor,
    amount_formatted: formatMoney(expense.amount_minor, expense.currency),
    currency: expense.currency,
    category: expense.category_slug,
    category_label: category?.label ?? "Otros",
    category_emoji: category?.emoji ?? "📦",
    date: expense.spent_on,
    date_label: formatDateHuman(expense.spent_on, today),
  };
}

export function formatSummary(
  summary: SpendingSummary,
  today: string,
): FormattedSpendingSummary {
  const byCategory: Record<string, FormattedCategoryTotal[]> = {};
  for (const [currency, items] of Object.entries(summary.by_category)) {
    byCategory[currency] = items.map(formatCategoryTotal);
  }

  const topExpenses: Record<string, FormattedExpense[]> = {};
  for (const [currency, items] of Object.entries(summary.top_expenses)) {
    topExpenses[currency] = items.map((expense) =>
      formatExpense(expense, today),
    );
  }

  return {
    date_from: summary.date_from,
    date_to: summary.date_to,
    totals: formatCurrencyTotals(summary.totals),
    by_category: byCategory,
    top_expenses: topExpenses,
  };
}

export function formatSnapshot(
  snapshot: SpendingSnapshot,
): FormattedSpendingSnapshot {
  return {
    today: formatCurrencyTotals(snapshot.today),
    month: formatCurrencyTotals(snapshot.month),
  };
}
