import React from "react";
import { useTranslation } from "react-i18next";
import { Instagram, MessageCircle, Tag, ExternalLink } from "lucide-react";
import { Badge } from "@/shared/ui/badge";
import type { Club } from "@/shared/types";
import { sanitizeHref } from "@/shared/utils/url";

// Normalize club category to use consolidated event category translations where applicable
function getClubCategoryTranslation(category: string, t: (key: string) => string): string {
  const categoryMap: Record<string, string> = {
    "Academic": "categories.academic",
    "Religious": "categories.religious",
    "Cultural": "categories.cultural",
  };
  const normalizedKey = categoryMap[category];
  if (normalizedKey) {
    return t(normalizedKey) || category;
  }
  // Fallback to clubs.categories.* for WUSA-specific categories
  return t(`clubs.categories.${category}`) || category;
}

interface ClubCardProps {
  club: Club;
}

export function ClubCard({ club }: ClubCardProps) {
  const { t } = useTranslation();
  
  const getCategoryColor = (category: string): { bg: string; text: string } => {
    // Map categories to existing category colors where possible
    const mapping: Record<string, { bg: string; text: string }> = {
      Academic: {
        bg: "bg-category-academic-bg",
        text: "text-category-academic-text",
      },
      Religious: {
        bg: "bg-category-religious-bg",
        text: "text-category-religious-text",
      },
      "Religious and Spiritual": {
        bg: "bg-category-religious-bg",
        text: "text-category-religious-text",
      },
      Cultural: {
        bg: "bg-category-cultural-bg",
        text: "text-category-cultural-text",
      },
      "Creative Arts, Dance and Music": {
        bg: "bg-category-arts-bg",
        text: "text-category-arts-text",
      },
      "Games, Recreational and Social": {
        bg: "bg-category-social-bg",
        text: "text-category-social-text",
      },
    };
    return (
      mapping[category] || {
        bg: "bg-category-default-bg",
        text: "text-category-default-text",
      }
    );
  };

  const handleClubPageClick = () => {
    const safe = sanitizeHref(club.club_page);
    if (safe) {
      window.open(safe, "_blank", "noopener,noreferrer");
    }
  };

  return (
    <article className="rounded-xl overflow-hidden hover:shadow-lg hover:opacity-80 cursor-pointer transition-all duration-300 group flex flex-col h-full bg-card border border-border">
      <div className="p-4 flex flex-col gap-3 flex-1">
        {/* Club Name */}
        <h3 className="font-bold text-base text-foreground line-clamp-2">
          {club.club_name}
        </h3>

        {/* Categories */}
        <div className="flex flex-wrap gap-1.5">
          {club.categories.slice(0, 2).map((category) => {
            const colors = getCategoryColor(category);
            const translatedCategory = getClubCategoryTranslation(category, t);
            return (
              <Badge
                key={category}
                variant="outline"
                className={`${colors.bg} ${colors.text} text-[10px] px-2 py-0.5 rounded-full font-medium`}
              >
                {translatedCategory.length > 20 ? translatedCategory.substring(0, 20) + "..." : translatedCategory}
              </Badge>
            );
          })}
          {club.categories.length > 2 && (
            <Badge
              variant="outline"
              className="bg-muted text-muted-foreground text-[10px] px-2 py-0.5 rounded-full font-medium"
            >
              +{club.categories.length - 2}
            </Badge>
          )}
        </div>

        {/* Club Type */}
        <div className="flex items-center gap-1.5">
          <Tag className="w-3 h-3 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">{club.club_type}</span>
        </div>

        {/* Social Links */}
        <div className="flex items-center gap-2 mt-auto">
          {club.ig && (
            <a
              href={`https://instagram.com/${club.ig}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <Instagram className="w-3.5 h-3.5" />
              <span>{club.ig}</span>
            </a>
          )}
          {club.discord && sanitizeHref(club.discord) && (
            <a
              href={sanitizeHref(club.discord)}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <MessageCircle className="w-3.5 h-3.5" />
              <span>{t("clubs.discord")}</span>
            </a>
          )}
        </div>

      </div>
    </article>
  );
}
