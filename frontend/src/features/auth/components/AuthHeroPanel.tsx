import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import imgLogo from "@/assets/38e8096a28295e8dcc0e5020d0a5f3dd85d5f019.png";
import { PreviewStyleEventCard } from "@/features/auth/components/PreviewStyleEventCard";
import { eventToPreview } from "@/features/auth/utils/eventPreview";
import type { Event } from "@/shared/types";

interface AuthHeroPanelProps {
  /** Upcoming events for the preview collage (server-fetched; empty shows the brand fallback). */
  events?: Event[];
}

export function AuthHeroPanel({ events = [] }: AuthHeroPanelProps) {
  const { t, i18n } = useTranslation();

  const locale = i18n.language || "en-US";

  // First four distinct-title upcoming events, deterministic so server and
  // client render the same collage (random selection would cause a hydration
  // mismatch). Recurring events appear multiple times in the feed; showing
  // the same title twice reads as a bug.
  const previewEvents = useMemo(() => {
    const seenTitles = new Set<string>();
    const distinct = [];
    for (const event of events) {
      if (seenTitles.has(event.title)) continue;
      seenTitles.add(event.title);
      distinct.push({ id: event.id, preview: eventToPreview(event, locale, t) });
      if (distinct.length === 4) break;
    }
    return distinct;
  }, [events, locale, t]);

  return (
    <section className="hidden lg:flex flex-1 min-h-full bg-gradient-to-br from-primary/[0.06] via-secondary/30 to-secondary/60 border-l border-border px-8 py-10 justify-center items-center overflow-hidden">
      <div className="w-full max-w-[520px] space-y-6">
        {previewEvents.length > 0 ? (
          <>
            <header className="space-y-1">
              <h2 className="text-lg font-semibold text-foreground">
                {t("auth.heroTitle")}
              </h2>
              <p className="text-sm text-muted-foreground">{t("auth.heroSubtitle")}</p>
            </header>
            <div
              className="grid grid-cols-2 gap-4"
              data-testid="auth-preview-events"
            >
              {previewEvents.map(({ id, preview }) => (
                <PreviewStyleEventCard key={id} event={preview} />
              ))}
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center text-center space-y-4 py-12">
            <img
              alt={t("common.logo")}
              className="h-10 w-[57px] object-contain opacity-90"
              src={imgLogo.src}
            />
            <p className="text-sm text-muted-foreground max-w-[280px]">
              {t("auth.heroEmpty")}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
