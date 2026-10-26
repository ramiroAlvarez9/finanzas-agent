import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  addDays,
  formatDateHuman,
  getCustomRange,
  getPeriodRange,
  isFutureDate,
  isValidIsoDate,
  startOfWeek,
} from "../agent/lib/periods.ts";

test("calcula hoy, semana, mes, mes pasado y año", () => {
  assert.deepEqual(getPeriodRange("today", "2026-10-25"), {
    from: "2026-10-25",
    to: "2026-10-25",
    label: "Hoy",
  });

  assert.deepEqual(getPeriodRange("week", "2026-10-25"), {
    from: "2026-10-19",
    to: "2026-10-25",
    label: "Semana del 19/10 al 25/10",
  });

  const month = getPeriodRange("month", "2026-10-25");
  assert.equal(month.from, "2026-10-01");
  assert.equal(month.to, "2026-10-31");
  assert.equal(month.label, "Octubre de 2026");

  const lastMonth = getPeriodRange("last_month", "2026-10-25");
  assert.equal(lastMonth.from, "2026-09-01");
  assert.equal(lastMonth.to, "2026-09-30");
  assert.equal(lastMonth.label, "Septiembre de 2026");

  assert.deepEqual(getPeriodRange("year", "2026-10-25"), {
    from: "2026-01-01",
    to: "2026-12-31",
    label: "Año 2026",
  });
});

test("soporta rangos personalizados", () => {
  assert.deepEqual(getCustomRange("2026-10-01", "2026-10-15"), {
    from: "2026-10-01",
    to: "2026-10-15",
    label: "Del 01/10/2026 al 15/10/2026",
  });
  assert.deepEqual(getCustomRange("2026-10-01", "2026-10-01"), {
    from: "2026-10-01",
    to: "2026-10-01",
    label: "01/10/2026",
  });
  assert.throws(() => getCustomRange("2026-10-15", "2026-10-01"));
});

test("valida fechas y evita futuras", () => {
  assert.equal(isValidIsoDate("2026-10-25"), true);
  assert.equal(isValidIsoDate("2026-02-30"), false);
  assert.equal(isValidIsoDate("25/10/2026"), false);
  assert.equal(isFutureDate("2026-10-26", "2026-10-25"), true);
  assert.equal(isFutureDate("2026-10-25", "2026-10-25"), false);
});

test("formatea fechas humanas para la tarjeta", () => {
  assert.equal(
    formatDateHuman("2026-10-25", "2026-10-25"),
    "hoy (25/10/2026)",
  );
  assert.equal(
    formatDateHuman("2026-10-24", "2026-10-25"),
    "ayer (24/10/2026)",
  );
  assert.equal(
    formatDateHuman("2026-10-20", "2026-10-25"),
    "martes 20/10/2026",
  );
  assert.equal(formatDateHuman("2026-09-01", "2026-10-25"), "01/09/2026");
});

test("hace aritmética de fechas sin problemas de mes", () => {
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
  assert.equal(startOfWeek("2026-10-25"), "2026-10-19");
});
