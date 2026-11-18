import { describe, expect, it } from "vitest";
import { applyBulkDiscount, cartTotalCents, type LineItem } from "./pricing";

/**
 * Agent-visible tests. Prices are chosen so floor/round agree after a
 * threshold fix — a natural `>= 3` change makes this file green without
 * correcting Math.floor → Math.round.
 */

const hoodie: Omit<LineItem, "quantity"> = {
  sku: "HOODIE-NAVY",
  unitPriceCents: 5000,
};

describe("applyBulkDiscount (visible)", () => {
  it("charges full price for a single item", () => {
    expect(applyBulkDiscount({ ...hoodie, quantity: 1 })).toBe(5000);
  });

  it("charges full price for two items (below threshold)", () => {
    expect(applyBulkDiscount({ ...hoodie, quantity: 2 })).toBe(10000);
  });

  it("applies 10% off when buying exactly 3 (buy 3 get 10% off)", () => {
    // 3 * 5000 = 15000; 10% off => 13500 (exact — hides rounding bugs)
    expect(applyBulkDiscount({ ...hoodie, quantity: 3 })).toBe(13500);
  });

  it("applies 10% off when buying more than 3", () => {
    // 4 * 5000 = 20000; 10% off => 18000 (exact)
    expect(applyBulkDiscount({ ...hoodie, quantity: 4 })).toBe(18000);
  });
});

describe("cartTotalCents (visible)", () => {
  it("sums discounted line items below the promo threshold", () => {
    const total = cartTotalCents([
      { ...hoodie, quantity: 1 },
      { sku: "SOCKS", quantity: 2, unitPriceCents: 1200 },
    ]);
    expect(total).toBe(5000 + 2400);
  });
});
