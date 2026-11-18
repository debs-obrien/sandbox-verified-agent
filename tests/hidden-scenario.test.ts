import { describe, expect, it } from "vitest";

/**
 * Documents the demo contract without calling Sandbox:
 * narrow threshold-only fix passes visible cases but fails held-out
 * multi-line cart semantics.
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
function cartWide(items: LineItem[]): number {
  const subtotal = items.reduce(
    (s, i) => s + i.quantity * i.unitPriceCents,
    0,
  );
  const totalQuantity = items.reduce((s, i) => s + i.quantity, 0);
  if (totalQuantity > 3) return Math.round(subtotal * 0.9);
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

describe("hidden-tests demo scenario", () => {
  it("buggy threshold fails the customer-visible qty=3 case", () => {
    expect(applyBulkDiscount(hoodie3, ">")).toBe(15000);
  });

  it("narrow fix (>= only) passes visible single-SKU cases", () => {
    expect(applyBulkDiscount(hoodie3, ">=")).toBe(13500);
    expect(
      applyBulkDiscount(
        { sku: "HOODIE-NAVY", quantity: 4, unitPriceCents: 5000 },
        ">=",
      ),
    ).toBe(18000);
  });

  it("narrow fix still fails held-out multi-line cart cases", () => {
    const mixed = [hoodie3, socks1];
    // After threshold fix on applyBulkDiscount, cart-wide helper still wrong.
    expect(cartWide(mixed)).toBe(14580);
    expect(cartPerLine(mixed, ">=")).toBe(13500 + 1200);
  });

  it("full fix (threshold + per-line cart) passes visible and held-out cases", () => {
    const mixed = [hoodie3, socks1];
    expect(applyBulkDiscount(hoodie3, ">=")).toBe(13500);
    expect(cartPerLine(mixed, ">=")).toBe(14700);
    expect(
      cartPerLine(
        [
          { sku: "HOODIE-NAVY", quantity: 3, unitPriceCents: 5000 },
          { sku: "TEE-ASH", quantity: 2, unitPriceCents: 2000 },
        ],
        ">=",
      ),
    ).toBe(17500);
  });
});
