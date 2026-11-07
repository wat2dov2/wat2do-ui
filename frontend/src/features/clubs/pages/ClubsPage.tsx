"use client";

import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import { Bookmark, Building2, Search } from "lucide-react";
import { Button } from "@/shared/ui/button";
import {
  ClubList,
  ClubListEmptyState,
} from "@/features/clubs/components/ClubList";
import { useClubsPage } from "@/features/clubs/hooks/useClubsPage";
import { useAuthState } from "@/features/auth/hooks/useAuthState";
import { useSavedClubsStore } from "@/features/clubs/store/savedClubs.store";
import { clubPagePath } from "@/shared/constants/routes";
import type { PaginatedClubsResponse } from "@/features/clubs/api/clubs.api";
import { Stack } from "@/shared/layout";
import { ClubsPageHeader } from "@/features/clubs/components/ClubsPageHeader";
import { EmptyState } from "@/shared/feedback";

interface ClubsPageProps {
  initialDirectory: PaginatedClubsResponse | null;
  initialSchool: string;
}

export function ClubsPage({
  initialDirectory,
  initialSchool,
}: ClubsPageProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const { isAuthenticated: authed } = useAuthState();

  const clubsPage = useClubsPage({ initialDirectory, initialSchool });
  const { toggleCategory, clubs, isLoading, isError, refresh, totalItems, activeTab } = clubsPage;

  const savedClubIds = useSavedClubsStore(
    useShallow((state) => state.savedClubIds),
  );

  const showSignInPrompt =
    (activeTab === "followed" || activeTab === "claimed") && !authed;
  const showResults =
    !showSignInPrompt && !isError && (isLoading || clubs.length > 0);
  const showEmptyState =
    !showSignInPrompt && !isError && !isLoading && clubs.length === 0;

  return (
    <Stack gap={2}>
      <ClubsPageHeader
        state={clubsPage}
        count={isLoading ? null : totalItems}
        disabled={isLoading || isError}
      />

      {showSignInPrompt ? (
        <div className="flex flex-col items-center justify-center py-20 px-4 rounded-2xl bg-surface">
          <Bookmark className="size-10 text-muted-foreground mb-4" />
          <h3 className="text-lg font-semibold text-foreground mb-2">
            {activeTab === "followed"
              ? t("clubs.signInToViewClubs")
              : t("clubs.signInToViewClaimedClubs")}
          </h3>
          <p className="text-sm text-muted-foreground text-center max-w-sm mb-6">
            {activeTab === "followed"
              ? t("clubs.signInToViewClubsDesc")
              : t("clubs.signInToViewClaimedClubsDesc")}
          </p>
          <a
            href="/login"
            className="px-4 py-2 bg-primary text-primary-foreground font-medium rounded-xl text-sm hover:opacity-90 transition-opacity"
            id={
              activeTab === "followed"
                ? "followed-clubs-sign-in"
                : "claimed-clubs-sign-in"
            }
          >
            {t("events.signIn")}
          </a>
        </div>
      ) : isError ? (
        <EmptyState
          role="alert"
          title={t("errorBoundary.title")}
          action={
            <Button variant="outline" onClick={refresh}>
              {t("common.tryAgain")}
            </Button>
          }
        />
      ) : showResults ? (
        <ClubList
          clubs={clubs}
          savedClubIds={savedClubIds}
          isLoading={isLoading}
          resetKey={clubsPage.appliedQueryKey}
          onClubClick={(club) =>
            router.push(clubPagePath(club.id))
          }
          onCategoryClick={toggleCategory}
        />
      ) : null}

      {showEmptyState && (
        <ClubListEmptyState
          title={
            activeTab === "followed"
              ? t("clubs.noFollowedClubs")
              : activeTab === "claimed"
                ? t("clubs.noClaimedClubs")
                : t("clubs.noClubsFound")
          }
          description={
            activeTab === "followed"
              ? t("clubs.emptyClubsDesc")
              : activeTab === "claimed"
                ? t("clubs.emptyClaimedClubsDesc")
                : t("clubs.noClubsFoundDesc")
          }
          icon={
            activeTab === "followed" ? (
              <Bookmark className="size-8 text-muted-foreground" />
            ) : activeTab === "claimed" ? (
              <Building2 className="size-8 text-muted-foreground" />
            ) : (
              <Search className="size-8 text-muted-foreground" />
            )
          }
        />
      )}
    </Stack>
  );
}
