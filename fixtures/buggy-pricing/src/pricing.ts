/**
 * Checkout pricing helpers for the Acme Merch storefront.
 *
 * Promo rule (from marketing): "Buy 3, get 10% off" — the discount
 * applies when the customer buys three or more of the same SKU.
 */

export type LineItem = {
  sku: string;
  quantity: number;
  unitPriceCents: number;
};

/**
 * Apply the bulk discount to a single line item.
 * Returns the discounted line total in cents.
 */
export function applyBulkDiscount(item: LineItem): number {
  const subtotal = item.quantity * item.unitPriceCents;

  // Promo: buy 3 get 10% off
  // BUG: uses `>` instead of `>=`, so quantity === 3 never qualifies.
  if (item.quantity > 3) {
    return Math.round(subtotal * 0.9);
  }

  return subtotal;
}

/**
 * Sum discounted totals for a cart.
 */
export function cartTotalCents(items: LineItem[]): number {
  return items.reduce((sum, item) => sum + applyBulkDiscount(item), 0);
}
