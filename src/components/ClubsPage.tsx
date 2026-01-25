import React, { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Search, Instagram, MessageCircle, Tag, ExternalLink } from "lucide-react";
import { Badge } from "./ui/badge";
import { mockClubs } from "@/data/clubs";
import type { Club } from "@/types";

export function ClubsPage() {
  const { t } = useTranslation();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);

  // Get unique categories and club types
  const allCategories = useMemo(() => {
    const cats = new Set<string>();
    mockClubs.forEach((club) => {
      club.categories.forEach((cat) => cats.add(cat));
    });
    return Array.from(cats).sort();
  }, []);

  // Filter clubs
  const filteredClubs = useMemo(() => {
    return mockClubs.filter((club) => {
      // Search filter
      if (
        searchQuery &&
        !club.club_name.toLowerCase().includes(searchQuery.toLowerCase())
      )
        return false;

      // Category filter
      if (
        selectedCategories.length > 0 &&
        !club.categories.some((cat) => selectedCategories.includes(cat))
      )
        return false;

      return true;
    });
  }, [searchQuery, selectedCategories]);

  const toggleCategory = (category: string) => {
    setSelectedCategories((prev) =>
      prev.includes(category)
        ? prev.filter((c) => c !== category)
        : [...prev, category]
    );
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">{t("clubs.title")}</h1>
        <p className="text-sm text-muted-foreground">
          {t("clubs.description")}
        </p>
      </div>

      {/* Search and Filters */}
      <div className="space-y-4">
        {/* Search Bar */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            placeholder={t("clubs.searchPlaceholder")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full border border-border bg-muted text-foreground rounded-xl pl-9 pr-3 py-1.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-gray-600 dark:focus:border-gray-700 transition-all shadow-md"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          )}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-2">
          {/* Category Chips */}
          {allCategories.slice(0, 10).map((category) => (
            <button
              key={category}
              onClick={() => toggleCategory(category)}
              className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-all ${
                selectedCategories.includes(category)
                  ? "bg-primary/20 text-primary"
                  : "bg-muted text-muted-foreground hover:bg-gray-200"
              }`}
            >
              {t(`clubs.categories.${category}`) || category}
            </button>
          ))}
        </div>

        {/* Active Filters */}
        {selectedCategories.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-muted-foreground">{t("clubs.activeFilters")}:</span>
            {selectedCategories.map((cat) => (
              <Badge
                key={cat}
                variant="secondary"
                className="text-xs px-2 py-0.5 rounded-xl"
              >
                {t(`clubs.categories.${cat}`) || cat}
                <button
                  onClick={() => toggleCategory(cat)}
                  className="ml-1.5 hover:text-foreground"
                >
                  ×
                </button>
              </Badge>
            ))}
          </div>
        )}
      </div>

      {/* Results Count */}
      <div className="flex items-center justify-between">
        <span className="font-bold text-xl text-gray-900">
          {filteredClubs.length} {filteredClubs.length === 1 ? t("clubs.club") : t("clubs.clubs")}
        </span>
      </div>

      {/* Clubs Grid */}
      {filteredClubs.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-4 gap-4">
          {filteredClubs.map((club) => (
            <ClubCard key={club.id} club={club} />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-24 px-4">
          <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
            <Search className="w-8 h-8 text-muted-foreground" />
          </div>
          <h3 className="text-lg font-semibold text-foreground mb-2">
            {t("clubs.noClubsFound")}
          </h3>
          <p className="text-sm text-muted-foreground text-center max-w-md">
            {t("clubs.noClubsFoundDesc")}
          </p>
        </div>
      )}
    </div>
  );
}

function ClubCard({ club }: { club: Club }) {
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
    if (club.club_page.startsWith("http")) {
      window.open(club.club_page, "_blank");
    }
  };

  return (
    <article className="rounded-xl overflow-hidden hover:shadow-lg hover:opacity-80 cursor-pointer transition-all duration-300 group flex flex-col h-full bg-card border border-border">
      <div className="p-4 flex flex-col gap-3 flex-1">
        {/* Club Name */}
        <h3 className="font-bold text-base text-gray-900 line-clamp-2">
          {club.club_name}
        </h3>

        {/* Categories */}
        <div className="flex flex-wrap gap-1.5">
          {club.categories.slice(0, 2).map((category) => {
            const colors = getCategoryColor(category);
            const translatedCategory = t(`clubs.categories.${category}`) || category;
            return (
              <Badge
                key={category}
                className={`${colors.bg} ${colors.text} text-[10px] px-2 py-0.5 rounded-full font-medium`}
              >
                {translatedCategory.length > 20 ? translatedCategory.substring(0, 20) + "..." : translatedCategory}
              </Badge>
            );
          })}
          {club.categories.length > 2 && (
            <Badge className="bg-muted text-muted-foreground text-[10px] px-2 py-0.5 rounded-full font-medium">
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
          {club.discord && (
            <a
              href={club.discord}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <MessageCircle className="w-3.5 h-3.5" />
              <span>Discord</span>
            </a>
          )}
        </div>

        {/* Club Page Link */}
        <button
          onClick={handleClubPageClick}
          className="flex items-center justify-center gap-1.5 w-full px-3 py-2 bg-muted hover:bg-gray-200 text-foreground text-xs font-medium rounded-xl transition-colors mt-2"
        >
          <span>{t("clubs.viewClubPage")}</span>
          <ExternalLink className="w-3 h-3" />
        </button>
      </div>
    </article>
  );
}
