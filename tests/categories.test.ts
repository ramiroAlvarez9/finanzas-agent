import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  CATEGORIES,
  CATEGORY_SLUGS,
  getCategory,
  isCategorySlug,
} from "../agent/lib/categories.ts";

test("hay 18 categorías con slugs únicos", () => {
  assert.equal(CATEGORY_SLUGS.length, 18);
  assert.equal(new Set(CATEGORY_SLUGS).size, 18);
  assert.equal(CATEGORIES.length, 18);
});

test("incluye la categoría de suscripciones de IA", () => {
  assert.equal(isCategorySlug("suscripciones_ia"), true);
  const category = getCategory("suscripciones_ia");
  assert.equal(category?.label, "Suscripciones de IA");
  assert.equal(category?.emoji, "🤖");
  assert.ok(category?.keywords.includes("chatgpt"));
});

test("todas las categorías tienen label, emoji y ejemplos", () => {
  for (const category of CATEGORIES) {
    assert.ok(category.label.length > 0);
    assert.ok(category.emoji.length > 0);
    assert.ok(category.keywords.length > 0);
    assert.equal(typeof category.sortOrder, "number");
  }
});

test("rechaza slugs inexistentes", () => {
  assert.equal(isCategorySlug("no_existe"), false);
  assert.equal(getCategory("no_existe"), undefined);
});
