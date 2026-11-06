/** "$12.50" for an amount in cents, in the reader's locale and the given currency ("cad", "usd"). */
export function formatCents(cents: number, currency: string, locale?: string): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}
