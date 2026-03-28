import { useTranslation } from "react-i18next";

/**
 * Hook for translating option arrays
 * Optimized to reduce re-renders by using i18n's built-in reactivity
 */
export function useTranslatedOptions(
  options: string[],
  translationKeyPrefix?: string
): Array<{ value: string; label: string }> {
  const { t } = useTranslation();

  // No memoization needed - i18n handles reactivity internally
  // Options array reference should be stable from parent
  if (!translationKeyPrefix) {
    return options.map((option) => ({ value: option, label: option }));
  }
  
  return options.map((option) => {
    const key = `${translationKeyPrefix}.${option.toLowerCase()}`;
    const translated = t(key);
    return { value: option, label: translated !== key ? translated : option };
  });
}
