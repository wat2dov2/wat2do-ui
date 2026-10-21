/**
 * A count with at most three significant figures, rounded down so the claim
 * stays true: 19,690 reads "19,600+", while 151 reads "151".
 */
export function formatLandingCount(count: number, locale: string): string {
  const format = new Intl.NumberFormat(locale);
  if (count < 1000) return format.format(count);
  const step = 10 ** (Math.floor(Math.log10(count)) - 2);
  const floored = Math.floor(count / step) * step;
  return floored < count ? `${format.format(floored)}+` : format.format(floored);
}
