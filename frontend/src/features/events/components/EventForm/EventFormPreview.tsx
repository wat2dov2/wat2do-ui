import React from "react";
import { useTranslation } from "react-i18next";
import { CalendarIcon, MapPin, Users, ImagePlus } from "lucide-react";
import { BadgeMask } from "@/shared/ui/badge-mask";
import type { EventFormData } from "@/shared/types";
import { formatEventDate, formatTime } from "@/shared/utils/date";
import { getCategoryClasses, translateCategory } from "@/shared/utils/event";

interface EventFormPreviewProps {
  formData: EventFormData;
}

export function EventFormPreview({ formData }: EventFormPreviewProps) {
  const { t } = useTranslation();

  return (
    <div className="w-80 bg-muted border-l border-border p-6 overflow-y-auto min-h-0 space-y-4">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-foreground">
          {t("forms.livePreview")}
        </span>
      </div>

      {/* Preview Card - Matches EventCard styling */}
      <div className="bg-card rounded-xl border border-border overflow-hidden shadow-sm">
        {/* Image area with category badge */}
        <div className="relative h-32 bg-gradient-to-br from-gray-200 to-gray-300 flex items-center justify-center">
          <ImagePlus className="w-6 h-6 text-muted-foreground" />
          {formData.category && (
            <BadgeMask variant="top-left">
              <span
                className={`font-bold text-[10px] px-2 py-0.5 block rounded-full ${
                  getCategoryClasses(formData.category).bg
                } ${getCategoryClasses(formData.category).text}`}
              >
                {translateCategory(formData.category, t)}
              </span>
            </BadgeMask>
          )}
          {/* Club badge - bottom left */}
          <div className="absolute bottom-2 left-2 z-10 flex items-center gap-2">
            <div className="w-7 h-7 rounded-full border-2 border-card shadow-lg flex items-center justify-center flex-shrink-0 bg-card bg-gradient-to-br from-primary/20 to-primary/10">
              <Users
                className="w-3.5 h-3.5 text-primary"
                strokeWidth={2}
              />
            </div>
            <span className="font-bold text-[10px] text-white truncate max-w-[100px] drop-shadow-[0_1px_3px_rgba(0,0,0,0.5),0_1px_2px_rgba(0,0,0,0.4)]">
              {formData.organization || t("events.organization")}
            </span>
          </div>
        </div>
        <div className="p-4 space-y-3">
          {/* Title first */}
          <h3 className="font-medium text-[12px] leading-tight line-clamp-2 text-foreground">
            {formData.title || t("events.eventTitle")}
          </h3>

          {/* Badges - light background styling */}
          <div className="flex flex-wrap gap-1.5">
            {formData.price === 0 ? (
              <span className="font-medium text-[10px] px-2 py-0.5 rounded-xl bg-success/20 text-success">
                {t("common.free")}
              </span>
            ) : (
              <span className="font-medium text-[10px] px-2 py-0.5 rounded-xl bg-primary/20 text-primary">
                ${formData.price}
              </span>
            )}
            {formData.food.length > 0 && (
              <span className="font-medium text-[10px] px-2 py-0.5 rounded-xl bg-warning/20 text-warning">
                {t("common.freeFood")}
              </span>
            )}
            {formData.requiresRegistration && (
              <span className="font-medium text-[10px] px-2 py-0.5 rounded-xl bg-primary/20 text-primary">
                {t("common.registrationRequired")}
              </span>
            )}
          </div>

          {/* Event Info */}
          <div className="space-y-1">
            <div className="flex gap-1.5 items-center">
              <CalendarIcon
                className="w-3 h-3 shrink-0 text-muted-foreground"
                strokeWidth={2}
              />
              <span className="text-[11px] truncate text-muted-foreground">
                {formatEventDate(formData.date)} at{" "}
                {formatTime(formData.time)}
              </span>
            </div>
            <div className="flex gap-1.5 items-center">
              <MapPin
                className="w-3 h-3 flex-shrink-0 text-muted-foreground"
                strokeWidth={2}
              />
              <span className="text-[11px] truncate text-muted-foreground">
                {formData.location || t("filters.location")}
              </span>
            </div>
          </div>

          {/* Divider */}
          <div className="h-px bg-gradient-to-r from-transparent via-border to-transparent" />

          {/* View More button placeholder */}
          <div className="w-full text-white font-medium text-[11px] h-8 rounded-xl flex items-center justify-center gap-1.5 shadow-sm bg-primary">
            {t("events.viewMore")}
          </div>
        </div>
      </div>

      <p className="text-[10px] text-muted-foreground text-center">
        {t("events.previewDescription")}
      </p>
    </div>
  );
}
