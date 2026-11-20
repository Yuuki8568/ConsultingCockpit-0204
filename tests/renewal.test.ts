import assert from "node:assert/strict";
import test from "node:test";
import { monthlyRenewalDates } from "../packages/web/src/web/domain/logic/renewal";

test("original Jan31 anniversary returns after leap February", () => {
  assert.deepEqual(monthlyRenewalDates("2024-01-31", "2024-02-01"), {
    renewalDate: "2024-02-29", invoiceDate: "2024-02-15", stopDeadlineJst: "2024-02-28 23:59（日本時間）",
  });
  assert.equal(monthlyRenewalDates("2024-01-31", "2024-03-01")?.renewalDate, "2024-03-31");
  assert.equal(monthlyRenewalDates("2025-01-31", "2025-02-01")?.renewalDate, "2025-02-28");
  assert.equal(monthlyRenewalDates("2025-01-31", "2025-04-01")?.renewalDate, "2025-04-30");
  assert.equal(monthlyRenewalDates("2025-01-31", "2025-05-01")?.renewalDate, "2025-05-31");
});

test("first renewal is one month after start, including future starts", () => {
  for (const today of ["2025-01-01", "2025-06-14", "2025-06-15", "2025-07-01"]) {
    assert.deepEqual(monthlyRenewalDates("2025-06-15", today), {
      renewalDate: "2025-07-15", invoiceDate: "2025-07-01", stopDeadlineJst: "2025-07-14 23:59（日本時間）",
    });
  }
});

test("renewal today remains current; day after selects next original anniversary", () => {
  assert.equal(monthlyRenewalDates("2024-01-31", "2024-02-29")?.renewalDate, "2024-02-29");
  assert.equal(monthlyRenewalDates("2024-01-31", "2024-03-01")?.renewalDate, "2024-03-31");
  assert.equal(monthlyRenewalDates("2024-02-29", "2025-03-01")?.renewalDate, "2025-03-29");
});

test("invoice and deadline cross calendar year correctly", () => {
  assert.deepEqual(monthlyRenewalDates("2024-12-01", "2024-12-20"), {
    renewalDate: "2025-01-01", invoiceDate: "2024-12-18", stopDeadlineJst: "2024-12-31 23:59（日本時間）",
  });
  assert.equal(monthlyRenewalDates("2024-12-31", "2025-01-31")?.renewalDate, "2025-01-31");
});

test("invalid dates and out-of-range renewal years fail closed", () => {
  for (const value of ["", "2025-02-29", "2024-02-30", "2025-04-31", "2025-13-01", "2025-00-01", "2025-01-00", "25-01-01", "2025-1-01", "2025-01-01T00:00:00Z", " 2025-01-01", undefined, null]) {
    assert.equal(monthlyRenewalDates(value as string, "2025-01-01"), null);
    assert.equal(monthlyRenewalDates("2025-01-01", value as string), null);
  }
  assert.equal(monthlyRenewalDates("9999-12-01", "9999-12-01"), null);
});

test("date-only calculations work for years below 100 without Date.UTC century coercion", () => {
  assert.equal(monthlyRenewalDates("0099-12-31", "0100-01-01")?.renewalDate, "0100-01-31");
});
