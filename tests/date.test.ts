import { strict as assert } from "node:assert";
import { test } from "node:test";
import { DEFAULT_TIMEZONE, getUserToday } from "../agent/lib/date.ts";

test("getUserToday devuelve una fecha YYYY-MM-DD en la zona indicada", () => {
  const today = getUserToday(DEFAULT_TIMEZONE);
  assert.match(today, /^\d{4}-\d{2}-\d{2}$/);
});

test("getUserToday respeta el cambio de día entre zonas horarias", () => {
  const realDate = globalThis.Date;
  class FixedDate extends realDate {
    constructor(...args: ConstructorParameters<typeof Date>) {
      if (args.length === 0) super("2026-10-07T02:30:00.000Z");
      else super(...args);
    }
  }
  globalThis.Date = FixedDate;
  try {
    assert.equal(getUserToday("America/Argentina/Buenos_Aires"), "2026-10-06");
    assert.equal(getUserToday("UTC"), "2026-10-07");
  } finally {
    globalThis.Date = realDate;
  }
});
