import { type MouseEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { Bookmark, Instagram, MessageCircle, ShieldCheck, Tag, UserPlus } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { cn } from "@/shared/lib/utils";
import type { Organization } from "@/shared/types";
import { sanitizeHref } from "@/shared/utils/url";
import { useSavedOrganizationsStore } from "@/features/organizations/store/savedOrganizations.store";
import { useAuthState } from "@/features/auth";
import { OrganizationCategoryBadges } from "./OrganizationCategoryBadges";
import { ClaimOrganizationModal } from "./ClaimOrganizationModal";
import { JoinOrganizationModal } from "./JoinOrganizationModal";

interface OrganizationCardProps {
  organization: Organization;
  onMouseDown?: () => void;
}

export function OrganizationCard({ organization, onMouseDown }: OrganizationCardProps) {
  const { t } = useTranslation();
  const { isAuthenticated } = useAuthState();
  const isSaved = useSavedOrganizationsStore((s) => s.savedOrganizationIds.includes(organization.id));
  const toggleSave = useSavedOrganizationsStore((s) => s.toggleSaveOrganization);

  const [isClaimOpen, setIsClaimOpen] = useState(false);
  const [isJoinOpen, setIsJoinOpen] = useState(false);

  const handleToggleSave = (e: MouseEvent) => {
    e.stopPropagation();
    toggleSave(organization.id);
  };

  const isUnowned = organization.created_by === null || !organization.created_by;

  return (
    <>
      <article
        onMouseDown={onMouseDown}
        className="group flex h-full min-h-[196px] cursor-pointer flex-col overflow-hidden rounded-xl border border-border bg-card text-left shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-lg"
      >
        <div className="flex flex-1 flex-col p-4">
          {/* Identity */}
          <div className="min-w-0 space-y-1">
            <h3 className="line-clamp-2 text-base font-semibold leading-tight text-foreground">
              {organization.club_name}
            </h3>
            <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
              <Tag className="size-3 shrink-0" />
              <span className="truncate">{organization.club_type}</span>
            </div>
          </div>

          <OrganizationCategoryBadges
            categories={organization.categories}
            maxVisible={2}
            className="mt-4 min-h-6"
          />

          {/* Social Links */}
          <div className="mt-4 flex min-h-7 items-center gap-2 overflow-hidden">
            {organization.ig && (
              <a
                href={`https://instagram.com/${organization.ig}`}
                target="_blank"
                rel="noopener noreferrer"
                onMouseDown={(e) => e.stopPropagation()}
                className="inline-flex min-w-0 max-w-[65%] items-center gap-1 rounded-lg bg-secondary/60 px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                <Instagram className="size-3.5 shrink-0" />
                <span className="truncate">{organization.ig}</span>
              </a>
            )}
            {organization.discord && sanitizeHref(organization.discord) && (
              <a
                href={sanitizeHref(organization.discord)}
                target="_blank"
                rel="noopener noreferrer"
                onMouseDown={(e) => e.stopPropagation()}
                className="inline-flex min-w-0 items-center gap-1 rounded-lg bg-secondary/60 px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                <MessageCircle className="size-3.5 shrink-0" />
                <span className="truncate">{t("organizations.discord")}</span>
              </a>
            )}
          </div>

          {/* Action Bar */}
          {isAuthenticated && (
            <div className="mt-auto grid grid-cols-[2.5rem_minmax(0,1fr)] gap-2 border-t border-border/70 pt-3">
              <Button
                type="button"
                variant={isSaved ? "secondary" : "outline"}
                size="icon"
                onMouseDown={handleToggleSave}
                aria-label={isSaved ? t("organizations.saved") : t("organizations.save")}
                className={cn(
                  "h-9 w-10 min-w-0 overflow-hidden border-border/80",
                  isSaved && "border-primary/25 bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary",
                )}
                id={`follow-org-${organization.id}`}
              >
                <Bookmark className={cn("size-4 shrink-0", isSaved && "fill-current")} />
              </Button>

              {isUnowned ? (
                <Button
                  type="button"
                  size="sm"
                  className="h-9 min-w-0 overflow-hidden px-3 text-xs font-semibold"
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    setIsClaimOpen(true);
                  }}
                >
                  <ShieldCheck className="size-4 shrink-0" />
                  <span className="truncate">{t("organizations.claimOrganization")}</span>
                </Button>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  className="h-9 min-w-0 overflow-hidden px-3 text-xs font-semibold"
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    setIsJoinOpen(true);
                  }}
                >
                  <UserPlus className="size-4 shrink-0" />
                  <span className="truncate">{t("organizations.applyToJoin")}</span>
                </Button>
              )}
            </div>
          )}
        </div>
      </article>

      <ClaimOrganizationModal
        isOpen={isClaimOpen}
        onClose={() => setIsClaimOpen(false)}
        organization={organization}
      />

      <JoinOrganizationModal
        isOpen={isJoinOpen}
        onClose={() => setIsJoinOpen(false)}
        organization={organization}
      />
    </>
  );
}
