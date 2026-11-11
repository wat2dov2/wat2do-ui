import { useEffect } from "react";
import { controlBox } from "@/shared/config/controlBox";

const GOOGLE_FONTS_CSS = "https://fonts.googleapis.com/css2";

/** Each family's stylesheet is added to the page once, however many titles use it. */
const requested = new Set<string>();

/**
 * The CSS font stack for an event's poster-matched title font, loading the font
 * from Google Fonts the first time a title needs it. Only fonts the ingestion
 * agent may pick (controlbox `title_fonts`) are loaded; anything else, or no
 * font, keeps the page's own font.
 */
export function useTitleFont(font: string | null | undefined): string | undefined {
  const known = font != null && controlBox.eventDiscovery.titleFonts.has(font) ? font : null;
  useEffect(() => {
    if (!known || requested.has(known)) return;
    requested.add(known);
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = `${GOOGLE_FONTS_CSS}?family=${encodeURIComponent(known).replace(/%20/g, "+")}&display=swap`;
    document.head.appendChild(link);
  }, [known]);
  return known ? `"${known}", var(--font-sans)` : undefined;
}
