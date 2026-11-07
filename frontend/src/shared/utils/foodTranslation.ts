/**
 * Translates a food tag using the translation function `t`.
 * Falls back to the canonical food name if no key is found or if translation fails.
 */
export function translateFood(food: string, t: (key: string) => string): string {
  if (!food) return food;
  if (food.trim().toLocaleLowerCase() === "yes!" || food.trim().toLocaleLowerCase() === "yes") {
    return t("filters.food");
  }
  const key = `foods.${food}`;
  const translated = t(key);
  return translated !== key ? translated : food;
}

/** An event's food as one line, the way its page and its card's food badge list it. */
export function translateFoods(foods: readonly string[], t: (key: string) => string): string {
  return foods.map((food) => translateFood(food, t)).join(", ");
}
