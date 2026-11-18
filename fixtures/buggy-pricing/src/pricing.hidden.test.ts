import { describe, expect, it } from "vitest";
import { applyBulkDiscount, cartTotalCents } from "./pricing";

/**
 * Held-out tests — NOT copied into the agent sandbox in `hidden` mode.
 * Independent verification runs these in a fresh sandbox with the agent's
 * pricing.ts applied. Catches incomplete fixes (threshold-only, bad rounding).
 */

describe("applyBulkDiscount (hidden)", () => {
  it("rounds fractional discount cents to nearest cent (not floor)", () => {
    // 3 * 1111 = 3333; 10% off => 2999.7 → Math.round = 3000, Math.floor = 2999
    expect(
      applyBulkDiscount({
        sku: "TEE-ASH",
        quantity: 3,
        unitPriceCents: 1111,
      }),
    ).toBe(3000);
  });

  it("rounds when quantity is above the threshold", () => {
    // 5 * 1111 = 5555; 10% off => 4999.5 → Math.round = 5000, Math.floor = 4999
    expect(
      applyBulkDiscount({
        sku: "TEE-ASH",
        quantity: 5,
        unitPriceCents: 1111,
      }),
    ).toBe(5000);
  });

  it("still discounts large quantities (boundary)", () => {
    // 10 * 5000 = 50000; 10% off => 45000
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
  it("applies per-line promo and rounds each line independently", () => {
    const total = cartTotalCents([
      { sku: "TEE-ASH", quantity: 3, unitPriceCents: 1111 }, // 3000 after round
      { sku: "HOODIE-NAVY", quantity: 1, unitPriceCents: 5000 }, // 5000
      { sku: "SOCKS", quantity: 4, unitPriceCents: 999 }, // 4*999=3996*0.9=3596.4 → 3596
    ]);
    expect(total).toBe(3000 + 5000 + 3596);
  });
});
