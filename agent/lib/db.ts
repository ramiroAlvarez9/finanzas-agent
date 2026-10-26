import { createClient, type Client } from "@libsql/client";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { CATEGORIES } from "./categories";
import { DEFAULT_TIMEZONE } from "./date";
import { DEFAULT_CURRENCY, resolveCurrency } from "./money";
import { getPeriodRange } from "./periods";
import { normalizeText } from "./text";

const DEFAULT_DB_URL = "file:data/finanzas.db";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  user_id TEXT PRIMARY KEY,
  timezone TEXT NOT NULL DEFAULT 'America/Argentina/Buenos_Aires',
  default_currency TEXT NOT NULL DEFAULT 'ARS',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS categories (
  slug TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  emoji TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  currency TEXT NOT NULL CHECK (length(currency) = 3),
  category_slug TEXT NOT NULL,
  description TEXT NOT NULL,
  description_norm TEXT NOT NULL,
  spent_on TEXT NOT NULL,
  source_call_id TEXT UNIQUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_expenses_user_date
  ON expenses (user_id, spent_on)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_expenses_user_category
  ON expenses (user_id, category_slug)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS access_grants (
  user_id TEXT PRIMARY KEY,
  granted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
`;

export interface UserRecord {
  user_id: string;
  timezone: string;
  default_currency: string;
}

export interface ExpenseRecord {
  id: number;
  user_id: string;
  amount_minor: number;
  currency: string;
  category_slug: string;
  description: string;
  spent_on: string;
  created_at: string | null;
  updated_at: string | null;
  deleted_at: string | null;
}

export interface ExpenseInput {
  userId: string;
  amountMinor: number;
  currency: string;
  categorySlug: string;
  description: string;
  spentOn: string;
  sourceCallId?: string | null;
}

export interface CurrencyTotal {
  currency: string;
  total_minor: number;
  count: number;
}

export interface CategoryTotal extends CurrencyTotal {
  category_slug: string;
  share_percent: number;
}

export interface SpendingSummary {
  date_from: string;
  date_to: string;
  totals: CurrencyTotal[];
  by_category: Record<string, CategoryTotal[]>;
  top_expenses: Record<string, ExpenseRecord[]>;
}

export interface SpendingSnapshot {
  today: CurrencyTotal[];
  month: CurrencyTotal[];
}

export interface ExpenseFilters {
  query?: string;
  category?: string;
  currency?: string;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
  sort?: "date" | "recent";
}

export interface SpendingFilters {
  category?: string;
  currency?: string;
  limit?: number;
}

export interface DeleteExpenseResult {
  expense: ExpenseRecord;
  already_deleted: boolean;
}

export interface UserSettingsInput {
  timezone?: string;
  defaultCurrency?: string;
}

let client: Client | undefined;
let schemaReady: Promise<void> | undefined;

function resolveDbUrl(): string {
  return (
    process.env.DATABASE_URL ??
    process.env.TURSO_DATABASE_URL ??
    DEFAULT_DB_URL
  );
}

function getClient(): Client {
  if (client) return client;
  const url = resolveDbUrl();
  if (url.startsWith("file:")) {
    const filePath = url.slice("file:".length);
    if (filePath && !filePath.startsWith(":memory:")) {
      mkdirSync(dirname(filePath), { recursive: true });
    }
  }
  client = createClient({
    url,
    authToken: process.env.DATABASE_AUTH_TOKEN,
  });
  return client;
}

function toNumber(value: unknown): number {
  return Number(value ?? 0);
}

function toNullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function mapExpenseRow(row: Record<string, unknown>): ExpenseRecord {
  return {
    id: toNumber(row.id),
    user_id: String(row.user_id),
    amount_minor: toNumber(row.amount_minor),
    currency: resolveCurrency(String(row.currency)),
    category_slug: String(row.category_slug),
    description: String(row.description),
    spent_on: String(row.spent_on),
    created_at: toNullableString(row.created_at),
    updated_at: toNullableString(row.updated_at),
    deleted_at: toNullableString(row.deleted_at),
  };
}

async function seedCategories(c: Client): Promise<void> {
  for (const category of CATEGORIES) {
    await c.execute({
      sql: `INSERT INTO categories (slug, label, emoji, sort_order)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(slug) DO UPDATE SET
              label = excluded.label,
              emoji = excluded.emoji,
              sort_order = excluded.sort_order`,
      args: [
        category.slug,
        category.label,
        category.emoji,
        category.sortOrder,
      ],
    });
  }
}

function ready(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      const c = getClient();
      await c.executeMultiple(SCHEMA);
      await seedCategories(c);
    })();
  }
  return schemaReady;
}

export async function isUserGranted(userId: string): Promise<boolean> {
  await ready();
  const rs = await getClient().execute({
    sql: "SELECT 1 FROM access_grants WHERE user_id = ? LIMIT 1",
    args: [userId],
  });
  return rs.rows.length > 0;
}

export async function grantUser(userId: string): Promise<void> {
  await ready();
  await getClient().execute({
    sql: "INSERT OR IGNORE INTO access_grants (user_id) VALUES (?)",
    args: [userId],
  });
}

export async function getOrCreateUser(
  userId: string,
  timezone: string = DEFAULT_TIMEZONE,
): Promise<UserRecord> {
  await ready();
  const c = getClient();
  await c.execute({
    sql: `INSERT OR IGNORE INTO users (user_id, timezone, default_currency)
          VALUES (?, ?, ?)`,
    args: [userId, timezone, DEFAULT_CURRENCY],
  });
  const rs = await c.execute({
    sql: `SELECT user_id, timezone, default_currency
          FROM users WHERE user_id = ?`,
    args: [userId],
  });
  const row = rs.rows[0];
  return {
    user_id: String(row.user_id),
    timezone: row.timezone ? String(row.timezone) : DEFAULT_TIMEZONE,
    default_currency: resolveCurrency(
      row.default_currency ? String(row.default_currency) : undefined,
    ),
  };
}

export async function updateUserSettings(
  userId: string,
  settings: UserSettingsInput,
): Promise<UserRecord> {
  await getOrCreateUser(userId);
  const fields: string[] = [];
  const args: Array<string | number> = [];

  if (settings.defaultCurrency !== undefined) {
    fields.push("default_currency = ?");
    args.push(resolveCurrency(settings.defaultCurrency));
  }
  if (settings.timezone !== undefined) {
    fields.push("timezone = ?");
    args.push(settings.timezone);
  }

  if (fields.length > 0) {
    await getClient().execute({
      sql: `UPDATE users SET ${fields.join(", ")} WHERE user_id = ?`,
      args: [...args, userId],
    });
  }
  return getOrCreateUser(userId);
}

export async function getExpenseById(
  userId: string,
  expenseId: number,
  includeDeleted = false,
): Promise<ExpenseRecord | null> {
  await ready();
  const rs = await getClient().execute({
    sql: `SELECT id, user_id, amount_minor, currency, category_slug, description,
                 spent_on, created_at, updated_at, deleted_at
          FROM expenses
          WHERE user_id = ? AND id = ?${includeDeleted ? "" : " AND deleted_at IS NULL"}
          LIMIT 1`,
    args: [userId, expenseId],
  });
  const row = rs.rows[0];
  return row ? mapExpenseRow(row) : null;
}

export async function getExpenseBySourceCallId(
  sourceCallId: string,
): Promise<ExpenseRecord | null> {
  await ready();
  const rs = await getClient().execute({
    sql: `SELECT id, user_id, amount_minor, currency, category_slug, description,
                 spent_on, created_at, updated_at, deleted_at
          FROM expenses
          WHERE source_call_id = ?
          LIMIT 1`,
    args: [sourceCallId],
  });
  const row = rs.rows[0];
  return row ? mapExpenseRow(row) : null;
}

export async function insertExpense(
  input: ExpenseInput,
): Promise<{ expense: ExpenseRecord; inserted: boolean }> {
  await ready();
  const c = getClient();

  if (input.sourceCallId) {
    const existing = await getExpenseBySourceCallId(input.sourceCallId);
    if (existing) return { expense: existing, inserted: false };
  }

  const description = input.description.trim();
  const result = await c.execute({
    sql: `INSERT INTO expenses
            (user_id, amount_minor, currency, category_slug, description,
             description_norm, spent_on, source_call_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(source_call_id) DO NOTHING`,
    args: [
      input.userId,
      input.amountMinor,
      input.currency,
      input.categorySlug,
      description,
      normalizeText(description),
      input.spentOn,
      input.sourceCallId ?? null,
    ],
  });

  if (input.sourceCallId) {
    const stored = await getExpenseBySourceCallId(input.sourceCallId);
    if (stored) {
      return { expense: stored, inserted: result.rowsAffected > 0 };
    }
  }

  const id = toNumber(result.lastInsertRowid);
  const stored = await getExpenseById(input.userId, id, true);
  if (!stored) {
    throw new Error("No se pudo leer el gasto recién insertado.");
  }
  return { expense: stored, inserted: result.rowsAffected > 0 };
}

export async function listExpenses(
  userId: string,
  filters: ExpenseFilters = {},
): Promise<ExpenseRecord[]> {
  await ready();
  const where = ["user_id = ?", "deleted_at IS NULL"];
  const args: Array<string | number> = [userId];

  const query = filters.query ? normalizeText(filters.query) : "";
  if (query) {
    where.push("description_norm LIKE ?");
    args.push(`%${query}%`);
  }
  if (filters.category) {
    where.push("category_slug = ?");
    args.push(filters.category);
  }
  if (filters.currency) {
    where.push("currency = ?");
    args.push(filters.currency);
  }
  if (filters.dateFrom) {
    where.push("spent_on >= ?");
    args.push(filters.dateFrom);
  }
  if (filters.dateTo) {
    where.push("spent_on <= ?");
    args.push(filters.dateTo);
  }

  const limit = Math.min(Math.max(filters.limit ?? 10, 1), 50);
  const orderBy =
    filters.sort === "recent" ? "id DESC" : "spent_on DESC, id DESC";
  const rs = await getClient().execute({
    sql: `SELECT id, user_id, amount_minor, currency, category_slug, description,
                 spent_on, created_at, updated_at, deleted_at
          FROM expenses
          WHERE ${where.join(" AND ")}
          ORDER BY ${orderBy}
          LIMIT ?`,
    args: [...args, limit],
  });
  return rs.rows.map(mapExpenseRow);
}

export async function softDeleteExpense(
  userId: string,
  expenseId: number,
): Promise<DeleteExpenseResult | null> {
  await ready();
  const expense = await getExpenseById(userId, expenseId, true);
  if (!expense) return null;
  if (expense.deleted_at) {
    return { expense, already_deleted: true };
  }

  await getClient().execute({
    sql: `UPDATE expenses
          SET deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
    args: [expenseId, userId],
  });

  const updated = await getExpenseById(userId, expenseId, true);
  return updated
    ? { expense: updated, already_deleted: false }
    : null;
}

async function getCurrencyTotals(
  userId: string,
  from: string,
  to: string,
  filters: SpendingFilters = {},
): Promise<CurrencyTotal[]> {
  await ready();
  const where = [
    "user_id = ?",
    "deleted_at IS NULL",
    "spent_on >= ?",
    "spent_on <= ?",
  ];
  const args: Array<string | number> = [userId, from, to];

  if (filters.category) {
    where.push("category_slug = ?");
    args.push(filters.category);
  }
  if (filters.currency) {
    where.push("currency = ?");
    args.push(filters.currency);
  }

  const rs = await getClient().execute({
    sql: `SELECT currency, COUNT(*) AS count, SUM(amount_minor) AS total_minor
          FROM expenses
          WHERE ${where.join(" AND ")}
          GROUP BY currency
          ORDER BY total_minor DESC`,
    args,
  });

  return rs.rows.map((row) => ({
    currency: resolveCurrency(String(row.currency)),
    total_minor: toNumber(row.total_minor),
    count: toNumber(row.count),
  }));
}

export async function getSpendingSummary(
  userId: string,
  from: string,
  to: string,
  filters: SpendingFilters = {},
): Promise<SpendingSummary> {
  await ready();
  const c = getClient();
  const totals = await getCurrencyTotals(userId, from, to, filters);

  const where = [
    "user_id = ?",
    "deleted_at IS NULL",
    "spent_on >= ?",
    "spent_on <= ?",
  ];
  const args: Array<string | number> = [userId, from, to];

  if (filters.category) {
    where.push("category_slug = ?");
    args.push(filters.category);
  }
  if (filters.currency) {
    where.push("currency = ?");
    args.push(filters.currency);
  }

  const totalsByCurrency = new Map(
    totals.map((total) => [total.currency, total.total_minor]),
  );

  const categoryRs = await c.execute({
    sql: `SELECT currency, category_slug, COUNT(*) AS count, SUM(amount_minor) AS total_minor
          FROM expenses
          WHERE ${where.join(" AND ")}
          GROUP BY currency, category_slug
          ORDER BY currency ASC, total_minor DESC`,
    args,
  });

  const byCategory: Record<string, CategoryTotal[]> = {};
  for (const row of categoryRs.rows) {
    const currency = resolveCurrency(String(row.currency));
    const totalMinor = toNumber(row.total_minor);
    const currencyTotal = totalsByCurrency.get(currency) ?? 0;
    const entry: CategoryTotal = {
      currency,
      category_slug: String(row.category_slug),
      total_minor: totalMinor,
      count: toNumber(row.count),
      share_percent:
        currencyTotal > 0
          ? Math.round((totalMinor / currencyTotal) * 1000) / 10
          : 0,
    };
    byCategory[currency] ??= [];
    byCategory[currency].push(entry);
  }

  const limit = Math.min(Math.max(filters.limit ?? 5, 1), 20);
  const topExpenses: Record<string, ExpenseRecord[]> = {};
  for (const total of totals) {
    const rs = await c.execute({
      sql: `SELECT id, user_id, amount_minor, currency, category_slug, description,
                   spent_on, created_at, updated_at, deleted_at
            FROM expenses
            WHERE ${where.join(" AND ")} AND currency = ?
            ORDER BY amount_minor DESC, spent_on DESC, id DESC
            LIMIT ?`,
      args: [...args, total.currency, limit],
    });
    topExpenses[total.currency] = rs.rows.map(mapExpenseRow);
  }

  return {
    date_from: from,
    date_to: to,
    totals,
    by_category: byCategory,
    top_expenses: topExpenses,
  };
}

export async function getSpendingSnapshot(
  userId: string,
  today: string,
): Promise<SpendingSnapshot> {
  const month = getPeriodRange("month", today);
  const [todayTotals, monthTotals] = await Promise.all([
    getCurrencyTotals(userId, today, today),
    getCurrencyTotals(userId, month.from, month.to),
  ]);
  return { today: todayTotals, month: monthTotals };
}
