/**
 * Checkout pricing helpers for the Acme Merch storefront.
 *
 * Promo (from marketing): "Buy 3, get 10% off" — discount applies when
 * buying three or more of the same SKU on a line.
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

  if (item.quantity > 3) {
    return Math.round(subtotal * 0.9);
  }

  return subtotal;
}

/**
 * Sum discounted totals for a cart.
 */
export function cartTotalCents(items: LineItem[]): number {
  const subtotal = items.reduce(
    (sum, item) => sum + item.quantity * item.unitPriceCents,
    0,
  );
  const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);

  if (totalQuantity > 3) {
    return Math.round(subtotal * 0.9);
  }

  return subtotal;
}
