import { strict as assert } from "node:assert";
import { rmSync } from "node:fs";
import { test } from "node:test";
import type { ToolContext } from "eve/tools";

const dbPath = "scratch/unit-test-tools.db";
process.env.DATABASE_URL = `file:${dbPath}`;
for (const suffix of ["", "-wal", "-shm"]) {
  rmSync(`${dbPath}${suffix}`, { force: true });
}

const { default: logExpense } = await import("../agent/tools/log_expense.ts");
const { default: listExpenses } = await import("../agent/tools/list_expenses.ts");
const { default: deleteExpense } = await import("../agent/tools/delete_expense.ts");
const { default: getSpendingSummary } = await import(
  "../agent/tools/get_spending_summary.ts"
);
const { default: getUserProfile } = await import(
  "../agent/tools/get_user_profile.ts"
);
const { default: updateUserSettings } = await import(
  "../agent/tools/update_user_settings.ts"
);

test.after(async () => {
  for (const suffix of ["", "-wal", "-shm"]) {
    rmSync(`${dbPath}${suffix}`, { force: true });
  }
});

function ctxFor(userId: string, callId: string): ToolContext {
  return {
    session: {
      auth: {
        current: { principalId: userId },
      },
    },
    callId,
  } as unknown as ToolContext;
}

test("log_expense usa la moneda por defecto y respeta la fecha", async () => {
  const result = (await logExpense.execute(
    {
      description: "Almuerzo",
      amount: 12500,
      category: "comida",
      date: "2020-01-15",
    },
    ctxFor("tools-user", "call-log-1"),
  )) as Record<string, any>;

  assert.equal(result.expense.currency, "ARS");
  assert.equal(result.expense.amount_minor, 1_250_000);
  assert.equal(result.expense.description, "Almuerzo");
  assert.equal(result.expense.category, "comida");
  assert.equal(result.already_logged, false);
});

test("log_expense es idempotente por callId", async () => {
  const ctx = ctxFor("tools-user", "call-log-idem");
  const first = (await logExpense.execute(
    {
      description: "Café",
      amount: 500,
      category: "comida",
      date: "2020-01-15",
    },
    ctx,
  )) as Record<string, any>;
  const second = (await logExpense.execute(
    {
      description: "Café",
      amount: 500,
      category: "comida",
      date: "2020-01-15",
    },
    ctx,
  )) as Record<string, any>;

  assert.equal(first.already_logged, false);
  assert.equal(second.already_logged, true);
  assert.equal(first.expense.id, second.expense.id);
});

test("log_expense acepta USD y rechaza fechas futuras", async () => {
  const usd = (await logExpense.execute(
    {
      description: "ChatGPT",
      amount: 100,
      currency: "USD",
      category: "suscripciones_ia",
      date: "2020-01-16",
    },
    ctxFor("tools-user", "call-log-usd"),
  )) as Record<string, any>;

  assert.equal(usd.expense.currency, "USD");
  assert.equal(usd.expense.amount_minor, 10_000);

  const future = (await logExpense.execute(
    {
      description: "Futuro",
      amount: 100,
      category: "otros",
      date: "2099-01-01",
    },
    ctxFor("tools-user", "call-log-future"),
  )) as Record<string, any>;

  assert.ok(future.error);
});

test("list_expenses filtra por texto, categoría y fecha", async () => {
  const byText = (await listExpenses.execute(
    { query: "chatgpt", date_from: "2020-01-01", date_to: "2020-01-31" },
    ctxFor("tools-user", "call-list-text"),
  )) as Record<string, any>;
  assert.equal(byText.count, 1);
  assert.equal(byText.expenses[0].description, "ChatGPT");

  const byCategory = (await listExpenses.execute(
    {
      category: "comida",
      date_from: "2020-01-01",
      date_to: "2020-01-31",
    },
    ctxFor("tools-user", "call-list-category"),
  )) as Record<string, any>;
  assert.equal(byCategory.count, 2);
});

test("get_spending_summary separa monedas y calcula porcentajes", async () => {
  const summary = (await getSpendingSummary.execute(
    {
      period: "custom",
      date_from: "2020-01-01",
      date_to: "2020-01-31",
    },
    ctxFor("tools-user", "call-summary"),
  )) as Record<string, any>;

  assert.equal(summary.period_label, "Del 01/01/2020 al 31/01/2020");
  const ars = summary.totals.find(
    (total: Record<string, unknown>) => total.currency === "ARS",
  );
  const usd = summary.totals.find(
    (total: Record<string, unknown>) => total.currency === "USD",
  );
  assert.ok(ars);
  assert.ok(usd);
  assert.equal(usd.total_minor, 10_000);
  assert.equal(ars.total_minor, 1_300_000);
  assert.ok(summary.by_category.ARS.length >= 1);
  assert.ok(summary.by_category.USD.length >= 1);
});

test("delete_expense borra y saca el gasto del resumen", async () => {
  const created = (await logExpense.execute(
    {
      description: "Subte",
      amount: 100,
      category: "transporte",
      date: "2020-01-17",
    },
    ctxFor("tools-user", "call-log-delete"),
  )) as Record<string, any>;

  const deleted = (await deleteExpense.execute(
    { expense_id: created.expense.id },
    ctxFor("tools-user", "call-delete"),
  )) as Record<string, any>;

  assert.equal(deleted.deleted, true);
  assert.equal(deleted.already_deleted, false);

  const summary = (await getSpendingSummary.execute(
    {
      period: "custom",
      date_from: "2020-01-17",
      date_to: "2020-01-17",
    },
    ctxFor("tools-user", "call-summary-after-delete"),
  )) as Record<string, any>;

  assert.equal(summary.totals.length, 0);
});

test("update_user_settings cambia la moneda por defecto", async () => {
  const updated = (await updateUserSettings.execute(
    { default_currency: "USD", timezone: "UTC" },
    ctxFor("tools-settings", "call-settings"),
  )) as Record<string, any>;

  assert.equal(updated.default_currency, "USD");
  assert.equal(updated.timezone, "UTC");

  const profile = (await getUserProfile.execute(
    {},
    ctxFor("tools-settings", "call-profile"),
  )) as Record<string, any>;
  assert.equal(profile.default_currency, "USD");
  assert.equal(profile.timezone, "UTC");

  const logged = (await logExpense.execute(
    {
      description: "Sin moneda",
      amount: 50,
      category: "otros",
      date: "2020-01-18",
    },
    ctxFor("tools-settings", "call-log-default-usd"),
  )) as Record<string, any>;

  assert.equal(logged.expense.currency, "USD");
});
