import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { ChevronDown, Crown, Shield } from "lucide-react";
import { useAuthState, type AuthState } from "@/features/auth/hooks/useAuthState";
import { useOpenClubPanel } from "@/features/clubs";
import { ROUTES } from "@/shared/constants/routes";
import { Button, buttonVariants } from "@/shared/ui/button";
import { SearchCombobox } from "@/shared/ui/search-combobox";

type ManagedClub = AuthState["clubs"][number];

/**
 * The club panel for each club the visitor helps run, and Admin for admins:
 * the profile page's header holds them, since the top bar no longer does.
 */
export function ProfileTeamActions() {
  const { t } = useTranslation();
  const router = useRouter();
  const { profileCompleted, isAdmin, clubs, clubId } = useAuthState();
  const openClubPanel = useOpenClubPanel();
  const activeClub = clubs.find((club) => club.id === clubId) ?? clubs[0];
  const handleClubSelect = useCallback((club: ManagedClub) => openClubPanel(club), [openClubPanel]);
  if (!profileCompleted) return null;

  return (
    <>
      {activeClub ? (
        // One entry for every club the visitor manages: pick which one the club panel opens on.
        <SearchCombobox<ManagedClub>
          selectedKey=""
          onSelect={handleClubSelect}
          items={clubs}
          getKey={(club) => club.id}
          getLabel={(club) => club.club_name}
          displayValue={t("clubPanel.title")}
          renderTriggerLabel={(label) => (
            <>
              <Crown />
              <span className="min-w-0 flex-1 truncate text-start">{label}</span>
              <ChevronDown />
            </>
          )}
          triggerClassName={buttonVariants({ variant: "outline", size: "sm" })}
          searchPlaceholder={t("forms.searchClubPlaceholder")}
          emptyLabel={t("forms.noClubFound")}
        />
      ) : null}
      {isAdmin ? (
        <Button variant="outline" size="sm" onClick={() => router.push(ROUTES.ADMIN)}>
          <Shield />
          {t("navigation.admin")}
        </Button>
      ) : null}
    </>
  );
}
