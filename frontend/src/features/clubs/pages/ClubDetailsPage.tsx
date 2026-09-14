"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  Bookmark,
  Discord,
  ExternalLink,
  HelpCircle,
  Instagram,
} from "@/shared/ui/doodle-icons";
import { Button } from "@/shared/ui/button";
import { LoadingPage } from "@/shared/ui/loading-page";
import { Link } from "@/shared/ui/link";
import { Separator } from "@/shared/ui/separator";
import { useAuthState } from "@/features/auth/hooks/useAuthState";
import { ClubEventsGrid } from "@/features/events/components/ClubEventsGrid";
import { ClubPositionsGrid } from "@/features/positions/components/ClubPositionsGrid";
import { ClaimClubModal } from "@/features/clubs/components/ClaimClubModal";
import { ClubCategoryBadges } from "@/features/clubs/components/ClubCategoryBadges";
import { getClubById } from "@/features/clubs/api/clubs.api";
import { useSavedClubsStore } from "@/features/clubs/store/savedClubs.store";
import { ROUTES } from "@/shared/constants/routes";
import { Container, PageHeader, Stack } from "@/shared/layout";
import { queryKeys } from "@/shared/lib/queryKeys";
import { sanitizeHref } from "@/shared/utils/url";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/ui/tabs";
import type { Event, Club, Position } from "@/shared/types";

interface ClubDetailsPageProps {
  clubId: number;
  initialClub: Club;
  initialEvents: Event[];
  initialPositions: Position[];
  schoolName: string;
}

interface ClubDetailsContentProps {
  club: Club;
  initialEvents: Event[];
  initialPositions: Position[];
  schoolName: string;
}

// Layout only: how the icon sits beside the label. The link's own appearance -
// colour, underline on hover - belongs to the Link primitive, not to this page.
const CLUB_LINK_CLASS = "flex items-center gap-2 text-sm";

function ClubDetailsContent({
  club,
  initialEvents,
  initialPositions,
  schoolName,
}: ClubDetailsContentProps) {
  const { t } = useTranslation();
  const { isAuthenticated, userId, clubs } = useAuthState();
  const [showClaimModal, setShowClaimModal] = useState(false);
  const toggleSave = useSavedClubsStore(
    (state) => state.toggleSaveClub,
  );
  const savedClubIds = useSavedClubsStore(
    (state) => state.savedClubIds,
  );
  const isSaved = savedClubIds.includes(club.id);
  const managesClub = club.created_by === userId || clubs.some((managedClub) => managedClub.id === club.id);
  const clubPageHref = sanitizeHref(club.club_page);
  const discordHref = sanitizeHref(club.discord ?? "");

  return (
    <>
      <Container size="lg">
        <Stack gap={6}>
          <PageHeader
            back={{
              href: ROUTES.CLUBS,
              label: t("clubs.allClubs"),
            }}
            title={club.club_name}
            description={schoolName}
            actionsPlacement="heading"
            actions={
              <Stack
                direction="horizontal"
                gap={2}
                align="center"
                wrap
                justify="end"
              >
                {isAuthenticated ? (
                  <Button
                    type="button"
                    variant="outline"
                    selected={isSaved}
                    onClick={() => toggleSave(club.id)}
                  >
                    <Bookmark
                      className={isSaved ? "size-4 fill-current" : "size-4"}
                    />
                    {isSaved
                      ? t("clubs.saved")
                      : t("clubs.save")}
                  </Button>
                ) : null}
                {isAuthenticated && !managesClub ? (
                  <Button type="button" onClick={() => setShowClaimModal(true)}>
                    {t("clubs.claimOwnership")}
                  </Button>
                ) : null}
              </Stack>
            }
          />

          <Stack gap={3}>
            <ClubCategoryBadges
              categories={club.categories}
              badgeClassName="text-xs px-2.5"
            />

            <Stack direction="horizontal" gap={4} align="center" wrap>
              {clubPageHref ? (
                <Link
                  href={clubPageHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={CLUB_LINK_CLASS}
                >
                  <ExternalLink className="size-4 text-muted-foreground" />
                  <span className="truncate">
                    {club.club_page}
                  </span>
                </Link>
              ) : null}
              {club.ig ? (
                <Link
                  href={`https://instagram.com/${club.ig}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={CLUB_LINK_CLASS}
                >
                  <Instagram className="size-4 text-muted-foreground" />
                  <span>@{club.ig}</span>
                </Link>
              ) : null}
              {discordHref ? (
                <Link
                  href={discordHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={CLUB_LINK_CLASS}
                >
                  <Discord className="size-4 text-muted-foreground" />
                  <span>{t("clubPanel.joinDiscord")}</span>
                </Link>
              ) : null}
            </Stack>

            {club.status !== "approved" ? (
              <div className="flex items-center gap-2 rounded-lg border border-warning/20 bg-warning/10 px-3 py-2 text-sm text-warning">
                <HelpCircle className="size-4 shrink-0" />
                <span>
                  {club.status === "rejected"
                    ? t("clubs.reviewRejected")
                    : t("clubs.awaitingReview")}
                </span>
              </div>
            ) : null}
          </Stack>

          <Separator />

          <Tabs defaultValue="events">
            <TabsList aria-label={t("clubs.activityTabsLabel")}>
              <TabsTrigger value="events">{t("navigation.events")}</TabsTrigger>
              <TabsTrigger value="positions">
                {t("navigation.positions")}
              </TabsTrigger>
            </TabsList>
            <TabsContent value="events" className="mt-6">
              <ClubEventsGrid
                clubId={club.id}
                school={club.school}
                initialEvents={initialEvents}
              />
            </TabsContent>
            <TabsContent value="positions" className="mt-6">
              <ClubPositionsGrid
                clubId={club.id}
                school={club.school}
                initialPositions={initialPositions}
              />
            </TabsContent>
          </Tabs>
        </Stack>
      </Container>

      <ClaimClubModal
        isOpen={showClaimModal}
        onClose={() => setShowClaimModal(false)}
        club={club}
      />
    </>
  );
}

export function ClubDetailsPage({
  clubId,
  initialClub,
  initialEvents,
  initialPositions,
  schoolName,
}: ClubDetailsPageProps) {
  const { t } = useTranslation();
  const {
    data: club,
    isPending,
    isError,
  } = useQuery({
    queryKey: queryKeys.clubs.detail(clubId),
    queryFn: () => getClubById(clubId),
    enabled: Number.isInteger(clubId) && clubId > 0,
    initialData: initialClub,
  });

  if (isPending && !isError) {
    return <LoadingPage className="min-h-[60dvh]" />;
  }

  if (isError || !club) {
    return (
      <Container size="sm" className="text-center">
        <p className="text-sm text-muted-foreground">
          {t("clubs.loadFailed")}
        </p>
      </Container>
    );
  }

  return (
    <ClubDetailsContent
      club={club}
      initialEvents={initialEvents}
      initialPositions={initialPositions}
      schoolName={schoolName}
    />
  );
}
