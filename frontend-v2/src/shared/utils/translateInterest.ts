/**
 * Translates an interest value using the categories translation prefix
 */
export function translateInterest(interest: string, t: (key: string) => string): string {
  const key = `categories.${interest.toLowerCase()}`;
  const translated = t(key);
  return translated !== key ? translated : interest;
}
