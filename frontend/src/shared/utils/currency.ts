export function formatCadCents(cents: number, locale?: string): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "CAD",
  }).format(cents / 100);
}
