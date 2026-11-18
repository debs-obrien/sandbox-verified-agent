import { describe, expect, it } from "vitest";
import { applyBulkDiscount, cartTotalCents, type LineItem } from "./pricing";

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
    expect(applyBulkDiscount({ ...hoodie, quantity: 3 })).toBe(13500);
  });

  it("applies 10% off when buying more than 3", () => {
    expect(applyBulkDiscount({ ...hoodie, quantity: 4 })).toBe(18000);
  });
});

describe("cartTotalCents (visible)", () => {
  it("sums line items when every line is below the promo threshold", () => {
    const total = cartTotalCents([
      { ...hoodie, quantity: 1 },
      { sku: "SOCKS", quantity: 2, unitPriceCents: 1200 },
    ]);
    expect(total).toBe(5000 + 2400);
  });
});
