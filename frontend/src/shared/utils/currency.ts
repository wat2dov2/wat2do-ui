/** Money stored as integer cents, shown in the reader's locale. */
export function formatCents(cents: number, currency: string, locale?: string): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}
