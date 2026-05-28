/**
 * Translates a food tag using the translation function `t`.
 * Falls back to the canonical food name if no key is found or if translation fails.
 */
export function translateFood(food: string, t: (key: string) => string): string {
  if (!food) return food;
  const key = `foods.${food}`;
  const translated = t(key);
  return translated !== key ? translated : food;
}
