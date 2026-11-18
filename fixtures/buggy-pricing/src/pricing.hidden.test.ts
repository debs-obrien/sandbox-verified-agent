import { describe, expect, it } from "vitest";
import { applyBulkDiscount, cartTotalCents } from "./pricing";

describe("applyBulkDiscount (hidden)", () => {
  it("still discounts large single-SKU quantities", () => {
    expect(
      applyBulkDiscount({
        sku: "HOODIE-NAVY",
        quantity: 10,
        unitPriceCents: 5000,
      }),
    ).toBe(45000);
  });
});

describe("cartTotalCents (hidden)", () => {
  it("discounts each qualifying SKU line independently", () => {
    expect(
      cartTotalCents([
        { sku: "HOODIE-NAVY", quantity: 3, unitPriceCents: 5000 },
        { sku: "SOCKS", quantity: 1, unitPriceCents: 1200 },
      ]),
    ).toBe(13500 + 1200);
  });

  it("does not discount non-qualifying lines when another SKU hits the promo", () => {
    expect(
      cartTotalCents([
        { sku: "HOODIE-NAVY", quantity: 3, unitPriceCents: 5000 },
        { sku: "TEE-ASH", quantity: 2, unitPriceCents: 2000 },
      ]),
    ).toBe(13500 + 4000);
  });

  it("applies the promo on multiple qualifying lines separately", () => {
    expect(
      cartTotalCents([
        { sku: "HOODIE-NAVY", quantity: 3, unitPriceCents: 5000 },
        { sku: "HOODIE-GREY", quantity: 4, unitPriceCents: 5000 },
      ]),
    ).toBe(13500 + 18000);
  });
});
