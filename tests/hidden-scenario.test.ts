import { describe, expect, it } from "vitest";

/**
 * Documents the demo contract without calling Sandbox:
 * narrow threshold-only fix passes visible cases but fails held-out rounding.
 */

type LineItem = { quantity: number; unitPriceCents: number };

function apply(item: LineItem, opts: { ge: boolean; round: boolean }): number {
  const subtotal = item.quantity * item.unitPriceCents;
  const qualifies = opts.ge ? item.quantity >= 3 : item.quantity > 3;
  if (!qualifies) return subtotal;
  const discounted = subtotal * 0.9;
  return opts.round ? Math.round(discounted) : Math.floor(discounted);
}

const hoodie = { unitPriceCents: 5000 };
const tee = { unitPriceCents: 1111 };

describe("hidden-tests demo scenario", () => {
  it("buggy code fails the customer-visible qty=3 case", () => {
    expect(apply({ ...hoodie, quantity: 3 }, { ge: false, round: false })).toBe(
      15000,
    );
  });

  it("narrow fix (>= only) passes visible exact-cent prices", () => {
    const narrow = { ge: true, round: false };
    expect(apply({ ...hoodie, quantity: 3 }, narrow)).toBe(13500);
    expect(apply({ ...hoodie, quantity: 4 }, narrow)).toBe(18000);
  });

  it("narrow fix still fails held-out rounding cases", () => {
    const narrow = { ge: true, round: false };
    // 3 * 1111 * 0.9 = 2999.7 → floor 2999, round 3000
    expect(apply({ ...tee, quantity: 3 }, narrow)).toBe(2999);
    expect(apply({ ...tee, quantity: 3 }, { ge: true, round: true })).toBe(3000);
  });

  it("full fix passes visible + held-out cases", () => {
    const full = { ge: true, round: true };
    expect(apply({ ...hoodie, quantity: 3 }, full)).toBe(13500);
    expect(apply({ ...tee, quantity: 3 }, full)).toBe(3000);
    expect(apply({ ...tee, quantity: 5 }, full)).toBe(5000);
  });
});
