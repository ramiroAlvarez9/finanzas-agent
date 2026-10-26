import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  currencyFractionDigits,
  formatAmount,
  formatMoney,
  isSupportedCurrency,
  normalizeCurrencyCode,
  resolveCurrency,
  toMinorUnits,
} from "../agent/lib/money.ts";

test("reconoce monedas ISO y rechaza códigos inválidos", () => {
  assert.equal(isSupportedCurrency("USD"), true);
  assert.equal(isSupportedCurrency("usd"), true);
  assert.equal(isSupportedCurrency("CLP"), true);
  assert.equal(isSupportedCurrency("ZZZ"), false);
  assert.equal(normalizeCurrencyCode("eur"), "EUR");
  assert.equal(normalizeCurrencyCode("ZZZ"), null);
  assert.equal(resolveCurrency(undefined, "USD"), "USD");
  assert.equal(resolveCurrency("ZZZ", "EUR"), "EUR");
  assert.equal(resolveCurrency(undefined, "ZZZ"), "ARS");
});

test("usa la cantidad de decimales correcta por moneda", () => {
  assert.equal(currencyFractionDigits("ARS"), 2);
  assert.equal(currencyFractionDigits("USD"), 2);
  assert.equal(currencyFractionDigits("CLP"), 0);
  assert.equal(currencyFractionDigits("JPY"), 0);
  assert.equal(currencyFractionDigits("KWD"), 3);
});

test("convierte montos a unidad mínima", () => {
  assert.equal(toMinorUnits(12.5, "USD"), 1250);
  assert.equal(toMinorUnits(12500, "ARS"), 1250000);
  assert.equal(toMinorUnits(12500, "CLP"), 12500);
  assert.equal(toMinorUnits(1.234, "KWD"), 1234);
  assert.throws(() => toMinorUnits(0, "ARS"));
  assert.throws(() => toMinorUnits(-5, "ARS"));
});

test("formatea montos con código de moneda", () => {
  const ars = formatMoney(1250000, "ARS");
  assert.match(ars, /ARS/);
  assert.match(ars, /12[.,]500/);

  const usd = formatMoney(10000, "USD");
  assert.match(usd, /USD/);
  assert.match(usd, /100/);

  const clp = formatAmount(15000, "CLP");
  assert.match(clp, /CLP/);
  assert.match(clp, /15[.,]000/);
});
