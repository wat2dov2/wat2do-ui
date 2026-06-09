import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Instagram, MessageCircle, Tag, Bookmark } from "lucide-react";
import { Badge } from "@/shared/ui/badge";
import type { Organization } from "@/shared/types";
import { sanitizeHref } from "@/shared/utils/url";
import { getClubCategoryTranslation } from "@/shared/utils/categoryTranslation";
import { getCategoryClasses } from "@/shared/utils/event";
import { useSavedOrganizationsStore } from "@/features/organizations/store/savedOrganizations.store";
import { useAuthState } from "@/features/auth";
import { ClaimOrganizationModal } from "./ClaimOrganizationModal";
import { JoinOrganizationModal } from "./JoinOrganizationModal";

interface OrganizationCardProps {
  club: Organization;
  onMouseDown?: () => void;
}

export function OrganizationCard({ club, onMouseDown }: OrganizationCardProps) {
  const { t } = useTranslation();
  const { isAuthenticated } = useAuthState();
  const isSaved = useSavedOrganizationsStore((s) => s.savedOrganizationIds.includes(club.id));
  const toggleSave = useSavedOrganizationsStore((s) => s.toggleSaveOrganization);

  const [isClaimOpen, setIsClaimOpen] = useState(false);
  const [isJoinOpen, setIsJoinOpen] = useState(false);

  const handleToggleSave = (e: React.MouseEvent) => {
    e.stopPropagation();
    toggleSave(club.id);
  };

  const isUnowned = club.created_by === null || !club.created_by;

  return (
    <>
      <article
        onMouseDown={onMouseDown}
        className="rounded-xl overflow-hidden hover:shadow-lg hover:opacity-80 cursor-pointer transition-all duration-300 group flex flex-col h-full bg-card border border-border"
      >
        <div className="p-4 flex flex-col gap-3 flex-1">
          {/* Header with Club Name and Follow Button */}
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-semibold text-base text-foreground line-clamp-2 flex-1">
              {club.club_name}
            </h3>
            <button
              onMouseDown={handleToggleSave}
              aria-label={isSaved ? t("organizations.saved") : t("organizations.save")}
              className="p-1.5 rounded-lg hover:bg-secondary text-muted-foreground hover:text-foreground transition-all duration-200"
              id={`follow-club-${club.id}`}
            >
              <Bookmark className={`size-4 ${isSaved ? "fill-primary text-primary" : ""}`} />
            </button>
          </div>

          {/* Categories */}
          <div className="flex flex-wrap gap-1.5">
            {club.categories.slice(0, 2).map((category) => {
              const colors = getCategoryClasses(category);
              const translatedCategory = getClubCategoryTranslation(category, t);
              return (
                <Badge
                  key={category}
                  variant="outline"
                  className={`${colors.bg} ${colors.text} text-[10px] px-2 py-0.5 rounded-full font-medium border-0`}
                >
                  {translatedCategory.length > 20 ? translatedCategory.substring(0, 20) + "..." : translatedCategory}
                </Badge>
              );
            })}
            {club.categories.length > 2 && (
              <Badge
                variant="outline"
                className="bg-secondary text-muted-foreground text-[10px] px-2 py-0.5 rounded-full font-medium border-0"
              >
                +{club.categories.length - 2}
              </Badge>
            )}
          </div>

          {/* Club Type */}
          <div className="flex items-center gap-1.5">
            <Tag className="size-3 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">{club.club_type}</span>
          </div>

          {/* Claim / Join Action Buttons */}
          {isAuthenticated && (
            <div className="pt-1">
              {isUnowned ? (
                <button
                  type="button"
                  className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-primary/20 bg-primary/5 text-primary rounded-lg transition-all duration-200 hover:bg-primary/10"
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    setIsClaimOpen(true);
                  }}
                >
                  {t("organizations.claimOrganization")}
                </button>
              ) : (
                <button
                  type="button"
                  className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-border bg-secondary/30 text-foreground rounded-lg transition-all duration-200 hover:bg-secondary"
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    setIsJoinOpen(true);
                  }}
                >
                  {t("organizations.applyToJoin")}
                </button>
              )}
            </div>
          )}

          {/* Social Links */}
          <div className="flex items-center gap-2 mt-auto">
            {club.ig && (
              <a
                href={`https://instagram.com/${club.ig}`}
                target="_blank"
                rel="noopener noreferrer"
                onMouseDown={(e) => e.stopPropagation()}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <Instagram className="size-3.5" />
                <span>{club.ig}</span>
              </a>
            )}
            {club.discord && sanitizeHref(club.discord) && (
              <a
                href={sanitizeHref(club.discord)}
                target="_blank"
                rel="noopener noreferrer"
                onMouseDown={(e) => e.stopPropagation()}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <MessageCircle className="size-3.5" />
                <span>{t("organizations.discord")}</span>
              </a>
            )}
          </div>
        </div>
      </article>

      <ClaimOrganizationModal
        isOpen={isClaimOpen}
        onClose={() => setIsClaimOpen(false)}
        club={club}
      />

      <JoinOrganizationModal
        isOpen={isJoinOpen}
        onClose={() => setIsJoinOpen(false)}
        club={club}
      />
    </>
  );
}
