import { strict as assert } from "node:assert";
import { rmSync } from "node:fs";
import { test } from "node:test";

const dbPath = "scratch/unit-test-finanzas.db";
process.env.DATABASE_URL = `file:${dbPath}`;
for (const suffix of ["", "-wal", "-shm"]) {
  rmSync(`${dbPath}${suffix}`, { force: true });
}

const {
  getExpenseById,
  getOrCreateUser,
  getSpendingSnapshot,
  getSpendingSummary,
  grantUser,
  insertExpense,
  isUserGranted,
  listExpenses,
  softDeleteExpense,
  updateUserSettings,
} = await import("../agent/lib/db.ts");

test.after(async () => {
  for (const suffix of ["", "-wal", "-shm"]) {
    rmSync(`${dbPath}${suffix}`, { force: true });
  }
});

async function addExpense(
  userId: string,
  amountMinor: number,
  currency: string,
  categorySlug: string,
  description: string,
  spentOn: string,
  sourceCallId?: string,
) {
  return insertExpense({
    userId,
    amountMinor,
    currency,
    categorySlug,
    description,
    spentOn,
    sourceCallId,
  });
}

test("guarda gastos, los lista y calcula totales por moneda y categoría", async () => {
  await addExpense(
    "user_a",
    1_250_000,
    "ARS",
    "comida",
    "Almuerzo",
    "2026-10-25",
  );
  await addExpense(
    "user_a",
    4_500_000,
    "ARS",
    "servicios",
    "Luz",
    "2026-10-24",
  );
  await addExpense(
    "user_a",
    10_000,
    "USD",
    "suscripciones_ia",
    "ChatGPT",
    "2026-10-25",
  );
  await addExpense(
    "user_b",
    999_900,
    "ARS",
    "supermercado",
    "Verdulería",
    "2026-10-25",
  );

  const aExpenses = await listExpenses("user_a");
  assert.equal(aExpenses.length, 3);
  assert.equal(aExpenses[0].spent_on, "2026-10-25");

  const luz = await listExpenses("user_a", { query: "luz" });
  assert.equal(luz.length, 1);
  assert.equal(luz[0].description, "Luz");

  const servicios = await listExpenses("user_a", { category: "servicios" });
  assert.equal(servicios.length, 1);

  const oneDay = await listExpenses("user_a", {
    dateFrom: "2026-10-25",
    dateTo: "2026-10-25",
  });
  assert.equal(oneDay.length, 2);

  const bExpenses = await listExpenses("user_b");
  assert.equal(bExpenses.length, 1);

  const summary = await getSpendingSummary(
    "user_a",
    "2026-10-01",
    "2026-10-31",
  );

  const ars = summary.totals.find((total) => total.currency === "ARS");
  assert.deepEqual(ars, {
    currency: "ARS",
    total_minor: 5_750_000,
    count: 2,
  });

  const usd = summary.totals.find((total) => total.currency === "USD");
  assert.deepEqual(usd, {
    currency: "USD",
    total_minor: 10_000,
    count: 1,
  });

  assert.equal(summary.by_category.ARS.length, 2);
  assert.equal(summary.by_category.USD.length, 1);
  const serviciosTotal = summary.by_category.ARS.find(
    (category) => category.category_slug === "servicios",
  );
  assert.equal(serviciosTotal?.total_minor, 4_500_000);
  assert.equal(serviciosTotal?.share_percent, 78.3);

  assert.equal(summary.top_expenses.ARS.length, 2);
  assert.equal(summary.top_expenses.USD.length, 1);
});

test("el snapshot de hoy y del mes usa la fecha del gasto", async () => {
  const snapshot = await getSpendingSnapshot("user_a", "2026-10-25");
  const todayArs = snapshot.today.find((total) => total.currency === "ARS");
  const todayUsd = snapshot.today.find((total) => total.currency === "USD");
  const monthArs = snapshot.month.find((total) => total.currency === "ARS");

  assert.deepEqual(todayArs, {
    currency: "ARS",
    total_minor: 1_250_000,
    count: 1,
  });
  assert.deepEqual(todayUsd, {
    currency: "USD",
    total_minor: 10_000,
    count: 1,
  });
  assert.deepEqual(monthArs, {
    currency: "ARS",
    total_minor: 5_750_000,
    count: 2,
  });
});

test("es idempotente por source_call_id", async () => {
  const first = await addExpense(
    "idem-user",
    500_000,
    "ARS",
    "comida",
    "Café",
    "2026-10-25",
    "call-idem-1",
  );
  const second = await addExpense(
    "idem-user",
    500_000,
    "ARS",
    "comida",
    "Café",
    "2026-10-25",
    "call-idem-1",
  );

  assert.equal(first.inserted, true);
  assert.equal(second.inserted, false);
  assert.equal(first.expense.id, second.expense.id);
  assert.equal((await listExpenses("idem-user")).length, 1);
});

test("elimina de forma lógica y saca el gasto de los totales", async () => {
  const { expense } = await addExpense(
    "delete-user",
    300_000,
    "ARS",
    "transporte",
    "Subte",
    "2026-10-25",
  );

  const deleted = await softDeleteExpense("delete-user", expense.id);
  assert.ok(deleted);
  assert.equal(deleted?.already_deleted, false);
  assert.equal(await getExpenseById("delete-user", expense.id), null);
  assert.ok(await getExpenseById("delete-user", expense.id, true));

  assert.equal((await listExpenses("delete-user")).length, 0);
  const summary = await getSpendingSummary(
    "delete-user",
    "2026-10-01",
    "2026-10-31",
  );
  assert.equal(summary.totals.length, 0);

  const again = await softDeleteExpense("delete-user", expense.id);
  assert.equal(again?.already_deleted, true);
});

test("no deja eliminar gastos de otro usuario", async () => {
  const { expense } = await addExpense(
    "isolation-b",
    100_000,
    "ARS",
    "otros",
    "Varios",
    "2026-10-25",
  );

  const deleted = await softDeleteExpense("isolation-a", expense.id);
  assert.equal(deleted, null);
  assert.equal((await listExpenses("isolation-b")).length, 1);
});

test("permite cambiar la moneda por defecto y la zona horaria", async () => {
  const initial = await getOrCreateUser("settings-user");
  assert.equal(initial.default_currency, "ARS");
  assert.equal(initial.timezone, "America/Argentina/Buenos_Aires");

  const updated = await updateUserSettings("settings-user", {
    defaultCurrency: "USD",
    timezone: "UTC",
  });
  assert.equal(updated.default_currency, "USD");
  assert.equal(updated.timezone, "UTC");
});

test("maneja los permisos de acceso", async () => {
  assert.equal(await isUserGranted("grant-user"), false);
  await grantUser("grant-user");
  assert.equal(await isUserGranted("grant-user"), true);
});
