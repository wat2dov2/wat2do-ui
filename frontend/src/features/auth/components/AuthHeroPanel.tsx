"use client";

import Image from "next/image";
import { useTranslation } from "react-i18next";
import imgLogo from "@/assets/38e8096a28295e8dcc0e5020d0a5f3dd85d5f019.png";
import { EventCard } from "@/features/events/components/EventCard";
import { EventCardSkeleton } from "@/features/events/components/EventCardSkeleton";
import { controlBox } from "@/shared/config/controlBox";
import type { Event } from "@/shared/types";

interface AuthHeroPanelProps {
  /** Upcoming events for the preview collage (server-fetched; empty shows the brand fallback). */
  events?: Event[];
  isLoading?: boolean;
}

export function AuthHeroPanel({ events = [], isLoading = false }: AuthHeroPanelProps) {
  const { t } = useTranslation();

  return (
    <section className="hidden lg:flex flex-1 min-h-full bg-gradient-to-br from-primary/[0.06] via-secondary/30 to-secondary/60 border-l border-border px-8 py-10 justify-center items-center overflow-hidden">
      <div className="w-full max-w-[520px] space-y-6">
        {isLoading || events.length > 0 ? (
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
              aria-busy={isLoading}
            >
              {isLoading ? Array.from({ length: controlBox.eventDiscovery.previewEventCount }, (_, index) => (
                <EventCardSkeleton key={index} />
              )) : events.map((event) => (
                <EventCard key={event.id} event={event} interactive={false} imagePriority />
              ))}
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center text-center space-y-4 py-12">
            <Image
              alt={t("common.logo")}
              width={57}
              height={40}
              className="h-10 w-[57px] object-contain opacity-90"
              src={imgLogo}
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
