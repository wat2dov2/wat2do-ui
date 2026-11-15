import { useMemo } from "react";
import NextLink from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import { useRequestSchool } from "@/app/client-providers";
import { clubDirectoryQueryOptions, useSavedClubsStore } from "@/features/clubs";
import { ProfileRowsSkeleton } from "@/features/profile/components/ProfileEventSection";
import { clubPagePath } from "@/shared/constants/routes";
import { Section, Stack } from "@/shared/layout";
import { AvatarStack } from "@/shared/ui/avatar-stack";
import { Item, ItemContent, ItemMedia, ItemTitle } from "@/shared/ui/item";

/** The clubs the visitor follows at this school, each linked to its page. */
export function FollowedClubsSection() {
  const { t } = useTranslation();
  const school = useRequestSchool();
  const followedIds = useSavedClubsStore(useShallow((state) => state.savedClubIds));
  const followedLoaded = useSavedClubsStore((state) => state.hasLoaded);
  const directory = useQuery(clubDirectoryQueryOptions(school));
  const clubs = useMemo(() => {
    const followed = new Set(followedIds);
    return (directory.data?.items ?? [])
      .filter((club) => followed.has(club.id))
      .sort((left, right) => left.club_name.localeCompare(right.club_name));
  }, [directory.data, followedIds]);
  const isPending = !followedLoaded || directory.isPending;

  return (
    <Section
      title={t("profile.clubs.title")}
      description={!isPending && clubs.length === 0 ? t("profile.clubs.empty") : undefined}
    >
      {isPending ? (
        <ProfileRowsSkeleton />
      ) : clubs.length ? (
        <Stack gap={2}>
          {clubs.map((club) => (
            <Item key={club.id} variant="outline" size="sm" asChild>
              <NextLink href={clubPagePath(club.id)}>
                <ItemMedia>
                  <AvatarStack decorative avatars={[{ src: club.logo_url ?? "", name: club.club_name }]} />
                </ItemMedia>
                <ItemContent>
                  <ItemTitle>{club.club_name}</ItemTitle>
                </ItemContent>
              </NextLink>
            </Item>
          ))}
        </Stack>
      ) : null}
    </Section>
  );
}
