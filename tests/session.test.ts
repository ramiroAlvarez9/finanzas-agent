import { strict as assert } from "node:assert";
import { test } from "node:test";
import { FALLBACK_USER_ID, resolveUserId } from "../agent/lib/session.ts";

const context = (principalId?: string) => ({
  session: { auth: { current: principalId ? { principalId } : null } },
});

test("resolveUserId usa el principal autenticado", () => {
  assert.equal(resolveUserId(context("telegram-user") as never), "telegram-user");
});

test("resolveUserId usa el fallback sin autenticación", () => {
  assert.equal(resolveUserId(context() as never), FALLBACK_USER_ID);
});
