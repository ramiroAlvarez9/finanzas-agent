import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  buildApprovalMessage,
  CANCEL_OPTION_LABEL,
  CONFIRM_OPTION_LABEL,
  type ExpenseDisplay,
} from "../agent/lib/approval-message.ts";

const today = "2026-10-25";

test("arma la tarjeta de un gasto en ARS", () => {
  const text = buildApprovalMessage(
    "log_expense",
    {
      description: "Almuerzo",
      amount: 12500,
      currency: "ARS",
      category: "comida",
      date: today,
    },
    { today, defaultCurrency: "ARS" },
  );

  assert.ok(text);
  assert.match(text, /Voy a anotar este gasto/);
  assert.match(text, /Almuerzo/);
  assert.match(text, /ARS/);
  assert.match(text, /Restaurantes/);
  assert.match(text, /hoy \(25\/10\/2026\)/);
  assert.match(text, /Confirmás/);
});

test("respeta la moneda explícita y usa la default si falta", () => {
  const explicit = buildApprovalMessage(
    "log_expense",
    {
      description: "ChatGPT",
      amount: 100,
      currency: "USD",
      category: "suscripciones_ia",
    },
    { today, defaultCurrency: "ARS" },
  );
  assert.match(explicit ?? "", /USD/);
  assert.match(explicit ?? "", /Suscripciones de IA/);

  const fallback = buildApprovalMessage(
    "log_expense",
    {
      description: "Nafta",
      amount: 15000,
      category: "transporte",
    },
    { today, defaultCurrency: "EUR" },
  );
  assert.match(fallback ?? "", /EUR/);
});

test("arma la tarjeta de eliminación con el gasto exacto", () => {
  const expense: ExpenseDisplay = {
    description: "Luz",
    amount_minor: 4500000,
    currency: "ARS",
    category_slug: "servicios",
    spent_on: "2026-10-24",
  };
  const text = buildApprovalMessage(
    "delete_expense",
    { expense_id: 7 },
    { today, defaultCurrency: "ARS", expense },
  );

  assert.ok(text);
  assert.match(text, /Voy a eliminar este gasto/);
  assert.match(text, /Luz/);
  assert.match(text, /ARS/);
  assert.match(text, /Servicios/);
  assert.match(text, /ayer \(24\/10\/2026\)/);
});

test("avisa cuando no encuentra el detalle del gasto a eliminar", () => {
  const text = buildApprovalMessage(
    "delete_expense",
    { expense_id: 99 },
    { today, defaultCurrency: "ARS", expense: null },
  );
  assert.match(text ?? "", /No encontré el detalle/);
  assert.match(text ?? "", /no se va a borrar nada/);
});

test("devuelve null para herramientas sin tarjeta personalizada", () => {
  assert.equal(
    buildApprovalMessage("otra_tool", {}, { today, defaultCurrency: "ARS" }),
    null,
  );
  assert.equal(CONFIRM_OPTION_LABEL, "✅ Confirmar");
  assert.equal(CANCEL_OPTION_LABEL, "❌ Cancelar");
});
