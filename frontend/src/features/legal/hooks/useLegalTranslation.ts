import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { loadLegalTranslations } from "@/features/legal/lib/translations";
import { isSupportedLanguage } from "@/shared/constants/languages";

/**
 * `useTranslation` for the legal pages: it loads their copy in the visitor's
 * language and renders again once that copy arrives (English shows until then).
 */
export function useLegalTranslation() {
  const translation = useTranslation();
  const language = translation.i18n.language;
  // Changing it re-renders the page, whose t() then finds the copy just added.
  const [, setLoadedLanguage] = useState<string | null>(null);

  useEffect(() => {
    if (!isSupportedLanguage(language)) {
      return;
    }
    let current = true;
    loadLegalTranslations(language)
      .then(() => {
        if (current) {
          setLoadedLanguage(language);
        }
      })
      .catch((error: unknown) => {
        console.error(`Failed to load the legal pages in "${language}":`, error);
      });
    return () => {
      current = false;
    };
  }, [language]);

  return translation;
}
