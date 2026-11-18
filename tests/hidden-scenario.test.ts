import { describe, expect, it } from "vitest";
import { decideVerdict } from "../src/lib/receipt/totals";
import sampleHidden from "../samples/sample-hidden.json";
import type { Receipt } from "../src/lib/types";

/**
 * Documents the demo contract without calling Sandbox:
 * narrow threshold-only (or dual `>`→`>=`) fix passes visible cases but
 * fails held-out multi-line cart semantics.
 */

type LineItem = { sku: string; quantity: number; unitPriceCents: number };

function applyBulkDiscount(
  item: LineItem,
  threshold: ">" | ">=",
): number {
  const subtotal = item.quantity * item.unitPriceCents;
  const qualifies =
    threshold === ">=" ? item.quantity >= 3 : item.quantity > 3;
  if (!qualifies) return subtotal;
  return Math.round(subtotal * 0.9);
}

/** Buggy cart: discount from cart-wide quantity. */
function cartWide(items: LineItem[], threshold: ">" | ">="): number {
  const subtotal = items.reduce(
    (s, i) => s + i.quantity * i.unitPriceCents,
    0,
  );
  const totalQuantity = items.reduce((s, i) => s + i.quantity, 0);
  const qualifies =
    threshold === ">=" ? totalQuantity >= 3 : totalQuantity > 3;
  if (qualifies) return Math.round(subtotal * 0.9);
  return subtotal;
}

/** Correct cart: per-line via applyBulkDiscount. */
function cartPerLine(items: LineItem[], threshold: ">" | ">="): number {
  return items.reduce((s, i) => s + applyBulkDiscount(i, threshold), 0);
}

const hoodie3: LineItem = {
  sku: "HOODIE-NAVY",
  quantity: 3,
  unitPriceCents: 5000,
};
const socks1: LineItem = { sku: "SOCKS", quantity: 1, unitPriceCents: 1200 };
const belowThresholdCart: LineItem[] = [
  { sku: "HOODIE-NAVY", quantity: 1, unitPriceCents: 5000 },
  { sku: "SOCKS", quantity: 2, unitPriceCents: 1200 },
];

describe("hidden-tests demo scenario", () => {
  it("buggy threshold fails the customer-visible qty=3 case", () => {
    expect(applyBulkDiscount(hoodie3, ">")).toBe(15000);
  });

  it("narrow fix (>= on line item only) passes all visible cases", () => {
    expect(applyBulkDiscount({ ...hoodie3, quantity: 1 }, ">=")).toBe(5000);
    expect(applyBulkDiscount({ ...hoodie3, quantity: 2 }, ">=")).toBe(10000);
    expect(applyBulkDiscount(hoodie3, ">=")).toBe(13500);
    expect(applyBulkDiscount({ ...hoodie3, quantity: 4 }, ">=")).toBe(18000);
    // Visible cart is a single below-threshold line — green under cart-wide too.
    expect(cartWide([{ ...hoodie3, quantity: 1 }], ">")).toBe(5000);
    expect(cartWide([{ ...hoodie3, quantity: 1 }], ">=")).toBe(5000);
  });

  it("dual >= fix (line + cart-wide) still leaves visible green", () => {
    expect(applyBulkDiscount(hoodie3, ">=")).toBe(13500);
    expect(cartWide([{ ...hoodie3, quantity: 1 }], ">=")).toBe(5000);
  });

  it("dual >= still fails held-out below-threshold multi-line cart", () => {
    // totalQuantity 3 with cart-wide >= incorrectly discounts.
    expect(cartWide(belowThresholdCart, ">=")).toBe(6660);
    expect(cartPerLine(belowThresholdCart, ">=")).toBe(7400);
  });

  it("narrow or dual >= still fails held-out mixed qualifying carts", () => {
    const mixed = [hoodie3, socks1];
    expect(cartWide(mixed, ">")).toBe(14580);
    expect(cartWide(mixed, ">=")).toBe(14580);
    expect(cartPerLine(mixed, ">=")).toBe(13500 + 1200);
  });

  it("full fix (threshold + per-line cart) passes visible and held-out", () => {
    expect(applyBulkDiscount(hoodie3, ">=")).toBe(13500);
    expect(cartPerLine(belowThresholdCart, ">=")).toBe(7400);
    expect(cartPerLine([hoodie3, socks1], ">=")).toBe(14700);
  });
});

describe("Caught path (claim fixed + proof red)", () => {
  it("decideVerdict maps to claim-failed-verification", () => {
    expect(
      decideVerdict({
        claimSubmitted: true,
        claimedFixed: true,
        verified: false,
      }),
    ).toBe("claim-failed-verification");
  });

  it("sample-hidden receipt carries failing held-out tests and revealed source", () => {
    const r = sampleHidden as Receipt;
    expect(r.mode).toBe("hidden");
    expect(r.agentClaim.submitted).toBe(true);
    expect(r.agentClaim.claimedFixed).toBe(true);
    expect(r.verification.verified).toBe(false);
    expect(r.verdict).toBe("claim-failed-verification");

    const failingHidden = r.verification.hiddenTests.filter(
      (t) => t.status === "failed",
    );
    expect(failingHidden.length).toBeGreaterThan(0);
    expect(failingHidden.every((t) => t.heldOut === true)).toBe(true);
    expect(
      failingHidden.some((t) => /cartTotalCents \(hidden\)/.test(t.fullName)),
    ).toBe(true);
    expect(r.verification.independentTests.stdout.length).toBeGreaterThan(0);
    expect(r.hiddenTestSource).toBeTruthy();
    expect(r.hiddenTestSource).toContain("cartTotalCents (hidden)");
  });
});
