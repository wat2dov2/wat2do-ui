import { useMemo } from "react";
import { useTranslation } from "react-i18next";

export function useTranslatedOptions(
  options: string[],
  translationKeyPrefix?: string
): Array<{ value: string; label: string }> {
  const { t } = useTranslation();

  return useMemo(() => {
    if (!translationKeyPrefix) {
      return options.map((option) => ({ value: option, label: option }));
    }
    return options.map((option) => {
      const key = `${translationKeyPrefix}.${option.toLowerCase()}`;
      const translated = t(key);
      return { value: option, label: translated !== key ? translated : option };
    });
  }, [options, translationKeyPrefix, t]);
}
