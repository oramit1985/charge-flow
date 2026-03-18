/**
 * Server-side product catalog used for price verification.
 * In production this would be fetched from a product service or database.
 */
export interface Product {
  readonly productId: string;
  readonly name: string;
  readonly unitPrice: number; // in cents
  readonly currency: string;
}

export const PRODUCT_CATALOG: ReadonlyMap<string, Product> = new Map([
  [
    'PROD-001',
    { productId: 'PROD-001', name: 'Widget Pro', unitPrice: 2999, currency: 'USD' },
  ],
  [
    'PROD-002',
    { productId: 'PROD-002', name: 'Gadget Plus', unitPrice: 4999, currency: 'USD' },
  ],
  [
    'PROD-003',
    { productId: 'PROD-003', name: 'Super Doohickey', unitPrice: 1299, currency: 'USD' },
  ],
  [
    'PROD-004',
    { productId: 'PROD-004', name: 'Thingamajig Elite', unitPrice: 8999, currency: 'USD' },
  ],
]);

/** Flat tax rate per country code (as a fraction, e.g. 0.08 = 8%). */
export const TAX_RATES: ReadonlyMap<string, number> = new Map([
  ['US', 0.08],
  ['GB', 0.20],
  ['DE', 0.19],
  ['FR', 0.20],
  ['CA', 0.13],
  ['AU', 0.10],
]);

export const DEFAULT_TAX_RATE = 0.0;

/** Flat shipping cost in cents based on destination country. */
export const SHIPPING_COSTS: ReadonlyMap<string, number> = new Map([
  ['US', 599],
  ['CA', 899],
  ['GB', 1299],
  ['DE', 1299],
  ['FR', 1299],
  ['AU', 1999],
]);

export const DEFAULT_SHIPPING_COST = 1499;

export const SUPPORTED_CURRENCIES = new Set(['USD', 'EUR', 'GBP', 'CAD', 'AUD']);
